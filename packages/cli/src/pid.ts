import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
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

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function cleanStalePid(filePath: string): boolean {
  const entry = readPid(filePath);
  if (entry === null) return false;
  if (isProcessAlive(entry.pid)) return false;
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
