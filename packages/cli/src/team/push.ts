import { randomUUID } from "node:crypto";
import {
  canonicalProjectName,
  projectRepoName,
  computeBurstsFromSessions,
  dailyActivity,
  sessionDay,
  summarizeBursts,
  type DailyBucket,
  type SessionMeta,
} from "@claude-lens/parser";
import {
  RICH_ROLLUP_SCHEMA_VERSION,
  type DailyRollup,
  type RichDailyRollup,
  type EnrichedDailyExtras,
  type DayArtifactSignals,
  type WireUsageWindow,
  type WireExtraUsage,
  type WireUsageSnapshot,
  type WireCyclePeak,
  type WireCyclePeaks,
  type IngestPayload,
  type IngestResponse,
  type ServerCommand,
  type CommandResult,
} from "@claude-lens/parser/fs";
import type { Entry } from "@claude-lens/entries";
import { listEntriesForDay } from "@claude-lens/entries/fs";
import { latestClaudeCodeSnapshot } from "../usage/storage.js";
import type { TeamConfig } from "./config.js";

export { RICH_ROLLUP_SCHEMA_VERSION };
export type {
  DailyRollup,
  RichDailyRollup,
  EnrichedDailyExtras,
  DayArtifactSignals,
  WireUsageWindow,
  WireExtraUsage,
  WireUsageSnapshot,
  WireCyclePeak,
  WireCyclePeaks,
  IngestPayload,
  IngestResponse,
  ServerCommand,
  CommandResult,
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

// Bounds of a local-time YYYY-MM-DD as [startMs, endMs).
function dayBoundsMs(day: string): { startMs: number; endMs: number } {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return {
    startMs: new Date(y, m - 1, d, 0, 0, 0, 0).getTime(),
    endMs: new Date(y, m - 1, d + 1, 0, 0, 0, 0).getTime(),
  };
}

function clipSegmentsToDay(
  segments: { startMs: number; endMs: number }[] | undefined,
  bounds: { startMs: number; endMs: number },
): { startMs: number; endMs: number }[] {
  if (!segments || segments.length === 0) return [];
  const out: { startMs: number; endMs: number }[] = [];
  for (const seg of segments) {
    const s = Math.max(seg.startMs, bounds.startMs);
    const e = Math.min(seg.endMs, bounds.endMs);
    if (e > s) out.push({ startMs: s, endMs: e });
  }
  return out;
}

export function sessionTouchesDay(s: SessionMeta, day: string): boolean {
  const bounds = dayBoundsMs(day);
  if (s.activeSegments && s.activeSegments.length > 0) {
    return s.activeSegments.some((seg) => seg.endMs > bounds.startMs && seg.startMs < bounds.endMs);
  }
  return sessionDay(s) === day;
}

// Compute per-day rich rollup blocks from raw sessions + cached Entries.
// Sessions provide the parallelism-burst math; Entries provide the Entry-
// derived counts, working_shape, skills, subagents. `privateProjects`
// filters project labels out of the projects[] breakdown.
//
// `daySessions` should include every session whose active segments touch
// `day`, not just sessions that started on it — cross-midnight sessions
// contribute clipped agent-time to both calendar days, matching the
// headline `dailyRollup.agentTimeMs` semantics in `dailyActivity`.
export function buildRichRollupBlocks(
  day: string,
  daySessions: SessionMeta[],
  entries: Entry[],
  privateProjects: ReadonlySet<string>,
): Omit<RichDailyRollup, keyof DailyRollup> {
  const bounds = dayBoundsMs(day);
  const clippedSessions: SessionMeta[] = [];
  for (const s of daySessions) {
    const clipped = clipSegmentsToDay(s.activeSegments, bounds);
    if (clipped.length === 0) continue;
    clippedSessions.push({ ...s, activeSegments: clipped });
  }

  const bursts = computeBurstsFromSessions(clippedSessions);
  const stats = summarizeBursts(bursts);

  const projects = new Map<string, { agentTimeMs: number; sessions: number }>();
  for (const s of clippedSessions) {
    // Canonical project is computed from the human-readable cwd path, NOT the
    // raw `~/.claude/projects/<encoded>` directory — matching the Entry's
    // `project` field that build.ts derives via the same call.
    // Private-project opt-out is keyed on the full canonical path; group the
    // breakdown by repo name so the team edition never receives absolute paths
    // and same-repo-different-harness rows fold together.
    const canonical = canonicalProjectName(s.projectName);
    if (privateProjects.has(canonical)) continue;
    const name = projectRepoName(s.projectName);
    const ms = s.activeSegments!.reduce((sum, seg) => sum + (seg.endMs - seg.startMs), 0);
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
    // Wire schema requires integer minutes (active_min is a float).
    longAutonomous: { count: longCount, totalMin: Math.round(longTotalMin), maxSingleMin: Math.round(longMaxSingleMin) },
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
  artifactSignals?: DayArtifactSignals;
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
    ...(richRollup || inputs.enrichedExtras || inputs.artifactSignals
      ? { schemaVersion: RICH_ROLLUP_SCHEMA_VERSION }
      : {}),
    ...(inputs.rollup ? { dailyRollup: inputs.rollup } : {}),
    ...(richRollup ? { richRollup } : {}),
    ...(inputs.enrichedExtras ? { enrichedExtras: inputs.enrichedExtras } : {}),
    ...(inputs.artifactSignals ? { artifactSignals: inputs.artifactSignals } : {}),
    ...(inputs.usageSnapshot ? { usageSnapshot: inputs.usageSnapshot } : {}),
    ...(inputs.planTier ? { planTier: inputs.planTier } : {}),
    ...(inputs.cyclePeaks ? { cyclePeaks: inputs.cyclePeaks } : {}),
  };
}

export async function pushToTeamServer(
  config: TeamConfig,
  payload: IngestPayload,
): Promise<{ ok: boolean; status: number; body: IngestResponse | null }> {
  const res = await fetch(`${config.serverUrl}/api/ingest/metrics`, {
    method: "POST",
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.bearerToken}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null) as IngestResponse | null;
  return { ok: res.ok, status: res.status, body };
}
