import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { existsSync } from "node:fs";
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

    const db = drizzle(client);
    await migrate(db, { migrationsFolder });
  } finally {
    // Best-effort unlock; the lock is also released automatically on disconnect.
    await client
      .query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID.toString()])
      .catch(() => {});
    await client.end();
  }
}
