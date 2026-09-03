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
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllClaudeUsage, UsageApiError } from "./usage/api.js";
import { fetchZaiUsage, ZaiApiError } from "./usage/zai.js";
import { fetchGrokUsage, GrokApiError } from "./usage/grok.js";
import { fetchCodexUsage, CodexApiError } from "./usage/codex.js";
import { fetchCopilotUsage, CopilotApiError } from "./usage/copilot.js";
import { fetchCommandCodeUsage, CommandCodeApiError } from "./usage/command-code.js";
import {
  discoverKaihkProviders,
  fetchKaihkUsageForKey,
  isKaihkAgent,
} from "./usage/kaihk.js";
import { appendSnapshot, latestSnapshotsByAgent, pruneAgent } from "./usage/storage.js";
import { agentSources, cclensPath } from "@claude-lens/parser/fs";
import { appendDaemonLogLine } from "./daemon-log.js";
import { discoverClaudeAccounts } from "./usage/accounts.js";
import { BASE_INTERVAL_MS, nextIntervalMs, type PollOutcome } from "./usage/backoff.js";
import { runTeamSync } from "./team/sync.js";
import { runPerceptionSweep } from "./perception/worker.js";
import { backfillLastWeekDigest, backfillYesterdayDigest } from "./perception/backfill.js";
import { getUpdateAvailability } from "./updater.js";
import { getServerStatus, probeServerHealth, restartWedgedServer } from "./server.js";
import { ServerWatchdog, type WatchdogVerdict } from "./watchdog.js";

declare const CLI_VERSION: string;

const USAGE_LOG = cclensPath("usage.jsonl");
const DAEMON_LOG = cclensPath("daemon.log");
const UPDATE_STATE = cclensPath("daemon-update.json");
// Watchdog cadence. Short so we notice wake-from-sleep and token refresh
// within a few seconds instead of waiting out a 5-minute interval.
const WATCHDOG_INTERVAL_MS = 5 * 1000;
const AUTO_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SERVER_HEALTH_INTERVAL_MS = 60 * 1000;
const SERVER_HEALTH_TIMEOUT_MS = 10 * 1000;

mkdirSync(dirname(USAGE_LOG), { recursive: true });

function log(level: "info" | "warn" | "error", message: string): void {
  appendDaemonLogLine(level, message);
}

let nextPollAtMs = 0;
let nextAuxPollAtMs = 0;
let nextTeamSyncAtMs = 0;
let nextServerHealthAtMs = 0;
// First team sync after this daemon booted is tagged trigger="boot" in the
// [sync] summary line; every tick after is "auto".
let firstTeamSync = true;
let currentIntervalMs = BASE_INTERVAL_MS;
let waitingForRefresh = false;
let updateCheckInFlight = false;

const PERCEPTION_INTERVAL_MS = 5 * 60 * 1000;
let nextPerceptionAtMs = Date.now() + PERCEPTION_INTERVAL_MS;
let perceptionInFlight = false;
// One-shot per-process: backfill last week's narrative after the FIRST
// successful sweep on this boot. Re-running on every poll would either
// re-spend (if the lock file is mistakenly cleared) or just be wasted I/O.
let backfillAttempted = false;

