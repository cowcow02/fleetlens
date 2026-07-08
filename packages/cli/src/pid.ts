import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";

export function writePid(filePath: string, pid: number, port?: number, version?: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  // Format: pid[:port[:version]]. The version is the CLI that launched the
  // server, so `start`/`web` can detect a server left behind by an older
  // install and cycle it — without it an updated CLI keeps serving a stale
  // (sometimes broken, e.g. deleted lazy-route chunks) bundle. Version is
  // only appended when a port is present so the colon positions stay stable.
  let content = String(pid);
  if (port != null) {
    content += `:${port}`;
    if (version) content += `:${version}`;
  }
  writeFileSync(filePath, content, "utf8");
}

export function readPid(filePath: string): { pid: number; port?: number; version?: string } | null {
  try {
    const content = readFileSync(filePath, "utf8").trim();
    const [pidStr, portStr, versionStr] = content.split(":");
    const pid = parseInt(pidStr, 10);
    if (Number.isNaN(pid)) return null;
    const port = portStr ? parseInt(portStr, 10) : undefined;
    return {
      pid,
      port: Number.isNaN(port!) ? undefined : port,
      version: versionStr || undefined,
    };
  } catch {
    return null;
  }
}

/** True when `pid` is alive — and, when `markers` are given, when its ps
 *  command line contains one of them. PID files survive reboots and PIDs
 *  restart low, so a bare kill(pid,0) probe yields false positives: an
 *  unrelated boot process wearing our old PID made the login LaunchAgent
 *  skip the daemon with "already running" (2026-07-08). */
export function isProcessAlive(pid: number, markers?: string[]): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (!markers || markers.length === 0) return true;
  try {
    const cmd = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
    }).trim();
    return markers.some((m) => cmd.includes(m));
  } catch {
    return false; // pid vanished between the probe and ps
  }
}

export function cleanStalePid(filePath: string, markers?: string[]): boolean {
  const entry = readPid(filePath);
  if (entry === null) return false;
  if (isProcessAlive(entry.pid, markers)) return false;
  try {
    unlinkSync(filePath);
  } catch {
    // Already gone
  }
  return true;
}

export function removePid(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    // Already gone
  }
}
