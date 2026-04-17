import { getPool } from "../db/pool.js";

let started = false;

export function startScheduler(): void {
  if (started) return;
  started = true;

  // Idempotent DELETE runs hourly; no need to pick a specific UTC hour.
  setInterval(async () => {
    try {
      const res = await getPool().query(
        "DELETE FROM ingest_log WHERE received_at < now() - interval '24 hours'"
      );
      if (res.rowCount) console.log(`[scheduler] pruned ${res.rowCount} ingest_log rows`);
    } catch (err) {
      console.error(`[scheduler] prune failed: ${(err as Error).message}`);
    }
  }, 60 * 60 * 1000);
}
