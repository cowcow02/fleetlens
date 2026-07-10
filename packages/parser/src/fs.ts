/**
 * Server-side filesystem entry point — exports the agent-agnostic registry
 * (`agentSources`, `listAllSessions`, `getAnySession`), cross-agent cache
 * dispatch, and snapshot-format helpers (`loadUsageByDay`,
 * `loadCalibrationCurve`).
 *
 * Lives at `@claude-lens/parser/fs` so pure browser consumers can use the
 * rest of the package without importing node:fs.
 *
 * Per-agent adapters live in their own modules (`claude-code.ts`,
 * `codex.ts`); this file re-exports their public surface so existing
 * consumers don't need to update import paths.
 */

import { promises as fs, existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { toLocalDay } from "./analytics.js";
import type { AgentKind, SessionDetail, SessionMeta } from "./types.js";
import {
  type AgentMetadata,
  CODEX_METADATA,
  GEMINI_METADATA,
  ANTIGRAVITY_METADATA,
  COWORK_METADATA,
  GROK_METADATA,
} from "./agent-metadata.js";
import {
  type CalibrationEvent,
  type PlanTier,
  type RateSource,
  RATE_PER_PCT_5H,
  RATE_PER_PCT_7D,
  buildSpendIndex,
  collectSnapPairRates,
  groupSnapsByCycle,
  predictAnchored,
  userSoloRate,
} from "./calibration.js";

import {
  DEFAULT_ROOT,
  type ListOptions,
  claudeCodeSource,
  clearClaudeCodeCaches,
  invalidateClaudeCodeFile,
  claudeCodeCacheStats,
  loadCalibrationEvents,
} from "./claude-code.js";

import {
  DEFAULT_CODEX_ROOT as _DEFAULT_CODEX_ROOT,
  listCodexSessions as _listCodexSessions,
  getCodexSession as _getCodexSession,
  clearCodexCaches,
  getLatestCodexUsage,
} from "./codex.js";

import {
  DEFAULT_GEMINI_ROOT as _DEFAULT_GEMINI_ROOT,
  listGeminiSessions as _listGeminiSessions,
  getGeminiSession as _getGeminiSession,
  clearGeminiCaches,
} from "./gemini.js";

import {
  DEFAULT_ANTIGRAVITY_ROOT as _DEFAULT_ANTIGRAVITY_ROOT,
  listAntigravitySessions as _listAntigravitySessions,
  getAntigravitySession as _getAntigravitySession,
  clearAntigravityCaches,
} from "./antigravity.js";

import {
  DEFAULT_COWORK_ROOT as _DEFAULT_COWORK_ROOT,
  listCoworkSessions as _listCoworkSessions,
  getCoworkSession as _getCoworkSession,
  clearCoworkCaches,
} from "./cowork.js";

import {
  DEFAULT_GROK_ROOT as _DEFAULT_GROK_ROOT,
  listGrokSessions as _listGrokSessions,
  getGrokSession as _getGrokSession,
  clearGrokCaches,
} from "./grok.js";

// ─── Re-exports (preserve the public @claude-lens/parser/fs surface) ───

export {
  DEFAULT_ROOT,
  decodeProjectName,
  isFleetlensRuntimeDir,
  readJsonlFile,
  walkJsonlFiles,
  sessionIdFromFileName,
  listSessions,
  getSession,
  listProjects,
  loadTeamForSession,
  findTeamLead,
  loadCalibrationEvents,
  loadWorkflowAgentDetail,
} from "./claude-code.js";
export { resolveProjectIdentity, readGitFolder } from "./git-project.js";
export type { GitFolderInfo, GitRemote } from "./git-project.js";
export type { FileRef, ListOptions, ProjectRefLite } from "./claude-code.js";
export type { WorkflowAgentDetail, WorkflowAgentStep } from "./claude-code.js";

export {
  DEFAULT_CODEX_ROOT,
  listCodexSessions,
  getCodexSession,
  codexSessionLocalDay,
  getLatestCodexUsage,
} from "./codex.js";
export type {
  ListCodexOptions,
  GetCodexOptions,
  CodexUsageWindows,
} from "./codex.js";

export {
  DEFAULT_GEMINI_ROOT,
  listGeminiSessions,
  getGeminiSession,
  geminiSessionLocalDay,
} from "./gemini.js";
export type {
  ListGeminiOptions,
  GetGeminiOptions,
} from "./gemini.js";

export {
  DEFAULT_ANTIGRAVITY_ROOT,
  listAntigravitySessions,
  getAntigravitySession,
  antigravitySessionLocalDay,
} from "./antigravity.js";
export type {
  ListAntigravityOptions,
  GetAntigravityOptions,
} from "./antigravity.js";

export {
  DEFAULT_COWORK_ROOT,
  listCoworkSessions,
  getCoworkSession,
} from "./cowork.js";
export type {
  ListCoworkOptions,
  GetCoworkOptions,
} from "./cowork.js";

export {
  DEFAULT_GROK_ROOT,
  resolveDefaultGrokRoot,
  listGrokSessions,
  getGrokSession,
  grokSessionLocalDay,
  clearGrokCaches,
} from "./grok.js";
export type {
  ListGrokOptions,
  GetGrokOptions,
} from "./grok.js";

export {
  type TeamConfig,
  type SyncProjects,
  readTeamConfig,
  writeTeamConfig,
  clearTeamConfig,
  shouldSyncProject,
} from "./team-config.js";

export {
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
  type LastPushRecord,
  type ServerCommand,
  type CommandResult,
  type IngestResponse,
  RICH_ROLLUP_SCHEMA_VERSION,
} from "./team-wire.js";

/* ================================================================= */
/*  State directory                                                  */
/* ================================================================= */

/** Absolute path of the per-machine fleetlens state dir. Defaults to
 *  `~/.cclens`; override with `CCLENS_HOME` so multiple workspaces (e.g.
 *  Conductor) can run isolated state side-by-side. */
export function cclensHome(): string {
  return process.env.CCLENS_HOME || path.join(os.homedir(), ".cclens");
}

/** Join one or more segments under the state dir. */
export function cclensPath(...parts: string[]): string {
  return path.join(cclensHome(), ...parts);
}

/* ================================================================= */
/*  Cross-agent cache dispatch                                       */
/* ================================================================= */

export type CacheStats = {
  metaEntries: number;
  detailEntries: number;
  calibrationEventsEntries: number;
};

export function cacheStats(): CacheStats {
  return claudeCodeCacheStats();
}

export function clearCaches(): void {
  clearClaudeCodeCaches();
  clearCodexCaches();
  clearGeminiCaches();
  clearAntigravityCaches();
  clearCoworkCaches();
  clearGrokCaches();
}

/** Drop cached entries for a Claude Code file path. Called by the SSE
 *  watcher when a file appears or changes. */
export function invalidateFile(fullPath: string): void {
  invalidateClaudeCodeFile(fullPath);
}

/* ================================================================= */
/*  Agent-source registry                                            */
/* ================================================================= */

export type AgentSource = AgentMetadata & {
  /** Default root directory the source reads from. Surfaced in help text
   *  and the /sessions subtitle. */
  defaultRoot: string;
  listSessions(opts?: ListOptions): Promise<SessionMeta[]>;
  getSession(id: string, opts?: { root?: string }): Promise<SessionDetail | null>;
  /** Daemon polls this every cycle; null = nothing new. */
  usagePoller?(): Promise<UsageSnapshotLike | null>;
};

/** Structural subset of cli's UsageSnapshot — keeps parser → cli one-way. */
type UsageSnapshotLike = {
  captured_at: string;
  agent?: AgentKind;
  five_hour: { utilization: number | null; resets_at: string | null };
  seven_day: { utilization: number | null; resets_at: string | null };
  plan_type?: string | null;
};

const codexSource: AgentSource = {
  ...CODEX_METADATA,
  defaultRoot: _DEFAULT_CODEX_ROOT,
  async listSessions(opts) {
    return _listCodexSessions(opts);
  },
  async getSession(id) {
    return _getCodexSession(id);
  },
  async usagePoller() {
    const w = await getLatestCodexUsage();
    if (!w) return null;
    return {
      captured_at: new Date().toISOString(),
      agent: "codex",
      five_hour: w.five_hour,
      seven_day: w.seven_day,
    };
  },
};

// Gemini CLI's free / paid tiers don't expose structured rate-limit
// telemetry in transcripts, so no usagePoller — utilization tracking is
// Claude / Codex only until that surfaces upstream.
const geminiSource: AgentSource = {
  ...GEMINI_METADATA,
  defaultRoot: _DEFAULT_GEMINI_ROOT,
  async listSessions(opts) {
    return _listGeminiSessions(opts);
  },
  async getSession(id) {
    return _getGeminiSession(id);
  },
};

const antigravitySource: AgentSource = {
  ...ANTIGRAVITY_METADATA,
  defaultRoot: _DEFAULT_ANTIGRAVITY_ROOT,
  async listSessions(opts) {
    return _listAntigravitySessions(opts);
  },
  async getSession(id) {
    return _getAntigravitySession(id);
  },
};

// Cowork sessions don't expose rate-limit telemetry in their transcripts —
// utilization rolls into the Claude account's OAuth window, which is already
// polled by the Claude-Code source.
const coworkSource: AgentSource = {
  ...COWORK_METADATA,
  defaultRoot: _DEFAULT_COWORK_ROOT,
  async listSessions(opts) {
    return _listCoworkSessions(opts);
  },
  async getSession(id) {
    return _getCoworkSession(id);
  },
};

// Grok weekly plan usage is polled by the CLI daemon (network billing API,
// same path as OpenUsage) — not from session signals. No usagePoller here.
const grokSource: AgentSource = {
  ...GROK_METADATA,
  // Display default; list/get re-resolve GROK_HOME at call time internally.
  defaultRoot: _DEFAULT_GROK_ROOT,
  async listSessions(opts) {
    return _listGrokSessions(opts);
  },
  async getSession(id, opts) {
    return _getGrokSession(id, opts);
  },
};

export const agentSources: AgentSource[] = [
  claudeCodeSource,
  codexSource,
  geminiSource,
  antigravitySource,
  coworkSource,
  grokSource,
];

export function getAgentSource(kind: AgentKind): AgentSource | undefined {
  return agentSources.find((s) => s.kind === kind);
}

export async function listAllSessions(opts: { limit?: number } = {}): Promise<SessionMeta[]> {
  const lists = await Promise.all(agentSources.map((s) => s.listSessions(opts)));
  const merged: SessionMeta[] = [];
  for (const lst of lists) merged.push(...lst);
  merged.sort((a, b) => (b.firstTimestamp ?? "").localeCompare(a.firstTimestamp ?? ""));
  if (opts.limit !== undefined) return merged.slice(0, opts.limit);
  return merged;
}

export async function getAnySession(id: string): Promise<SessionDetail | null> {
  for (const source of agentSources) {
    const detail = await source.getSession(id);
    if (detail) return detail;
  }
  return null;
}

/* ================================================================= */
/*  Usage daemon snapshots (cclensHome()/usage.jsonl)                */
/*  Multi-agent storage: each line carries an `agent` field.         */
/* ================================================================= */

function usageLogPath(): string {
  return cclensPath("usage.jsonl");
}

/** Append a single usage snapshot line to ~/.cclens/usage.jsonl.
 *  Shared by the CLI daemon (per-5-min poll) and the web Settings
 *  route (immediate write on a freshly-validated Z.ai key, so the
 *  /usage tab + menu-bar widget are populated the instant the user saves,
 *  without waiting for the daemon's next tick). */
export function appendUsageSnapshot(snapshot: unknown): void {
  const p = usageLogPath();
  mkdirSync(path.dirname(p), { recursive: true });
  appendFileSync(p, JSON.stringify(snapshot) + "\n", "utf8");
}

/** Drop every zai (or other) agent line from ~/.cclens/usage.jsonl.
 *  Used when a source is unconfigured (key removed) so a stale line
 *  doesn't keep the widget/dashboard showing obsolete usage. The log is
 *  otherwise append-only; this is the one intentional rewrite, scoped to a
 *  single agent and safe because the daemon is its only writer. */
export function pruneUsageAgent(agent: string): void {
  const p = usageLogPath();
  if (!existsSync(p)) return;
  const kept = readFileSync(p, "utf8")
    .split("\n")
    .filter((line) => {
      if (!line.trim()) return false;
      try {
        return JSON.parse(line).agent !== agent;
      } catch {
        return true;
      }
    });
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, kept.join("\n") + (kept.length ? "\n" : ""), "utf8");
}

