import { getServerStatus, isServerStale } from "../server.js";
import { getDaemonStatusInfo } from "./daemon.js";

declare const CLI_VERSION: string;

/**
 * `fleetlens status` — show the live state of both the web server and
 * the usage daemon in one line each, plus the most recent utilization
 * snapshot from the daemon.
 */
export async function status(): Promise<void> {
  // --- Web server ---
  const server = getServerStatus();
  if (server.running) {
    const url = `http://localhost:${server.port}`;
    const ver = server.version ?? "unknown";
    console.log(`Server:  running on ${url} (PID ${server.pid}, v${ver})`);
    if (isServerStale(server)) {
      console.log(
        `  ⚠  serving stale ${ver} (CLI is ${CLI_VERSION}) — run 'fleetlens start' to restart on the current version`,
      );
    }
  } else {
    console.log("Server:  not running");
  }

  // --- Usage daemon ---
  const daemon = getDaemonStatusInfo();
  if (daemon.running) {
    console.log(`Daemon:  running (PID ${daemon.pid})`);
  } else {
    console.log("Daemon:  not running");
  }

  // --- Latest snapshot ---
  if (daemon.lastSnapshot && daemon.lastSnapshotAgeMs !== null) {
    const age = Math.round(daemon.lastSnapshotAgeMs / 1000);
    const ageStr =
      age < 60 ? `${age}s` : age < 3600 ? `${Math.round(age / 60)}m` : `${Math.round(age / 3600)}h`;
    console.log(`Latest:  ${ageStr} ago`);
    console.log(`  5h:    ${daemon.lastSnapshot.five_hour.utilization?.toFixed(1) ?? "—"}%`);
    console.log(`  7d:    ${daemon.lastSnapshot.seven_day.utilization?.toFixed(1) ?? "—"}%`);
  } else {
    console.log("Latest:  no usage snapshot yet");
  }
}
