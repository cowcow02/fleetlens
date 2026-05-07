import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

    await logMigrationState(client, migrationsFolder, "before drizzle");

    const db = drizzle(client);
    try {
      await migrate(db, { migrationsFolder });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Drizzle's normal path runs each migration's SQL in a transaction;
      // it has no IF-NOT-EXISTS handling, so a CREATE TABLE for a relation
      // that already exists (left over from an earlier fallback run, or
      // from a hand-applied schema) blows up the entire migrate() call. The
      // fallback applier handles that exact case: it detects "already
      // exists" and records the hash without re-running DDL. Drop into it.
      if (/already exists/i.test(msg)) {
        console.warn(
          `[migrate] drizzle threw "already exists" — falling through to fallback applier`,
        );
      } else {
        throw err;
      }
    }

    await logMigrationState(client, migrationsFolder, "after drizzle");

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

/**
 * Discover every migration that should be applied by looking at the SQL
 * files on disk PLUS the journal. The journal is authoritative for ordering
 * (`when`), but if someone adds an .sql file without running `drizzle-kit
 * generate`, the file is invisible to drizzle's normal migrator. Returning
 * orphans alongside journal entries lets the fallback catch those too.
 */
function discoverAllMigrations(migrationsFolder: string): JournalEntry[] {
  const journal = readJournal(migrationsFolder);
  const journalTags = new Set(journal.map((e) => e.tag));
  const sqlFiles = readdirSync(migrationsFolder)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.replace(/\.sql$/, ""))
    .sort();
  const orphans = sqlFiles.filter((tag) => !journalTags.has(tag));
  if (orphans.length > 0) {
    console.warn(
      `[migrate] orphan SQL files not in _journal.json: ${orphans.join(", ")}`,
    );
  }
  // Stable ordering: journal entries first (in their declared order), then
  // orphans appended sorted by filename. Orphan `when` defaults to a value
  // greater than the latest journal entry so they always come last.
  const maxWhen = journal.reduce((m, e) => Math.max(m, e.when), 0);
  const orphanEntries: JournalEntry[] = orphans.map((tag, i) => ({
    idx: journal.length + i,
    tag,
    when: maxWhen + 1 + i,
  }));
  return [...journal, ...orphanEntries];
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
  const entries = discoverAllMigrations(migrationsFolder);
  const applied = await client.query<{ hash: string }>(
    "SELECT hash FROM drizzle.__drizzle_migrations",
  );
  const appliedHashes = new Set(applied.rows.map((r) => r.hash));
  const pendingTags = entries
    .filter((e) => !appliedHashes.has(hashOfMigration(migrationsFolder, e.tag)))
    .map((e) => e.tag);
  console.log(
    `[migrate] ${label} — applied=${applied.rows.length} expected=${entries.length} ` +
    `pending=${pendingTags.length}` +
    (pendingTags.length > 0 ? ` (${pendingTags.join(", ")})` : ""),
  );
}

async function applyAnyMissingMigrations(
  client: Client,
  migrationsFolder: string,
): Promise<void> {
  const entries = discoverAllMigrations(migrationsFolder);
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
