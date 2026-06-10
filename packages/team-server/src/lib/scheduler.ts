import { getPool } from "../db/pool";

export async function pruneIngestLog(): Promise<number> {
  const res = await getPool().query(
    "DELETE FROM ingest_log WHERE received_at < now() - interval '24 hours'"
  );
  return res.rowCount ?? 0;
}

export async function refreshMembershipWeeklyUtilization(): Promise<void> {
  await getPool().query(
    "REFRESH MATERIALIZED VIEW CONCURRENTLY membership_weekly_utilization",
  );
}

export async function prunePlanUtilization(): Promise<number> {
  const res = await getPool().query(`
    DELETE FROM plan_utilization pu
    USING teams t
    WHERE pu.team_id = t.id
      AND pu.captured_at < now() - make_interval(days => t.retention_days)
  `);
  return res.rowCount ?? 0;
}

let started = false;

export function startScheduler(): void {
  if (started) return;
  if (process.env.FLEETLENS_EXTERNAL_SCHEDULER === "1") return;
  started = true;

  setInterval(async () => {
    try {
      const n = await pruneIngestLog();
      if (n) console.log(`[scheduler] pruned ${n} ingest_log rows`);
    } catch (err) {
      console.error(`[scheduler] prune failed: ${(err as Error).message}`);
    }
  }, 60 * 60 * 1000);

  setInterval(async () => {
    try {
      const { checkNow } = await import("./self-update/service");
      await checkNow();
    } catch (err) {
      console.warn("[scheduler] checkForUpdates failed:", err);
    }
  }, 60 * 60 * 1000);

  setInterval(async () => {
    try {
      await refreshMembershipWeeklyUtilization();
    } catch (err) {
      console.error(
        `[scheduler] mat view refresh failed: ${(err as Error).message}`,
      );
    }
  }, 60 * 60 * 1000);

  setInterval(async () => {
    try {
      const { syncAllGithubIntegrations } = await import("./integrations");
      await syncAllGithubIntegrations(getPool());
    } catch (err) {
      console.error(`[scheduler] github sync sweep failed: ${(err as Error).message}`);
    }
  }, 60 * 60 * 1000);

  setInterval(async () => {
    try {
      const n = await prunePlanUtilization();
      if (n) console.log(`[scheduler] pruned ${n} plan_utilization rows`);
    } catch (err) {
      console.error(
        `[scheduler] plan_utilization prune failed: ${(err as Error).message}`,
      );
    }
  }, 24 * 60 * 60 * 1000);

  // Kick off once shortly after boot so admins don't wait an hour for the
  // first status. Non-blocking — boot path proceeds regardless.
  setTimeout(async () => {
    try {
      const { checkNow } = await import("./self-update/service");
      await checkNow();
    } catch (err) {
      console.warn("[scheduler] initial checkForUpdates failed:", err);
    }
  }, 5000);
}
