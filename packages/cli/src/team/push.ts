import { randomUUID } from "node:crypto";

// esbuild `define` (build.mjs) replaces this with the package version; vitest
// defines it as "0.0.0-test". Stamped into every ingest so the team server can
// surface each member's installed CLI version on the roster.
declare const CLI_VERSION: string;

import {
  canonicalProjectName,
  projectKey,
  computeBurstsFromSessions,
  dailyActivity,
  sessionDay,
  summarizeBursts,
  type DailyBucket,
  type SessionMeta,
} from "@claude-lens/parser";
import {
  RICH_ROLLUP_SCHEMA_VERSION,
  shouldSyncProject,
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
  type SyncProjects,
} from "@claude-lens/parser/fs";
import type { Entry } from "@claude-lens/entries";
import { listEntriesForDay, entryExists, writeEntryPreservingEnrichment } from "@claude-lens/entries/fs";
import { buildEntriesForFile } from "../perception/build-entries.js";
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

// Each day row reflects what actually happened that day: dailyActivity splits
// agent time, tokens, tool calls and turns by event timestamp, and counts a
// session on every local day its agent worked. So `sessions` is session-days —
// a cross-midnight session is +1 on both days and its tokens/tools land on the
// day they occurred (no more "agent time but 0 tokens / 0 sessions" days).
// `uniqueSessions` carries the start-day count so SUM(uniqueSessions) over a
// range stays equal to the real unique-session total for aggregate consumers.
export function buildRollupsForRange(sessions: SessionMeta[], sinceDay?: string): DailyRollup[] {
  const startCounts = new Map<string, number>();
  for (const s of sessions) {
    const d = sessionDay(s);
    if (d) startCounts.set(d, (startCounts.get(d) ?? 0) + 1);
  }
  return dailyActivity(sessions)
    .filter((b) => !sinceDay || b.date >= sinceDay)
    .map((b) => ({ ...bucketToRollup(b), uniqueSessions: startCounts.get(b.date) ?? 0 }));
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

// Session-level choke point for the member's project selection. Applied ONCE
// where sessions enter payload building so excluded projects vanish from the
// daily totals too — a per-project-rows-only filter would leak the excluded
// share as (total − sum of rows).
export function filterSyncedSessions(
  sessions: SessionMeta[],
  syncProjects?: SyncProjects,
): SessionMeta[] {
  if (!syncProjects) return sessions;
  return sessions.filter((s) => shouldSyncProject(projectKey(s.projectName), syncProjects));
}

export function sessionTouchesDay(s: SessionMeta, day: string): boolean {
  const bounds = dayBoundsMs(day);
  if (s.activeSegments && s.activeSegments.length > 0) {
    return s.activeSegments.some((seg) => seg.endMs > bounds.startMs && seg.startMs < bounds.endMs);
  }
  return sessionDay(s) === day;
}

// UUIDs (Antigravity conversation ids) and bare 16-64 char hex strings
// (Gemini tmp-dir hashes) are per-conversation identities, not projects.
const SYNTHETIC_NAME_RE =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,64})$/i;

export function isSyntheticProjectName(name: string): boolean {
  return SYNTHETIC_NAME_RE.test(name) || name === "cowork:unspaced" || name === "(unknown)";
}