type UsageSnapshot = {
  captured_at?: string;
  /** Source agent. Absent on legacy snapshots written before multi-agent
   *  support — readers MUST treat undefined as "claude-code". */
  agent?: AgentKind;
  five_hour?: { utilization?: number; resets_at?: string };
  seven_day?: { utilization?: number; resets_at?: string };
  seven_day_sonnet?: { utilization?: number } | null;
};

/** Per-day peak 5-hour Claude utilization for [start, end] inclusive.
 *  Codex snapshots are dropped here so chart axes track Claude's plan
 *  alone. */
export async function loadUsageByDay(
  start: Date,
  end: Date,
): Promise<{ by_day: { date: string; peak_util_pct: number }[] }> {
  let raw: string;
  try {
    raw = await fs.readFile(usageLogPath(), "utf8");
  } catch {
    return { by_day: [] };
  }

  const startMs = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const endMs = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999).getTime();

  const byDay = new Map<string, number>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const snap = JSON.parse(trimmed) as UsageSnapshot;
      if (!snap.captured_at) continue;
      if ((snap.agent ?? "claude-code") !== "claude-code") continue;
      const ms = Date.parse(snap.captured_at);
      if (Number.isNaN(ms)) continue;
      if (ms < startMs) continue;
      // continue (not break): the daemon can append out-of-order timestamps
      // after resume-from-sleep or a backfill, so an early break would drop
      // later in-range snapshots that follow a single past-window outlier.
      if (ms > endMs) continue;
      const key = toLocalDay(ms);
      const util = snap.five_hour?.utilization ?? 0;
      const cur = byDay.get(key) ?? 0;
      if (util > cur) byDay.set(key, util);
    } catch {
      /* skip malformed */
    }
  }

  const out: { date: string; peak_util_pct: number }[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const stop = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cur.getTime() <= stop.getTime()) {
    const k = toLocalDay(cur.getTime());
    out.push({ date: k, peak_util_pct: byDay.get(k) ?? 0 });
    cur.setDate(cur.getDate() + 1);
  }
  return { by_day: out };
}

