import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db.js";
import { getPool } from "../../src/db/pool.js";

// The route reads the session token via next/headers `cookies()`, which needs a
// Next request context vitest workers don't provide. Mock it to a mutable ref
// (hoisted above the import) so each test can set the caller's cookie.
const { cookieRef } = vi.hoisted(() => ({ cookieRef: { value: undefined as string | undefined } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "fleetlens_session" && cookieRef.value ? { value: cookieRef.value } : undefined,
  }),
}));

const { GET } = await import(
  "../../src/app/api/team/[slug]/members/[id]/daemon-log/route.js"
);
const { createUserAccount, createSession } = await import("../../src/lib/auth.js");
const { createTeamWithAdmin } = await import("../../src/lib/teams.js");
const { createInvite, redeemInvite } = await import("../../src/lib/members.js");

let pool: ReturnType<typeof getPool>;

function makeReq(memberId: string, query = ""): Request {
  return new Request(`http://localhost/api/team/acme/members/${memberId}/daemon-log${query}`);
}

function ctx(slug: string, id: string) {
  return { params: Promise.resolve({ slug, id }) };
}

async function seedLog(teamId: string, membershipId: string, count: number) {
  const vals: unknown[] = [];
  const tuples: string[] = [];
  for (let i = 0; i < count; i++) {
    const b = i * 4;
    const ts = new Date(Date.UTC(2026, 6, 1, 0, i, 0)).toISOString();
    vals.push(teamId, membershipId, ts, `[sync] ok · #${i}`);
    tuples.push(`($${b + 1}, $${b + 2}, $${b + 3}, 'info', $${b + 4})`);
  }
  await pool.query(
    `INSERT INTO member_daemon_log (team_id, membership_id, ts, level, msg) VALUES ${tuples.join(",")}`,
    vals,
  );
}

beforeAll(async () => {
  pool = await resetDb();
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  cookieRef.value = undefined;
  await pool.query(
    "TRUNCATE TABLE member_daemon_log, group_members, groups, events, sessions, memberships, invites, user_accounts, teams RESTART IDENTITY CASCADE",
  );
});

