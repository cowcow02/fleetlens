import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

export function writePid(filePath: string, pid: number, port?: number): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const content = port != null ? `${pid}:${port}` : String(pid);
  writeFileSync(filePath, content, "utf8");
}

export function readPid(filePath: string): { pid: number; port?: number } | null {
  try {
    const content = readFileSync(filePath, "utf8").trim();
    const [pidStr, portStr] = content.split(":");
    const pid = parseInt(pidStr, 10);
    if (Number.isNaN(pid)) return null;
    const port = portStr ? parseInt(portStr, 10) : undefined;
    return { pid, port: Number.isNaN(port!) ? undefined : port };
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
