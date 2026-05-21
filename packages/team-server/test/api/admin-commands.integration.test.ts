import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { resetDb } from "../helpers/db.js";
import { NextRequest } from "next/server";
import { getPool } from "../../src/db/pool.js";

const { POST } = await import("../../src/app/api/admin/members/[id]/commands/route.js");

const { createUserAccount, createSession } = await import("../../src/lib/auth.js");
const { createTeamWithAdmin } = await import("../../src/lib/teams.js");
const { generateToken, sha256 } = await import("../../src/lib/crypto.js");

let pool: ReturnType<typeof getPool>;

function makeReq(
  url: string,
  cookie: string | null,
  body: unknown,
): NextRequest {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (cookie) headers.set("cookie", `fleetlens_session=${cookie}`);
  return new NextRequest(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function makeUser(email: string) {
  const u = await createUserAccount(email, "pass1234", email, {}, pool);
  const { cookieToken } = await createSession(u.id, pool);
  return { id: u.id, cookie: cookieToken };
}

async function makeStaffUser(email: string) {
  const u = await createUserAccount(email, "pass1234", email, {}, pool);
  await pool.query("UPDATE user_accounts SET is_staff = true WHERE id = $1", [u.id]);
  const { cookieToken } = await createSession(u.id, pool);
  return { id: u.id, cookie: cookieToken };
}

async function addMember(teamId: string, userId: string, role: "admin" | "member" = "member") {
  const token = "bt_" + generateToken(32);
  const res = await pool.query<{ id: string }>(
    `INSERT INTO memberships (user_account_id, team_id, role, bearer_token_hash)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, teamId, role, sha256(token)],
  );
  return res.rows[0].id;
}

beforeAll(async () => {
  pool = await resetDb();
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query(
    "TRUNCATE TABLE events, sessions, memberships, user_accounts, teams RESTART IDENTITY CASCADE",
  );
});

const url = (membershipId: string) =>
  `http://localhost/api/admin/members/${membershipId}/commands`;

describe("POST /api/admin/members/[id]/commands", () => {
  it("returns 401 when there is no session cookie", async () => {
    const admin = await makeUser("admin1@example.com");
    const { team } = await createTeamWithAdmin("Team A", admin.id, pool);
    const targetUser = await makeUser("target1@example.com");
    const targetMembershipId = await addMember(team.id, targetUser.id, "member");

    const req = makeReq(url(targetMembershipId), null, {
      type: "backfill-activity",
      params: { days: 30 },
    });
    const res = await POST(req, { params: Promise.resolve({ id: targetMembershipId }) });
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller is a regular member (not admin/staff) of the target team", async () => {
    const admin = await makeUser("admin2@example.com");
    const { team } = await createTeamWithAdmin("Team B", admin.id, pool);
    const memberUser = await makeUser("plainmember@example.com");
    await addMember(team.id, memberUser.id, "member");
    const targetUser = await makeUser("target2@example.com");
    const targetMembershipId = await addMember(team.id, targetUser.id, "member");

    const req = makeReq(url(targetMembershipId), memberUser.cookie, {
      type: "backfill-activity",
      params: { days: 30 },
    });
    const res = await POST(req, { params: Promise.resolve({ id: targetMembershipId }) });
    expect(res.status).toBe(403);
  });

  it("returns 403 when the caller is admin of a different team than the target", async () => {
    const adminA = await makeUser("adminA@example.com");
    await createTeamWithAdmin("Team Alpha", adminA.id, pool);
    const adminB = await makeUser("adminB@example.com");
    const { team: teamB } = await createTeamWithAdmin("Team Beta", adminB.id, pool);
    const targetUser = await makeUser("targetB@example.com");
    const targetMembershipId = await addMember(teamB.id, targetUser.id, "member");

    const req = makeReq(url(targetMembershipId), adminA.cookie, {
      type: "backfill-activity",
      params: { days: 30 },
    });
    const res = await POST(req, { params: Promise.resolve({ id: targetMembershipId }) });
    expect(res.status).toBe(403);
  });

  it("returns 400 when type is missing or params.days is out of range", async () => {
    const admin = await makeUser("admin3@example.com");
    const { team } = await createTeamWithAdmin("Team C", admin.id, pool);
    const targetUser = await makeUser("target3@example.com");
    const targetMembershipId = await addMember(team.id, targetUser.id, "member");

    // Missing type
    const r1 = await POST(
      makeReq(url(targetMembershipId), admin.cookie, { params: { days: 30 } }),
      { params: Promise.resolve({ id: targetMembershipId }) },
    );
    expect(r1.status).toBe(400);

    // days = 0 (below min)
    const r2 = await POST(
      makeReq(url(targetMembershipId), admin.cookie, {
        type: "backfill-activity",
        params: { days: 0 },
      }),
      { params: Promise.resolve({ id: targetMembershipId }) },
    );
    expect(r2.status).toBe(400);

    // days = 366 (above max)
    const r3 = await POST(
      makeReq(url(targetMembershipId), admin.cookie, {
        type: "backfill-activity",
        params: { days: 366 },
      }),
      { params: Promise.resolve({ id: targetMembershipId }) },
    );
    expect(r3.status).toBe(400);
  });

  it("returns 201 with the new command for an admin enqueueing on a target in their team", async () => {
    const admin = await makeUser("admin4@example.com");
    const { team } = await createTeamWithAdmin("Team D", admin.id, pool);
    const targetUser = await makeUser("target4@example.com");
    const targetMembershipId = await addMember(team.id, targetUser.id, "member");

    const req = makeReq(url(targetMembershipId), admin.cookie, {
      type: "backfill-activity",
      params: { days: 30 },
    });
    const res = await POST(req, { params: Promise.resolve({ id: targetMembershipId }) });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; command_type: string; params: { days: number } };
    expect(body.id).toMatch(/^cmd_/);
    expect(body.command_type).toBe("backfill-activity");
    expect(body.params).toEqual({ days: 30 });

    // Row landed in the DB.
    const row = await pool.query<{ team_id: string; membership_id: string; issued_by_id: string }>(
      "SELECT team_id, membership_id, issued_by_id FROM member_commands WHERE id = $1",
      [body.id],
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0].team_id).toBe(team.id);
    expect(row.rows[0].membership_id).toBe(targetMembershipId);
    expect(row.rows[0].issued_by_id).toBe(admin.id);
  });

  it("returns 200 with the SAME id when the same type+params is enqueued twice (idempotent)", async () => {
    const admin = await makeUser("admin5@example.com");
    const { team } = await createTeamWithAdmin("Team E", admin.id, pool);
    const targetUser = await makeUser("target5@example.com");
    const targetMembershipId = await addMember(team.id, targetUser.id, "member");

    const payload = { type: "backfill-activity", params: { days: 30 } };

    const r1 = await POST(
      makeReq(url(targetMembershipId), admin.cookie, payload),
      { params: Promise.resolve({ id: targetMembershipId }) },
    );
    expect(r1.status).toBe(201);
    const b1 = (await r1.json()) as { id: string };

    const r2 = await POST(
      makeReq(url(targetMembershipId), admin.cookie, payload),
      { params: Promise.resolve({ id: targetMembershipId }) },
    );
    expect(r2.status).toBe(200);
    const b2 = (await r2.json()) as { id: string };
    expect(b2.id).toBe(b1.id);

    const count = await pool.query<{ c: string }>(
      "SELECT COUNT(*)::text AS c FROM member_commands WHERE membership_id = $1",
      [targetMembershipId],
    );
    expect(count.rows[0].c).toBe("1");
  });

  it("returns 201 with a NEW id when the same type is enqueued with different params", async () => {
    const admin = await makeUser("admin6@example.com");
    const { team } = await createTeamWithAdmin("Team F", admin.id, pool);
    const targetUser = await makeUser("target6@example.com");
    const targetMembershipId = await addMember(team.id, targetUser.id, "member");

    const r1 = await POST(
      makeReq(url(targetMembershipId), admin.cookie, {
        type: "backfill-activity",
        params: { days: 30 },
      }),
      { params: Promise.resolve({ id: targetMembershipId }) },
    );
    expect(r1.status).toBe(201);
    const b1 = (await r1.json()) as { id: string };

    const r2 = await POST(
      makeReq(url(targetMembershipId), admin.cookie, {
        type: "backfill-activity",
        params: { days: 90 },
      }),
      { params: Promise.resolve({ id: targetMembershipId }) },
    );
    expect(r2.status).toBe(201);
    const b2 = (await r2.json()) as { id: string };
    expect(b2.id).not.toBe(b1.id);
  });
});
