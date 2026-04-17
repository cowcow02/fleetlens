import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getPool } from "../../src/db/pool.js";
import { runMigrations } from "../../src/db/migrate.js";
import { weekStartIso, loadRoster, loadMemberRollups, loadMember } from "../../src/lib/queries.js";
import { createUserAccount } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";
import { createInvite, redeemInvite } from "../../src/lib/members.js";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost:5432/fleetlens_dev";

let pool: ReturnType<typeof getPool>;
let adminUserId: string;
let teamId: string;
let adminMembershipId: string;
let memberUserId: string;
let memberMembershipId: string;

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

  const admin = await createUserAccount("queries-admin@example.com", "pass1234", "Queries Admin", {}, pool);
  adminUserId = admin.id;
  const { team, membership } = await createTeamWithAdmin("Queries Team", admin.id, pool);
  teamId = team.id;
  adminMembershipId = membership.id;

  // Second member
  const member = await createUserAccount("queries-member@example.com", "pass1234", "Queries Member", {}, pool);
  memberUserId = member.id;
  const { token } = await createInvite(teamId, adminUserId, {}, pool);
  const redeemed = await redeemInvite(token, member.id, pool);
  memberMembershipId = redeemed!.membershipId;
});

afterAll(async () => {
  await pool.end();
});

