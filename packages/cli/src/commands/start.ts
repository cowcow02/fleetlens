import { getServerStatus, startServer, openBrowser } from "../server.js";
import { checkForUpdate } from "../updater.js";
import { startDaemonSilent } from "./daemon.js";

/**
 * `fleetlens start` — launch both the dashboard web server AND the usage
 * daemon in one shot. The daemon backfills plan utilization in the
 * background so the dashboard has fresh data even when the browser tab
 * isn't open.
 *
 * Power users who want to manage the daemon separately can still use
 * `fleetlens daemon <start|stop|status|logs>` directly. Pass `--no-daemon`
 * to start to skip the daemon part.
 */
export async function start(args: string[]): Promise<void> {
  const portFlag = args.indexOf("--port");
  const port = portFlag !== -1 ? parseInt(args[portFlag + 1], 10) : undefined;
  const noOpen = args.includes("--no-open");
  const noDaemon = args.includes("--no-daemon");

  // Auto-update check
  try {
    await checkForUpdate();
  } catch {
    // Silently skip if updater fails
  }

  // --- Web server ---
  const status = getServerStatus();
  let serverUrl: string;
  let serverPid: number;
  if (status.running) {
    serverUrl = `http://localhost:${status.port}`;
    serverPid = status.pid;
    console.log(`Server:  already running on ${serverUrl} (PID ${serverPid})`);
  } else {
    console.log("Starting Fleetlens...");
    try {
      const result = await startServer({ port });
      serverUrl = `http://localhost:${result.port}`;
      serverPid = result.pid;
      console.log(`Server:  started on ${serverUrl} (PID ${serverPid})`);
    } catch (err) {
      console.error(`Failed to start server: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  // --- Usage daemon ---
  if (!noDaemon) {
    const daemon = startDaemonSilent();
    if (daemon.alreadyRunning) {
      console.log(`Daemon:  already running (PID ${daemon.pid})`);
    } else if (daemon.started) {
      console.log(`Daemon:  started (PID ${daemon.pid})`);
    } else {
      // Non-fatal — the dashboard still works without the daemon, you
      // just won't get live usage updates. Warn and continue.
      console.warn(`Daemon:  failed to start — ${daemon.error}`);
    }
  }

  if (!noOpen) openBrowser(serverUrl);
}
