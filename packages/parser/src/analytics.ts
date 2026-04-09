/**
 * Analytics helpers for dashboards.
 *
 * All functions are pure — they take already-parsed SessionMeta / SessionDetail
 * arrays and produce aggregates ready for charts.
 */

import type { SessionDetail, SessionEvent, SessionMeta, Usage } from "./types.js";

const BLANK_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** Local-timezone YYYY-MM-DD for a millisecond timestamp. */
export function toLocalDay(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Get the session's "starting day" in local time, or undefined. */
export function sessionDay(meta: SessionMeta): string | undefined {
  if (!meta.firstTimestamp) return undefined;
  const ms = Date.parse(meta.firstTimestamp);
  if (Number.isNaN(ms)) return undefined;
  return toLocalDay(ms);
}

/* ================================================================= */
/*  Daily activity — heatmap + line/bar                              */
/* ================================================================= */

export type DailyBucket = {
  /** YYYY-MM-DD */
  date: string;
  /** Number of sessions started on this date */
  sessions: number;
  /** Total tool calls across all sessions that day */
  toolCalls: number;
  /** Total user turns across all sessions that day */
  turns: number;
  /** Summed usage — input / output / cacheRead / cacheWrite */
  tokens: Usage;
  /** Summed session duration across the day, in ms */
  durationMs: number;
  /** Max concurrent sessions observed at any instant that day */
  peakParallelism: number;
};

function makeDay(date: string): DailyBucket {
  return {
    date,
    sessions: 0,
    toolCalls: 0,
    turns: 0,
    tokens: { ...BLANK_USAGE },
    durationMs: 0,
    peakParallelism: 0,
  };
}

/** All local-time YYYY-MM-DD strings between start and end, inclusive. */
export function daysBetween(startDay: string, endDay: string): string[] {
  const [ys, ms, ds] = startDay.split("-").map(Number) as [number, number, number];
  const [ye, me, de] = endDay.split("-").map(Number) as [number, number, number];
  const start = new Date(ys, ms - 1, ds);
  const end = new Date(ye, me - 1, de);
  const out: string[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(toLocalDay(d.getTime()));
  }
  return out;
}

/**
 * Bucket sessions into daily aggregates. Returns one bucket per calendar day
 * between the earliest and latest session, with empty days included so that
 * heatmaps / charts can render a continuous range.
 */
export function dailyActivity(sessions: SessionMeta[]): DailyBucket[] {
  if (sessions.length === 0) return [];

  const byDay = new Map<string, DailyBucket>();
  let minDay: string | undefined;
  let maxDay: string | undefined;

  for (const s of sessions) {
    const day = sessionDay(s);
    if (!day) continue;
    if (!minDay || day < minDay) minDay = day;
    if (!maxDay || day > maxDay) maxDay = day;

    const bucket = byDay.get(day) ?? makeDay(day);
    bucket.sessions++;
    bucket.toolCalls += s.toolCallCount ?? 0;
    bucket.turns += s.turnCount ?? 0;
    bucket.tokens.input += s.totalUsage.input;
    bucket.tokens.output += s.totalUsage.output;
    bucket.tokens.cacheRead += s.totalUsage.cacheRead;
    bucket.tokens.cacheWrite += s.totalUsage.cacheWrite;
    bucket.durationMs += s.durationMs ?? 0;
    byDay.set(day, bucket);
  }

  // Fill gaps so the heatmap draws a continuous range.
  const range = minDay && maxDay ? daysBetween(minDay, maxDay) : [];
  const out: DailyBucket[] = [];
  for (const day of range) {
    out.push(byDay.get(day) ?? makeDay(day));
  }

  // Compute per-day peak parallelism.
  const parallelism = computeParallelism(sessions);
  const byDayPar = new Map<string, number>();
  for (const p of parallelism) {
    const day = toLocalDay(p.atMs);
    const cur = byDayPar.get(day) ?? 0;
    if (p.active > cur) byDayPar.set(day, p.active);
  }
  for (const b of out) {
    b.peakParallelism = byDayPar.get(b.date) ?? 0;
  }

  return out;
}

/* ================================================================= */
/*  Parallel agent detection                                         */
/* ================================================================= */

export type ParallelismPoint = {
  atMs: number;
  active: number;
  /** Session IDs contributing to this peak (up to 10 for UI display). */
  sessions: string[];
};

/**
 * Sweep-line algorithm over session intervals. Returns the active-count
 * curve sampled at every start/end boundary.
 */
export function computeParallelism(sessions: SessionMeta[]): ParallelismPoint[] {
  type Event = { ms: number; delta: number; sessionId: string };
  const events: Event[] = [];
  for (const s of sessions) {
    if (!s.firstTimestamp || !s.lastTimestamp) continue;
    const start = Date.parse(s.firstTimestamp);
    const end = Date.parse(s.lastTimestamp);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) continue;
    events.push({ ms: start, delta: +1, sessionId: s.id });
    events.push({ ms: end, delta: -1, sessionId: s.id });
  }
  events.sort((a, b) => a.ms - b.ms || b.delta - a.delta);

  const active = new Set<string>();
  const points: ParallelismPoint[] = [];
  for (const e of events) {
    if (e.delta === 1) active.add(e.sessionId);
    else active.delete(e.sessionId);
    points.push({
      atMs: e.ms,
      active: active.size,
      sessions: Array.from(active).slice(0, 10),
    });
  }
  return points;
}