// Compute per-day rich rollup blocks from raw sessions + cached Entries.
// Sessions provide the parallelism-burst math; Entries provide the Entry-
// derived counts, working_shape, skills, subagents. Every project the member
// worked on is included — there is no per-project gating.
//
// `daySessions` should include every session whose active segments touch
// `day`, not just sessions that started on it — cross-midnight sessions
// contribute clipped agent-time to both calendar days, matching the
// headline `dailyRollup.agentTimeMs` semantics in `dailyActivity`.
export function buildRichRollupBlocks(
  day: string,
  daySessions: SessionMeta[],
  entries: Entry[],
  resolveRepo?: (dir: string) => string | null,
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

  // Repo identity per session, strongest signal first: the project cwd's own
  // .git, then the repos its edited files live in (covers sessions run at a
  // parent folder like ~/Repo), then an unambiguous harvested push/PR repo
  // (covers checkouts deleted since the session ran).
  const repoForEntry = (e: Entry): string | null => {
    if (resolveRepo) {
      const own = resolveRepo(e.project);
      if (own) return own;
      const counts = new Map<string, number>();
      for (const d of e.edited_dirs ?? []) {
        const r = resolveRepo(d);
        if (r) counts.set(r, (counts.get(r) ?? 0) + 1);
      }
      const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (dominant) return dominant;
    }
    return e.github_repos?.length === 1 ? e.github_repos[0]! : null;
  };
  const sessionRepo = new Map<string, string>();
  for (const e of entries) {
    const r = repoForEntry(e);
    if (r) sessionRepo.set(e.session_id, r);
  }

  // Rows keyed by resolved repo when one exists (so two checkouts of the same
  // repo fold into one row) and by repo-directory basename otherwise.
  const projects = new Map<string, { project: string; agentTimeMs: number; sessions: number; resolved?: string }>();
  for (const s of clippedSessions) {
    // Group the breakdown by Fleetlens project key so the team edition never receives
    // absolute paths and same-repo-different-harness rows fold together.
    const canonical = canonicalProjectName(s.projectName);
    const name = projectKey(s.projectName);
    const repo = resolveRepo?.(canonical) ?? sessionRepo.get(s.id);
    // Some adapters fall back to a synthetic per-conversation identity when
    // no cwd is available: Antigravity reports its conversation UUID, Gemini
    // its tmp-dir hash, Copilot "(unknown)", unspaced Cowork sessions the
    // "cowork:unspaced" bucket. Those sessions still count toward day totals
    // and concurrency, but minting a project row per bucket lands each one on
    // the server as a distinct fake project and inflates the per-member
    // distinct-project breadth counters (observed 2x on a real fleet: 28 of
    // 56 reported "projects" were conversation UUIDs). Matched by shape, not
    // by "isn't an absolute path" — a Gemini session can legitimately report
    // a bare project slug like "fleetlens", which must keep its row.
    if (!repo && isSyntheticProjectName(s.projectName)) continue;
    const key = repo ?? name;
    const ms = s.activeSegments!.reduce((sum, seg) => sum + (seg.endMs - seg.startMs), 0);
    const cur = projects.get(key) ?? { project: name, agentTimeMs: 0, sessions: 0, ...(repo ? { resolved: repo } : {}) };
    cur.agentTimeMs += ms;
    cur.sessions += 1;
    projects.set(key, cur);
  }

  // owner/name identities per project (from git-push / gh-pr output in the
  // entries) — lets the server canonicalize local directory names onto the
  // actual remotes instead of guessing by clone-directory name.
  const projectRepos = new Map<string, Set<string>>();
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
    const shape = e.signals?.working_shape ?? null;
    if (shape) {
      const cur = workingShapes.get(shape) ?? { sessions: 0, agentTimeMs: 0 };
      cur.sessions += 1;
      // active_min has 0.1 precision; ×60000 can yield 42000.000000000007 in
      // FP, which the ingest schema rejects (integer). Round at the source.
      cur.agentTimeMs += Math.round(e.numbers.active_min * 60_000);
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
    if (e.github_repos?.length) {
      // Same key rule as the projects map so the attachment lands on its row.
      const key = sessionRepo.get(e.session_id) ?? projectKey(e.project);
      const set = projectRepos.get(key) ?? new Set<string>();
      for (const r of e.github_repos) set.add(r);
      projectRepos.set(key, set);
    }
    if (e.flags.includes("long_autonomous")) {
      longCount += 1;
      longTotalMin += e.numbers.active_min;
      if (e.numbers.active_min > longMaxSingleMin) longMaxSingleMin = e.numbers.active_min;
    }
  }

  return {
    projects: Array.from(projects.entries())
      .map(([key, v]) => {
        // Resolved identity first — the server trusts reported order.
        const extras = [...(projectRepos.get(key) ?? [])].filter((r) => r !== v.resolved);
        const repos = v.resolved ? [v.resolved, ...extras] : extras;
        return {
          project: v.project,
          agentTimeMs: v.agentTimeMs,
          sessions: v.sessions,
          ...(repos.length ? { githubRepos: repos.slice(0, 5) } : {}),
        };
      })
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

// Session ids we've already attempted an on-the-spot entry build for in THIS
// sync run — success OR failure. A pair backfill walks ~51 days sequentially
// and a session spanning two days appears in both days' `daySessions`; without
// this a cross-midnight session would be re-parsed once per touched day. The
// builder emits one Entry per touched day from a single parse, so one attempt
// per session covers every day it lands on. RUN-SCOPED: `resetEnsuredSessions`
// clears it at the start of each `runTeamSync` so a transient read failure
// retries on the next tick instead of being poisoned for the daemon's life.
const ensuredSessions = new Set<string>();

export function resetEnsuredSessions(): void {
  ensuredSessions.clear();
}

// On a freshly-paired machine no perception entries exist yet, so a weeks-long
// backfill would push base `dailyRollup` blocks only — no `richRollup`, no
// `enrichedExtras` — leaving the member's server-side maturity card incoherent
// (0 projects / 0 skills against dozens of sessions). Build the day's entries
// DETERMINISTICALLY on the spot (no LLM — the daemon's perception sweep
// enriches later) so rich blocks ride along for every backfilled day.
//
// Reuses the sweep's exact claude-code reconstruction (build-entries.ts) so
// keys match and `writeEntryPreservingEnrichment` means a later sweep updates
// rather than duplicates. Non-claude sessions are skipped (the sweep processes
// them through a different, id-keyed path). A missing/unparseable transcript
// (test fixtures, a deleted checkout) is caught and the day degrades to
// base-only — never throws.
function ensureEntriesForDay(day: string, daySessions: SessionMeta[]): void {
  for (const s of daySessions) {
    if (ensuredSessions.has(s.id)) continue;
    if ((s.agent ?? "claude-code") !== "claude-code") continue;
    // Already cached for this session-day (real sweep, or an earlier day of
    // this same run) — leave it; only pay the parse when it's genuinely absent.
    // Existence check only (no read+parse); listEntriesForDay reads the file.
    if (entryExists(s.id, day)) continue;
    ensuredSessions.add(s.id);
    try {
      for (const e of buildEntriesForFile(s.filePath) ?? []) writeEntryPreservingEnrichment(e);
    } catch {
      // Missing / unparseable transcript — push base-only for this session's
      // days. Marked ensured above so we don't re-attempt on later days.
    }
  }
}

// Convenience: produce both V2 blocks for a single day. Returns undefined
// when there are no Entries cached for the day (the day was active but the
// perception sweep hasn't built Entries yet — push V1 only). LLM-enriched
// extras always ride along (no member-side opt-out).
export function buildRichBlocksForDay(
  day: string,
  daySessions: SessionMeta[],
  resolveRepo?: (dir: string) => string | null,
): { rich: Omit<RichDailyRollup, keyof DailyRollup>; enriched: EnrichedDailyExtras } | undefined {
  ensureEntriesForDay(day, daySessions);
  // daySessions is already selection-filtered; entries must match, or an
  // excluded project's skills/subagents/PR counts and enrichment mixes leak
  // into richRollup/enrichedExtras via the day-wide entry cache.
  const sessionIds = new Set(daySessions.map((s) => s.id));
  const entries = listEntriesForDay(day).filter((e) => sessionIds.has(e.session_id));
  if (entries.length === 0) return undefined;
  const rich = buildRichRollupBlocks(day, daySessions, entries, resolveRepo);
  const enriched = buildEnrichedExtras(entries);
  return { rich, enriched };
}

export type IngestPayloadInputs = {
  rollup?: DailyRollup;
  richExtras?: Omit<RichDailyRollup, keyof DailyRollup>;
  enrichedExtras?: EnrichedDailyExtras;
  artifactSignals?: DayArtifactSignals;
  usageSnapshot?: WireUsageSnapshot;
  planTier?: string;
  cyclePeaks?: WireCyclePeaks;
  syncLog?: { ts: string; level: string; msg: string }[];
};

export function buildIngestPayload(inputs: IngestPayloadInputs): IngestPayload {
  const richRollup: RichDailyRollup | undefined =
    inputs.rollup && inputs.richExtras ? { ...inputs.rollup, ...inputs.richExtras } : undefined;

  return {
    ingestId: randomUUID(),
    observedAt: new Date().toISOString(),
    cliVersion: CLI_VERSION,
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
    ...(inputs.syncLog && inputs.syncLog.length ? { syncLog: inputs.syncLog } : {}),
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
