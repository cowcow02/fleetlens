export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Install first so migration/scheduler/ingest lines are captured from boot.
  const { installLogCapture } = await import("./lib/log-buffer");
  installLogCapture();
  const { runMigrations } = await import("./db/migrate");
  const { startScheduler } = await import("./lib/scheduler");
  console.log("[instrumentation] running migrations…");
  await runMigrations();
  console.log("[instrumentation] migrations complete; starting scheduler");

  // Hydrate the raw-log buffer from server_log so the log survives a reboot.
  // After migrations (table exists); best-effort — a cold DB just starts empty.
  try {
    const { getPool } = await import("./db/pool");
    const { hydrate } = await import("./lib/log-buffer");
    const res = await getPool().query<{ seq: string; ts_ms: number; level: string; msg: string }>(
      `SELECT seq, EXTRACT(EPOCH FROM ts)::float8 * 1000 AS ts_ms, level, msg
         FROM (SELECT * FROM server_log ORDER BY seq DESC LIMIT 2000) s
        ORDER BY seq ASC`,
    );
    hydrate(res.rows.map((r) => ({
      seq: Number(r.seq),
      ts: Number(r.ts_ms),
      level: (r.level === "warn" || r.level === "error" ? r.level : "log"),
      msg: r.msg,
    })));
    console.log(`[instrumentation] hydrated ${res.rows.length} server_log lines`);
  } catch (err) {
    console.warn(`[instrumentation] server_log hydrate skipped: ${(err as Error).message}`);
  }

  startScheduler();
}