/* ================================================================= */
/*  Calibration: JSONL → predicted utilization                       */
/* ================================================================= */

/** All Claude Code snapshots from ~/.cclens/usage.jsonl. The calibration
 *  curve maps Claude session activity to Claude plan-window utilization,
 *  so it MUST exclude snapshots from other agents — a Codex 5h reading
 *  would otherwise be read as a Claude burnrate sample. Snapshots without
 *  an `agent` field default to "claude-code" for back-compat. */
export async function loadCalibrationSnapshots(): Promise<UsageSnapshot[]> {
  let raw: string;
  try {
    raw = await fs.readFile(usageLogPath(), "utf8");
  } catch {
    return [];
  }
  const out: UsageSnapshot[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const s = JSON.parse(t) as UsageSnapshot;
      if (!s.captured_at) continue;
      if ((s.agent ?? "claude-code") !== "claude-code") continue;
      out.push(s);
    } catch {
      /* skip malformed */
    }
  }
  out.sort((a, b) => (a.captured_at ?? "").localeCompare(b.captured_at ?? ""));
  return out;
}

/** One point on the calibration curve — pairs the daemon's measured
 *  utilization (when a snapshot landed in the slot) with the JSONL-derived
 *  prediction at that timestamp. */
export type CalibrationCurvePoint = {
  ts: string;
  real_5h: number | null;
  pred_5h: number;
  real_7d: number | null;
  pred_7d: number;
  cycle_end_5h: string | null;
  cycle_end_7d: string | null;
};

