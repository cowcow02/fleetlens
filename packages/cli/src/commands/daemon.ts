import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, statSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { writePid, readPid, isProcessAlive, cleanStalePid, removePid } from "../pid.js";
import { latestSnapshot } from "../usage/storage.js";

const STATE_DIR = join(homedir(), ".cclens");
const DAEMON_PID = join(STATE_DIR, "daemon.pid");
const USAGE_LOG = join(STATE_DIR, "usage.jsonl");
const DAEMON_LOG = join(STATE_DIR, "daemon.log");

export type DaemonLifecycleResult =
  | { started: true; pid: number; alreadyRunning: false }
  | { started: false; pid: number; alreadyRunning: true }
  | { started: false; pid: null; alreadyRunning: false; error: string };

/** Start the daemon if not already running. Pure data, no printing. */
export function startDaemonSilent(): DaemonLifecycleResult {
  cleanStalePid(DAEMON_PID);
  const existing = readPid(DAEMON_PID);
  if (existing !== null && isProcessAlive(existing.pid)) {
    return { started: false, pid: existing.pid, alreadyRunning: true };
  }

  const script = workerPath();
  if (!existsSync(script)) {
    return {
      started: false,
      pid: null,
      alreadyRunning: false,
      error: `Daemon worker not found at ${script}. Rebuild with: pnpm -F fleetlens build`,
    };
  }

  const child = spawn(process.execPath, [script], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  const pid = child.pid!;
  writePid(DAEMON_PID, pid);
  return { started: true, pid, alreadyRunning: false };
}

/** Stop the daemon if running. Pure data, no printing. */
export function stopDaemonSilent(): { stopped: boolean; pid: number | null } {
  cleanStalePid(DAEMON_PID);
  const entry = readPid(DAEMON_PID);
  if (entry === null) return { stopped: false, pid: null };

  try {
    process.kill(entry.pid, "SIGTERM");
  } catch {
    // already gone
  }
  removePid(DAEMON_PID);
  return { stopped: true, pid: entry.pid };
}

export type DaemonStatusInfo = {
  running: boolean;
  pid: number | null;
  lastSnapshotAgeMs: number | null;
  lastSnapshot: ReturnType<typeof latestSnapshot>;
  usageLogSize: number | null;
};

/** Inspect daemon state. Pure data, no printing. */
export function getDaemonStatusInfo(): DaemonStatusInfo {
  cleanStalePid(DAEMON_PID);
  const entry = readPid(DAEMON_PID);
  const running = entry !== null && isProcessAlive(entry.pid);
  const latest = latestSnapshot(USAGE_LOG);
  const lastSnapshotAgeMs = latest
    ? Date.now() - new Date(latest.captured_at).getTime()
    : null;
  const usageLogSize = existsSync(USAGE_LOG) ? statSync(USAGE_LOG).size : null;
  return {
    running,
    pid: running ? entry!.pid : null,
    lastSnapshotAgeMs,
    lastSnapshot: latest,
    usageLogSize,
  };
}

function workerPath(): string {
  // Both the CLI entrypoint and the daemon worker are bundled into dist/.
  // The build step emits two files: dist/index.js and dist/daemon-worker.js.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "daemon-worker.js");
}

export async function daemon(args: string[]): Promise<void> {
  const sub = args[0] ?? "status";

  switch (sub) {
    case "start":
      await daemonStart();
      break;
    case "stop":
      daemonStop();
      break;
    case "status":
      daemonStatus();
      break;
    case "logs":
      daemonLogs();
      break;
    default:
      console.error(`Unknown daemon subcommand: ${sub}`);
      console.error("Usage: fleetlens daemon <start|stop|status|logs>");
      process.exit(1);
  }
}

async function daemonStart(): Promise<void> {
  const result = startDaemonSilent();
  if (result.alreadyRunning) {
    console.log(`Daemon is already running (PID ${result.pid})`);
    return;
  }
  if (!result.started) {
    console.error(result.error);
    process.exit(1);
  }
  console.log(`Daemon started (PID ${result.pid})`);
  console.log(`Polling every 5 minutes. Logs: ${DAEMON_LOG}`);
}

function daemonStop(): void {
  const result = stopDaemonSilent();
  if (!result.stopped) {
    console.log("Daemon is not running.");
    return;
  }
  console.log(`Stopped daemon (PID ${result.pid})`);
}

function daemonStatus(): void {
  const info = getDaemonStatusInfo();
  if (info.running) {
    console.log(`Daemon: running (PID ${info.pid})`);
  } else {
    console.log("Daemon: not running");
  }

  if (info.lastSnapshot && info.lastSnapshotAgeMs !== null) {
    const age = Math.round(info.lastSnapshotAgeMs / 1000);
    const ageStr = age < 60 ? `${age}s` : age < 3600 ? `${Math.round(age / 60)}m` : `${Math.round(age / 3600)}h`;
    console.log(`Last snapshot: ${ageStr} ago`);
    console.log(`  5h:    ${info.lastSnapshot.five_hour.utilization?.toFixed(1) ?? "—"}%`);
    console.log(`  7d:    ${info.lastSnapshot.seven_day.utilization?.toFixed(1) ?? "—"}%`);
  } else {
    console.log("Last snapshot: none yet");
  }

  if (info.usageLogSize !== null) {
    console.log(`Usage log: ${USAGE_LOG} (${info.usageLogSize} bytes)`);
  }
}

function daemonLogs(): void {
  if (!existsSync(DAEMON_LOG)) {
    console.log("No daemon logs yet.");
    return;
  }
  const content = readFileSync(DAEMON_LOG, "utf8");
  const lines = content.trim().split("\n").slice(-20);
  for (const line of lines) process.stdout.write(line + "\n");
}
