import { randomUUID } from "node:crypto";
import {
  canonicalProjectName,
  computeBurstsFromSessions,
  dailyActivity,
  sessionDay,
  summarizeBursts,
  type DailyBucket,
  type SessionMeta,
} from "@claude-lens/parser";
import type { Entry } from "@claude-lens/entries";
import { listEntriesForDay } from "@claude-lens/entries/fs";
import { latestClaudeCodeSnapshot } from "../usage/storage.js";
import type { TeamConfig } from "./config.js";

export const RICH_ROLLUP_SCHEMA_VERSION = 2 as const;

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

// Layer A — per-day deterministic Entry-derived counts and breakdowns.
// Always safe to share (counts + labels only; never first_user / final_agent
// text). Project labels are filtered through `privateProjects` before being
// included. See docs/superpowers/specs/2026-05-16-personal-to-team-bridge-design.md.
export type RichDailyRollup = DailyRollup & {
  projects: { project: string; agentTimeMs: number; sessions: number }[];
  workingShapes: { shape: string; sessions: number; agentTimeMs: number }[];
  concurrencyPeak: number;
  parallelMinutes: number;
  longAutonomous: { count: number; totalMin: number; maxSingleMin: number };
  toolErrors: number;
  skillsLoaded: { name: string; sessions: number }[];
  subagentsDispatched: { type: string; count: number }[];
  brainstormWarmupSessions: number;
  planModeUsed: number;
  prs: number;
  commits: number;
  pushes: number;
};

// Layer B — LLM-derived per-day fields. Already cached locally; pushing them
// does not trigger fresh LLM work. Gated on `enrichmentOptIn` in TeamConfig.
export type EnrichedDailyExtras = {
  outcomeMix: Partial<Record<"shipped" | "partial" | "exploratory" | "blocked" | "trivial", number>>;
  helpfulnessMix: Partial<Record<"essential" | "helpful" | "neutral" | "unhelpful", number>>;
  goalMix: Partial<Record<string, number>>;
};

