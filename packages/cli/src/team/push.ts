import { randomUUID } from "node:crypto";
import { dailyActivity, sessionDay, type DailyBucket, type SessionMeta } from "@claude-lens/parser";
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

export type IngestPayload = {
  ingestId: string;
  observedAt: string;
  dailyRollup: DailyRollup;
};

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

export function buildIngestPayload(rollup: DailyRollup): IngestPayload {
  return {
    ingestId: randomUUID(),
    observedAt: new Date().toISOString(),
    dailyRollup: rollup,
  };
}

export async function pushToTeamServer(
  config: TeamConfig,
  payload: IngestPayload,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(`${config.serverUrl}/api/ingest/metrics`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.bearerToken}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}
