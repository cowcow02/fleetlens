import { appendFileSync } from "node:fs";
import { cclensPath } from "@claude-lens/parser/fs";

// Single writer for daemon.log lines, format `${ISO} ${LEVEL} ${msg}`. Shared
// by the daemon, pairing, and manual `team sync` so sync-log.ts picks the
// [sync] summary off daemon.log no matter which path emitted it.
export function appendDaemonLogLine(level: "info" | "warn" | "error", msg: string): void {
  try {
    appendFileSync(
      cclensPath("daemon.log"),
      `${new Date().toISOString()} ${level.toUpperCase()} ${msg}\n`,
      "utf8",
    );
  } catch {
    // Logging must never crash the caller.
  }
}
