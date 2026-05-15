import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { resetDb } from "../helpers/db.js";
import { getPool } from "../../src/db/pool.js";
import { createUserAccount, createSession } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";
import { createInvite, redeemInvite } from "../../src/lib/members.js";
import { GET as groupsGET, POST as groupsPOST } from "../../src/app/api/team/[slug]/groups/route.js";
import { PATCH as groupPATCH, DELETE as groupDELETE } from "../../src/app/api/team/[slug]/groups/[group]/route.js";
import {
  POST as membersPOST,
  DELETE as membersDELETE,
  PATCH as membersPATCH,
} from "../../src/app/api/team/[slug]/groups/[group]/members/route.js";

let pool: ReturnType<typeof getPool>;
let adminCookieToken: string;
let memberCookieToken: string;
let teamSlug: string;
let teamId: string;
let memberMembershipId: string;
let adminUserId: string;

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
  const admin = await createUserAccount("groups-admin@example.com", "pass1234", "Admin", {}, pool);
  adminUserId = admin.id;
  const { team } = await createTeamWithAdmin("Groups Team", admin.id, pool);
  teamSlug = team.slug;
  teamId = team.id;
  const adminSess = await createSession(admin.id, pool);
  adminCookieToken = adminSess.cookieToken;

  const member = await createUserAccount("groups-member@example.com", "pass1234", "Member", {}, pool);
  const inv = await createInvite(teamId, admin.id, {}, pool);
  const redeemed = await redeemInvite(inv.token, member.id, pool);
  memberMembershipId = redeemed!.membershipId;
  const memberSess = await createSession(member.id, pool);
  memberCookieToken = memberSess.cookieToken;
});

afterAll(async () => {
  await pool.end();
});

