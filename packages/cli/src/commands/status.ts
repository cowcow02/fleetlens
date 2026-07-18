import { getServerStatus, isServerStale, probeServerHealth } from "../server.js";
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
    // A live pid is not a live server — a GC-livelocked next-server keeps
    // its pid and port while answering nothing. Probe HTTP so status can't
    // report "running" for a wedged server (2026-07-18 incident).
    const responsive = await probeServerHealth(server.port, 3_000);
    if (responsive) {
      console.log(`Server:  running on ${url} (PID ${server.pid}, v${ver})`);
    } else {
      console.log(`Server:  running but UNRESPONSIVE on ${url} (PID ${server.pid}, v${ver})`);
      console.log(
        "  ⚠  process is alive but not answering HTTP — a running daemon's watchdog force-restarts a wedged server ('fleetlens daemon logs' shows its verdicts), or run 'fleetlens start' now",
      );
    }
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
