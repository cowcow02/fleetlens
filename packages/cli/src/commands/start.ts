import { getServerStatus, startServer, openBrowser } from "../server.js";
import { checkForUpdate } from "../updater.js";

export async function start(args: string[]): Promise<void> {
  const portFlag = args.indexOf("--port");
  const port = portFlag !== -1 ? parseInt(args[portFlag + 1], 10) : undefined;
  const noOpen = args.includes("--no-open");

  // Auto-update check
  try {
    await checkForUpdate();
  } catch {
    // Silently skip if updater fails
  }

  // Check if already running
  const status = getServerStatus();
  if (status.running) {
    const url = `http://localhost:${status.port}`;
    console.log(`fleetlens is already running on ${url} (PID ${status.pid})`);
    if (!noOpen) openBrowser(url);
    return;
  }

  console.log("Starting fleetlens...");

  try {
    const result = await startServer({ port });
    const url = `http://localhost:${result.port}`;
    console.log(`fleetlens running on ${url} (PID ${result.pid})`);
    if (!noOpen) openBrowser(url);
  } catch (err) {
    console.error(`Failed to start: ${(err as Error).message}`);
    process.exit(1);
  }
}