async function runPerceptionTick(): Promise<void> {
  if (perceptionInFlight) return;
  perceptionInFlight = true;
  try {
    const { sessionsProcessed, entriesWritten, errors, skippedOversized } = await runPerceptionSweep();
    if (sessionsProcessed > 0 || errors > 0 || skippedOversized > 0) {
      const mem = process.memoryUsage();
      const mb = (n: number) => Math.round(n / 1048576);
      log(
        "info",
        `perception sweep: ${sessionsProcessed} sessions, ${entriesWritten} entries, ${errors} errors, ${skippedOversized} oversized skipped · heap ${mb(mem.heapUsed)}MB rss ${mb(mem.rss)}MB`,
      );
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
    nextPerceptionAtMs = Date.now() + PERCEPTION_INTERVAL_MS;
  }
}

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
  if (updateCheckInFlight) {
    // Without this, the tick at 5 s cadence re-enters every loop while the
    // previous check is still in flight, and if it's ever stuck the daemon
    // spins until process restart.
    nextUpdateCheckAtMs = Date.now() + AUTO_UPDATE_INTERVAL_MS;
    return;
  }
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

const serverWatchdog = new ServerWatchdog();
let lastServerVerdict: WatchdogVerdict = "ok";
let lastServerPid: number | null = null;

/** HTTP-probe the web server and act on the ServerWatchdog verdict (see
 *  watchdog.ts for the wedge story). No pid file → intentionally stopped →
 *  not ours to touch. */
async function runServerHealthCheck(): Promise<void> {
  const status = getServerStatus();
  if (!status.running) {
    if (lastServerPid !== null) {
      serverWatchdog.noteServerGone();
      lastServerPid = null;
    }
    return;
  }
  if (status.pid !== lastServerPid) {
    // Probe failures must not carry across server instances: a fresh
    // server inheriting the old one's failure run could be killed on its
    // first slow probe.
    serverWatchdog.noteNewInstance();
    lastServerPid = status.pid;
  }

  const ok = await probeServerHealth(status.port, SERVER_HEALTH_TIMEOUT_MS);
  const verdict = serverWatchdog.onProbe(ok, Date.now());

  if (verdict === "failing") {
    log("warn", `[watchdog] server pid=${status.pid} not answering on port ${status.port}`);
  } else if (verdict === "restart") {
    log("warn", `[watchdog] server pid=${status.pid} wedged; force-restarting on port ${status.port}`);
    try {
      const fresh = await restartWedgedServer(status.pid, status.port);
      log("info", `[watchdog] server restarted (pid=${fresh.pid}, port=${fresh.port})`);
    } catch (err) {
      log("error", `[watchdog] restart failed: ${(err as Error).message}`);
    }
  } else if (verdict === "gave-up" && lastServerVerdict !== "gave-up") {
    log(
      "error",
      `[watchdog] server keeps wedging after 3 restarts within the hour; standing down — run 'fleetlens start' to restart manually`,
    );
  } else if (verdict === "ok" && lastServerVerdict !== "ok") {
    log("info", `[watchdog] server responding again (pid=${status.pid})`);
  }
  lastServerVerdict = verdict;
}

async function pollAuxiliaryUsage(): Promise<void> {
  // Iterate every registered agent source that still exposes a disk-side
  // usagePoller. Network-backed agents (Claude, Codex, Copilot, Grok, Z.ai) are
  // special-cased below so missing auth never stalls Claude's backoff path.
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
      const fiveHour = snapshot.five_hour.utilization === null
        ? "—"
        : `${snapshot.five_hour.utilization}%`;
      const sevenDay = snapshot.seven_day.utilization === null
        ? "—"
        : `${snapshot.seven_day.utilization}%`;
      log(
        "info",
        `${source.kind} snapshot 5h=${fiveHour} 7d=${sevenDay}`,
      );
    } catch (err) {
      log("warn", `${source.kind} poll failed: ${(err as Error).message}`);
    }
  }
  // Z.ai is a third, independent poller branch: like Claude it's a network
  // API-key call (not a parser agentSource), but unlike Claude its outcome
  // does NOT drive the daemon's backoff — a bad/missing Z.ai key must not
  // slow Claude polling, and vice-versa.
  try {
    const zaiSnapshot = await fetchZaiUsage();
    appendSnapshot(USAGE_LOG, zaiSnapshot);
    log(
      "info",
      `zai snapshot 5h=${zaiSnapshot.five_hour.utilization}% 7d=${zaiSnapshot.seven_day.utilization}%`,
    );
  } catch (err) {
    if (err instanceof ZaiApiError && err.code === "no_key") {
      // Not configured (or key removed via Settings): drop any stale zai line
      // so the widget/dashboard stop showing obsolete usage. Other codes
      // (http/network/parse) are real failures worth logging.
      pruneAgent(USAGE_LOG, "zai");
    } else {
      log("warn", `zai poll failed: ${(err as Error).message}`);
    }
  }
  // GitHub Copilot's current allowance is monthly AI credits. Its public SDK
  // RPC uses the Copilot CLI's secure login, so no token is copied into
  // Fleetlens state. There are no 5h/7d windows for this provider.
  try {
    const copilotSnapshot = await fetchCopilotUsage();
    appendSnapshot(USAGE_LOG, copilotSnapshot);
    const monthly = copilotSnapshot.monthly?.utilization;
    log("info", `copilot snapshot monthly=${monthly === null || monthly === undefined ? "—" : `${monthly}%`}`);
  } catch (err) {
    if (err instanceof CopilotApiError && err.code === "no_cli") {
      pruneAgent(USAGE_LOG, "copilot");
      // Quiet when Copilot isn't installed on this machine.
    } else if (!(err instanceof CopilotApiError && err.code === "no_auth")) {
      log("warn", `copilot poll failed: ${(err as Error).message}`);
    }
  }
  // Codex live plan windows — ChatGPT WHAM usage API (same path as OpenUsage).
  // Not scraped from session rollouts: those only refresh after a Codex turn
  // and can stick at a pre-reset % for days. Independent of Claude backoff.
  try {
    const codexSnapshot = await fetchCodexUsage();
    appendSnapshot(USAGE_LOG, codexSnapshot);
    const fiveHour = codexSnapshot.five_hour.utilization === null
      ? "—"
      : `${codexSnapshot.five_hour.utilization}%`;
    const sevenDay = codexSnapshot.seven_day.utilization === null
      ? "—"
      : `${codexSnapshot.seven_day.utilization}%`;
    log("info", `codex snapshot 5h=${fiveHour} 7d=${sevenDay}`);
  } catch (err) {
    if (
      err instanceof CodexApiError &&
      (err.code === "no_auth" || err.code === "api_key_only")
    ) {
      pruneAgent(USAGE_LOG, "codex");
      // Quiet when Codex simply isn't logged in (or is API-key-only).
    } else {
      log("warn", `codex poll failed: ${(err as Error).message}`);
    }
  }
  // Grok weekly credit pool — same endpoint as the Grok CLI / OpenUsage.
  // No 5h window; seven_day carries the weekly shared-pool %. Independent
  // of Claude backoff (missing auth must not stall other agents).
  try {
    const grokSnapshot = await fetchGrokUsage();
    appendSnapshot(USAGE_LOG, grokSnapshot);
    log(
      "info",
      `grok snapshot 5h=— 7d=${grokSnapshot.seven_day.utilization}%`,
    );
  } catch (err) {
    if (err instanceof GrokApiError && (err.code === "no_auth" || err.code === "not_weekly")) {
      pruneAgent(USAGE_LOG, "grok");
      if (err.code === "no_auth") {
        // Quiet when Grok simply isn't logged in on this machine.
      } else {
        log("warn", `grok poll skipped: ${err.message}`);
      }
    } else {
      log("warn", `grok poll failed: ${(err as Error).message}`);
    }
  }
  // Command Code 5h + weekly rolling windows — same alpha billing endpoints
  // as the cmd `/usage` overlay. Independent of Claude backoff.
  try {
    const cmdSnapshot = await fetchCommandCodeUsage();
    appendSnapshot(USAGE_LOG, cmdSnapshot);
    const monthly = cmdSnapshot.monthly?.utilization === null || cmdSnapshot.monthly?.utilization === undefined
      ? "—"
      : `${cmdSnapshot.monthly.utilization}%`;
    const fiveHour = cmdSnapshot.five_hour.utilization === null
      ? "—"
      : `${cmdSnapshot.five_hour.utilization}%`;
    const sevenDay = cmdSnapshot.seven_day.utilization === null
      ? "—"
      : `${cmdSnapshot.seven_day.utilization}%`;
    log("info", `command-code snapshot monthly=${monthly} 5h=${fiveHour} 7d=${sevenDay}`);
  } catch (err) {
    if (err instanceof CommandCodeApiError && err.code === "no_auth") {
      pruneAgent(USAGE_LOG, "command-code");
      // Quiet when Command Code simply isn't logged in on this machine.
    } else {
      log("warn", `command-code poll failed: ${(err as Error).message}`);
    }
  }
  // KaiHK spend vs the welcome-wallet USD cap. Keys come from OpenCode
  // providers whose baseURL is api.kaihk.com. Independent of Claude backoff.
  const kaihkProviders = discoverKaihkProviders();
  const kaihkIds = new Set(kaihkProviders.map((p) => p.id));
  for (const agent of Object.keys(latestSnapshotsByAgent(USAGE_LOG))) {
    if (isKaihkAgent(agent) && !kaihkIds.has(agent)) pruneAgent(USAGE_LOG, agent);
  }
  for (const provider of kaihkProviders) {
    try {
      const snap = await fetchKaihkUsageForKey(provider);
      appendSnapshot(USAGE_LOG, snap);
      const monthly = snap.monthly?.utilization;
      log(
        "info",
        `${provider.id} snapshot monthly=${monthly === null || monthly === undefined ? "—" : `${monthly.toFixed(1)}%`}`,
      );
    } catch (err) {
      log("warn", `${provider.id} poll failed: ${(err as Error).message}`);
    }
  }
}

