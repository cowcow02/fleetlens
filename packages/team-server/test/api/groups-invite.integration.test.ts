import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { resetDb } from "../helpers/db.js";
import { getPool } from "../../src/db/pool.js";
import { createUserAccount, createSession } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";
import { createInvite, redeemInvite } from "../../src/lib/members.js";
import { createGroup, addGroupMember, setGroupMemberManager } from "../../src/lib/groups.js";
import { POST as inviteGroupPOST } from "../../src/app/api/team/[slug]/groups/[group]/invite/route.js";
import { POST as revokePOST } from "../../src/app/api/team/[slug]/invites/[id]/revoke/route.js";

let pool: ReturnType<typeof getPool>;
let teamSlug: string;
let teamId: string;
let adminUserId: string;
let adminCookieToken: string;
let managerCookieToken: string;
let managerMembershipId: string;
let plainMemberCookieToken: string;
let managedGroupId: string;
let managedGroupSlug: string;
let otherGroupId: string;

function authedReq(
  url: string,
  cookieToken: string,
  opts: { method?: string; body?: unknown } = {},
): NextRequest {
  const headers = new Headers();
  headers.set("cookie", `fleetlens_session=${cookieToken}`);
  if (opts.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, {
    method: opts.method,
    headers,
    body: opts.body === undefined ? null : JSON.stringify(opts.body),
  });
}

beforeAll(async () => {
  pool = await resetDb();
  const admin = await createUserAccount("invite-admin@example.com", "pass1234", "Admin", {}, pool);
  adminUserId = admin.id;
  const { team } = await createTeamWithAdmin("Invite Team", admin.id, pool);
  teamSlug = team.slug;
  teamId = team.id;
  const aSess = await createSession(admin.id, pool);
  adminCookieToken = aSess.cookieToken;

  // Manager: a regular member promoted to manager of `managed` group.
  const manager = await createUserAccount("invite-manager@example.com", "pass1234", "Mgr", {}, pool);
  const mInv = await createInvite(teamId, adminUserId, {}, pool);
  const mRed = await redeemInvite(mInv.token, manager.id, pool);
  managerMembershipId = mRed!.membershipId;
  const mSess = await createSession(manager.id, pool);
  managerCookieToken = mSess.cookieToken;

  // Plain member: not a manager of any group.
  const plain = await createUserAccount("invite-plain@example.com", "pass1234", "Plain", {}, pool);
  const pInv = await createInvite(teamId, adminUserId, {}, pool);
  await redeemInvite(pInv.token, plain.id, pool);
  const pSess = await createSession(plain.id, pool);
  plainMemberCookieToken = pSess.cookieToken;

  // Create two groups; manager manages only `managed`.
  const managed = await createGroup(teamId, "managed-grp", "Managed Group", adminUserId, pool);
  managedGroupId = managed.id;
  managedGroupSlug = managed.slug;
  await addGroupMember(managed.id, managerMembershipId, adminUserId, pool);
  await setGroupMemberManager(managed.id, managerMembershipId, true, adminUserId, pool);

  const other = await createGroup(teamId, "other-grp", "Other Group", adminUserId, pool);
  otherGroupId = other.id;
});

afterAll(async () => {
  await pool.end();
});

