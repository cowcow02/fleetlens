import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { applyPreDrizzleBaselineIfNeeded } from "../../src/db/baseline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "../../src/db/migrations");
const CONN = process.env.DATABASE_URL ?? "postgres://localhost:5432/fleetlens_dev";

async function wipeDb(client: Client) {
  await client.query(`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await client.query(`
    DO $$ DECLARE r record;
    BEGIN
      FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      LOOP EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE'; END LOOP;
    END $$;
  `);
}

describe("applyPreDrizzleBaselineIfNeeded", () => {
  let client: Client;

  beforeEach(async () => {
    client = new Client({ connectionString: CONN });
    await client.connect();
    await wipeDb(client);
  });

  afterAll(async () => {
    if (client) await client.end().catch(() => {});
  });

  it("does nothing when user_accounts does not exist (fresh DB)", async () => {
    await applyPreDrizzleBaselineIfNeeded(client, MIGRATIONS_DIR);
    const { rows } = await client.query(
      "SELECT to_regclass('drizzle.__drizzle_migrations') AS tbl",
    );
    expect(rows[0].tbl).toBeNull();
  });

  it("creates the journal row with created_at >= folderMillis so Drizzle skips 0000_initial", async () => {
    // Simulate an existing v0.4.x deployment by applying 0000_initial.sql manually.
    const sql = readFileSync(join(MIGRATIONS_DIR, "0000_initial.sql"), "utf8");
    await client.query(sql);

    // Insert a canary row into user_accounts that would be destroyed if Drizzle
    // re-ran 0000_initial (which drops-and-recreates nothing but would error out
    // on duplicate CREATE, aborting the transaction).
    await client.query(
      `INSERT INTO user_accounts (email, password_hash) VALUES ('canary@example.com', 'x')`,
    );

    await applyPreDrizzleBaselineIfNeeded(client, MIGRATIONS_DIR);

    // Verify the journal entry's created_at is EXACTLY 0000's folderMillis.
    // Drizzle's migrator picks the max created_at row, then only applies
    // migrations whose folderMillis > that value. If baseline set created_at
    // to Date.now() (which is what the pre-0001 code did) it would mask every
    // future migration, not just 0000.
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8"),
    );
    const folderMillis = journal.entries.find((e: { idx: number; when: number }) => e.idx === 0).when;
    const { rows } = await client.query(
      `SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY id`,
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].created_at)).toBe(folderMillis);

    // Now run Drizzle's migrator. If the baseline is effective, it should NOT
    // attempt to re-run 0000_initial — which would error on duplicate CREATE TABLE.
    // Canary row survives as further proof. Subsequent migrations (0001+) must
    // still apply because their folderMillis > 0000's folderMillis.
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });

    const canary = await client.query(
      `SELECT email FROM user_accounts WHERE email = 'canary@example.com'`,
    );
    expect(canary.rowCount).toBe(1);

    const { rows: tables } = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='update_check_cache'",
    );
    expect(tables).toHaveLength(1);
  });

  it("is idempotent — calling twice does not insert duplicate rows", async () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, "0000_initial.sql"), "utf8");
    await client.query(sql);

    await applyPreDrizzleBaselineIfNeeded(client, MIGRATIONS_DIR);
    await applyPreDrizzleBaselineIfNeeded(client, MIGRATIONS_DIR);

    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`,
    );
    expect(rows[0].n).toBe(1);
  });

  it("repairs a v0.4.2-style buggy baseline row (Date.now() instead of folderMillis)", async () => {
    // Simulate a v0.4.2 deployment: schema exists, baseline row has Date.now() as created_at.
    const sql = readFileSync(join(MIGRATIONS_DIR, "0000_initial.sql"), "utf8");
    await client.query(sql);
    await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at BIGINT
      )
    `);
    const buggyTimestamp = Date.now();
    await client.query(
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('old-hash', $1)`,
      [buggyTimestamp],
    );

    // Run the new baseline — should repair in place.
    await applyPreDrizzleBaselineIfNeeded(client, MIGRATIONS_DIR);

    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8"),
    );
    const folderMillis = journal.entries.find((e: { idx: number; when: number }) => e.idx === 0).when;

    const { rows } = await client.query(
      `SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY id`,
    );
    expect(rows).toHaveLength(1);  // repaired in place, no duplicate
    expect(Number(rows[0].created_at)).toBe(folderMillis);
  });
});