async function pollClaudeUsage(): Promise<PollOutcome> {
  // Claude's poller stays distinct — its return value drives backoff
  // because OAuth/auth outcomes are the daemon's primary signal.
  try {
    const { snapshots, errors } = await fetchAllClaudeUsage();
    for (const snapshot of snapshots) {
      appendSnapshot(USAGE_LOG, snapshot);
      const tag = snapshot.agent ?? "claude-code";
      log(
        "info",
        `${tag} snapshot 5h=${snapshot.five_hour.utilization}% 7d=${snapshot.seven_day.utilization}%`,
      );
    }
    for (const err of errors) {
      const tag = err.slug ? `claude-code:${err.slug}` : "claude-code";
      log("warn", `poll failed (${err.code}) ${tag}: ${err.message}`);
    }
    if (snapshots.length > 0) return "success";
    if (errors.length === 0) {
      log("warn", "poll failed (no_token): No Claude Code OAuth token found. Run `claude` to log in first.");
      return "auth";
    }
    if (errors.every((e) => e.code === "network")) return "network";
    return "auth";
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
    try {
      const now = Date.now();
      if (now >= nextAuxPollAtMs) {
        // Every non-Claude provider has independent auth and must keep polling
        // even when Claude Code is absent or waiting for a token refresh.
        await pollAuxiliaryUsage();
        nextAuxPollAtMs = Date.now() + BASE_INTERVAL_MS;
      }
      if (now >= nextPollAtMs) {
        // Log a wake-from-sleep catch-up when we come back from a long gap.
        // Only meaningful once we've done at least one poll (nextPollAtMs > 0).
        if (nextPollAtMs > 0 && now - nextPollAtMs > currentIntervalMs) {
          log(
            "info",
            `wake-from-sleep catch-up: ${Math.round((now - nextPollAtMs + currentIntervalMs) / 1000)}s since last poll`,
          );
        }

        // Local precheck: any discovered Claude login still has a usable token?
        const accounts = discoverClaudeAccounts({ nowMs: now });
        if (accounts.length === 0) {
          const expired = discoverClaudeAccounts({ nowMs: now, usableOnly: false });
          if (expired.length > 0) {
            if (!waitingForRefresh) {
              log("info", "token expired; waiting for Claude Code to refresh it");
              waitingForRefresh = true;
            }
            // Don't advance nextPollAtMs — next watchdog tick rechecks in
            // WATCHDOG_INTERVAL_MS, and the moment Claude Code writes a fresh
            // token we fire a poll immediately.
          } else {
            log("warn", "no Claude Code OAuth token found; waiting");
            waitingForRefresh = true;
            // No creds at all — don't spam, retry at normal cadence.
            nextPollAtMs = now + BASE_INTERVAL_MS;
          }
        } else {
          if (waitingForRefresh) {
            log("info", "token refreshed; resuming polls");
            waitingForRefresh = false;
          }
          const outcome = await pollClaudeUsage();
          scheduleAfter(Date.now(), outcome);
        }
      }
      const teamNow = Date.now();
      if (teamNow >= nextTeamSyncAtMs) {
        // Team push is independent of Claude OAuth state — it uses its own bearer
        // and a different server. Keep it on its own cadence so an expired Claude
        // token cannot turn the team sync loop into a 5-second retry storm.
        await runTeamSync(log, undefined, {
          trigger: firstTeamSync ? "boot" : "auto",
          nextSyncMs: BASE_INTERVAL_MS,
        });
        firstTeamSync = false;
        nextTeamSyncAtMs = Date.now() + BASE_INTERVAL_MS;
      }
      if (Date.now() >= nextUpdateCheckAtMs) {
        await runDaemonUpdateCheck();
      }
      if (Date.now() >= nextServerHealthAtMs) {
        await runServerHealthCheck();
        nextServerHealthAtMs = Date.now() + SERVER_HEALTH_INTERVAL_MS;
      }
      if (Date.now() >= nextPerceptionAtMs) {
        // Run on the same loop as polls/sync so a sweep cannot overlap a
        // team push and double the heap (the previous setInterval did).
        await runPerceptionTick();
      }
    } catch (err) {
      log("error", `daemon tick failed: ${(err as Error).stack ?? err}`);
    }
    await sleep(WATCHDOG_INTERVAL_MS);
  }
}

// Version + script path: several installs can coexist (npm global, nvm
// global, repo dist via the menubar's cli-launch.json) and the log must say
// which one this daemon is.
log(
  "info",
  `daemon started (pid=${process.pid}, version=${CLI_VERSION}, interval=${BASE_INTERVAL_MS / 1000}s, watchdog=${WATCHDOG_INTERVAL_MS / 1000}s, script=${process.argv[1] ?? "?"})`,
);

// Kick the loop. runLoop() never resolves — it runs until SIGTERM.
void runLoop();

process.on("unhandledRejection", (reason) => {
  log("error", `unhandledRejection: ${reason instanceof Error ? reason.stack : String(reason)}`);
});

process.on("uncaughtException", (err) => {
  log("error", `uncaughtException: ${err.stack ?? String(err)}`);
  process.exit(1);
});

process.on("SIGTERM", () => {
  log("info", `daemon stopping (pid=${process.pid})`);
  process.exit(0);
});
