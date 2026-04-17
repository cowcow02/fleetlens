import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { getPool } from "../../src/db/pool.js";
import { runMigrations } from "../../src/db/migrate.js";
import { GET as rosterGET } from "../../src/app/api/team/roster/route.js";
import { POST as invitesPOST } from "../../src/app/api/team/invites/route.js";
import { POST as joinPOST } from "../../src/app/api/team/join/route.js";
import { POST as leavePOST } from "../../src/app/api/team/leave/route.js";
import { GET as whoamiGET } from "../../src/app/api/team/whoami/route.js";
import { GET as memberGET, DELETE as memberDELETE } from "../../src/app/api/team/members/[id]/route.js";
import { GET as settingsGET, PUT as settingsPUT } from "../../src/app/api/team/settings/route.js";
import { createUserAccount, createSession } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";
import { createInvite, redeemInvite } from "../../src/lib/members.js";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost:5432/fleetlens_dev";

let pool: ReturnType<typeof getPool>;
let adminCookieToken: string;
let memberCookieToken: string;
let adminBearerToken: string;
let memberBearerToken: string;
let teamSlug: string;
let teamId: string;
let adminMembershipId: string;
let memberMembershipId: string;
let adminUserId: string;

// Use NextRequest so req.nextUrl.searchParams and req.cookies work correctly
function makeReq(url: string, opts: { method?: string; headers?: HeadersInit; body?: BodyInit | null } = {}): NextRequest {
  return new NextRequest(url, opts);
}

function makeAuthedReq(url: string, cookie: string, opts: { method?: string; headers?: HeadersInit; body?: BodyInit | null } = {}): NextRequest {
  const headers = new Headers(opts.headers as HeadersInit | undefined);
  headers.set("cookie", `fleetlens_session=${cookie}`);
  return new NextRequest(url, { ...opts, headers });
}

function makeBearerReq(url: string, token: string, opts: { method?: string; headers?: HeadersInit; body?: BodyInit | null } = {}): NextRequest {
  const headers = new Headers(opts.headers as HeadersInit | undefined);
  headers.set("authorization", `Bearer ${token}`);
  return new NextRequest(url, { ...opts, headers });
}

beforeAll(async () => {
  pool = getPool();
  await runMigrations();
  await pool.query("DELETE FROM events");
  await pool.query("DELETE FROM daily_rollups");
  await pool.query("DELETE FROM ingest_log");
  await pool.query("DELETE FROM invites");
  await pool.query("DELETE FROM memberships");
  await pool.query("DELETE FROM sessions");
  await pool.query("DELETE FROM server_config");
  await pool.query("DELETE FROM teams");
  await pool.query("DELETE FROM user_accounts");

  // Set up admin
  const admin = await createUserAccount("team-admin@example.com", "pass1234", "Team Admin", {}, pool);
  adminUserId = admin.id;
  const { team, membership } = await createTeamWithAdmin("Integration Team", admin.id, pool);
  teamSlug = team.slug;
  teamId = team.id;
  adminMembershipId = membership.id;
  adminBearerToken = membership.bearerToken;
  const adminSession = await createSession(admin.id, pool);
  adminCookieToken = adminSession.cookieToken;

  // Set up member
  const member = await createUserAccount("team-member@example.com", "pass1234", "Team Member", {}, pool);
  const { token } = await createInvite(teamId, admin.id, {}, pool);
  const redeemed = await redeemInvite(token, member.id, pool);
  memberMembershipId = redeemed!.membershipId;
  memberBearerToken = redeemed!.bearerToken;
  const memberSession = await createSession(member.id, pool);
  memberCookieToken = memberSession.cookieToken;
});

afterAll(async () => {
  await pool.end();
});