export type CalibrationCurve = {
  model: string;
  tier: PlanTier;
  rate_per_pct: number;
  rate_per_pct_5h: number;
  rate_per_pct_7d: number;
  /** "user_calibrated" once a well-covered completed cycle has been
   *  observed; "tier_default" until then. */
  rate_source_5h: RateSource;
  rate_source_7d: RateSource;
  cycles_used_5h: number;
  cycles_used_7d: number;
  granularity_min: number;
  curve: CalibrationCurvePoint[];
  first_snapshot_ts: string | null;
  real_count: number;
  total_count: number;
};

/** Walk forward from each snapshot's `resets_at` to find the most recent
 *  earlier snapshot whose reset value matches `ts` — i.e. which 5h or 7d
 *  cycle does this timestamp belong to. */
function inferResetsAt(
  ts: number,
  snapResets: Array<[number, number]>,
  cycleHours: number,
): number | null {
  if (snapResets.length === 0) return null;
  for (const [snapMs, resetMs] of snapResets) {
    if (snapMs >= ts && resetMs > ts) {
      let r = resetMs;
      const cycleMs = cycleHours * 3_600_000;
      while (r - cycleMs > ts) r -= cycleMs;
      return r;
    }
  }
  let last = snapResets[snapResets.length - 1]![1];
  const cycleMs = cycleHours * 3_600_000;
  while (last < ts) last += cycleMs;
  return last;
}