export type ParallelRun = {
  startMs: number;
  endMs: number;
  peak: number;
  sessions: string[];
};

/**
 * Detect contiguous intervals where ≥ `minActive` sessions ran in parallel.
 * Defaults to minActive=2 (the interesting case).
 */
export function detectParallelRuns(sessions: SessionMeta[], minActive = 2): ParallelRun[] {
  const points = computeParallelism(sessions);
  const runs: ParallelRun[] = [];
  let cur: ParallelRun | null = null;
  for (const p of points) {
    if (p.active >= minActive) {
      if (!cur) {
        cur = { startMs: p.atMs, endMs: p.atMs, peak: p.active, sessions: [...p.sessions] };
      } else {
        cur.endMs = p.atMs;
        if (p.active > cur.peak) cur.peak = p.active;
        for (const sid of p.sessions) {
          if (!cur.sessions.includes(sid)) cur.sessions.push(sid);
        }
      }
    } else if (cur) {
      cur.endMs = p.atMs;
      runs.push(cur);
      cur = null;
    }
  }
  if (cur) runs.push(cur);
  return runs;
}

/* ================================================================= */
/*  PR detection                                                     */
/* ================================================================= */

export type PrMarker = {
  /** Session the PR creation happened in */
  sessionId: string;
  /** When the tool call fired */
  timestamp: string;
  /** ms since session start */
  tOffsetMs?: number;
  /** ms since session start, as a fraction of total (0..1) */
  positionInSession?: number;
  /** Raw Bash command that created the PR */
  command: string;
  /** Extracted PR number if we could parse it (e.g. from gh output) */
  prNumber?: number;
  /** Extracted title if available from `--title "..."` */
  title?: string;
};

const PR_CREATE_RE = /gh\s+pr\s+create\b/i;
const PR_NUMBER_RE = /#(\d+)/;
const TITLE_FLAG_RE = /--title\s+["']([^"']+)["']/;

/**
 * Scan a session's events for `gh pr create` Bash invocations. Returns one
 * marker per invocation with the tool call's timestamp and (if available)
 * the PR number / title.
 */
export function detectPrMarkers(session: SessionDetail): PrMarker[] {
  const out: PrMarker[] = [];
  const total = session.durationMs ?? 0;

  for (const e of session.events) {
    if (e.role !== "tool-call" || e.toolName !== "Bash") continue;
    const toolUseBlock = e.blocks.find((b) => b && "type" in b && b.type === "tool_use");
    if (!toolUseBlock || toolUseBlock.type !== "tool_use") continue;
    const input = toolUseBlock.input as Record<string, unknown> | undefined;
    const command = typeof input?.command === "string" ? input.command : "";
    if (!PR_CREATE_RE.test(command)) continue;

    const titleMatch = command.match(TITLE_FLAG_RE);
    // We don't have the tool result's stdout here (the detail uses events, not
    // tool results); PR number parsing is best-effort.
    const numberMatch = command.match(PR_NUMBER_RE);

    out.push({
      sessionId: session.id,
      timestamp: e.timestamp ?? session.firstTimestamp ?? "",
      tOffsetMs: e.tOffsetMs,
      positionInSession:
        total > 0 && e.tOffsetMs !== undefined
          ? Math.min(1, Math.max(0, e.tOffsetMs / total))
          : undefined,
      command: command.slice(0, 300),
      prNumber: numberMatch ? Number(numberMatch[1]) : undefined,
      title: titleMatch?.[1],
    });
  }
  return out;
}