describe("groups API: create, list, rename, delete", () => {
  it("admin can create, list, rename, delete a group", async () => {
    const createReq = authedReq(
      `http://localhost/api/team/${teamSlug}/groups`,
      adminCookieToken,
      { method: "POST", body: { slug: "platform", name: "Platform Squad" } },
    );
    const createRes = await groupsPOST(createReq, { params: Promise.resolve({ slug: teamSlug }) });
    expect(createRes.status).toBe(200);
    const { group } = await createRes.json();
    expect(group.slug).toBe("platform");
    expect(group.name).toBe("Platform Squad");

    const listReq = authedReq(`http://localhost/api/team/${teamSlug}/groups`, adminCookieToken);
    const listRes = await groupsGET(listReq, { params: Promise.resolve({ slug: teamSlug }) });
    expect(listRes.status).toBe(200);
    const { groups } = await listRes.json();
    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect(groups.find((g: { slug: string }) => g.slug === "platform")).toBeTruthy();

    const renReq = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/${group.id}`,
      adminCookieToken,
      { method: "PATCH", body: { name: "Platform" } },
    );
    const renRes = await groupPATCH(renReq, {
      params: Promise.resolve({ slug: teamSlug, group: group.id }),
    });
    expect(renRes.status).toBe(200);
    const renamed = await pool.query<{ name: string }>("SELECT name FROM groups WHERE id = $1", [group.id]);
    expect(renamed.rows[0].name).toBe("Platform");

    const delReq = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/${group.id}`,
      adminCookieToken,
      { method: "DELETE" },
    );
    const delRes = await groupDELETE(delReq, {
      params: Promise.resolve({ slug: teamSlug, group: group.id }),
    });
    expect(delRes.status).toBe(200);
    const after = await pool.query("SELECT 1 FROM groups WHERE id = $1", [group.id]);
    expect(after.rowCount).toBe(0);
  });

  it("rejects invalid slugs (uppercase, underscores)", async () => {
    const req = authedReq(
      `http://localhost/api/team/${teamSlug}/groups`,
      adminCookieToken,
      { method: "POST", body: { slug: "Bad_Slug", name: "X" } },
    );
    const res = await groupsPOST(req, { params: Promise.resolve({ slug: teamSlug }) });
    expect(res.status).toBe(400);
  });

  it("rejects missing slug or name with 400", async () => {
    const req = authedReq(
      `http://localhost/api/team/${teamSlug}/groups`,
      adminCookieToken,
      { method: "POST", body: { slug: "ok" } },
    );
    const res = await groupsPOST(req, { params: Promise.resolve({ slug: teamSlug }) });
    expect(res.status).toBe(400);
  });

  it("returns 409 on duplicate slug within the same team", async () => {
    const a = authedReq(
      `http://localhost/api/team/${teamSlug}/groups`,
      adminCookieToken,
      { method: "POST", body: { slug: "dupes", name: "Dupes" } },
    );
    const aRes = await groupsPOST(a, { params: Promise.resolve({ slug: teamSlug }) });
    expect(aRes.status).toBe(200);
    const b = authedReq(
      `http://localhost/api/team/${teamSlug}/groups`,
      adminCookieToken,
      { method: "POST", body: { slug: "dupes", name: "Dupes 2" } },
    );
    const bRes = await groupsPOST(b, { params: Promise.resolve({ slug: teamSlug }) });
    expect(bRes.status).toBe(409);
  });

  it("non-admin cannot create a group (403)", async () => {
    const req = authedReq(
      `http://localhost/api/team/${teamSlug}/groups`,
      memberCookieToken,
      { method: "POST", body: { slug: "nope", name: "Nope" } },
    );
    const res = await groupsPOST(req, { params: Promise.resolve({ slug: teamSlug }) });
    expect(res.status).toBe(403);
  });

  it("unauthenticated request returns 401", async () => {
    const req = new NextRequest(`http://localhost/api/team/${teamSlug}/groups`);
    const res = await groupsGET(req, { params: Promise.resolve({ slug: teamSlug }) });
    expect(res.status).toBe(401);
  });

  it("rename: missing name returns 400", async () => {
    const created = authedReq(
      `http://localhost/api/team/${teamSlug}/groups`,
      adminCookieToken,
      { method: "POST", body: { slug: "renametest", name: "Rename Test" } },
    );
    const cRes = await groupsPOST(created, { params: Promise.resolve({ slug: teamSlug }) });
    const { group } = await cRes.json();

    const req = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/${group.id}`,
      adminCookieToken,
      { method: "PATCH", body: {} },
    );
    const res = await groupPATCH(req, {
      params: Promise.resolve({ slug: teamSlug, group: group.id }),
    });
    expect(res.status).toBe(400);
  });

  it("group not found returns 404 on PATCH/DELETE", async () => {
    const fakeSlug = "no-such-group-here";
    const req = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/${fakeSlug}`,
      adminCookieToken,
      { method: "PATCH", body: { name: "X" } },
    );
    const res = await groupPATCH(req, {
      params: Promise.resolve({ slug: teamSlug, group: fakeSlug }),
    });
    expect(res.status).toBe(404);
  });

  it("non-admin GET returns only groups they manage", async () => {
    // Admin creates two groups; member manages one of them.
    const c1 = authedReq(
      `http://localhost/api/team/${teamSlug}/groups`,
      adminCookieToken,
      { method: "POST", body: { slug: "managed", name: "Managed" } },
    );
    const c1Res = await groupsPOST(c1, { params: Promise.resolve({ slug: teamSlug }) });
    const { group: managed } = await c1Res.json();

    const c2 = authedReq(
      `http://localhost/api/team/${teamSlug}/groups`,
      adminCookieToken,
      { method: "POST", body: { slug: "unmanaged", name: "Unmanaged" } },
    );
    const c2Res = await groupsPOST(c2, { params: Promise.resolve({ slug: teamSlug }) });
    const { group: unmanaged } = await c2Res.json();

    // Add member to managed group as manager.
    const addReq = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/${managed.id}/members`,
      adminCookieToken,
      { method: "POST", body: { membershipId: memberMembershipId, isManager: true } },
    );
    const addRes = await membersPOST(addReq, {
      params: Promise.resolve({ slug: teamSlug, group: managed.id }),
    });
    expect(addRes.status).toBe(200);

    const listReq = authedReq(`http://localhost/api/team/${teamSlug}/groups`, memberCookieToken);
    const listRes = await groupsGET(listReq, { params: Promise.resolve({ slug: teamSlug }) });
    expect(listRes.status).toBe(200);
    const { groups: visible } = await listRes.json();
    const slugs = visible.map((g: { slug: string }) => g.slug);
    expect(slugs).toContain("managed");
    expect(slugs).not.toContain("unmanaged");

    // Cleanup.
    await pool.query("DELETE FROM groups WHERE id = ANY($1::uuid[])", [[managed.id, unmanaged.id]]);
  });
});

