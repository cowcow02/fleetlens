import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPreDrizzleBaselineIfNeeded } from "./baseline";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Any 64-bit integer that's unique within this database works. MUST stay
// constant across releases — concurrent boots of different versions still
// serialize on this one key.
const MIGRATION_LOCK_ID = 7326544091n;

/**
 * Resolve the migrations folder for both `next dev` (TS source, __dirname is
 * src/db/) and the production standalone bundle (webpack remaps __dirname into
 * .next/server/chunks/, so SQL files have to be located via process.cwd()).
 *
 * Throws if no candidate path contains _journal.json — drizzle's migrator
 * silently no-ops on a missing folder, which previously let releases ship
 * with un-applied migrations and report `[instrumentation] migrations
 * complete` regardless. Loud-fail so future bundling regressions surface.
 */
function resolveMigrationsPath(): string {
  const candidates = [
    join(__dirname, "migrations"),
    join(process.cwd(), "packages/team-server/src/db/migrations"),
  ];
  for (const p of candidates) {
    if (existsSync(join(p, "meta", "_journal.json"))) return p;
  }
  throw new Error(
    `[migrate] No migrations bundle found. Tried:\n  ${candidates.join("\n  ")}\n` +
    `Drizzle journal (_journal.json) was not present at any candidate. ` +
    `Check the Dockerfile / Next standalone copy step.`,
  );
}

export async function runMigrations(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const migrationsFolder = resolveMigrationsPath();
  console.log(`[migrate] applying from ${migrationsFolder}`);

  // Dedicated one-shot client, NOT the shared app pool. pg_advisory_lock
  // (session-scoped) is held only on its acquiring connection, so drizzle's
  // migrator must run every statement on this same client. Using a pool
  // would check out a different connection for DDL and race.
  const client = new Client({ connectionString });
  await client.connect();
  try {
    // Lock id passed as string to avoid node-pg's JS-number coercion
    // truncating values above 2^31. Arrives as bigint in Postgres either way.
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID.toString()]);

    await applyPreDrizzleBaselineIfNeeded(client, migrationsFolder);

    await logMigrationState(client, migrationsFolder, "before drizzle migrate");

    const db = drizzle(client);
    await migrate(db, { migrationsFolder });

    await logMigrationState(client, migrationsFolder, "after drizzle migrate");

    // Fallback: drizzle has been observed to silently no-op on production
    // (its own tracking table is in a state where it believes everything
    // is applied even when tables are missing). After its normal pass,
    // re-derive the pending set from journal hashes vs applied hashes and
    // run any leftovers directly. Idempotent: if drizzle did its job, this
    // loop finds nothing to do and exits.
    await applyAnyMissingMigrations(client, migrationsFolder);
  } finally {
    // Best-effort unlock; the lock is also released automatically on disconnect.
    await client
      .query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID.toString()])
      .catch(() => {});
    await client.end();
  }
}

type JournalEntry = { idx: number; tag: string; when: number };

function readJournal(migrationsFolder: string): JournalEntry[] {
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
  ) as { entries: JournalEntry[] };
  return journal.entries;
}

function hashOfMigration(migrationsFolder: string, tag: string): string {
  const sql = readFileSync(join(migrationsFolder, `${tag}.sql`), "utf8");
  return createHash("sha256").update(sql).digest("hex");
}

async function logMigrationState(
  client: Client,
  migrationsFolder: string,
  label: string,
): Promise<void> {
  const entries = readJournal(migrationsFolder);
  const expected = entries.map((e) => ({
    idx: e.idx,
    tag: e.tag,
    hash: hashOfMigration(migrationsFolder, e.tag),
  }));
  const applied = await client.query<{ id: number; hash: string; created_at: string }>(
    "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id",
  );
  const appliedHashes = new Set(applied.rows.map((r) => r.hash));
  const pending = expected.filter((e) => !appliedHashes.has(e.hash));
  console.log(
    `[migrate-debug] ${label} — applied=${applied.rows.length} ` +
    `expected=${expected.length} pending=${pending.length}`,
  );
  for (const r of applied.rows) {
    console.log(`[migrate-debug]   applied id=${r.id} hash=${r.hash} created_at=${r.created_at}`);
  }
  for (const e of expected) {
    const status = appliedHashes.has(e.hash) ? "APPLIED" : "PENDING";
    console.log(`[migrate-debug]   ${status} idx=${e.idx} tag=${e.tag} hash=${e.hash}`);
  }
}

async function applyAnyMissingMigrations(
  client: Client,
  migrationsFolder: string,
): Promise<void> {
  const entries = readJournal(migrationsFolder);
  const applied = await client.query<{ hash: string }>(
    "SELECT hash FROM drizzle.__drizzle_migrations",
  );
  const appliedHashes = new Set(applied.rows.map((r) => r.hash));

  for (const entry of entries) {
    const hash = hashOfMigration(migrationsFolder, entry.tag);
    if (appliedHashes.has(hash)) continue;

    console.warn(
      `[migrate-fallback] drizzle did not apply ${entry.tag}; applying directly`,
    );
    const sql = readFileSync(join(migrationsFolder, `${entry.tag}.sql`), "utf8");
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
        [hash, entry.when],
      );
      await client.query("COMMIT");
      console.log(`[migrate-fallback] applied ${entry.tag} (hash=${hash})`);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      const msg = err instanceof Error ? err.message : String(err);
      // Tables present already means an earlier deploy applied this
      // migration's DDL but the tracking row is missing — schema-and-tracker
      // drift, common after test resets or v0.4.2-era buggy baselining.
      // Record the hash so future runs see it as applied; the schema is
      // already the right shape.
      if (/already exists/i.test(msg)) {
        console.warn(
          `[migrate-fallback] ${entry.tag}: schema already present; recording hash without re-applying`,
        );
        await client.query(
          "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
          [hash, entry.when],
        );
        continue;
      }
      console.error(`[migrate-fallback] FAILED to apply ${entry.tag}:`, msg);
      throw err;
    }
  }
}
