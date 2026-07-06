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

// Synced integration history follows the same per-team retention as plan
// utilization — the 60-day sync window bounds growth, but re-connected
// integrations would otherwise accumulate rows merged before the window.
export async function pruneIntegrationData(): Promise<number> {
  const prs = await getPool().query(`
    DELETE FROM github_pull_requests p
    USING teams t
    WHERE p.team_id = t.id
      AND COALESCE(p.merged_at, p.closed_at, p.created_at) < now() - make_interval(days => t.retention_days)
  `);
  const issues = await getPool().query(`
    DELETE FROM linear_issues i
    USING teams t
    WHERE i.team_id = t.id
      AND COALESCE(i.completed_at, i.canceled_at, i.created_at) < now() - make_interval(days => t.retention_days)
  `);
  const jiraIssues = await getPool().query(`
    DELETE FROM jira_issues i
    USING teams t
    WHERE i.team_id = t.id
      AND COALESCE(i.completed_at, i.canceled_at, i.created_at) < now() - make_interval(days => t.retention_days)
  `);
  return (prs.rowCount ?? 0) + (issues.rowCount ?? 0) + (jiraIssues.rowCount ?? 0);
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

// Per-push sync-log rows are high-frequency operational data (~1/push/member),
// and the UI only ever shows the last 100. A fixed 30-day window keeps them
// useful for troubleshooting while bounding growth regardless of a team's
// (analytics-oriented) retention_days.
export async function pruneMemberSyncLog(): Promise<number> {
  const res = await getPool().query(
    "DELETE FROM member_sync_log WHERE created_at < now() - interval '30 days'"
  );
  return res.rowCount ?? 0;
}

export async function pruneMemberDaemonLog(): Promise<number> {
  const res = await getPool().query(
    "DELETE FROM member_daemon_log WHERE ts < now() - interval '30 days'"
  );
  return res.rowCount ?? 0;
}

export async function pruneServerLog(): Promise<number> {
  const res = await getPool().query(
    "DELETE FROM server_log WHERE ts < now() - interval '7 days'"
  );
  return res.rowCount ?? 0;
}

// Flush the in-memory server-log ring buffer to server_log in batches. Runs on
// a short interval rather than write-through per line, because a synchronous
// per-line DB write would re-enter the patched console (pg logs errors via
// console) and infinite-loop. Tracks a high-water seq across calls.
let lastFlushedSeq = 0;
export async function flushServerLog(): Promise<number> {
  const { drainForFlush } = await import("./log-buffer");
  const pending = drainForFlush(lastFlushedSeq);
  if (pending.length === 0) return 0;
  const vals: unknown[] = [];
  const tuples = pending.map((l, i) => {
    const b = i * 4;
    vals.push(l.seq, new Date(l.ts).toISOString(), l.level, l.msg);
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4})`;
  });
  await getPool().query(
    `INSERT INTO server_log (seq, ts, level, msg) VALUES ${tuples.join(",")}
     ON CONFLICT (seq) DO NOTHING`,
    vals,
  );
  lastFlushedSeq = pending[pending.length - 1].seq;
  return pending.length;
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
    try {
      const n = await pruneMemberSyncLog();
      if (n) console.log(`[scheduler] pruned ${n} member_sync_log rows`);
    } catch (err) {
      console.error(`[scheduler] member_sync_log prune failed: ${(err as Error).message}`);
    }
    try {
      const n = await pruneMemberDaemonLog();
      if (n) console.log(`[scheduler] pruned ${n} member_daemon_log rows`);
    } catch (err) {
      console.error(`[scheduler] member_daemon_log prune failed: ${(err as Error).message}`);
    }
    try {
      const n = await pruneServerLog();
      if (n) console.log(`[scheduler] pruned ${n} server_log rows`);
    } catch (err) {
      console.error(`[scheduler] server_log prune failed: ${(err as Error).message}`);
    }
  }, 60 * 60 * 1000);

  // Persist the server-log ring buffer to Postgres so it survives reboots.
  // Silent on the happy path (logging each flush would itself grow the log).
  setInterval(async () => {
    try {
      await flushServerLog();
    } catch (err) {
      console.error(`[scheduler] server_log flush failed: ${(err as Error).message}`);
    }
  }, 20_000);

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
      const { syncAllIntegrations } = await import("./integrations");
      await syncAllIntegrations(getPool());
    } catch (err) {
      console.error(`[scheduler] integration sync sweep failed: ${(err as Error).message}`);
    }
  }, 60 * 60 * 1000);

  setInterval(async () => {
    try {
      const n = await prunePlanUtilization();
      if (n) console.log(`[scheduler] pruned ${n} plan_utilization rows`);
      const ni = await pruneIntegrationData();
      if (ni) console.log(`[scheduler] pruned ${ni} integration rows`);
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