/** Build a continuous predicted-utilization curve aligned with daemon
 *  snapshots. Anchors exactly through every observed OAuth snapshot via
 *  spend-weighted interpolation; past the latest snap of a cycle, uses
 *  a $/pp rate fitted from the upper percentile of snap-pair rates —
 *  closest to the user's solo rate on shared accounts. See
 *  predictAnchored / collectSnapPairRates in calibration.ts.
 *
 *  Cold-start back-fill: extends 14 days before the first snapshot so
 *  /usage shows estimates from JSONL spend even with a brand-new daemon. */
export function buildCalibrationCurve(
  events: CalibrationEvent[],
  snapshots: UsageSnapshot[],
  tier: PlanTier = "pro-max-20x",
  granularityMin = 30,
): CalibrationCurve | null {
  if (snapshots.length === 0 || events.length === 0) return null;

  const spend = buildSpendIndex(events);
  const tierDefault7d = RATE_PER_PCT_7D[tier];
  const tierDefault5h = RATE_PER_PCT_5H[tier];

  const snapsByCycle5h = groupSnapsByCycle(snapshots, (s) => s.five_hour);
  const snapsByCycle7d = groupSnapsByCycle(snapshots, (s) => s.seven_day);
  // Spend floors filter out low-spend pairs whose rates are dominated by
  // 1pp utilization rounding noise. Cap at 24h to drop daemon-off pairs
  // where teammate contribution is unknowable.
  const pairs7d = collectSnapPairRates(snapsByCycle7d, spend, {
    minTravelPct: 1, minDollars: 10, maxGapMs: 24 * 3_600_000,
  });
  const pairs5h = collectSnapPairRates(snapsByCycle5h, spend, {
    minTravelPct: 1, minDollars: 1, maxGapMs: 2 * 3_600_000,
  });
  const fwdRate7d = userSoloRate(pairs7d, 0.9) ?? tierDefault7d;
  const fwdRate5h = userSoloRate(pairs5h, 0.9) ?? tierDefault5h;
  const cycles7d = new Set(pairs7d.map((p) => p.cycleEndMs)).size;
  const cycles5h = new Set(pairs5h.map((p) => p.cycleEndMs)).size;

  const snap5h: Array<[number, number]> = [];
  const snap7d: Array<[number, number]> = [];
  for (const s of snapshots) {
    const ms = Date.parse(s.captured_at!);
    if (Number.isNaN(ms)) continue;
    if (s.five_hour?.resets_at) {
      const r = Date.parse(s.five_hour.resets_at);
      if (!Number.isNaN(r)) snap5h.push([ms, r]);
    }
    if (s.seven_day?.resets_at) {
      const r = Date.parse(s.seven_day.resets_at);
      if (!Number.isNaN(r)) snap7d.push([ms, r]);
    }
  }
  const HOUR = 3_600_000;

  const realByMinute = new Map<number, [number | null, number | null]>();
  for (const s of snapshots) {
    const ms = Date.parse(s.captured_at!);
    if (Number.isNaN(ms)) continue;
    const k = Math.floor(ms / 60_000);
    realByMinute.set(k, [
      s.five_hour?.utilization ?? null,
      s.seven_day?.utilization ?? null,
    ]);
  }

  const firstSnapMs = Date.parse(snapshots[0]!.captured_at!);
  const lastSnapMs = Date.parse(snapshots[snapshots.length - 1]!.captured_at!);
  const firstEventMs = Date.parse(events[0]!.ts);
  // Cold-start back-fill reaches at most 14 d before the first snapshot, and no
  // earlier than the first event (there's no spend to interpolate before that).
  // But never start *after* the first snapshot: Claude Code prunes
  // ~/.claude/projects, so transcripts routinely begin months after the daemon's
  // first snapshot, and clipping there hid real utilization readings entirely.
  const backfillStart = Math.max(firstEventMs, firstSnapMs - 14 * 86_400_000);
  const rangeStart = Math.min(firstSnapMs, backfillStart);
  const rangeEnd = lastSnapMs;
  const stepMs = granularityMin * 60_000;

  const curve: CalibrationCurvePoint[] = [];
  let cur = rangeStart;
  while (cur <= rangeEnd) {
    let real5: number | null = null;
    let real7: number | null = null;
    for (let off = 0; off < granularityMin; off++) {
      const k = Math.floor((cur + off * 60_000) / 60_000);
      const r = realByMinute.get(k);
      if (r) { real5 = r[0]; real7 = r[1]; break; }
    }

    const r5 = inferResetsAt(cur, snap5h, 5);
    const r7 = inferResetsAt(cur, snap7d, 168);
    // groupSnapsByCycle keys are hour-rounded so sub-second jitter on
    // resets_at doesn't fragment a cycle; mirror the rounding here.
    const r5k = r5 != null ? Math.round(r5 / HOUR) * HOUR : null;
    const r7k = r7 != null ? Math.round(r7 / HOUR) * HOUR : null;

    const cycle5Snaps = r5k != null ? (snapsByCycle5h.get(r5k) ?? []) : [];
    const cycle7Snaps = r7k != null ? (snapsByCycle7d.get(r7k) ?? []) : [];
    const cycleEnd5 = r5k ?? cur + 5 * HOUR;
    const cycleEnd7 = r7k ?? cur + 168 * HOUR;

    const p5 = predictAnchored(spend, cycle5Snaps, fwdRate5h, cycleEnd5, 5, cur);
    const p7 = predictAnchored(spend, cycle7Snaps, fwdRate7d, cycleEnd7, 168, cur);

    curve.push({
      ts: new Date(cur).toISOString(),
      real_5h: real5,
      // Predicted utilization LEGITIMATELY exceeds 200 on overage (the
      // extrapolated cycle close). The old min(200) clamp silently capped it,
      // so cyclePeaks.peakPct could never carry a *predicted* overage to the
      // team server (which now accepts up to 10000). Keep only a generous
      // finite ceiling as a corruption guard, matching the wire cap.
      pred_5h: Math.max(0, Math.min(10000, p5)),
      real_7d: real7,
      pred_7d: Math.max(0, Math.min(10000, p7)),
      cycle_end_5h: r5k != null ? new Date(r5k).toISOString() : null,
      cycle_end_7d: r7k != null ? new Date(r7k).toISOString() : null,
    });
    cur += stepMs;
  }

  // "user_calibrated" once we have ≥3 usable pairs; "tier_default" otherwise.
  const rateSource7d: RateSource = pairs7d.length >= 3 ? "user_calibrated" : "tier_default";
  const rateSource5h: RateSource = pairs5h.length >= 3 ? "user_calibrated" : "tier_default";

  return {
    model: `anchored-${tier}`,
    tier,
    rate_per_pct: fwdRate7d,
    rate_per_pct_5h: fwdRate5h,
    rate_per_pct_7d: fwdRate7d,
    rate_source_5h: rateSource5h,
    rate_source_7d: rateSource7d,
    cycles_used_5h: cycles5h,
    cycles_used_7d: cycles7d,
    granularity_min: granularityMin,
    curve,
    first_snapshot_ts: snapshots[0]!.captured_at ?? null,
    real_count: curve.filter((c) => c.real_7d !== null).length,
    total_count: curve.length,
  };
}

/** Convenience entry point. Heavy on first call; fast afterward thanks to
 *  the per-file cache. Wrap in React's `cache()` from the calling layer
 *  to make it per-request memoized. */
export async function loadCalibrationCurve(
  tier: PlanTier = "pro-max-20x",
  root: string = DEFAULT_ROOT,
  granularityMin = 30,
): Promise<CalibrationCurve | null> {
  const [events, snapshots] = await Promise.all([
    loadCalibrationEvents(root),
    loadCalibrationSnapshots(),
  ]);
  return buildCalibrationCurve(events, snapshots, tier, granularityMin);
}