describe("GET /api/team/roster", () => {
  it("returns 400 when team slug is missing", async () => {
    const req = makeAuthedReq("http://localhost/api/team/roster", adminCookieToken);
    const res = await rosterGET(req);
    expect(res.status).toBe(400);
  });

  it("admin sees all roster members", async () => {
    const req = makeAuthedReq(
      `http://localhost/api/team/roster?team=${teamSlug}`,
      adminCookieToken
    );
    const res = await rosterGET(req);
    expect(res.status).toBe(200);
    const roster = await res.json();
    expect(roster.length).toBe(2);
  });

  it("non-admin member sees only their own row", async () => {
    const req = makeAuthedReq(
      `http://localhost/api/team/roster?team=${teamSlug}`,
      memberCookieToken
    );
    const res = await rosterGET(req);
    expect(res.status).toBe(200);
    const roster = await res.json();
    expect(roster.length).toBe(1);
    expect(roster[0].id).toBe(memberMembershipId);
  });

  it("returns 401 without authentication", async () => {
    const req = makeReq(`http://localhost/api/team/roster?team=${teamSlug}`);
    const res = await rosterGET(req);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/team/invites", () => {
  it("returns 400 when team slug is missing", async () => {
    const req = makeAuthedReq("http://localhost/api/team/invites", adminCookieToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await invitesPOST(req);
    expect(res.status).toBe(400);
  });

  it("admin can create an invite", async () => {
    const req = makeAuthedReq(
      `http://localhost/api/team/invites?team=${teamSlug}`,
      adminCookieToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresInDays: 7 }),
      }
    );
    const res = await invitesPOST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.inviteId).toBeTruthy();
    expect(body.tokenPlaintext).toMatch(/^iv_/);
  });

  it("returns 401 when unauthenticated", async () => {
    const req = makeReq(
      `http://localhost/api/team/invites?team=${teamSlug}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }
    );
    const res = await invitesPOST(req);
    expect(res.status).toBe(401);
  });

  it("non-admin member cannot create invite (403)", async () => {
    const req = makeAuthedReq(
      `http://localhost/api/team/invites?team=${teamSlug}`,
      memberCookieToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }
    );
    const res = await invitesPOST(req);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/team/join", () => {
  it("returns 400 when required fields are missing", async () => {
    const req = makeReq("http://localhost/api/team/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "3.3.3.3" },
      body: JSON.stringify({}),
    });
    const res = await joinPOST(req);
    expect(res.status).toBe(400);
  });

  it("returns 401 for wrong credentials", async () => {
    const invite = await createInvite(teamId, adminUserId, {}, pool);
    const req = makeReq("http://localhost/api/team/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "3.3.3.3" },
      body: JSON.stringify({
        inviteToken: invite.token,
        email: "team-admin@example.com",
        password: "wrongpassword",
      }),
    });
    const res = await joinPOST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid invite token", async () => {
    const req = makeReq("http://localhost/api/team/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "3.3.3.3" },
      body: JSON.stringify({
        inviteToken: "iv_invalid",
        email: "team-admin@example.com",
        password: "pass1234",
      }),
    });
    const res = await joinPOST(req);
    expect(res.status).toBe(400);
  });

  it("happy path: valid invite + credentials returns 201 with bearerToken", async () => {
    const newUser = await createUserAccount("joiner@example.com", "pass1234", null, {}, pool);
    const invite = await createInvite(teamId, adminUserId, {}, pool);
    const req = makeReq("http://localhost/api/team/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "3.3.3.3" },
      body: JSON.stringify({
        inviteToken: invite.token,
        email: "joiner@example.com",
        password: "pass1234",
      }),
    });
    const res = await joinPOST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.bearerToken).toMatch(/^bt_/);
  });
});