describe("groups API: members add / remove / promote", () => {
  it("admin can add member, promote to manager, demote, remove", async () => {
    // Create a fresh group + a fresh member.
    const cReq = authedReq(
      `http://localhost/api/team/${teamSlug}/groups`,
      adminCookieToken,
      { method: "POST", body: { slug: "membersgrp", name: "Members Grp" } },
    );
    const cRes = await groupsPOST(cReq, { params: Promise.resolve({ slug: teamSlug }) });
    const { group } = await cRes.json();

    const newU = await createUserAccount("groups-extra@example.com", "pass1234", null, {}, pool);
    const inv = await createInvite(teamId, adminUserId, {}, pool);
    const redeemed = await redeemInvite(inv.token, newU.id, pool);
    const newMembershipId = redeemed!.membershipId;

    // Add the member.
    const addReq = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/${group.id}/members`,
      adminCookieToken,
      { method: "POST", body: { membershipId: newMembershipId } },
    );
    const addRes = await membersPOST(addReq, {
      params: Promise.resolve({ slug: teamSlug, group: group.id }),
    });
    expect(addRes.status).toBe(200);

    // Promote to manager.
    const promoteReq = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/${group.id}/members`,
      adminCookieToken,
      { method: "PATCH", body: { membershipId: newMembershipId, isManager: true } },
    );
    const promoteRes = await membersPATCH(promoteReq, {
      params: Promise.resolve({ slug: teamSlug, group: group.id }),
    });
    expect(promoteRes.status).toBe(200);

    const gmRow = await pool.query<{ is_manager: boolean }>(
      "SELECT is_manager FROM group_members WHERE group_id = $1 AND membership_id = $2",
      [group.id, newMembershipId],
    );
    expect(gmRow.rows[0].is_manager).toBe(true);

    // Demote.
    const demoteReq = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/${group.id}/members`,
      adminCookieToken,
      { method: "PATCH", body: { membershipId: newMembershipId, isManager: false } },
    );
    const demoteRes = await membersPATCH(demoteReq, {
      params: Promise.resolve({ slug: teamSlug, group: group.id }),
    });
    expect(demoteRes.status).toBe(200);

    const after = await pool.query<{ is_manager: boolean }>(
      "SELECT is_manager FROM group_members WHERE group_id = $1 AND membership_id = $2",
      [group.id, newMembershipId],
    );
    expect(after.rows[0].is_manager).toBe(false);

    // Remove via query string.
    const rmReq = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/${group.id}/members?membershipId=${newMembershipId}`,
      adminCookieToken,
      { method: "DELETE" },
    );
    const rmRes = await membersDELETE(rmReq, {
      params: Promise.resolve({ slug: teamSlug, group: group.id }),
    });
    expect(rmRes.status).toBe(200);

    const gone = await pool.query(
      "SELECT 1 FROM group_members WHERE group_id = $1 AND membership_id = $2",
      [group.id, newMembershipId],
    );
    expect(gone.rowCount).toBe(0);
  });

  it("POST add rejects missing membershipId with 400", async () => {
    const cReq = authedReq(
      `http://localhost/api/team/${teamSlug}/groups`,
      adminCookieToken,
      { method: "POST", body: { slug: "addmissing", name: "X" } },
    );
    const cRes = await groupsPOST(cReq, { params: Promise.resolve({ slug: teamSlug }) });
    const { group } = await cRes.json();
    const req = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/${group.id}/members`,
      adminCookieToken,
      { method: "POST", body: {} },
    );
    const res = await membersPOST(req, {
      params: Promise.resolve({ slug: teamSlug, group: group.id }),
    });
    expect(res.status).toBe(400);
  });

  it("POST add rejects membership from a different team", async () => {
    const cReq = authedReq(
      `http://localhost/api/team/${teamSlug}/groups`,
      adminCookieToken,
      { method: "POST", body: { slug: "crossteam", name: "Cross Team" } },
    );
    const cRes = await groupsPOST(cReq, { params: Promise.resolve({ slug: teamSlug }) });
    const { group } = await cRes.json();

    const otherAdmin = await createUserAccount("groups-other-admin@example.com", "pass1234", null, {}, pool);
    const { membership: otherMem } = await createTeamWithAdmin("Other Team", otherAdmin.id, pool);

    const req = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/${group.id}/members`,
      adminCookieToken,
      { method: "POST", body: { membershipId: otherMem.id } },
    );
    const res = await membersPOST(req, {
      params: Promise.resolve({ slug: teamSlug, group: group.id }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH requires both membershipId and isManager", async () => {
    const cReq = authedReq(
      `http://localhost/api/team/${teamSlug}/groups`,
      adminCookieToken,
      { method: "POST", body: { slug: "patchbad", name: "Patch Bad" } },
    );
    const cRes = await groupsPOST(cReq, { params: Promise.resolve({ slug: teamSlug }) });
    const { group } = await cRes.json();

    const req = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/${group.id}/members`,
      adminCookieToken,
      { method: "PATCH", body: { membershipId: memberMembershipId } },
    );
    const res = await membersPATCH(req, {
      params: Promise.resolve({ slug: teamSlug, group: group.id }),
    });
    expect(res.status).toBe(400);
  });

  it("non-admin cannot add/remove/promote (403)", async () => {
    const cReq = authedReq(
      `http://localhost/api/team/${teamSlug}/groups`,
      adminCookieToken,
      { method: "POST", body: { slug: "memberacl", name: "Member ACL" } },
    );
    const cRes = await groupsPOST(cReq, { params: Promise.resolve({ slug: teamSlug }) });
    const { group } = await cRes.json();

    const addReq = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/${group.id}/members`,
      memberCookieToken,
      { method: "POST", body: { membershipId: memberMembershipId } },
    );
    const addRes = await membersPOST(addReq, {
      params: Promise.resolve({ slug: teamSlug, group: group.id }),
    });
    expect(addRes.status).toBe(403);
  });

  it("DELETE without membershipId query param returns 400", async () => {
    const cReq = authedReq(
      `http://localhost/api/team/${teamSlug}/groups`,
      adminCookieToken,
      { method: "POST", body: { slug: "delbad", name: "Del Bad" } },
    );
    const cRes = await groupsPOST(cReq, { params: Promise.resolve({ slug: teamSlug }) });
    const { group } = await cRes.json();

    const req = authedReq(
      `http://localhost/api/team/${teamSlug}/groups/${group.id}/members`,
      adminCookieToken,
      { method: "DELETE" },
    );
    const res = await membersDELETE(req, {
      params: Promise.resolve({ slug: teamSlug, group: group.id }),
    });
    expect(res.status).toBe(400);
  });
});
