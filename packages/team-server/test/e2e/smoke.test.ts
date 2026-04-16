import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { runMigrations } from "../../src/db/migrate.js";
import { claimTeam } from "../../src/lib/teams.js";
import { createInvite, joinTeam, leaveTeam } from "../../src/lib/members.js";
import { processIngest } from "../../src/lib/ingest.js";
import { sha256, generateToken } from "../../src/lib/crypto.js";
import { generateBootstrapToken, validateAdminSession } from "../../src/lib/auth.js";

const TEST_DB = process.env.DATABASE_URL || "postgres://localhost:5432/fleetlens_test";

describe("E2E smoke test", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: TEST_DB, max: 5 });
    process.env.DATABASE_URL = TEST_DB;
    await pool.query(`
      DELETE FROM events;
      DELETE FROM ingest_log;
      DELETE FROM daily_rollups;
      DELETE FROM admin_sessions;
      DELETE FROM invites;
      DELETE FROM members;
      DELETE FROM teams;
    `);
    await runMigrations();
  });

  afterAll(async () => {
    // Clean up
    await pool.query(`
      DELETE FROM events;
      DELETE FROM ingest_log;
      DELETE FROM daily_rollups;
      DELETE FROM admin_sessions;
      DELETE FROM invites;
      DELETE FROM members;
      DELETE FROM teams;
    `);
    await pool.end();
  });

  it("complete lifecycle: bootstrap → claim → invite → join → ingest → roster verify → leave → verify revoked", async () => {
    // 1. Generate bootstrap token
    const bootstrap = generateBootstrapToken();
    expect(bootstrap.token).toBeTruthy();
    expect(bootstrap.hash).toBeTruthy();

    // 2. Claim the instance
    const claim = await claimTeam(
      {
        bootstrapToken: bootstrap.token,
        teamName: "Smoke Test Team",
        adminEmail: "admin@smoke.test",
        adminDisplayName: "Smoke Admin",
      },
      bootstrap.hash,
      bootstrap.expiresAt,
      pool
    );
    expect(claim.team.slug).toBe("smoke-test-team");
    expect(claim.team.name).toBe("Smoke Test Team");
    expect(claim.admin.role).toBe("admin");
    expect(claim.sessionToken).toBeTruthy();
    expect(claim.recoveryToken).toMatch(/^rt_/);

    // 3. Validate admin session works
    const session = await validateAdminSession(claim.sessionToken, pool);
    expect(session).not.toBeNull();
    expect(session!.memberId).toBe(claim.admin.id);

    // 4. Create an invite
    const invite = await createInvite(
      { label: "Test Developer" },
      claim.admin.id,
      claim.team.id,
      "http://localhost:3322",
      pool
    );
    expect(invite.tokenPlaintext).toMatch(/^iv_/);
    expect(invite.joinUrl).toContain(invite.tokenPlaintext);

    // 5. Join as a member using the invite
    const joined = await joinTeam(
      {
        inviteToken: invite.tokenPlaintext,
        email: "dev@smoke.test",
        displayName: "Test Dev",
      },
      pool
    );
    expect(joined.member.role).toBe("member");
    expect(joined.bearerToken).toMatch(/^bt_/);
    expect(joined.teamSlug).toBe("smoke-test-team");

    // 6. Push ingest data
    const ingestResult1 = await processIngest(
      {
        ingestId: "smoke-001",
        observedAt: new Date().toISOString(),
        dailyRollup: {
          day: new Date().toISOString().slice(0, 10),
          agentTimeMs: 7200000,
          sessions: 3,
          toolCalls: 150,
          turns: 30,
          tokens: {
            input: 500000,
            output: 25000,
            cacheRead: 3000000,
            cacheWrite: 200000,
          },
        },
      },
      joined.member.id,
      claim.team.id,
      pool
    );
    expect(ingestResult1.accepted).toBe(true);

    // 7. Verify roster shows the member with correct stats
    const rosterRes = await pool.query(`
      SELECT m.id, m.display_name, m.last_seen_at,
             COALESCE(SUM(r.agent_time_ms), 0)::bigint AS total_agent_time_ms,
             COALESCE(SUM(r.sessions), 0)::int AS total_sessions
      FROM members m
      LEFT JOIN daily_rollups r ON r.member_id = m.id AND r.team_id = m.team_id
      WHERE m.team_id = $1 AND m.revoked_at IS NULL
      GROUP BY m.id
      ORDER BY m.last_seen_at DESC NULLS LAST
    `, [claim.team.id]);

    expect(rosterRes.rowCount).toBe(2); // admin + member
    const devMember = rosterRes.rows.find((r: any) => r.display_name === "Test Dev");
    expect(devMember).toBeTruthy();
    expect(Number(devMember.total_agent_time_ms)).toBe(7200000);
    expect(Number(devMember.total_sessions)).toBe(3);
    expect(devMember.last_seen_at).not.toBeNull();

    // 8. Deduplicate: same ingestId should return deduplicated
    const ingestResult2 = await processIngest(
      {
        ingestId: "smoke-001",
        observedAt: new Date().toISOString(),
        dailyRollup: {
          day: new Date().toISOString().slice(0, 10),
          agentTimeMs: 9999999,
          sessions: 99,
          toolCalls: 999,
          turns: 99,
          tokens: { input: 999, output: 999, cacheRead: 999, cacheWrite: 999 },
        },
      },
      joined.member.id,
      claim.team.id,
      pool
    );
    expect(ingestResult2.deduplicated).toBe(true);

    // 9. Leave the team
    await leaveTeam(joined.member.id, pool);

    // 10. Verify member is revoked
    const memberCheck = await pool.query(
      "SELECT revoked_at FROM members WHERE id = $1",
      [joined.member.id]
    );
    expect(memberCheck.rows[0].revoked_at).not.toBeNull();

    // 11. Verify roster now shows only admin
    const rosterAfter = await pool.query(
      "SELECT id FROM members WHERE team_id = $1 AND revoked_at IS NULL",
      [claim.team.id]
    );
    expect(rosterAfter.rowCount).toBe(1); // only admin remains

    // 12. Verify events were logged
    const events = await pool.query(
      "SELECT action FROM events WHERE team_id = $1 ORDER BY created_at",
      [claim.team.id]
    );
    const actions = events.rows.map((e: any) => e.action);
    expect(actions).toContain("admin.claim");
    expect(actions).toContain("member.invite");
    expect(actions).toContain("member.join");
  });

  it("second ingest replaces daily rollup values", async () => {
    // Get the existing member (dev was revoked, use admin)
    const teamRes = await pool.query("SELECT id FROM teams WHERE slug = 'smoke-test-team'");
    const adminRes = await pool.query(
      "SELECT id FROM members WHERE team_id = $1 AND role = 'admin'",
      [teamRes.rows[0].id]
    );

    const day = new Date().toISOString().slice(0, 10);

    await processIngest({
      ingestId: "smoke-replace-1",
      observedAt: new Date().toISOString(),
      dailyRollup: {
        day,
        agentTimeMs: 1000,
        sessions: 1,
        toolCalls: 10,
        turns: 5,
        tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
      },
    }, adminRes.rows[0].id, teamRes.rows[0].id, pool);

    await processIngest({
      ingestId: "smoke-replace-2",
      observedAt: new Date().toISOString(),
      dailyRollup: {
        day,
        agentTimeMs: 2000,
        sessions: 2,
        toolCalls: 20,
        turns: 10,
        tokens: { input: 200, output: 100, cacheRead: 0, cacheWrite: 0 },
      },
    }, adminRes.rows[0].id, teamRes.rows[0].id, pool);

    // Verify replaced (not accumulated)
    const rollup = await pool.query(
      "SELECT agent_time_ms, sessions FROM daily_rollups WHERE member_id = $1 AND day = $2",
      [adminRes.rows[0].id, day]
    );
    expect(Number(rollup.rows[0].agent_time_ms)).toBe(2000);
    expect(Number(rollup.rows[0].sessions)).toBe(2);
  });
});
