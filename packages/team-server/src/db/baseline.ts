import { Client } from "pg";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export async function applyPreDrizzleBaselineIfNeeded(
  client: Client,
  migrationsFolder: string,
): Promise<void> {
  // Fresh DB? If user_accounts doesn't exist, nothing to baseline —
  // let the normal migrator run everything from 0000.
  const existing = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'user_accounts'`,
  );
  if (existing.rowCount === 0) return;

  // Pre-create drizzle's journal schema + table so we can insert the baseline
  // row before the migrator itself runs.
  await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at BIGINT
    )
  `);

  // Read 0000's folderMillis — we use this both for fresh inserts and for
  // repairing pre-existing rows that were inserted by v0.4.2's buggy baseline
  // (which used Date.now() instead of folderMillis(0000)).
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
  ) as { entries: Array<{ idx: number; when: number }> };
  const firstEntry = journal.entries.find((e) => e.idx === 0);
  if (!firstEntry) throw new Error("baseline: 0000 entry missing from _journal.json");
  const expectedCreatedAt = firstEntry.when;

  // Are we already baselined? Inspect the earliest row.
  const earliest = await client.query(
    `SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at ASC LIMIT 1`,
  );
  if (earliest.rowCount !== 0) {
    // Already baselined. If the row's created_at doesn't match 0000's
    // folderMillis, it's a v0.4.2 buggy baseline — repair in place.
    const row = earliest.rows[0];
    if (Number(row.created_at) !== expectedCreatedAt) {
      console.warn(
        `[baseline] Repairing stale baseline row (id=${row.id}): ` +
        `created_at was ${row.created_at}, fixing to folderMillis(0000)=${expectedCreatedAt}`,
      );
      await client.query(
        `UPDATE drizzle.__drizzle_migrations SET created_at = $1 WHERE id = $2`,
        [expectedCreatedAt, row.id],
      );
    }
    return;
  }

  // Not yet baselined — insert the row for the first time.
  const sqlPath = join(migrationsFolder, "0000_initial.sql");
  const sql = readFileSync(sqlPath, "utf8");
  const hash = createHash("sha256").update(sql).digest("hex");

  await client.query(
    `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
    [hash, expectedCreatedAt],
  );
}
