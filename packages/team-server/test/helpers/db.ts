import { getPool } from "../../src/db/pool.js";
import { runMigrations } from "../../src/db/migrate.js";

process.env.DATABASE_URL ||= "postgres://localhost:5432/fleetlens_test";

/**
 * Reset the test DB to a clean migrated state.
 * Uses TRUNCATE ... CASCADE so we don't have to maintain FK-aware delete order
 * when Doc 2/3/4 add new tables.
 */
export async function resetDb(): Promise<ReturnType<typeof getPool>> {
  // TRUNCATE below is unconditional and destructive — refuse to run against
  // anything that doesn't look like a dedicated test database. (This once
  // wiped a conventionally-named local dev DB when the suite fell back to it.)
  const dbName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
  if (!/test/.test(dbName)) {
    throw new Error(
      `Refusing to TRUNCATE database "${dbName}" — the team-server test suite wipes all tables. ` +
        `Point DATABASE_URL at a dedicated test database whose name contains "test" ` +
        `(e.g. createdb fleetlens_test; migrations run automatically).`,
    );
  }
  const pool = getPool();
  await runMigrations();
  await pool.query(`
    TRUNCATE TABLE
      events, daily_rollups, rich_daily_rollups, ingest_log, invites,
      plan_utilization,
      group_members, groups,
      memberships, sessions, server_config,
      update_check_cache,
      user_accounts, teams
    RESTART IDENTITY CASCADE
  `);
  return pool;
}