describe("manager invite API (POST /api/team/[slug]/groups/[group]/invite)", () => {
  it("manager can invite into a group they manage (200; invite has role=member and the manager's group)", async () => {
    const req = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/${managedGroupSlug}/invite`,
      managerCookieToken,
      { method: "POST", body: { email: "newbie@example.com" } },
    );
    const res = await inviteGroupPOST(req, {
      params: Promise.resolve({ slug: teamSlug, group: managedGroupSlug }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.tokenPlaintext).toMatch(/^iv_/);
    expect(json.inviteId).toBeTruthy();
    expect(json.joinUrl).toContain(`/signup?invite=${json.tokenPlaintext}`);

    const row = await pool.query<{ role: string; group_ids: string[] }>(
      "SELECT role, group_ids FROM invites WHERE id = $1",
      [json.inviteId],
    );
    expect(row.rows[0].role).toBe("member");
    expect(row.rows[0].group_ids).toContain(managedGroupId);
  });

  it("manager cannot include a group they don't manage (403)", async () => {
    const req = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/${managedGroupSlug}/invite`,
      managerCookieToken,
      { method: "POST", body: { email: "x@example.com", groupIds: [otherGroupId] } },
    );
    const res = await inviteGroupPOST(req, {
      params: Promise.resolve({ slug: teamSlug, group: managedGroupSlug }),
    });
    expect(res.status).toBe(403);
  });

  it("plain member (not manager of any group) gets 404", async () => {
    const req = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/${managedGroupSlug}/invite`,
      plainMemberCookieToken,
      { method: "POST", body: {} },
    );
    const res = await inviteGroupPOST(req, {
      params: Promise.resolve({ slug: teamSlug, group: managedGroupSlug }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects non-string groupIds element with 400", async () => {
    const req = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/${managedGroupSlug}/invite`,
      managerCookieToken,
      { method: "POST", body: { email: "x@example.com", groupIds: [123] } },
    );
    const res = await inviteGroupPOST(req, {
      params: Promise.resolve({ slug: teamSlug, group: managedGroupSlug }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/groupIds/);
  });

  it("admin cannot supply a foreign-team group id (400 'not in this team')", async () => {
    const otherAdmin = await createUserAccount("invite-other-admin@example.com", "pass1234", null, {}, pool);
    const { team: otherTeam } = await createTeamWithAdmin("Other Invite Team", otherAdmin.id, pool);
    const foreignGroup = await createGroup(otherTeam.id, "foreign-grp", "Foreign Group", otherAdmin.id, pool);

    const req = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/${managedGroupSlug}/invite`,
      adminCookieToken,
      { method: "POST", body: { email: "y@example.com", groupIds: [foreignGroup.id] } },
    );
    const res = await inviteGroupPOST(req, {
      params: Promise.resolve({ slug: teamSlug, group: managedGroupSlug }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/not in this team/);
  });

  it("dedup: second invite into the same group set returns 409", async () => {
    const first = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/${managedGroupSlug}/invite`,
      managerCookieToken,
      { method: "POST", body: {} },
    );
    const r1 = await inviteGroupPOST(first, {
      params: Promise.resolve({ slug: teamSlug, group: managedGroupSlug }),
    });
    expect(r1.status).toBe(201);
    const { inviteId: firstId } = await r1.json();

    const second = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/${managedGroupSlug}/invite`,
      managerCookieToken,
      { method: "POST", body: {} },
    );
    const r2 = await inviteGroupPOST(second, {
      params: Promise.resolve({ slug: teamSlug, group: managedGroupSlug }),
    });
    expect(r2.status).toBe(409);

    // state accumulates across tests; revoke so the next default-config create doesn't dedup-collide
    await pool.query("UPDATE invites SET revoked_at = now() WHERE id = $1", [firstId]);
  });

  it("manager can revoke a link whose group_ids is a subset of their managed groups", async () => {
    const create = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/${managedGroupSlug}/invite`,
      managerCookieToken,
      { method: "POST", body: {} },
    );
    const { inviteId } = await (await inviteGroupPOST(create, {
      params: Promise.resolve({ slug: teamSlug, group: managedGroupSlug }),
    })).json();

    const revoke = authedReq(
      `http://localhost/api/team/${teamSlug}/invites/${inviteId}/revoke`,
      managerCookieToken,
      { method: "POST" },
    );
    const res = await revokePOST(revoke, {
      params: Promise.resolve({ slug: teamSlug, id: inviteId }),
    });
    expect(res.status).toBe(200);

    const row = await pool.query<{ revoked_at: string | null }>(
      "SELECT revoked_at FROM invites WHERE id = $1",
      [inviteId],
    );
    expect(row.rows[0].revoked_at).not.toBeNull();
  });

  it("manager cannot revoke a link that includes a group they don't manage", async () => {
    const admin = authedReq(
      `http://localhost/api/team/invites?team=${teamSlug}`,
      adminCookieToken,
      { method: "POST", body: { role: "member", groupIds: [managedGroupId, otherGroupId] } },
    );
    const { POST: adminInvitePOST } = await import("../../src/app/api/team/invites/route.js");
    const { inviteId } = await (await adminInvitePOST(admin)).json();

    const revoke = authedReq(
      `http://localhost/api/team/${teamSlug}/invites/${inviteId}/revoke`,
      managerCookieToken,
      { method: "POST" },
    );
    const res = await revokePOST(revoke, {
      params: Promise.resolve({ slug: teamSlug, id: inviteId }),
    });
    expect(res.status).toBe(403);
  });
});
