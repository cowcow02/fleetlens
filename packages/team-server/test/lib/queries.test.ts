import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resetDb } from "../helpers/db.js";
import { getPool } from "../../src/db/pool.js";
import { rangeStartIso, loadRoster, loadMemberRollups, loadMember } from "../../src/lib/queries.js";
import { createUserAccount } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";
import { createInvite, redeemInvite } from "../../src/lib/members.js";
let pool: ReturnType<typeof getPool>;
let adminUserId: string;
let teamId: string;
let adminMembershipId: string;
let memberUserId: string;
let memberMembershipId: string;

beforeAll(async () => {
  pool = await resetDb();
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

describe("rangeStartIso", () => {
  // Tests "today + (days-1) prior calendar days" semantics. Local midnight
  // → UTC ISO slice, so we use noon local to avoid timezone edge cases.
  function localNoon(year: number, month: number, day: number): Date {
    return new Date(year, month - 1, day, 12, 0, 0);
  }

  it("returns YYYY-MM-DD", () => {
    const result = rangeStartIso(7, localNoon(2024, 1, 15));
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("7 days from a Monday → previous Tuesday (6 calendar days earlier)", () => {
    const inputMon = localNoon(2024, 1, 15);
    const result = rangeStartIso(7, inputMon);
    const resultDate = new Date(result + "T12:00:00");
    const diffDays = Math.round((inputMon.getTime() - resultDate.getTime()) / 86400000);
    // Allow ±1 day for UTC offset
    expect(diffDays).toBeGreaterThanOrEqual(5);
    expect(diffDays).toBeLessThanOrEqual(7);
  });

  it("30 days → ~29 days earlier", () => {
    const input = localNoon(2024, 3, 31);
    const result = rangeStartIso(30, input);
    const resultDate = new Date(result + "T12:00:00");
    const diffDays = Math.round((input.getTime() - resultDate.getTime()) / 86400000);
    expect(diffDays).toBeGreaterThanOrEqual(28);
    expect(diffDays).toBeLessThanOrEqual(30);
  });

  it("90 days → ~89 days earlier", () => {
    const input = localNoon(2024, 6, 1);
    const result = rangeStartIso(90, input);
    const resultDate = new Date(result + "T12:00:00");
    const diffDays = Math.round((input.getTime() - resultDate.getTime()) / 86400000);
    expect(diffDays).toBeGreaterThanOrEqual(88);
    expect(diffDays).toBeLessThanOrEqual(90);
  });

  it("defaults `now` to today", () => {
    const result = rangeStartIso(7);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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
    const roster = await loadRoster(emptyTeam.id, 7, pool);
    expect(roster).toHaveLength(0);
  });

  it("returns two rows for our two-member team", async () => {
    const roster = await loadRoster(teamId, 7, pool);
    expect(roster.length).toBe(2);
  });

  it("rows have the expected shape", async () => {
    const roster = await loadRoster(teamId, 7, pool);
    const row = roster[0];
    expect(typeof row.id).toBe("string");
    expect(typeof row.role).toBe("string");
    expect(typeof row.range_sessions).toBe("number");
  });

  it("aggregates daily_rollups into range totals", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await pool.query(`
      INSERT INTO daily_rollups (team_id, membership_id, day, agent_time_ms, sessions, tool_calls, turns,
                                  tokens_input, tokens_output, tokens_cache_read, tokens_cache_write)
      VALUES ($1, $2, $3, 3600000, 2, 10, 4, 500, 300, 100, 50)
    `, [teamId, adminMembershipId, today]);

    const roster = await loadRoster(teamId, 7, pool);
    const adminRow = roster.find((r) => r.id === adminMembershipId);
    expect(Number(adminRow!.range_sessions)).toBe(2);
    expect(Number(adminRow!.range_agent_time_ms)).toBe(3600000);
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
