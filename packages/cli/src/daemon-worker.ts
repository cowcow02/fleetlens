/**
 * Usage-poller daemon worker. Runs detached. Polls /api/oauth/usage and
 * appends each snapshot to `cclensHome()/usage.jsonl`. Logs errors to
 * `cclensHome()/daemon.log` but never crashes on transient failures.
 *
 * Expiry handling is local: we read `expiresAt` from the Keychain entry
 * and simply don't call the API when the token is dead. The watchdog
 * rechecks every WATCHDOG_INTERVAL_MS, so the moment Claude Code refreshes
 * the token we resume polling within seconds — no backoff, no wasted 401s.
 *
 * Backoff only kicks in for real HTTP errors (401/429/5xx) where the
 * server disagrees with our local view. Those should be rare.
 */

import { spawn } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchUsage, UsageApiError } from "./usage/api.js";
import { appendSnapshot } from "./usage/storage.js";
import { agentSources, cclensPath } from "@claude-lens/parser/fs";
import { isUsable, readOAuthCredentials } from "./usage/token.js";
import { BASE_INTERVAL_MS, nextIntervalMs, type PollOutcome } from "./usage/backoff.js";
import { runTeamSync } from "./team/sync.js";
import { runPerceptionSweep } from "./perception/worker.js";
import { backfillLastWeekDigest, backfillYesterdayDigest } from "./perception/backfill.js";
import { getUpdateAvailability } from "./updater.js";

const USAGE_LOG = cclensPath("usage.jsonl");
const DAEMON_LOG = cclensPath("daemon.log");
const UPDATE_STATE = cclensPath("daemon-update.json");
// Watchdog cadence. Short so we notice wake-from-sleep and token refresh
// within a few seconds instead of waiting out a 5-minute interval.
const WATCHDOG_INTERVAL_MS = 5 * 1000;
const AUTO_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

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
let nextTeamSyncAtMs = 0;
let currentIntervalMs = BASE_INTERVAL_MS;
let waitingForRefresh = false;
let updateCheckInFlight = false;

const PERCEPTION_INTERVAL_MS = 5 * 60 * 1000;
let perceptionInFlight = false;
// One-shot per-process: backfill last week's narrative after the FIRST
// successful sweep on this boot. Re-running on every poll would either
// re-spend (if the lock file is mistakenly cleared) or just be wasted I/O.
let backfillAttempted = false;

const perceptionHandle: NodeJS.Timeout = setInterval(async () => {
  if (perceptionInFlight) return;
  perceptionInFlight = true;
  try {
    const { sessionsProcessed, entriesWritten, errors } = await runPerceptionSweep();
    if (sessionsProcessed > 0 || errors > 0) {
      log("info", `perception sweep: ${sessionsProcessed} sessions, ${entriesWritten} entries, ${errors} errors`);
    }
    if (!backfillAttempted) {
      backfillAttempted = true;
      // Detached: a long LLM run shouldn't block the next sweep tick. Errors
      // are caught inside the backfill helpers; these .catch handlers are
      // belt-and-braces against unexpected throws.
      void backfillLastWeekDigest({ log }).catch((err) => {
        log("warn", `auto-backfill: failed (${(err as Error).message})`);
      });
      void backfillYesterdayDigest({ log }).catch((err) => {
        log("warn", `auto-backfill-day: failed (${(err as Error).message})`);
      });
    }
  } catch (err) {
    log("error", `perception sweep failed: ${(err as Error).message}`);
  } finally {
    perceptionInFlight = false;
  }
}, PERCEPTION_INTERVAL_MS);

type DaemonUpdateState = {
  lastCheckedAt?: string;
  current?: string;
  latest?: string | null;
  updateAvailable?: boolean;
  updateSpawnedAt?: string;
  error?: string;
};

function readUpdateState(): DaemonUpdateState | null {
  try {
    return JSON.parse(readFileSync(UPDATE_STATE, "utf8")) as DaemonUpdateState;
  } catch {
    return null;
  }
}

function writeUpdateState(state: DaemonUpdateState): void {
  try {
    writeFileSync(UPDATE_STATE, JSON.stringify(state, null, 2), { mode: 0o600 });
  } catch {
    // Non-critical state; the daemon can still run without it.
  }
}

function nextUpdateCheckFromState(nowMs: number): number {
  const lastCheckedAt = readUpdateState()?.lastCheckedAt;
  if (!lastCheckedAt) return 0;
  const lastMs = Date.parse(lastCheckedAt);
  if (Number.isNaN(lastMs)) return 0;
  return nowMs - lastMs >= AUTO_UPDATE_INTERVAL_MS
    ? 0
    : lastMs + AUTO_UPDATE_INTERVAL_MS;
}

