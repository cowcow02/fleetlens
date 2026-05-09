import { writeFileSync, unlinkSync, existsSync, readFileSync, statSync } from "node:fs";
import { cclensPath } from "@claude-lens/parser/fs";

// Lock is "fresh" if mtime is within STALE_MS AND owning pid is alive. The
// pipeline keeps mtime fresh via a HEARTBEAT_MS interval; without that, any
// synth lasting more than STALE_MS would falsely look idle to other callers.
const STALE_MS = 60 * 1000;
const HEARTBEAT_MS = 30 * 1000;

let lockPathCached: string | null = null;
let heartbeat: NodeJS.Timeout | null = null;

function lockPath(): string {
  if (lockPathCached) return lockPathCached;
  lockPathCached = cclensPath("llm-interactive.lock");
  return lockPathCached;
}

/** @internal Test-only. */
export function __setInteractiveLockPathForTest(path: string): void {
  lockPathCached = path;
}

function touchLock(): void {
  writeFileSync(lockPath(), String(process.pid), "utf8");
}

export function writeInteractiveLock(): void {
  touchLock();
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = setInterval(() => {
    try { touchLock(); } catch { /* disk full or path gone — leave it */ }
  }, HEARTBEAT_MS);
  // Don't keep the Node event loop alive just for this timer; long-lived
  // pipelines have their own work pinning the loop, and short-lived tests
  // shouldn't hang on a stray interval.
  heartbeat.unref?.();
}

export function removeInteractiveLock(): void {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  try { unlinkSync(lockPath()); } catch { /* already gone */ }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function interactiveLockFresh(nowMs: number): boolean {
  const p = lockPath();
  if (!existsSync(p)) return false;
  try {
    const mtime = statSync(p).mtimeMs;
    if (nowMs - mtime > STALE_MS) return false;
    const pid = Number(readFileSync(p, "utf8").trim());
    if (!Number.isFinite(pid) || pid <= 0) return false;
    if (!pidAlive(pid)) return false;
    return true;
  } catch {
    return false;
  }
}
