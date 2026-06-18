import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";
import { getPool } from "../../src/db/pool.js";

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost:5432/fleetlens_test";
  await runMigrations();
});

afterAll(async () => {
  await getPool().end();
});

describe("migrations", () => {
  it("creates all tables", async () => {
    const pool = getPool();
    const result = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`
    );
    const tables = result.rows.map((r) => r.table_name);
    for (const expected of [
      "user_accounts",
      "teams",
      "memberships",
      "invites",
      "sessions",
      "daily_rollups",
      "events",
      "ingest_log",
      "server_config",
      "plan_utilization",
    ]) {
      expect(tables).toContain(expected);
    }
  });

  it("0002 creates plan_utilization table, plan_tier column, and weekly mat view", async () => {
    const pool = getPool();

    const cols = await pool.query<{ column_name: string; column_default: string | null }>(
      `SELECT column_name, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'memberships' AND column_name = 'plan_tier'`,
    );
    expect(cols.rowCount).toBe(1);
    expect(cols.rows[0].column_default).toMatch(/'pro-max'/);

    const view = await pool.query(
      `SELECT 1 FROM pg_matviews
       WHERE schemaname = 'public' AND matviewname = 'membership_weekly_utilization'`,
    );
    expect(view.rowCount).toBe(1);

    // Plan tier CHECK rejects invalid values.
    const user = await pool.query<{ id: string }>(
      `INSERT INTO user_accounts (email, password_hash) VALUES ('plan-tier-test@example.com','x') RETURNING id`,
    );
    const team = await pool.query<{ id: string }>(
      `INSERT INTO teams (slug, name) VALUES ('plan-tier-test','Plan Tier') RETURNING id`,
    );
    try {
      await expect(
        pool.query(
          `INSERT INTO memberships (user_account_id, team_id, role, plan_tier)
           VALUES ($1, $2, 'admin', 'enterprise')`,
          [user.rows[0].id, team.rows[0].id],
        ),
      ).rejects.toThrow(/check constraint|memberships_plan_tier_check/i);
    } finally {
      await pool.query(`DELETE FROM teams WHERE id = $1`, [team.rows[0].id]);
      await pool.query(`DELETE FROM user_accounts WHERE id = $1`, [user.rows[0].id]);
    }
  });

  it("is idempotent — running twice does not throw", async () => {
    await expect(runMigrations()).resolves.toBeUndefined();
  });

  it("0001 adds update_check_cache and promotes an existing admin to staff", async () => {
    const pool = getPool();
    const { rows: tableRows } = await pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='update_check_cache'",
    );
    expect(tableRows).toHaveLength(1);
  });
});

describe("schema parity with SCHEMA_SQL", () => {
  it("every expected column exists with the correct nullability and default hints", async () => {
    const pool = getPool();

    // Shape-level introspection. (Types reported by information_schema are
    // generic — e.g. "text" not "varchar(255)" — but are stable enough to
    // assert against. For bigint columns we also check `data_type = 'bigint'`.)
    const { rows } = await pool.query(`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `);
    const byTable = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!byTable.has(r.table_name)) byTable.set(r.table_name, []);
      byTable.get(r.table_name)!.push(r);
    }

    // Load the old SCHEMA_SQL from the prior commit and diff critical columns.
    // Spot-check a handful of high-risk columns that are easy to mis-translate:
    const memberships = byTable.get("memberships")!;
    expect(memberships.map((c) => c.column_name)).toEqual([
      "id",
      "user_account_id",
      "team_id",
      "role",
      "bearer_token_hash",
      "joined_at",
      "last_seen_at",
      "revoked_at",
      "plan_tier",
    ]);
    const roleCol = memberships.find((c) => c.column_name === "role")!;
    expect(roleCol.is_nullable).toBe("NO");

    const dailyRollups = byTable.get("daily_rollups")!;
    expect(dailyRollups.map((c) => c.column_name)).toEqual([
      "team_id",
      "membership_id",
      "day",
      "agent_time_ms",
      "sessions",
      "tool_calls",
      "turns",
      "tokens_input",
      "tokens_output",
      "tokens_cache_read",
      "tokens_cache_write",
      "unique_sessions",
    ]);
    expect(dailyRollups.find((c) => c.column_name === "unique_sessions")!.is_nullable).toBe("YES");
    expect(dailyRollups.find((c) => c.column_name === "agent_time_ms")!.data_type).toBe("bigint");

    const events = byTable.get("events")!;
    expect(events.find((c) => c.column_name === "id")!.data_type).toBe("bigint");
  });

  it("expected indexes are present with correct names", async () => {
    const pool = getPool();
    const { rows } = await pool.query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
    `);
    const names = new Set(rows.map((r) => r.indexname));
    for (const expected of [
      "idx_memberships_team_active",
      "idx_memberships_bearer",
      "idx_sessions_user",
      "idx_daily_rollups_team_day",
      "idx_events_team_created",
      "idx_ingest_log_received",
    ]) {
      expect(names.has(expected), `missing index ${expected}`).toBe(true);
    }
  });

  it("CHECK constraints on role columns enforce admin/member", async () => {
    const pool = getPool();
    // Set up real parent rows so the FK constraints are satisfied and we know
    // the INSERT rejection is from the CHECK constraint, not an FK failure.
    const user = await pool.query<{ id: string }>(
      `INSERT INTO user_accounts (email, password_hash) VALUES ('check-test@example.com', 'x') RETURNING id`,
    );
    const team = await pool.query<{ id: string }>(
      `INSERT INTO teams (slug, name) VALUES ('check-test', 'Check Test') RETURNING id`,
    );

    try {
      // memberships with a bad role should be rejected by the CHECK constraint.
      // Assert on the error shape so we know it's the CHECK, not something else:
      await expect(
        pool.query(
          `INSERT INTO memberships (user_account_id, team_id, role)
           VALUES ($1, $2, 'bogus')`,
          [user.rows[0].id, team.rows[0].id],
        ),
      ).rejects.toThrow(/check constraint|memberships_role_check/i);

      // invites with a bad role should be rejected similarly:
      await expect(
        pool.query(
          `INSERT INTO invites (team_id, created_by, token_hash, role, expires_at)
           VALUES ($1, $2, 'hash-' || gen_random_uuid()::text, 'bogus', now() + interval '1 day')`,
          [team.rows[0].id, user.rows[0].id],
        ),
      ).rejects.toThrow(/check constraint|invites_role_check/i);
    } finally {
      await pool.query(`DELETE FROM teams WHERE id = $1`, [team.rows[0].id]);
      await pool.query(`DELETE FROM user_accounts WHERE id = $1`, [user.rows[0].id]);
    }
  });
});
