import "server-only";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { cclensHome, readTeamConfig, type TeamConfig } from "@claude-lens/parser/fs";

type IngestPayload = {
  ingestId: string;
  observedAt: string;
  dailyRollup?: {
    day: string;
    agentTimeMs: number;
    sessions: number;
    toolCalls: number;
    turns: number;
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  };
  usageSnapshot?: unknown;
  planTier?: string;
  cyclePeaks?: unknown;
};

type LastPushRecord = {
  pushedAt: string;
  ok: boolean;
  payload: IngestPayload;
  error?: string;
};

export type TeamConnection =
  | { paired: false }
  | {
      paired: true;
      team: { name: string; slug: string; serverUrl: string };
      member: { role: string | null; pairedAt: string };
      lastPush:
        | { kind: "none" }
        | { kind: "ok"; at: string; payload: IngestPayload }
        | { kind: "error"; at: string; error: string; payload: IngestPayload };
      health: "green" | "amber" | "red";
    };

const LAST_PUSH_FILE = "team-last-push.json";

const FRESH_MS = 15 * 60_000;
const STALE_MS = 60 * 60_000;

function readLastPush(): LastPushRecord | null {
  const path = join(cclensHome(), LAST_PUSH_FILE);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LastPushRecord;
  } catch {
    return null;
  }
}

function deriveHealth(lastPush: LastPushRecord | null, nowMs: number = Date.now()): "green" | "amber" | "red" {
  if (!lastPush) return "amber";
  if (!lastPush.ok) return "red";
  const ageMs = nowMs - Date.parse(lastPush.pushedAt);
  if (Number.isNaN(ageMs) || ageMs > STALE_MS) return "red";
  if (ageMs > FRESH_MS) return "amber";
  return "green";
}

export function readTeamConnection(): TeamConnection {
  const config: TeamConfig | null = readTeamConfig();
  if (!config) return { paired: false };
  const lastPush = readLastPush();

  return {
    paired: true,
    team: {
      name: config.teamName ?? config.teamSlug,
      slug: config.teamSlug,
      serverUrl: config.serverUrl,
    },
    member: {
      role: null,
      pairedAt: config.pairedAt,
    },
    lastPush: !lastPush
      ? { kind: "none" }
      : lastPush.ok
        ? { kind: "ok", at: lastPush.pushedAt, payload: lastPush.payload }
        : { kind: "error", at: lastPush.pushedAt, error: lastPush.error ?? "Unknown error", payload: lastPush.payload },
    health: deriveHealth(lastPush),
  };
}
