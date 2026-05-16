import { getPool } from "../../src/db/pool.js";
import { runMigrations } from "../../src/db/migrate.js";

process.env.DATABASE_URL ||= "postgres://localhost:5432/fleetlens_dev";

/**
 * Reset the test DB to a clean migrated state.
 * Uses TRUNCATE ... CASCADE so we don't have to maintain FK-aware delete order
 * when Doc 2/3/4 add new tables.
 */
export async function resetDb(): Promise<ReturnType<typeof getPool>> {
  const pool = getPool();
  await runMigrations();
  await pool.query(`
    TRUNCATE TABLE
      events, daily_rollups, ingest_log, invites,
      plan_utilization,
      group_members, groups,
      memberships, sessions, server_config,
      update_check_cache,
      user_accounts, teams
    RESTART IDENTITY CASCADE
  `);
  return pool;
}
