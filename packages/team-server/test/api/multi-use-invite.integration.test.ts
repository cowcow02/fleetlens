import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { resetDb } from "../helpers/db.js";
import { getPool } from "../../src/db/pool.js";
import { createUserAccount, createSession } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";
import { createInvite, redeemInvite } from "../../src/lib/members.js";
import { POST as adminInvitePOST } from "../../src/app/api/team/invites/route.js";
import { POST as revokePOST } from "../../src/app/api/team/[slug]/invites/[id]/revoke/route.js";
import { GET as listGET } from "../../src/app/api/team/[slug]/invites/route.js";

let pool: ReturnType<typeof getPool>;

function authedReq(url: string, cookieToken: string, opts: { method?: string; body?: unknown } = {}): NextRequest {
  const headers = new Headers();
  headers.set("cookie", `fleetlens_session=${cookieToken}`);
  if (opts.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, {
    method: opts.method,
    headers,
    body: opts.body === undefined ? null : JSON.stringify(opts.body),
  });
}

beforeEach(async () => {
  pool = await resetDb();
});

afterAll(async () => {
  await pool.end();
});

describe("multi-use invite links", () => {
  it("create-list-revoke roundtrip: same link redeems for two users, third call after revoke fails", async () => {
    const admin = await createUserAccount("admin@acme.com", "adminpass1", "Admin", { isStaff: true }, pool);
    const { team } = await createTeamWithAdmin("Acme", admin.id, pool);
    const adminSess = await createSession(admin.id, pool);

    const createRes = await adminInvitePOST(
      authedReq(`http://localhost/api/team/invites?team=${team.slug}`, adminSess.cookieToken, {
        method: "POST",
        body: { role: "member", label: "Q2 hires" },
      }),
    );
    expect(createRes.status).toBe(201);
    const { tokenPlaintext, inviteId } = await createRes.json();
    expect(tokenPlaintext).toMatch(/^iv_/);

    const alice = await createUserAccount("alice@acme.com", "alicepass1", "Alice", {}, pool);
    const r1 = await redeemInvite(tokenPlaintext, alice.id, pool);
    expect(r1?.membershipId).toBeTruthy();

    const bob = await createUserAccount("bob@acme.com", "bobpass1234", "Bob", {}, pool);
    const r2 = await redeemInvite(tokenPlaintext, bob.id, pool);
    expect(r2?.membershipId).toBeTruthy();
    expect(r2!.membershipId).not.toBe(r1!.membershipId);

    const listRes = await listGET(
      authedReq(`http://localhost/api/team/${team.slug}/invites`, adminSess.cookieToken),
      { params: Promise.resolve({ slug: team.slug }) },
    );
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    const found = listBody.invites.find((i: any) => i.id === inviteId);
    expect(found).toBeTruthy();
    expect(found.label).toBe("Q2 hires");
    expect(found.redemptionCount).toBe(2);
    expect(found.token).toBe(tokenPlaintext);
    expect(found.joinUrl).toContain(tokenPlaintext);

    const revRes = await revokePOST(
      authedReq(`http://localhost/api/team/${team.slug}/invites/${inviteId}/revoke`, adminSess.cookieToken, { method: "POST" }),
      { params: Promise.resolve({ slug: team.slug, id: inviteId }) },
    );
    expect(revRes.status).toBe(200);

    const cara = await createUserAccount("cara@acme.com", "carapass1", "Cara", {}, pool);
    const r3 = await redeemInvite(tokenPlaintext, cara.id, pool);
    expect(r3).toBeNull();

    const list2 = await (await listGET(
      authedReq(`http://localhost/api/team/${team.slug}/invites`, adminSess.cookieToken),
      { params: Promise.resolve({ slug: team.slug }) },
    )).json();
    expect(list2.invites.find((i: any) => i.id === inviteId)).toBeUndefined();
  });

  it("dedup: creating a second active link with the same (role, group_set) returns 409", async () => {
    const admin = await createUserAccount("admin@acme.com", "adminpass1", "Admin", { isStaff: true }, pool);
    const { team } = await createTeamWithAdmin("Acme", admin.id, pool);
    const adminSess = await createSession(admin.id, pool);

    const first = await adminInvitePOST(
      authedReq(`http://localhost/api/team/invites?team=${team.slug}`, adminSess.cookieToken, {
        method: "POST",
        body: { role: "member" },
      }),
    );
    expect(first.status).toBe(201);

    const second = await adminInvitePOST(
      authedReq(`http://localhost/api/team/invites?team=${team.slug}`, adminSess.cookieToken, {
        method: "POST",
        body: { role: "member" },
      }),
    );
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error).toMatch(/already exists/i);
  });

  it("dedup allows a different (role, group_set) — admin link coexists with member link", async () => {
    const admin = await createUserAccount("admin@acme.com", "adminpass1", "Admin", { isStaff: true }, pool);
    const { team } = await createTeamWithAdmin("Acme", admin.id, pool);
    const adminSess = await createSession(admin.id, pool);

    const m = await adminInvitePOST(
      authedReq(`http://localhost/api/team/invites?team=${team.slug}`, adminSess.cookieToken, {
        method: "POST",
        body: { role: "member" },
      }),
    );
    expect(m.status).toBe(201);

    const a = await adminInvitePOST(
      authedReq(`http://localhost/api/team/invites?team=${team.slug}`, adminSess.cookieToken, {
        method: "POST",
        body: { role: "admin" },
      }),
    );
    expect(a.status).toBe(201);
  });

  it("single-use email-scoped invite still auto-revokes on first redemption", async () => {
    const admin = await createUserAccount("admin@acme.com", "adminpass1", "Admin", { isStaff: true }, pool);
    const { team } = await createTeamWithAdmin("Acme", admin.id, pool);

    const inv = await createInvite(team.id, admin.id, { email: "bob@acme.com" }, pool);
    const bob = await createUserAccount("bob@acme.com", "bobpass1234", "Bob", {}, pool);

    const first = await redeemInvite(inv.token, bob.id, pool);
    expect(first?.membershipId).toBeTruthy();

    const row = await pool.query<{ revoked_at: string | null }>(
      "SELECT revoked_at FROM invites WHERE id = $1",
      [inv.inviteId],
    );
    expect(row.rows[0].revoked_at).not.toBeNull();

    const second = await redeemInvite(inv.token, bob.id, pool);
    expect(second).toBeNull();
  });
});
