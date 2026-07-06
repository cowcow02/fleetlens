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
  startScheduler();
}
