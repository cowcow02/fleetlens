import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { getPool } from "../../src/db/pool.js";
import { runMigrations } from "../../src/db/migrate.js";
import { claimTeam } from "../../src/lib/teams.js";
import { createInvite, joinTeam, leaveTeam } from "../../src/lib/members.js";
import { processIngest } from "../../src/lib/ingest.js";
import { sha256 } from "../../src/lib/crypto.js";

const TEST_DB = process.env.DATABASE_URL || "postgres://localhost:5432/fleetlens_test";

let pool: pg.Pool;

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DB;
  pool = getPool();
  await runMigrations();
  await pool.query(`
    DELETE FROM events;
    DELETE FROM ingest_log;
    DELETE FROM daily_rollups;
    DELETE FROM admin_sessions;
    DELETE FROM invites;
    DELETE FROM members;
    DELETE FROM teams;
  `);
});

afterAll(() => pool.end());

describe("onboarding flow", () => {
  it("claim → invite → join → ingest → leave → revoked", async () => {
    // 1. Claim
    const bootstrapToken = "test-bootstrap-token";
    const result = await claimTeam(
      { bootstrapToken, teamName: "Test Team", adminEmail: "admin@test.com", adminDisplayName: "Admin" },
      sha256(bootstrapToken),
      new Date(Date.now() + 15 * 60 * 1000),
      pool
    );
    expect(result.team.slug).toBe("test-team");
    expect(result.admin.role).toBe("admin");
    expect(result.recoveryToken).toMatch(/^rt_/);
    expect(result.sessionToken).toBeTruthy();

    // 2. Invite
    const invite = await createInvite({}, result.admin.id, result.team.id, "http://localhost:3322", pool);
    expect(invite.tokenPlaintext).toMatch(/^iv_/);
    expect(invite.joinUrl).toContain("http://localhost:3322/join?token=iv_");
    expect(invite.expiresAt).toBeTruthy();

    // 3. Join
    const joined = await joinTeam({ inviteToken: invite.tokenPlaintext }, pool);
    expect(joined.member.role).toBe("member");
    expect(joined.bearerToken).toMatch(/^bt_/);
    expect(joined.teamSlug).toBe("test-team");

    // 4. Ingest succeeds
    const ingestResult = await processIngest({
      ingestId: "test-ingest-1",
      observedAt: new Date().toISOString(),
      dailyRollup: {
        day: "2026-04-16",
        agentTimeMs: 3600000,
        sessions: 2,
        toolCalls: 50,
        turns: 10,
        tokens: { input: 100000, output: 5000, cacheRead: 500000, cacheWrite: 20000 }
      }
    }, joined.member.id, result.team.id, pool);
    expect(ingestResult.accepted).toBe(true);

    // 5. Leave
    await leaveTeam(joined.member.id, pool);

    // 6. Verify revoked
    const memberCheck = await pool.query("SELECT revoked_at FROM members WHERE id = $1", [joined.member.id]);
    expect(memberCheck.rows[0].revoked_at).not.toBeNull();
  });

  it("cannot claim twice", async () => {
    const bootstrapToken = "test-bootstrap-token-2";
    await expect(
      claimTeam(
        { bootstrapToken, teamName: "Another Team" },
        sha256(bootstrapToken),
        new Date(Date.now() + 15 * 60 * 1000),
        pool
      )
    ).rejects.toThrow("Team already claimed");
  });

  it("expired bootstrap token is rejected", async () => {
    const bootstrapToken = "expired-token";
    await expect(
      claimTeam(
        { bootstrapToken, teamName: "Some Team" },
        sha256(bootstrapToken),
        new Date(Date.now() - 1000),
        pool
      )
    ).rejects.toThrow("Bootstrap token expired");
  });

  it("used invite cannot be reused", async () => {
    // get team/admin from the DB since we can't re-claim
    const teamRes = await pool.query("SELECT id FROM teams WHERE slug = 'test-team'");
    const adminRes = await pool.query("SELECT id FROM members WHERE team_id = $1 AND role = 'admin'", [teamRes.rows[0].id]);

    const invite = await createInvite({}, adminRes.rows[0].id, teamRes.rows[0].id, "http://localhost:3322", pool);

    // First join succeeds
    await joinTeam({ inviteToken: invite.tokenPlaintext }, pool);

    // Second join with same token fails
    await expect(joinTeam({ inviteToken: invite.tokenPlaintext }, pool)).rejects.toThrow("Invalid or expired invite");
  });
});
