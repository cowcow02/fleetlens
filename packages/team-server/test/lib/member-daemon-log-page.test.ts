import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resetDb } from "../helpers/db.js";
import { getPool } from "../../src/db/pool.js";
import { createUserAccount } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";
import { loadMemberDaemonLogPage } from "../../src/lib/plan-queries.js";

let pool: ReturnType<typeof getPool>;
let teamId: string;
let membershipId: string;

beforeAll(async () => {
  pool = await resetDb();
  const admin = await createUserAccount("dlog-admin@example.com", "pass1234", null, {}, pool);
  const { team, membership } = await createTeamWithAdmin("DLog Team", admin.id, pool);
  teamId = team.id;
  membershipId = membership.id;

  // 120 lines, oldest → newest so bigserial id order == chronological order.
  const vals: unknown[] = [];
  const tuples: string[] = [];
  for (let i = 0; i < 120; i++) {
    const b = i * 4;
    const ts = new Date(Date.UTC(2026, 6, 1, 0, i, 0)).toISOString();
    vals.push(teamId, membershipId, ts, `[sync] ok · auto · #${i}`);
    tuples.push(`($${b + 1}, $${b + 2}, $${b + 3}, 'info', $${b + 4})`);
  }
  await pool.query(
    `INSERT INTO member_daemon_log (team_id, membership_id, ts, level, msg) VALUES ${tuples.join(",")}`,
    vals,
  );
});

afterAll(async () => {
  await pool.end();
});

describe("loadMemberDaemonLogPage", () => {
  it("returns the newest page first with a nextCursor", async () => {
    const page = await loadMemberDaemonLogPage(teamId, membershipId, pool, { limit: 50 });
    expect(page.rows).toHaveLength(50);
    expect(page.rows[0].msg).toBe("[sync] ok · auto · #119"); // newest
    expect(page.rows[49].msg).toBe("[sync] ok · auto · #70");
    expect(page.nextCursor).toBe(page.rows[49].id);
  });

  it("pages strictly older with the before cursor and no overlap", async () => {
    const first = await loadMemberDaemonLogPage(teamId, membershipId, pool, { limit: 50 });
    const second = await loadMemberDaemonLogPage(teamId, membershipId, pool, {
      limit: 50,
      before: first.nextCursor!,
    });
    expect(second.rows).toHaveLength(50);
    // Every id in page 2 is strictly less than the smallest id in page 1.
    const minFirst = Math.min(...first.rows.map((r) => r.id));
    expect(Math.max(...second.rows.map((r) => r.id))).toBeLessThan(minFirst);
    expect(second.rows[0].msg).toBe("[sync] ok · auto · #69");
  });

  it("ends with nextCursor=null at the tail", async () => {
    const p1 = await loadMemberDaemonLogPage(teamId, membershipId, pool, { limit: 50 });
    const p2 = await loadMemberDaemonLogPage(teamId, membershipId, pool, { limit: 50, before: p1.nextCursor! });
    const p3 = await loadMemberDaemonLogPage(teamId, membershipId, pool, { limit: 50, before: p2.nextCursor! });
    expect(p3.rows).toHaveLength(20); // 120 - 50 - 50
    expect(p3.nextCursor).toBeNull();
  });

  it("scopes to the membership (no cross-member leakage)", async () => {
    const other = await createUserAccount("dlog-other@example.com", "pass1234", null, {}, pool);
    const res = await pool.query<{ id: string }>(
      `INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1, $2, 'member') RETURNING id`,
      [other.id, teamId],
    );
    const otherMembershipId = res.rows[0].id;
    const page = await loadMemberDaemonLogPage(teamId, otherMembershipId, pool, { limit: 50 });
    expect(page.rows).toHaveLength(0);
    expect(page.nextCursor).toBeNull();
  });
});