let nextUpdateCheckAtMs = nextUpdateCheckFromState(Date.now());

function cliEntryPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "index.js");
}

async function runDaemonUpdateCheck(): Promise<void> {
  if (process.env.FLEETLENS_DAEMON_AUTO_UPDATE === "0") {
    nextUpdateCheckAtMs = Date.now() + AUTO_UPDATE_INTERVAL_MS;
    return;
  }
  if (updateCheckInFlight) return;
  updateCheckInFlight = true;

  const checkedAt = new Date().toISOString();
  try {
    const availability = await getUpdateAvailability();
    if (!availability) return;

    const state: DaemonUpdateState = {
      lastCheckedAt: checkedAt,
      current: availability.current,
      latest: availability.latest,
      updateAvailable: availability.updateAvailable,
    };
    writeUpdateState(state);

    if (!availability.latest) {
      log("warn", "update check skipped: npm registry unreachable");
      return;
    }
    if (!availability.updateAvailable) {
      log("info", `update check ok: ${availability.current} is current`);
      return;
    }

    const entry = cliEntryPath();
    if (!existsSync(entry)) {
      log("warn", `update check found ${availability.latest}, but CLI entry is missing at ${entry}`);
      return;
    }

    let logFd: number | "ignore" = "ignore";
    try {
      logFd = openSync(DAEMON_LOG, "a");
    } catch {
      // If we cannot append logs, still let the updater run detached.
    }

    const child = spawn(process.execPath, [entry, "update"], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, FLEETLENS_UPDATE_SOURCE: "daemon" },
    });
    if (typeof logFd === "number") {
      child.on("exit", () => {
        try { closeSync(logFd); } catch {}
      });
    }
    child.unref();

    writeUpdateState({
      ...state,
      updateSpawnedAt: new Date().toISOString(),
    });
    log(
      "info",
      `update check found ${availability.latest}; spawned updater pid=${child.pid ?? "unknown"}`,
    );
  } catch (err) {
    writeUpdateState({ lastCheckedAt: checkedAt, error: (err as Error).message });
    log("warn", `update check failed: ${(err as Error).message}`);
  } finally {
    updateCheckInFlight = false;
    nextUpdateCheckAtMs = Date.now() + AUTO_UPDATE_INTERVAL_MS;
  }
}

async function tick(): Promise<PollOutcome> {
  // Iterate every registered agent source. Each declares its own
  // usagePoller (or omits it). Sources that read from disk (Codex)
  // can't fail in ways that block Claude's OAuth path; Claude's
  // poller is wired below as a special-cased one because OAuth
  // outcomes drive the daemon's backoff state.
  for (const source of agentSources) {
    if (source.kind === "claude-code") continue;     // handled below
    if (!source.usagePoller) continue;
    try {
      const partial = await source.usagePoller();
      if (!partial) continue;
      // Pad to the full UsageSnapshot shape — Claude-only fields are
      // null for non-Claude agents and the storage format is shared.
      const snapshot = {
        ...partial,
        seven_day_opus: null,
        seven_day_sonnet: null,
        seven_day_oauth_apps: null,
        seven_day_cowork: null,
        extra_usage: null,
      };
      appendSnapshot(USAGE_LOG, snapshot);
      log(
        "info",
        `${source.kind} snapshot 5h=${snapshot.five_hour.utilization}% 7d=${snapshot.seven_day.utilization}%`,
      );
    } catch (err) {
      log("warn", `${source.kind} poll failed: ${(err as Error).message}`);
    }
  }
  // Claude's poller stays distinct — its return value drives backoff
  // because OAuth/auth outcomes are the daemon's primary signal.
  try {
    const snapshot = await fetchUsage();
    appendSnapshot(USAGE_LOG, snapshot);
    log(
      "info",
      `claude-code snapshot 5h=${snapshot.five_hour.utilization}% 7d=${snapshot.seven_day.utilization}%`,
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
    const teamNow = Date.now();
    if (teamNow >= nextTeamSyncAtMs) {
      // Team push is independent of Claude OAuth state — it uses its own bearer
      // and a different server. Keep it on its own cadence so an expired Claude
      // token cannot turn the team sync loop into a 5-second retry storm.
      await runTeamSync(log);
      nextTeamSyncAtMs = Date.now() + BASE_INTERVAL_MS;
    }
    if (Date.now() >= nextUpdateCheckAtMs) {
      await runDaemonUpdateCheck();
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
  clearInterval(perceptionHandle);
  log("info", `daemon stopping (pid=${process.pid})`);
  process.exit(0);
});
