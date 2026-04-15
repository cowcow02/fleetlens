/**
 * Usage-poller daemon worker. Runs detached. Polls /api/oauth/usage and
 * appends each snapshot to `~/.cclens/usage.jsonl`. Logs errors to
 * `~/.cclens/daemon.log` but never crashes on transient failures.
 *
 * Expiry handling is local: we read `expiresAt` from the Keychain entry
 * and simply don't call the API when the token is dead. The watchdog
 * rechecks every WATCHDOG_INTERVAL_MS, so the moment Claude Code refreshes
 * the token we resume polling within seconds — no backoff, no wasted 401s.
 *
 * Backoff only kicks in for real HTTP errors (401/429/5xx) where the
 * server disagrees with our local view. Those should be rare.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fetchUsage, UsageApiError } from "./usage/api.js";
import { appendSnapshot } from "./usage/storage.js";
import { isUsable, readOAuthCredentials } from "./usage/token.js";
import { BASE_INTERVAL_MS, nextIntervalMs, type PollOutcome } from "./usage/backoff.js";

const STATE_DIR = join(homedir(), ".cclens");
const USAGE_LOG = join(STATE_DIR, "usage.jsonl");
const DAEMON_LOG = join(STATE_DIR, "daemon.log");
// Watchdog cadence. Short so we notice wake-from-sleep and token refresh
// within a few seconds instead of waiting out a 5-minute interval.
const WATCHDOG_INTERVAL_MS = 5 * 1000;

mkdirSync(dirname(USAGE_LOG), { recursive: true });

function log(level: "info" | "warn" | "error", message: string): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}\n`;
  try {
    appendFileSync(DAEMON_LOG, line, "utf8");
  } catch {
    // Disk might be full. Swallow and keep running.
  }
}

let nextPollAtMs = 0;
let currentIntervalMs = BASE_INTERVAL_MS;
let waitingForRefresh = false;

async function tick(): Promise<PollOutcome> {
  try {
    const snapshot = await fetchUsage();
    appendSnapshot(USAGE_LOG, snapshot);
    log(
      "info",
      `snapshot 5h=${snapshot.five_hour.utilization}% 7d=${snapshot.seven_day.utilization}%`,
    );
    return "success";
  } catch (err) {
    if (err instanceof UsageApiError) {
      log("warn", `poll failed (${err.code}): ${err.message}`);
      return err.code === "network" ? "network" : "auth";
    }
    log("error", `unexpected error: ${(err as Error).stack ?? err}`);
    return "auth";
  }
}

function scheduleAfter(now: number, outcome: PollOutcome): void {
  const prev = currentIntervalMs;
  currentIntervalMs = nextIntervalMs(currentIntervalMs, outcome);
  if (currentIntervalMs !== prev) {
    log(
      "info",
      `poll interval ${outcome === "success" ? "reset" : "backoff"} to ${currentIntervalMs / 1000}s`,
    );
  }
  nextPollAtMs = now + currentIntervalMs;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runLoop(): Promise<void> {
  while (true) {
    const now = Date.now();
    if (now >= nextPollAtMs) {
      // Log a wake-from-sleep catch-up when we come back from a long gap.
      // Only meaningful once we've done at least one poll (nextPollAtMs > 0).
      if (nextPollAtMs > 0 && now - nextPollAtMs > currentIntervalMs) {
        log(
          "info",
          `wake-from-sleep catch-up: ${Math.round((now - nextPollAtMs + currentIntervalMs) / 1000)}s since last poll`,
        );
      }

      // Local precheck: is the Keychain token usable right now?
      const creds = readOAuthCredentials();
      if (!creds) {
        log("warn", "no Claude Code OAuth token found; waiting");
        waitingForRefresh = true;
        // No creds at all — don't spam, retry at normal cadence.
        nextPollAtMs = now + BASE_INTERVAL_MS;
      } else if (!isUsable(creds, now)) {
        if (!waitingForRefresh) {
          log("info", "token expired; waiting for Claude Code to refresh it");
          waitingForRefresh = true;
        }
        // Don't advance nextPollAtMs — next watchdog tick rechecks in
        // WATCHDOG_INTERVAL_MS, and the moment Claude Code writes a fresh
        // token we fire a poll immediately.
      } else {
        if (waitingForRefresh) {
          log("info", "token refreshed; resuming polls");
          waitingForRefresh = false;
        }
        const outcome = await tick();
        scheduleAfter(Date.now(), outcome);
      }
    }
    await sleep(WATCHDOG_INTERVAL_MS);
  }
}

log(
  "info",
  `daemon started (pid=${process.pid}, interval=${BASE_INTERVAL_MS / 1000}s, watchdog=${WATCHDOG_INTERVAL_MS / 1000}s)`,
);

// Kick the loop. runLoop() never resolves — it runs until SIGTERM.
void runLoop();

process.on("SIGTERM", () => {
  log("info", `daemon stopping (pid=${process.pid})`);
  process.exit(0);
});