/* ================================================================= */
/*  High-level session metrics                                       */
/* ================================================================= */

export type HighLevelMetrics = {
  sessionCount: number;
  totalDurationMs: number;
  /** Summed "active" time across sessions — see sessionAirTimeMs */
  totalAirTimeMs: number;
  totalTokens: Usage;
  totalToolCalls: number;
  totalTurns: number;
  avgTurnsPerSession: number;
  avgDurationMs: number;
};

/**
 * A session's "air-time" is the cumulative time the agent was actively
 * moving through work. We approximate it by summing event-to-event gaps
 * that are under `idleThresholdMs` (default 3 minutes) — longer gaps are
 * assumed to be the user stepping away, so they don't count.
 */
export function sessionAirTimeMs(events: SessionEvent[], idleThresholdMs = 3 * 60 * 1000): number {
  let air = 0;
  for (const e of events) {
    if (e.gapMs === undefined) continue;
    if (e.gapMs <= idleThresholdMs) air += e.gapMs;
  }
  return air;
}

export function highLevelMetrics(sessions: SessionMeta[]): HighLevelMetrics {
  const totals: HighLevelMetrics = {
    sessionCount: sessions.length,
    totalDurationMs: 0,
    totalAirTimeMs: 0,
    totalTokens: { ...BLANK_USAGE },
    totalToolCalls: 0,
    totalTurns: 0,
    avgTurnsPerSession: 0,
    avgDurationMs: 0,
  };
  for (const s of sessions) {
    totals.totalDurationMs += s.durationMs ?? 0;
    // Approximation: totalAirTime can't be computed from meta alone; caller
    // should pass detail-derived sessions if they want accurate air-time.
    totals.totalAirTimeMs += s.durationMs ?? 0;
    totals.totalTokens.input += s.totalUsage.input;
    totals.totalTokens.output += s.totalUsage.output;
    totals.totalTokens.cacheRead += s.totalUsage.cacheRead;
    totals.totalTokens.cacheWrite += s.totalUsage.cacheWrite;
    totals.totalToolCalls += s.toolCallCount ?? 0;
    totals.totalTurns += s.turnCount ?? 0;
  }
  if (sessions.length > 0) {
    totals.avgTurnsPerSession = totals.totalTurns / sessions.length;
    totals.avgDurationMs = totals.totalDurationMs / sessions.length;
  }
  return totals;
}

/* ================================================================= */
/*  Project rollups                                                  */
/* ================================================================= */

export type ProjectRollup = {
  /** The raw project dir name (-Users-foo-Repo-bar) */
  projectDir: string;
  /** Decoded project name (/Users/foo/Repo/bar) */
  projectName: string;
  sessions: SessionMeta[];
  metrics: HighLevelMetrics;
  lastActiveMs?: number;
};

export function groupByProject(sessions: SessionMeta[]): ProjectRollup[] {
  const map = new Map<string, ProjectRollup>();
  for (const s of sessions) {
    const key = s.projectDir;
    const cur = map.get(key) ?? {
      projectDir: s.projectDir,
      projectName: s.projectName,
      sessions: [],
      metrics: highLevelMetrics([]),
      lastActiveMs: undefined,
    };
    cur.sessions.push(s);
    const last = s.lastTimestamp ? Date.parse(s.lastTimestamp) : undefined;
    if (last && (!cur.lastActiveMs || last > cur.lastActiveMs)) {
      cur.lastActiveMs = last;
    }
    map.set(key, cur);
  }
  for (const p of map.values()) {
    p.metrics = highLevelMetrics(p.sessions);
  }
  return Array.from(map.values()).sort(
    (a, b) => (b.lastActiveMs ?? 0) - (a.lastActiveMs ?? 0),
  );
}
