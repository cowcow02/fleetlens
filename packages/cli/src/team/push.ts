import { randomUUID } from "node:crypto";
import { dailyActivity, sessionDay, type DailyBucket, type SessionMeta } from "@claude-lens/parser";
import { latestClaudeCodeSnapshot } from "../usage/storage.js";
import type { TeamConfig } from "./config.js";

export type DailyRollup = {
  day: string;
  agentTimeMs: number;
  sessions: number;
  toolCalls: number;
  turns: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
};

export type WireUsageWindow = {
  utilization: number | null;
  resetsAt: string | null;
};

export type WireExtraUsage = {
  isEnabled: boolean;
  monthlyLimitUsd: number | null;
  usedCreditsUsd: number | null;
  utilization: number | null;
};

export type WireUsageSnapshot = {
  capturedAt: string;
  fiveHour: WireUsageWindow;
  sevenDay: WireUsageWindow;
  sevenDayOpus: WireUsageWindow | null;
  sevenDaySonnet: WireUsageWindow | null;
  sevenDayOauthApps: WireUsageWindow | null;
  sevenDayCowork: WireUsageWindow | null;
  extraUsage: WireExtraUsage | null;
};

export type WireCyclePeak = {
  endsAt: string;
  peakPct: number;
  source: "real" | "predicted";
  current: boolean;
};

export type WireCyclePeaks = {
  fiveHour: WireCyclePeak[];
  sevenDay: WireCyclePeak[];
};

export type IngestPayload = {
  ingestId: string;
  observedAt: string;
  // Optional so the daemon can push tier/snapshot/cyclePeaks updates on
  // idle days when there's no new daily activity to roll up. Server skips
  // the daily_rollups upsert when missing but still applies the rest.
  dailyRollup?: DailyRollup;
  usageSnapshot?: WireUsageSnapshot;
  // Anthropic-detected tier ("pro"|"pro-max"|"pro-max-20x"|"custom"). Server
  // upserts memberships.plan_tier when this is set so admins don't have to
  // hand-pick a tier the daemon already knows.
  planTier?: string;
  // Per-cycle peak utilization, computed locally by the daemon using the
  // SAME parser logic that drives the personal /usage trend strip. Pushing
  // the computed outcome (rather than raw events) keeps a single source of
  // truth and means team server never re-runs the math.
  cyclePeaks?: WireCyclePeaks;
};

// Server only cares about a freshly-captured snapshot. A stale one would
// poison the rolling-window math even though Anthropic's window has already
// rolled over.
const SNAPSHOT_FRESHNESS_MS = 10 * 60 * 1000;
const POST_TIMEOUT_MS = 15_000;

export function readLatestUsageSnapshotForWire(
  filePath: string,
  nowMs: number = Date.now(),
): WireUsageSnapshot | null {
  // Only push claude-code snapshots — see comment in backfill.ts. Walk
  // backwards through the JSONL so a recent codex snapshot doesn't shadow
  // the latest claude-code one.
  const raw = latestClaudeCodeSnapshot(filePath);
  if (!raw) return null;
  const capturedMs = Date.parse(raw.captured_at);
  if (Number.isNaN(capturedMs)) return null;
  if (nowMs - capturedMs > SNAPSHOT_FRESHNESS_MS) return null;

  const toWire = (
    w: { utilization: number | null; resets_at: string | null } | null,
  ): WireUsageWindow | null => (w ? { utilization: w.utilization, resetsAt: w.resets_at } : null);

  return {
    capturedAt: raw.captured_at,
    fiveHour: { utilization: raw.five_hour.utilization, resetsAt: raw.five_hour.resets_at },
    sevenDay: { utilization: raw.seven_day.utilization, resetsAt: raw.seven_day.resets_at },
    sevenDayOpus: toWire(raw.seven_day_opus),
    sevenDaySonnet: toWire(raw.seven_day_sonnet),
    sevenDayOauthApps: toWire(raw.seven_day_oauth_apps),
    sevenDayCowork: toWire(raw.seven_day_cowork),
    extraUsage: raw.extra_usage
      ? {
          isEnabled: raw.extra_usage.is_enabled,
          monthlyLimitUsd: raw.extra_usage.monthly_limit,
          usedCreditsUsd: raw.extra_usage.used_credits,
          utilization: raw.extra_usage.utilization,
        }
      : null,
  };
}

export function bucketToRollup(b: DailyBucket): DailyRollup {
  return {
    day: b.date,
    agentTimeMs: b.airTimeMs,
    sessions: b.sessions,
    toolCalls: b.toolCalls,
    turns: b.turns,
    tokens: { ...b.tokens },
  };
}

// dailyActivity counts a session in every day its agent-time touched (so
// summing across days double-counts cross-midnight sessions). For the
// daily_rollups table we want start-day-only attribution so that SUM(sessions)
// equals the total unique session count, matching the solo edition's headline
// metric. airTime / tokens / tool_calls / turns still use dailyActivity's
// semantics (split agent time across days; attribute session-scoped totals
// to the starting day).
export function buildRollupsForRange(sessions: SessionMeta[], sinceDay?: string): DailyRollup[] {
  const buckets = dailyActivity(sessions);
  const startCounts = new Map<string, number>();
  for (const s of sessions) {
    const d = sessionDay(s);
    if (d) startCounts.set(d, (startCounts.get(d) ?? 0) + 1);
  }

  return buckets
    .filter((b) => !sinceDay || b.date >= sinceDay)
    .map((b) => ({
      ...bucketToRollup(b),
      sessions: startCounts.get(b.date) ?? 0,
    }));
}

export function buildIngestPayload(
  rollup: DailyRollup | undefined,
  usageSnapshot?: WireUsageSnapshot,
  planTier?: string,
  cyclePeaks?: WireCyclePeaks,
): IngestPayload {
  return {
    ingestId: randomUUID(),
    observedAt: new Date().toISOString(),
    ...(rollup ? { dailyRollup: rollup } : {}),
    ...(usageSnapshot ? { usageSnapshot } : {}),
    ...(planTier ? { planTier } : {}),
    ...(cyclePeaks ? { cyclePeaks } : {}),
  };
}

export async function pushToTeamServer(
  config: TeamConfig,
  payload: IngestPayload,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(`${config.serverUrl}/api/ingest/metrics`, {
    method: "POST",
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.bearerToken}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}
