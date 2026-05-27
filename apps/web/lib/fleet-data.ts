/**
 * Server-only reader for the fleet runtimes snapshot.
 *
 * The fleet worker writes ~/.cclens/fleet/runtimes.json every ~60s with
 * one entry per known runtime (self + every connected peer). The /runtimes
 * page reads this file directly — no API endpoint, no client fetching.
 */

import "server-only";
import { existsSync, readFileSync, statSync } from "node:fs";
import { cclensPath } from "@claude-lens/parser/fs";

const RUNTIMES_FILE = cclensPath("fleet", "runtimes.json");
const FLEET_FILE = cclensPath("fleet", "fleet.json");
const FLEET_PID = cclensPath("fleet.pid");

export type AgentKindHint = "claude-code" | "codex" | "gemini" | string;

export type RuntimeAgentSourceSummary = {
  kind: AgentKindHint;
  totalSessions: number;
  sessionsLast24h: number;
};

export type RuntimeProjectSummary = {
  name: string;
  sessionCount: number;
  lastActivityAt: string;
  agentTimeMs: number;
};

export type RuntimeStats = {
  totalSessions: number;
  sessionsLast24h: number;
  sessionsLast7d: number;
  agentTimeLast24hMs: number;
  agentTimeLast7dMs: number;
  lastActivityAt?: string;
};

export type RuntimeInfo = {
  protocol: number;
  deviceId: string;
  publicKey: string;
  isLocal: boolean;
  label?: string;
  hostname?: string;
  fleetlensVersion?: string;
  stats: RuntimeStats;
  agentSources: RuntimeAgentSourceSummary[];
  recentProjects: RuntimeProjectSummary[];
  connection: { since: string; lastSeen: string } | null;
  capturedAt: string;
};

export type RuntimesSnapshot = {
  updatedAt: string;
  /** Element 0 is always the local runtime. */
  runtimes: RuntimeInfo[];
};

export type FleetState =
  | { configured: false }
  | { configured: true; workerRunning: boolean; snapshot: RuntimesSnapshot | null; snapshotAgeMs: number | null };

export function readFleetState(): FleetState {
  if (!existsSync(FLEET_FILE)) return { configured: false };

  let workerRunning = false;
  if (existsSync(FLEET_PID)) {
    try {
      const content = readFileSync(FLEET_PID, "utf8").trim();
      const [pidStr] = content.split(":");
      const pid = parseInt(pidStr, 10);
      if (!Number.isNaN(pid)) {
        try {
          process.kill(pid, 0);
          workerRunning = true;
        } catch {
          workerRunning = false;
        }
      }
    } catch {
      // unreadable pid file = treat as not running
    }
  }

  if (!existsSync(RUNTIMES_FILE)) {
    return { configured: true, workerRunning, snapshot: null, snapshotAgeMs: null };
  }
  try {
    const raw = readFileSync(RUNTIMES_FILE, "utf8");
    const snap = JSON.parse(raw) as RuntimesSnapshot;
    let snapshotAgeMs: number | null = null;
    try {
      snapshotAgeMs = Date.now() - statSync(RUNTIMES_FILE).mtimeMs;
    } catch {
      // ENOENT race; treat as fresh-unknown
    }
    return { configured: true, workerRunning, snapshot: snap, snapshotAgeMs };
  } catch {
    return { configured: true, workerRunning, snapshot: null, snapshotAgeMs: null };
  }
}

export function formatAgentTime(ms: number): string {
  if (ms <= 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM === 0 ? `${h}h` : `${h}h ${remM}m`;
}

export function formatRelativeMs(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < 30 * 1000) return "just now";
  if (abs < 60 * 1000) return `${Math.round(abs / 1000)}s ago`;
  if (abs < 60 * 60 * 1000) return `${Math.round(abs / 60_000)}m ago`;
  if (abs < 24 * 60 * 60 * 1000) return `${Math.round(abs / 3_600_000)}h ago`;
  return `${Math.round(abs / 86_400_000)}d ago`;
}
