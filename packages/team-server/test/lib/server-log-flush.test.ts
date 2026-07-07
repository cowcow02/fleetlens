import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getPool } from "../../src/db/pool.js";
import { runMigrations } from "../../src/db/migrate.js";
import { installLogCapture, isHydrated } from "../../src/lib/log-buffer.js";
import { flushServerLog } from "../../src/lib/scheduler.js";

process.env.DATABASE_URL ||= "postgres://localhost:5432/fleetlens_dev";

// Boot-seq collision regression: a failed server_log hydrate used to leave
// fresh seqs (1..N) colliding with persisted rows, and the flush's ON
// CONFLICT (seq) DO NOTHING silently dropped every new line — the server log
// went dark until the next clean reboot. flushServerLog must re-anchor past
// the persisted max before its first flush.
describe("flushServerLog after a failed hydrate", () => {
  beforeAll(async () => {
    await runMigrations();
    await getPool().query("DELETE FROM server_log");
  });

  afterAll(async () => {
    await getPool().end();
  });

  it("re-anchors seqs past the persisted max so new lines land instead of being conflict-dropped", async () => {
    const pool = getPool();
    // Persisted rows from a previous boot; hydrate() is never called here,
    // simulating the hydrate failure (buffer stays un-hydrated, seq from 1).
    await pool.query(
      `INSERT INTO server_log (seq, ts, level, msg)
       VALUES (1, now(), 'log', 'old-boot-1'), (2, now(), 'log', 'old-boot-2'), (3, now(), 'log', 'old-boot-3')
       ON CONFLICT (seq) DO NOTHING`,
    );
    expect(isHydrated()).toBe(false);

    installLogCapture();
    const marker = `fresh-after-failed-hydrate-${Math.random().toString(36).slice(2)}`;
    console.log(marker);

    const flushed = await flushServerLog();
    expect(flushed).toBeGreaterThan(0);

    const { rows } = await pool.query<{ seq: string }>(
      "SELECT seq FROM server_log WHERE msg LIKE $1",
      [`%${marker}%`],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].seq)).toBeGreaterThan(3);
    // The old rows survived untouched — nothing was overwritten or dropped.
    const old = await pool.query("SELECT count(*)::int AS n FROM server_log WHERE msg LIKE 'old-boot-%'");
    expect(old.rows[0].n).toBe(3);
  });
});
