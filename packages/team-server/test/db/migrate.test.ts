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
  it("creates all 7 tables", async () => {
    const pool = getPool();
    const result = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`
    );
    const tables = result.rows.map((r) => r.table_name);
    expect(tables).toContain("teams");
    expect(tables).toContain("members");
    expect(tables).toContain("invites");
    expect(tables).toContain("admin_sessions");
    expect(tables).toContain("daily_rollups");
    expect(tables).toContain("events");
    expect(tables).toContain("ingest_log");
  });

  it("is idempotent — running twice does not throw", async () => {
    await expect(runMigrations()).resolves.toBeUndefined();
  });
});
