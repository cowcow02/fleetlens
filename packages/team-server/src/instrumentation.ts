export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { runMigrations } = await import("./db/migrate");
  const { startScheduler } = await import("./lib/scheduler");
  console.log("[instrumentation] running migrations…");
  await runMigrations();
  console.log("[instrumentation] migrations complete; starting scheduler");
  startScheduler();
}