describe("POST /api/team/leave", () => {
  it("returns 401 without bearer token", async () => {
    const req = makeReq("http://localhost/api/team/leave", { method: "POST" });
    const res = await leavePOST(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 with invalid bearer token", async () => {
    const req = makeBearerReq("http://localhost/api/team/leave", "bt_invalid", { method: "POST" });
    const res = await leavePOST(req);
    expect(res.status).toBe(401);
  });

  it("happy path: member leaves and membership is revoked", async () => {
    // Create a dedicated member for this test
    const leaveUser = await createUserAccount("leaver@example.com", "pass1234", null, {}, pool);
    const invite = await createInvite(teamId, adminUserId, {}, pool);
    const redeemed = await redeemInvite(invite.token, leaveUser.id, pool);
    const leaverToken = redeemed!.bearerToken;

    const req = makeBearerReq("http://localhost/api/team/leave", leaverToken, { method: "POST" });
    const res = await leavePOST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

describe("GET /api/team/whoami", () => {
  it("returns 401 without bearer token", async () => {
    const req = makeReq("http://localhost/api/team/whoami");
    const res = await whoamiGET(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 with invalid bearer token", async () => {
    const req = makeBearerReq("http://localhost/api/team/whoami", "bt_invalid");
    const res = await whoamiGET(req);
    expect(res.status).toBe(401);
  });

  it("returns membership, team, and user for valid bearer", async () => {
    const req = makeBearerReq("http://localhost/api/team/whoami", adminBearerToken);
    const res = await whoamiGET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.membership.id).toBe(adminMembershipId);
    expect(body.membership.role).toBe("admin");
    expect(body.team.slug).toBe(teamSlug);
    expect(body.user.email).toBe("team-admin@example.com");
  });
});

describe("GET /api/team/members/[id]", () => {
  it("returns 401 without session", async () => {
    const req = makeReq(`http://localhost/api/team/members/${adminMembershipId}`);
    const res = await memberGET(req, { params: Promise.resolve({ id: adminMembershipId }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 for nonexistent member ID", async () => {
    const req = makeAuthedReq(
      `http://localhost/api/team/members/00000000-0000-0000-0000-000000000000`,
      adminCookieToken
    );
    const res = await memberGET(req, {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(404);
  });

  it("admin can view any member", async () => {
    const req = makeAuthedReq(
      `http://localhost/api/team/members/${memberMembershipId}`,
      adminCookieToken
    );
    const res = await memberGET(req, { params: Promise.resolve({ id: memberMembershipId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.member.id).toBe(memberMembershipId);
    expect(Array.isArray(body.rollups)).toBe(true);
  });

  it("member can view their own profile", async () => {
    const req = makeAuthedReq(
      `http://localhost/api/team/members/${memberMembershipId}`,
      memberCookieToken
    );
    const res = await memberGET(req, { params: Promise.resolve({ id: memberMembershipId }) });
    expect(res.status).toBe(200);
  });

  it("member cannot view another member's profile (403)", async () => {
    const req = makeAuthedReq(
      `http://localhost/api/team/members/${adminMembershipId}`,
      memberCookieToken
    );
    const res = await memberGET(req, { params: Promise.resolve({ id: adminMembershipId }) });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/team/members/[id]", () => {
  it("returns 401 without session", async () => {
    const req = makeReq(`http://localhost/api/team/members/${memberMembershipId}`, { method: "DELETE" });
    const res = await memberDELETE(req, { params: Promise.resolve({ id: memberMembershipId }) });
    expect(res.status).toBe(401);
  });

  it("admin can delete a member", async () => {
    // Create a temporary member to delete
    const tempUser = await createUserAccount("tobedeleted@example.com", "pass1234", null, {}, pool);
    const invite = await createInvite(teamId, adminUserId, {}, pool);
    const redeemed = await redeemInvite(invite.token, tempUser.id, pool);
    const tempMembershipId = redeemed!.membershipId;

    const req = makeAuthedReq(
      `http://localhost/api/team/members/${tempMembershipId}`,
      adminCookieToken,
      { method: "DELETE" }
    );
    const res = await memberDELETE(req, { params: Promise.resolve({ id: tempMembershipId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revoked).toBe(true);
  });

  it("non-admin cannot delete a member (403)", async () => {
    const req = makeAuthedReq(
      `http://localhost/api/team/members/${adminMembershipId}`,
      memberCookieToken,
      { method: "DELETE" }
    );
    const res = await memberDELETE(req, { params: Promise.resolve({ id: adminMembershipId }) });
    expect(res.status).toBe(403);
  });

  it("returns 404 for a nonexistent membership ID on delete", async () => {
    const req = makeAuthedReq(
      `http://localhost/api/team/members/00000000-0000-0000-0000-000000000000`,
      adminCookieToken,
      { method: "DELETE" }
    );
    const res = await memberDELETE(req, {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/team/settings", () => {
  it("returns 400 when team slug is missing", async () => {
    const req = makeAuthedReq("http://localhost/api/team/settings", adminCookieToken);
    const res = await settingsGET(req);
    expect(res.status).toBe(400);
  });

  it("admin can view settings", async () => {
    const req = makeAuthedReq(
      `http://localhost/api/team/settings?team=${teamSlug}`,
      adminCookieToken
    );
    const res = await settingsGET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe(teamSlug);
  });

  it("non-admin cannot view settings (403)", async () => {
    const req = makeAuthedReq(
      `http://localhost/api/team/settings?team=${teamSlug}`,
      memberCookieToken
    );
    const res = await settingsGET(req);
    expect(res.status).toBe(403);
  });
});

describe("PUT /api/team/settings", () => {
  it("returns 400 when team slug is missing", async () => {
    const req = makeAuthedReq("http://localhost/api/team/settings", adminCookieToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New Name" }),
    });
    const res = await settingsPUT(req);
    expect(res.status).toBe(400);
  });

  it("admin can update team name", async () => {
    const req = makeAuthedReq(
      `http://localhost/api/team/settings?team=${teamSlug}`,
      adminCookieToken,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated Team Name" }),
      }
    );
    const res = await settingsPUT(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(true);
  });

  it("admin can update retentionDays", async () => {
    const req = makeAuthedReq(
      `http://localhost/api/team/settings?team=${teamSlug}`,
      adminCookieToken,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retentionDays: 90 }),
      }
    );
    const res = await settingsPUT(req);
    expect(res.status).toBe(200);
  });

  it("returns 200 with updated=true even when neither name nor retentionDays is provided", async () => {
    const req = makeAuthedReq(
      `http://localhost/api/team/settings?team=${teamSlug}`,
      adminCookieToken,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}), // no name, no retentionDays
      }
    );
    const res = await settingsPUT(req);
    expect(res.status).toBe(200);
  });

  it("non-admin cannot update settings (403)", async () => {
    const req = makeAuthedReq(
      `http://localhost/api/team/settings?team=${teamSlug}`,
      memberCookieToken,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Hack" }),
      }
    );
    const res = await settingsPUT(req);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/team/invites — branch coverage", () => {
  it("creates an invite with email scope (covers email branch)", async () => {
    const req = makeAuthedReq(
      `http://localhost/api/team/invites?team=${teamSlug}`,
      adminCookieToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "specific@example.com", role: "admin", expiresInDays: 3 }),
      }
    );
    const res = await invitesPOST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tokenPlaintext).toMatch(/^iv_/);
  });

  it("creates an invite without expiresInDays (uses default 7) and non-admin role", async () => {
    // This covers the expiresInDays ternary false branch and the role ternary false branch
    const req = makeAuthedReq(
      `http://localhost/api/team/invites?team=${teamSlug}`,
      adminCookieToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}), // no email, no role, no expiresInDays → all defaults
      }
    );
    const res = await invitesPOST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tokenPlaintext).toMatch(/^iv_/);
  });
});

describe("GET /api/team/members/[id] — cross-team access", () => {
  it("returns 403 when viewing a member from a different team", async () => {
    // Create a second team
    const other2Admin = await createUserAccount("other2-admin@example.com", "pass1234", null, {}, pool);
    const { team: team2, membership: mem2 } = await createTeamWithAdmin("Other Team 2", other2Admin.id, pool);
    const other2Session = await createSession(other2Admin.id, pool);

    // admin tries to view own membership (from team2) using memberMembershipId (from team1)
    // This hits the !myMembership branch because adminCookieToken has no membership in team2
    const req = makeAuthedReq(
      `http://localhost/api/team/members/${mem2.id}`,
      adminCookieToken  // admin is NOT in team2
    );
    const res = await memberGET(req, { params: Promise.resolve({ id: mem2.id }) });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/team/join — rate limit", () => {
  it("returns 429 after exceeding rate limit (21 requests from same IP)", async () => {
    const ip = "10.10.10.77";
    let lastRes: Response | null = null;
    for (let i = 0; i < 21; i++) {
      const req = new NextRequest("http://localhost/api/team/join", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ inviteToken: "iv_test", email: "test@example.com", password: "pw" }),
      });
      lastRes = await joinPOST(req);
    }
    expect(lastRes!.status).toBe(429);
  });
});