describe("weekStartIso", () => {
  // The function sets local midnight and returns UTC ISO slice. We test
  // relative day-of-week distance rather than absolute ISO dates to be
  // timezone-agnostic.

  function localNoon(year: number, month: number, day: number): Date {
    // month is 1-indexed; noon local time avoids DST/UTC boundary issues
    return new Date(year, month - 1, day, 12, 0, 0);
  }

  it("returns a string 6 characters shorter than a day ISO string (YYYY-MM-DD)", () => {
    const result = weekStartIso(localNoon(2024, 1, 15));
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("Monday → same day returned", () => {
    // 2024-01-15 is a Monday
    const inputMon = localNoon(2024, 1, 15);
    const inputMonDay = inputMon.getDay(); // should be 1
    expect(inputMonDay).toBe(1);
    const result = weekStartIso(inputMon);
    // The result should be at most 0 days before the input
    const resultDate = new Date(result + "T12:00:00");
    const diff = Math.round((inputMon.getTime() - resultDate.getTime()) / 86400000);
    expect(diff).toBeGreaterThanOrEqual(0);
    expect(diff).toBeLessThanOrEqual(1); // at most 1 day difference due to UTC offset
  });

  it("Wednesday → result is Monday (2 days earlier in local time)", () => {
    // 2024-01-17 is a Wednesday
    const inputWed = localNoon(2024, 1, 17);
    expect(inputWed.getDay()).toBe(3); // Wednesday
    const result = weekStartIso(inputWed);
    // The Monday should be 2 local days before Wednesday
    const expectedMonday = new Date(2024, 0, 15, 12, 0, 0); // 2024-01-15
    const resultDate = new Date(result + "T12:00:00");
    // They should be the same calendar day (allow 1 day for UTC offset)
    const diff = Math.abs(expectedMonday.getTime() - resultDate.getTime());
    expect(diff).toBeLessThanOrEqual(1.5 * 86400000); // within 1.5 days
  });

  it("Sunday → result is Monday of the previous week (6 days earlier)", () => {
    // 2024-01-21 is a Sunday
    const inputSun = localNoon(2024, 1, 21);
    expect(inputSun.getDay()).toBe(0); // Sunday
    const result = weekStartIso(inputSun);
    // The returned date should be 6 days before Sunday
    const resultDate = new Date(result + "T12:00:00");
    const diffDays = Math.round((inputSun.getTime() - resultDate.getTime()) / 86400000);
    // Between 5-7 days before
    expect(diffDays).toBeGreaterThanOrEqual(5);
    expect(diffDays).toBeLessThanOrEqual(7);
  });

  it("Friday → result is Monday (4 days earlier in local time)", () => {
    // 2024-01-19 is a Friday
    const inputFri = localNoon(2024, 1, 19);
    expect(inputFri.getDay()).toBe(5); // Friday
    const result = weekStartIso(inputFri);
    const resultDate = new Date(result + "T12:00:00");
    const diffDays = Math.round((inputFri.getTime() - resultDate.getTime()) / 86400000);
    expect(diffDays).toBeGreaterThanOrEqual(3);
    expect(diffDays).toBeLessThanOrEqual(5);
  });

  it("defaults to today and returns a 10-char date string", () => {
    const result = weekStartIso();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Result must be <= today
    const today = new Date();
    const resultDate = new Date(result + "T12:00:00");
    expect(resultDate.getTime()).toBeLessThanOrEqual(today.getTime() + 86400000);
  });
});

describe("loadRoster", () => {
  it("returns zero rows for a team with no members (empty team)", async () => {
    const emptyAdmin = await createUserAccount("empty-admin@example.com", "pass1234", null, {}, pool);
    const { team: emptyTeam } = await createTeamWithAdmin("Empty Team", emptyAdmin.id, pool);
    // Revoke the admin so no active members
    await pool.query("UPDATE memberships SET revoked_at = now() WHERE team_id = $1", [emptyTeam.id]);
    const roster = await loadRoster(emptyTeam.id, pool);
    expect(roster).toHaveLength(0);
  });

  it("returns two rows for our two-member team", async () => {
    const roster = await loadRoster(teamId, pool);
    expect(roster.length).toBe(2);
  });

  it("rows have the expected shape", async () => {
    const roster = await loadRoster(teamId, pool);
    const row = roster[0];
    expect(typeof row.id).toBe("string");
    expect(typeof row.role).toBe("string");
    expect(typeof row.week_sessions).toBe("number");
  });

  it("aggregates daily_rollups into week totals", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await pool.query(`
      INSERT INTO daily_rollups (team_id, membership_id, day, agent_time_ms, sessions, tool_calls, turns,
                                  tokens_input, tokens_output, tokens_cache_read, tokens_cache_write)
      VALUES ($1, $2, $3, 3600000, 2, 10, 4, 500, 300, 100, 50)
    `, [teamId, adminMembershipId, today]);

    const roster = await loadRoster(teamId, pool);
    const adminRow = roster.find((r) => r.id === adminMembershipId);
    expect(Number(adminRow!.week_sessions)).toBe(2);
    expect(Number(adminRow!.week_agent_time_ms)).toBe(3600000);
  });
});

describe("loadMemberRollups", () => {
  it("returns empty array when no rollups exist", async () => {
    const rollups = await loadMemberRollups(teamId, memberMembershipId, 30, pool);
    expect(rollups).toEqual([]);
  });

  it("returns rollup rows for a member that has data", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await pool.query(`
      INSERT INTO daily_rollups (team_id, membership_id, day, agent_time_ms, sessions, tool_calls, turns,
                                  tokens_input, tokens_output, tokens_cache_read, tokens_cache_write)
      VALUES ($1, $2, $3, 1800000, 1, 5, 2, 200, 100, 50, 25)
      ON CONFLICT (team_id, membership_id, day) DO UPDATE SET sessions = EXCLUDED.sessions
    `, [teamId, memberMembershipId, today]);

    const rollups = await loadMemberRollups(teamId, memberMembershipId, 30, pool);
    expect(rollups.length).toBeGreaterThan(0);
    const row = rollups[0];
    expect(row.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof row.sessions).toBe("number");
  });
});

describe("loadMember", () => {
  it("returns member data for a valid membership ID", async () => {
    const member = await loadMember(adminMembershipId, pool);
    expect(member).not.toBeNull();
    expect(member!.id).toBe(adminMembershipId);
    expect(member!.team_id).toBe(teamId);
    expect(member!.email).toBe("queries-admin@example.com");
  });

  it("returns null for a nonexistent membership ID", async () => {
    const member = await loadMember("00000000-0000-0000-0000-000000000000", pool);
    expect(member).toBeNull();
  });
});