describe("GET /api/team/[slug]/members/[id]/daemon-log", () => {
  it("returns 401 without a session cookie", async () => {
    const res = await GET(makeReq("00000000-0000-0000-0000-000000000000"), ctx("acme", "00000000-0000-0000-0000-000000000000"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the member does not exist", async () => {
    const admin = await createUserAccount("dl-admin@example.com", "pass1234", "Admin", {}, pool);
    await createTeamWithAdmin("Acme", admin.id, pool);
    cookieRef.value = (await createSession(admin.id, pool)).cookieToken;
    const missing = "11111111-1111-1111-1111-111111111111";
    const res = await GET(makeReq(missing), ctx("acme", missing));
    expect(res.status).toBe(404);
  });

  it("returns 403 for a viewer who is not a member of the target's team", async () => {
    const adminA = await createUserAccount("dl-admin-a@example.com", "pass1234", "A", {}, pool);
    const { team: teamA, membership: adminAMembership } = await createTeamWithAdmin("Team A", adminA.id, pool);
    await seedLog(teamA.id, adminAMembership.id, 3);

    // An admin of a *different* team has a valid session but no membership in team A.
    const adminB = await createUserAccount("dl-admin-b@example.com", "pass1234", "B", {}, pool);
    await createTeamWithAdmin("Team B", adminB.id, pool);
    cookieRef.value = (await createSession(adminB.id, pool)).cookieToken;

    const res = await GET(makeReq(adminAMembership.id), ctx("team-a", adminAMembership.id));
    expect(res.status).toBe(403);
  });

  it("returns 403 for a plain member viewing another plain member", async () => {
    const admin = await createUserAccount("dl-admin-c@example.com", "pass1234", "Admin", {}, pool);
    const { team } = await createTeamWithAdmin("Team C", admin.id, pool);

    const viewerUser = await createUserAccount("dl-viewer@example.com", "pass1234", "Viewer", {}, pool);
    const targetUser = await createUserAccount("dl-target@example.com", "pass1234", "Target", {}, pool);
    const inv1 = await createInvite(team.id, admin.id, {}, pool);
    await redeemInvite(inv1.token, viewerUser.id, pool);
    const inv2 = await createInvite(team.id, admin.id, {}, pool);
    const targetM = (await redeemInvite(inv2.token, targetUser.id, pool))!.membershipId;

    cookieRef.value = (await createSession(viewerUser.id, pool)).cookieToken;
    const res = await GET(makeReq(targetM), ctx("team-c", targetM));
    expect(res.status).toBe(403);
  });

  it("returns the newest page with rows + nextCursor for an admin viewer", async () => {
    const admin = await createUserAccount("dl-admin-d@example.com", "pass1234", "Admin", {}, pool);
    const { team } = await createTeamWithAdmin("Team D", admin.id, pool);
    const targetUser = await createUserAccount("dl-target-d@example.com", "pass1234", "Target", {}, pool);
    const inv = await createInvite(team.id, admin.id, {}, pool);
    const targetM = (await redeemInvite(inv.token, targetUser.id, pool))!.membershipId;
    await seedLog(team.id, targetM, 120);

    cookieRef.value = (await createSession(admin.id, pool)).cookieToken;
    const res = await GET(makeReq(targetM), ctx("team-d", targetM));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Array<{ id: number; msg: string }>; nextCursor: number | null };
    expect(body.rows).toHaveLength(50);
    expect(body.rows[0].msg).toBe("[sync] ok · #119"); // newest first
    expect(body.nextCursor).toBe(body.rows[49].id);
  });

  it("pages strictly older with the before cursor", async () => {
    const admin = await createUserAccount("dl-admin-e@example.com", "pass1234", "Admin", {}, pool);
    const { team } = await createTeamWithAdmin("Team E", admin.id, pool);
    const targetUser = await createUserAccount("dl-target-e@example.com", "pass1234", "Target", {}, pool);
    const inv = await createInvite(team.id, admin.id, {}, pool);
    const targetM = (await redeemInvite(inv.token, targetUser.id, pool))!.membershipId;
    await seedLog(team.id, targetM, 120);
    cookieRef.value = (await createSession(admin.id, pool)).cookieToken;

    const first = (await (await GET(makeReq(targetM), ctx("team-e", targetM))).json()) as {
      rows: Array<{ id: number }>;
      nextCursor: number;
    };
    const res = await GET(makeReq(targetM, `?before=${first.nextCursor}`), ctx("team-e", targetM));
    const second = (await res.json()) as { rows: Array<{ id: number; msg: string }> };
    expect(second.rows).toHaveLength(50);
    const minFirst = Math.min(...first.rows.map((r) => r.id));
    expect(Math.max(...second.rows.map((r) => r.id))).toBeLessThan(minFirst);
    expect(second.rows[0].msg).toBe("[sync] ok · #69");
  });

  it("after mode returns only rows newer than the cursor, newest-first", async () => {
    const admin = await createUserAccount("dl-admin-f@example.com", "pass1234", "Admin", {}, pool);
    const { team } = await createTeamWithAdmin("Team F", admin.id, pool);
    const targetUser = await createUserAccount("dl-target-f@example.com", "pass1234", "Target", {}, pool);
    const inv = await createInvite(team.id, admin.id, {}, pool);
    const targetM = (await redeemInvite(inv.token, targetUser.id, pool))!.membershipId;
    await seedLog(team.id, targetM, 10);
    cookieRef.value = (await createSession(admin.id, pool)).cookieToken;

    const all = (await (await GET(makeReq(targetM), ctx("team-f", targetM))).json()) as {
      rows: Array<{ id: number; msg: string }>;
    };
    const at7 = all.rows.find((r) => r.msg.endsWith("#7"))!;
    const res = await GET(makeReq(targetM, `?after=${at7.id}`), ctx("team-f", targetM));
    const page = (await res.json()) as { rows: Array<{ msg: string }>; nextCursor: number | null };
    expect(page.rows.map((r) => r.msg)).toEqual(["[sync] ok · #9", "[sync] ok · #8"]);
    expect(page.nextCursor).toBeNull();
  });

  it("treats a non-numeric before cursor as no cursor (newest page)", async () => {
    const admin = await createUserAccount("dl-admin-g@example.com", "pass1234", "Admin", {}, pool);
    const { team } = await createTeamWithAdmin("Team G", admin.id, pool);
    const targetUser = await createUserAccount("dl-target-g@example.com", "pass1234", "Target", {}, pool);
    const inv = await createInvite(team.id, admin.id, {}, pool);
    const targetM = (await redeemInvite(inv.token, targetUser.id, pool))!.membershipId;
    await seedLog(team.id, targetM, 5);
    cookieRef.value = (await createSession(admin.id, pool)).cookieToken;

    const res = await GET(makeReq(targetM, "?before=abc"), ctx("team-g", targetM));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Array<{ msg: string }> };
    expect(body.rows[0].msg).toBe("[sync] ok · #4");
  });
});