export type IngestPayload = {
  ingestId: string;
  observedAt: string;
  // Set on V2+ payloads so server can branch. Absent payloads are V1.
  schemaVersion?: typeof RICH_ROLLUP_SCHEMA_VERSION;
  // Optional so the daemon can push tier/snapshot/cyclePeaks updates on
  // idle days when there's no new daily activity to roll up. Server skips
  // the daily_rollups upsert when missing but still applies the rest.
  dailyRollup?: DailyRollup;
  // Layer A — Entry-derived rollup; same day key as dailyRollup.
  richRollup?: RichDailyRollup;
  // Layer B — LLM-enriched extras, only when the member opted in.
  enrichedExtras?: EnrichedDailyExtras;
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

// Compute per-day rich rollup blocks from raw sessions + cached Entries.
// Sessions provide the parallelism-burst math; Entries provide the Entry-
// derived counts, working_shape, skills, subagents. `privateProjects`
// filters project labels out of the projects[] breakdown.
export function buildRichRollupBlocks(
  day: string,
  daySessions: SessionMeta[],
  entries: Entry[],
  privateProjects: ReadonlySet<string>,
): Omit<RichDailyRollup, keyof DailyRollup> {
  const bursts = computeBurstsFromSessions(daySessions);
  const stats = summarizeBursts(bursts);

  const projects = new Map<string, { agentTimeMs: number; sessions: number }>();
  for (const s of daySessions) {
    const name = canonicalProjectName(s.projectDir);
    if (privateProjects.has(name)) continue;
    const ms = (s.activeSegments ?? []).reduce((sum, seg) => sum + (seg.endMs - seg.startMs), 0);
    const cur = projects.get(name) ?? { agentTimeMs: 0, sessions: 0 };
    cur.agentTimeMs += ms;
    cur.sessions += 1;
    projects.set(name, cur);
  }

  const workingShapes = new Map<string, { sessions: number; agentTimeMs: number }>();
  const skills = new Map<string, number>();
  const subagents = new Map<string, number>();
  let toolErrors = 0;
  let brainstorm = 0;
  let planMode = 0;
  let prs = 0;
  let commits = 0;
  let pushes = 0;
  let longCount = 0;
  let longTotalMin = 0;
  let longMaxSingleMin = 0;
  for (const e of entries) {
    if (privateProjects.has(e.project)) continue;
    const shape = e.signals?.working_shape ?? null;
    if (shape) {
      const cur = workingShapes.get(shape) ?? { sessions: 0, agentTimeMs: 0 };
      cur.sessions += 1;
      cur.agentTimeMs += e.numbers.active_min * 60_000;
      workingShapes.set(shape, cur);
    }
    for (const [name, count] of Object.entries(e.skills)) {
      if (count > 0) skills.set(name, (skills.get(name) ?? 0) + 1);
    }
    for (const sa of e.subagents) {
      subagents.set(sa.type, (subagents.get(sa.type) ?? 0) + 1);
    }
    toolErrors += e.numbers.tool_errors;
    if (e.signals?.brainstorm_warmup) brainstorm += 1;
    if (e.numbers.exit_plan_calls > 0) planMode += 1;
    prs += e.numbers.prs;
    commits += e.numbers.commits;
    pushes += e.numbers.pushes;
    if (e.flags.includes("long_autonomous")) {
      longCount += 1;
      longTotalMin += e.numbers.active_min;
      if (e.numbers.active_min > longMaxSingleMin) longMaxSingleMin = e.numbers.active_min;
    }
  }

  return {
    projects: Array.from(projects.entries())
      .map(([project, v]) => ({ project, ...v }))
      .sort((a, b) => b.agentTimeMs - a.agentTimeMs),
    workingShapes: Array.from(workingShapes.entries())
      .map(([shape, v]) => ({ shape, ...v }))
      .sort((a, b) => b.sessions - a.sessions),
    concurrencyPeak: stats.peakConcurrent,
    parallelMinutes: Math.round(stats.totalParallelMs / 60_000),
    longAutonomous: { count: longCount, totalMin: longTotalMin, maxSingleMin: longMaxSingleMin },
    toolErrors,
    skillsLoaded: Array.from(skills.entries())
      .map(([name, sessions]) => ({ name, sessions }))
      .sort((a, b) => b.sessions - a.sessions),
    subagentsDispatched: Array.from(subagents.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    brainstormWarmupSessions: brainstorm,
    planModeUsed: planMode,
    prs,
    commits,
    pushes,
  };
}

// Aggregate already-enriched per-entry fields into per-day mixes. Pure
// pass-through of work the perception layer already did — no fresh LLM call.
export function buildEnrichedExtras(entries: Entry[]): EnrichedDailyExtras {
  const outcomeMix: EnrichedDailyExtras["outcomeMix"] = {};
  const helpfulnessMix: EnrichedDailyExtras["helpfulnessMix"] = {};
  const goalMix: Record<string, number> = {};
  for (const e of entries) {
    if (e.enrichment.status !== "done") continue;
    if (e.enrichment.outcome) {
      outcomeMix[e.enrichment.outcome] = (outcomeMix[e.enrichment.outcome] ?? 0) + 1;
    }
    if (e.enrichment.claude_helpfulness) {
      helpfulnessMix[e.enrichment.claude_helpfulness] =
        (helpfulnessMix[e.enrichment.claude_helpfulness] ?? 0) + 1;
    }
    for (const [cat, mins] of Object.entries(e.enrichment.goal_categories)) {
      if (typeof mins === "number") goalMix[cat] = (goalMix[cat] ?? 0) + mins;
    }
  }
  return { outcomeMix, helpfulnessMix, goalMix };
}

// Convenience: produce both V2 blocks for a single day. Returns undefined
// when there are no Entries cached for the day (the day was active but the
// perception sweep hasn't built Entries yet — push V1 only).
export function buildRichBlocksForDay(
  day: string,
  daySessions: SessionMeta[],
  privateProjects: ReadonlySet<string>,
  enrichmentOptIn: boolean,
): { rich: Omit<RichDailyRollup, keyof DailyRollup>; enriched?: EnrichedDailyExtras } | undefined {
  const entries = listEntriesForDay(day);
  if (entries.length === 0) return undefined;
  const rich = buildRichRollupBlocks(day, daySessions, entries, privateProjects);
  const enriched = enrichmentOptIn ? buildEnrichedExtras(entries) : undefined;
  return enriched ? { rich, enriched } : { rich };
}

export type IngestPayloadInputs = {
  rollup?: DailyRollup;
  richExtras?: Omit<RichDailyRollup, keyof DailyRollup>;
  enrichedExtras?: EnrichedDailyExtras;
  usageSnapshot?: WireUsageSnapshot;
  planTier?: string;
  cyclePeaks?: WireCyclePeaks;
};

export function buildIngestPayload(inputs: IngestPayloadInputs): IngestPayload {
  const richRollup: RichDailyRollup | undefined =
    inputs.rollup && inputs.richExtras ? { ...inputs.rollup, ...inputs.richExtras } : undefined;

  return {
    ingestId: randomUUID(),
    observedAt: new Date().toISOString(),
    ...(richRollup || inputs.enrichedExtras ? { schemaVersion: RICH_ROLLUP_SCHEMA_VERSION } : {}),
    ...(inputs.rollup ? { dailyRollup: inputs.rollup } : {}),
    ...(richRollup ? { richRollup } : {}),
    ...(inputs.enrichedExtras ? { enrichedExtras: inputs.enrichedExtras } : {}),
    ...(inputs.usageSnapshot ? { usageSnapshot: inputs.usageSnapshot } : {}),
    ...(inputs.planTier ? { planTier: inputs.planTier } : {}),
    ...(inputs.cyclePeaks ? { cyclePeaks: inputs.cyclePeaks } : {}),
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
