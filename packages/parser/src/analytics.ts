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

/**
 * Reduce a cwd path to its canonical project identity.
 *
 * Git worktrees are a common pattern for running multi-agent fleets in
 * parallel — `git worktree add .worktrees/kip-148 ...` creates a sibling
 * working copy under `.worktrees/`, and each worktree has its own cwd,
 * which Claude Code treats as a distinct "project". But conceptually
 * every `.worktrees/<name>` belongs to the parent repo, not a new project.
 *
 * This helper strips the `/.worktrees/<name>` suffix so worktrees roll up
 * under their parent repo everywhere: project list, sidebar, top projects,
 * Gantt colors, project detail page, etc.
 *
 *   canonicalProjectName("/Users/foo/Repo/bar/.worktrees/kip-148")
 *     === "/Users/foo/Repo/bar"
 *   canonicalProjectName("/Users/foo/Repo/bar")
 *     === "/Users/foo/Repo/bar"
 */
export function canonicalProjectName(projectName: string): string {
  const wtIdx = projectName.lastIndexOf("/.worktrees/");
  if (wtIdx >= 0) return projectName.slice(0, wtIdx);
  return projectName;
}

/** Extract the worktree branch name from a worktree path, or null. */
export function worktreeName(projectName: string): string | null {
  const wtIdx = projectName.lastIndexOf("/.worktrees/");
  if (wtIdx < 0) return null;
  return projectName.slice(wtIdx + "/.worktrees/".length);
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
  /** Summed active (air-time) across the day, in ms. Derived from
   *  SessionMeta.airTimeMs which filters gaps over the idle threshold. */
  airTimeMs: number;
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
    airTimeMs: 0,
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

  const touchBucket = (day: string) => {
    if (!minDay || day < minDay) minDay = day;
    if (!maxDay || day > maxDay) maxDay = day;
    const b = byDay.get(day) ?? makeDay(day);
    byDay.set(day, b);
    return b;
  };

  for (const s of sessions) {
    // Session-level one-shot totals (tool calls, turns, usage, durationMs)
    // are attributed to the day the session started. These are intrinsic
    // to the session as a whole — splitting them across days would be
    // both fiddly and misleading.
    const startDay = sessionDay(s);
    if (startDay) {
      const bucket = touchBucket(startDay);
      bucket.toolCalls += s.toolCallCount ?? 0;
      bucket.turns += s.turnCount ?? 0;
      bucket.tokens.input += s.totalUsage.input;
      bucket.tokens.output += s.totalUsage.output;
      bucket.tokens.cacheRead += s.totalUsage.cacheRead;
      bucket.tokens.cacheWrite += s.totalUsage.cacheWrite;
      bucket.durationMs += s.durationMs ?? 0;
    }

    // Active time + session presence get split by day based on the
    // session's active segments. A long-running session that spans
    // multiple local days contributes to every day its agent was
    // actually working — matches what the Gantt chart shows and what a
    // human would expect looking at a calendar heatmap.
    //
    // Fallback for old cached metas that predate `activeSegments`:
    // attribute the whole airTimeMs to startDay (legacy behavior).
    const segments = s.activeSegments;
    if (segments && segments.length > 0) {
      const touchedDays = new Set<string>();
      for (const seg of segments) {
        let cur = seg.startMs;
        while (cur < seg.endMs) {
          const day = toLocalDay(cur);
          touchedDays.add(day);
          // Compute the start-of-next-local-day to clip segments that
          // cross midnight.
          const d = new Date(cur);
          d.setHours(24, 0, 0, 0);
          const dayEndMs = Math.min(d.getTime(), seg.endMs);
          const bucket = touchBucket(day);
          bucket.airTimeMs += dayEndMs - cur;
          cur = dayEndMs;
        }
      }
      for (const day of touchedDays) {
        const bucket = touchBucket(day);
        bucket.sessions++;
      }
    } else if (startDay) {
      // Legacy fallback: attribute to start day only.
      const bucket = touchBucket(startDay);
      bucket.sessions++;
      bucket.airTimeMs += s.airTimeMs ?? 0;
    }
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
 * Sweep-line algorithm over session active intervals. Returns the active-
 * count curve sampled at every segment start/end boundary.
 *
 * Uses `SessionMeta.activeSegments` when present (split on 3-minute idle
 * gaps) so long-idle sessions don't falsely count as "parallel" during
 * their dead time. Falls back to first/last timestamp for old cached
 * metas that predate the field.
 */
export function computeParallelism(sessions: SessionMeta[]): ParallelismPoint[] {
  type Event = { ms: number; delta: number; sessionId: string };
  const events: Event[] = [];
  for (const s of sessions) {
    const segs =
      s.activeSegments && s.activeSegments.length > 0
        ? s.activeSegments
        : s.firstTimestamp && s.lastTimestamp
          ? (() => {
              const start = Date.parse(s.firstTimestamp!);
              const end = Date.parse(s.lastTimestamp!);
              if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];
              return [{ startMs: start, endMs: end }];
            })()
          : [];
    for (const seg of segs) {
      events.push({ ms: seg.startMs, delta: +1, sessionId: s.id });
      events.push({ ms: seg.endMs, delta: -1, sessionId: s.id });
    }
  }
  events.sort((a, b) => a.ms - b.ms || b.delta - a.delta);

  // Track per-session active segment count so a session with multiple
  // segments is only "removed" from the active set when its LAST segment
  // ends. Otherwise back-to-back segments would briefly drop the count.
  const segCount = new Map<string, number>();
  const points: ParallelismPoint[] = [];
  for (const e of events) {
    if (e.delta === 1) {
      segCount.set(e.sessionId, (segCount.get(e.sessionId) ?? 0) + 1);
    } else {
      const n = (segCount.get(e.sessionId) ?? 0) - 1;
      if (n <= 0) segCount.delete(e.sessionId);
      else segCount.set(e.sessionId, n);
    }
    points.push({
      atMs: e.ms,
      active: segCount.size,
      sessions: Array.from(segCount.keys()).slice(0, 10),
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
  totalLinesAdded: number;
  totalLinesRemoved: number;
  totalFilesEdited: number;
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
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
    totalFilesEdited: 0,
  };
  for (const s of sessions) {
    totals.totalDurationMs += s.durationMs ?? 0;
    // airTimeMs is now computed by parseTranscript using a 3-minute
    // idle threshold, so it correctly excludes lid-closed gaps and
    // other long away periods. Falls back to wall-clock duration on
    // old cached metas that predate the airTimeMs field.
    totals.totalAirTimeMs += s.airTimeMs ?? s.durationMs ?? 0;
    totals.totalTokens.input += s.totalUsage.input;
    totals.totalTokens.output += s.totalUsage.output;
    totals.totalTokens.cacheRead += s.totalUsage.cacheRead;
    totals.totalTokens.cacheWrite += s.totalUsage.cacheWrite;
    totals.totalToolCalls += s.toolCallCount ?? 0;
    totals.totalTurns += s.turnCount ?? 0;
    totals.totalLinesAdded += s.linesAdded ?? 0;
    totals.totalLinesRemoved += s.linesRemoved ?? 0;
    totals.totalFilesEdited += s.filesEdited ?? 0;
  }
  if (sessions.length > 0) {
    totals.avgTurnsPerSession = totals.totalTurns / sessions.length;
    totals.avgDurationMs = totals.totalDurationMs / sessions.length;
  }
  return totals;
}

/* ================================================================= */
/*  Active segments — for Gantt chart visualization                  */
/* ================================================================= */

export type ActiveSegment = {
  startMs: number;
  endMs: number;
};

/**
 * Compute contiguous "active" segments for a session from its events.
 * An active segment is a run of events where no gap exceeds the idle
 * threshold (default 3 min). Long gaps split the session into multiple
 * segments — so a 4-hour session with a 2-hour lunch break becomes
 * two short segments.
 */
export function computeActiveSegments(
  events: { timestamp?: string }[],
  idleThresholdMs = 3 * 60 * 1000,
): ActiveSegment[] {
  const timed = events
    .filter((e) => e.timestamp)
    .map((e) => Date.parse(e.timestamp!))
    .filter((ms) => !Number.isNaN(ms))
    .sort((a, b) => a - b);

  if (timed.length === 0) return [];

  const segments: ActiveSegment[] = [];
  let segStart = timed[0]!;
  let segEnd = timed[0]!;

  for (let i = 1; i < timed.length; i++) {
    const t = timed[i]!;
    if (t - segEnd > idleThresholdMs) {
      segments.push({ startMs: segStart, endMs: segEnd });
      segStart = t;
    }
    segEnd = t;
  }
  segments.push({ startMs: segStart, endMs: segEnd });
  return segments;
}

export type GanttSession = {
  id: string;
  projectName: string;
  projectDir: string;
  firstUserPreview?: string;
  lastAgentPreview?: string;
  model?: string;
  segments: ActiveSegment[];
  startMs: number;
  endMs: number;
  activeMs: number;
  totalUsage: Usage;
};

export type GanttDay = {
  date: string;
  sessions: GanttSession[];
  dayStartMs: number;
  dayEndMs: number;
  peakActiveParallelism: number;
};

/**
 * Build Gantt data for a specific day. Only sessions with at least one
 * active segment overlapping the target day are included.
 */
export function buildGanttDay(
  sessions: {
    id: string;
    projectName: string;
    projectDir: string;
    firstUserPreview?: string;
    lastAgentPreview?: string;
    model?: string;
    events: { timestamp?: string }[];
    totalUsage: Usage;
  }[],
  date: string,
): GanttDay {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dayStartMs = new Date(y, m - 1, d).getTime();
  const dayEndMs = new Date(y, m - 1, d + 1).getTime();

  const ganttSessions: GanttSession[] = [];

  for (const s of sessions) {
    const allSegments = computeActiveSegments(s.events);
    const daySegments = allSegments
      .filter((seg) => seg.endMs > dayStartMs && seg.startMs < dayEndMs)
      .map((seg) => ({
        startMs: Math.max(seg.startMs, dayStartMs),
        endMs: Math.min(seg.endMs, dayEndMs),
      }));

    if (daySegments.length === 0) continue;

    const startMs = Math.min(...daySegments.map((seg) => seg.startMs));
    const endMs = Math.max(...daySegments.map((seg) => seg.endMs));
    const activeMs = daySegments.reduce((sum, seg) => sum + (seg.endMs - seg.startMs), 0);

    ganttSessions.push({
      id: s.id,
      projectName: s.projectName,
      projectDir: s.projectDir,
      firstUserPreview: s.firstUserPreview,
      lastAgentPreview: s.lastAgentPreview,
      model: s.model,
      segments: daySegments,
      startMs,
      endMs,
      activeMs,
      totalUsage: s.totalUsage,
    });
  }

  ganttSessions.sort((a, b) => a.startMs - b.startMs);

  // Peak active parallelism: sweep-line over segment boundaries
  type Evt = { ms: number; delta: number };
  const evts: Evt[] = [];
  for (const s of ganttSessions) {
    for (const seg of s.segments) {
      evts.push({ ms: seg.startMs, delta: +1 });
      evts.push({ ms: seg.endMs, delta: -1 });
    }
  }
  evts.sort((a, b) => a.ms - b.ms || b.delta - a.delta);
  let active = 0;
  let peak = 0;
  for (const e of evts) {
    active += e.delta;
    if (active > peak) peak = active;
  }

  return { date, sessions: ganttSessions, dayStartMs, dayEndMs, peakActiveParallelism: peak };
}

/* ================================================================= */
/*  Parallelism bursts                                               */
/* ================================================================= */

export type ParallelismBurst = {
  startMs: number;
  endMs: number;
  /** Peak concurrent active sessions at any moment in the burst. */
  peak: number;
  /** Unique session IDs that contributed segments to this burst. */
  sessionIds: string[];
  /** Unique project dirs — used to decide cross-project vs same-project. */
  projectDirs: string[];
  /** True when sessionIds span more than one project. */
  crossProject: boolean;
};

/**
 * Detect human-scale "bursts" of parallel agent activity from a Gantt day.
 *
 * Raw `detectParallelRuns` produces dozens of short overlap events per busy
 * morning — each <3-min pause in one session splits the continuous work
 * into a new run. Users don't think that way. They think in bursts: "that
 * morning I was running 3 agents at once for about 20 minutes."
 *
 * This collapses raw overlap intervals into bursts using two rules:
 *   1. Minimum duration — drop overlaps shorter than `minDurationMs`. Kills
 *      accidental tab-switch overlaps (2–30 second artifacts).
 *   2. Merge gap — overlaps within `mergeGapMs` of each other are fused
 *      into one burst. Short idle pauses between agent messages don't
 *      create new bursts.
 *
 * The `peak` reported is the max concurrent sessions *inside* the burst.
 */
type BurstInputSession = {
  id: string;
  projectDir: string;
  segments: ActiveSegment[];
};

type BurstOpts = {
  minDurationMs?: number;
  mergeGapMs?: number;
  minActive?: number;
};

/**
 * Core burst detection over already-segmented sessions. Both the Gantt
 * (one-day) and dashboard (all-time) entry points feed into this.
 */
function detectBurstsCore(
  sessions: BurstInputSession[],
  opts: BurstOpts,
): ParallelismBurst[] {
  const minDurationMs = opts.minDurationMs ?? 60_000; // 1 min
  const mergeGapMs = opts.mergeGapMs ?? 10 * 60_000; // 10 min
  const minActive = opts.minActive ?? 2;

  type Evt = { ms: number; delta: number; sessionId: string };
  const events: Evt[] = [];
  for (const s of sessions) {
    for (const seg of s.segments) {
      if (seg.endMs <= seg.startMs) continue;
      events.push({ ms: seg.startMs, delta: +1, sessionId: s.id });
      events.push({ ms: seg.endMs, delta: -1, sessionId: s.id });
    }
  }
  events.sort((a, b) => a.ms - b.ms || b.delta - a.delta);

  // Active session multiset (a session with multiple segments stays "in"
  // until its last segment closes).
  const segCount = new Map<string, number>();

  type RawRun = {
    startMs: number;
    endMs: number;
    peak: number;
    sessionIds: Set<string>;
  };
  const rawRuns: RawRun[] = [];
  let cur: RawRun | null = null;

  for (const e of events) {
    if (e.delta === +1) {
      segCount.set(e.sessionId, (segCount.get(e.sessionId) ?? 0) + 1);
    } else {
      const n = (segCount.get(e.sessionId) ?? 0) - 1;
      if (n <= 0) segCount.delete(e.sessionId);
      else segCount.set(e.sessionId, n);
    }

    const active = segCount.size;
    if (active >= minActive) {
      if (!cur) {
        cur = {
          startMs: e.ms,
          endMs: e.ms,
          peak: active,
          sessionIds: new Set(segCount.keys()),
        };
      } else {
        cur.endMs = e.ms;
        if (active > cur.peak) cur.peak = active;
        for (const sid of segCount.keys()) cur.sessionIds.add(sid);
      }
    } else if (cur) {
      cur.endMs = e.ms;
      rawRuns.push(cur);
      cur = null;
    }
  }
  if (cur) rawRuns.push(cur);

  // Filter short overlap artifacts.
  const significant = rawRuns.filter((r) => r.endMs - r.startMs >= minDurationMs);

  // Merge runs that sit within `mergeGapMs` of each other — morning bursts
  // usually involve the same two repos with brief swaps, and strict set
  // equality leaves too much fragmentation.
  const merged: RawRun[] = [];
  for (const r of significant) {
    const last = merged[merged.length - 1];
    if (last && r.startMs - last.endMs <= mergeGapMs) {
      last.endMs = r.endMs;
      if (r.peak > last.peak) last.peak = r.peak;
      for (const sid of r.sessionIds) last.sessionIds.add(sid);
    } else {
      merged.push({
        startMs: r.startMs,
        endMs: r.endMs,
        peak: r.peak,
        sessionIds: new Set(r.sessionIds),
      });
    }
  }

  // Project metadata for each burst.
  const projectBySession = new Map<string, string>();
  for (const s of sessions) projectBySession.set(s.id, s.projectDir);

  return merged.map((r) => {
    const projectDirs = Array.from(
      new Set(
        Array.from(r.sessionIds)
          .map((sid) => projectBySession.get(sid))
          .filter((p): p is string => !!p),
      ),
    );
    return {
      startMs: r.startMs,
      endMs: r.endMs,
      peak: r.peak,
      sessionIds: Array.from(r.sessionIds),
      projectDirs,
      crossProject: projectDirs.length > 1,
    };
  });
}

/**
 * Detect human-scale "bursts" of parallel agent activity from a Gantt day.
 *
 * Raw `detectParallelRuns` produces dozens of short overlap events per busy
 * morning — each <3-min pause in one session splits the continuous work
 * into a new run. Users don't think that way. They think in bursts: "that
 * morning I was running 3 agents at once for about 20 minutes."
 *
 * This collapses raw overlap intervals into bursts using two rules:
 *   1. Minimum duration — drop overlaps shorter than `minDurationMs`. Kills
 *      accidental tab-switch overlaps (2–30 second artifacts).
 *   2. Merge gap — overlaps within `mergeGapMs` of each other are fused
 *      into one burst. Short idle pauses between agent messages don't
 *      create new bursts.
 *
 * The `peak` reported is the max concurrent sessions *inside* the burst.
 */
export function computeParallelismBursts(
  gantt: GanttDay,
  opts: BurstOpts = {},
): ParallelismBurst[] {
  return detectBurstsCore(gantt.sessions, opts);
}

/**
 * Aggregate parallelism bursts across a raw `SessionMeta[]` list using the
 * cached `activeSegments` field. Returns bursts spanning the entire
 * history, not just one day. Used by the dashboard to surface a global
 * headline number (peak concurrency, total parallel time, burst count).
 *
 * Sessions without `activeSegments` are skipped — they fall back to the
 * legacy first/last timestamp path only in `computeParallelism`, not here,
 * because raw session duration is exactly the signal we're trying to
 * avoid counting.
 */
export function computeBurstsFromSessions(
  sessions: SessionMeta[],
  opts: BurstOpts = {},
): ParallelismBurst[] {
  const input: BurstInputSession[] = [];
  for (const s of sessions) {
    if (!s.activeSegments || s.activeSegments.length === 0) continue;
    input.push({
      id: s.id,
      projectDir: s.projectDir,
      segments: s.activeSegments,
    });
  }
  return detectBurstsCore(input, opts);
}

export type ParallelismBurstStats = {
  /** Max peak concurrency across any single burst. */
  peakConcurrent: number;
  /** Sum of all burst durations in ms. */
  totalParallelMs: number;
  /** Number of bursts. */
  burstCount: number;
  /** How many bursts involve >1 project. */
  crossProjectBurstCount: number;
  /** Unique local days any burst touched. */
  activeDayCount: number;
};

/** Summarize a burst list into dashboard-friendly headline numbers. */
export function summarizeBursts(bursts: ParallelismBurst[]): ParallelismBurstStats {
  let peakConcurrent = 0;
  let totalParallelMs = 0;
  let crossProjectBurstCount = 0;
  const days = new Set<string>();
  for (const b of bursts) {
    if (b.peak > peakConcurrent) peakConcurrent = b.peak;
    totalParallelMs += b.endMs - b.startMs;
    if (b.crossProject) crossProjectBurstCount++;
    days.add(toLocalDay(b.startMs));
  }
  return {
    peakConcurrent,
    totalParallelMs,
    burstCount: bursts.length,
    crossProjectBurstCount,
    activeDayCount: days.size,
  };
}

/* ================================================================= */
/*  Project rollups                                                  */
/* ================================================================= */

export type ProjectRollup = {
  /** Stable project identifier — the canonical cwd path. Call sites
   *  should URL-encode it for use in href slugs. */
  projectDir: string;
  /** Canonical cwd path (worktrees rolled up to their parent repo). */
  projectName: string;
  sessions: SessionMeta[];
  /** All raw SessionMeta.projectDir values that contributed to this rollup.
   *  One project may include the parent repo plus any number of worktree
   *  subdirs, each with its own raw dir under ~/.claude/projects/. */
  rawProjectDirs: string[];
  /** Number of distinct git worktrees (`.worktrees/<name>`) rolled up
   *  into this project, excluding the parent repo itself. */
  worktreeCount: number;
  metrics: HighLevelMetrics;
  lastActiveMs?: number;
};

export function groupByProject(sessions: SessionMeta[]): ProjectRollup[] {
  const map = new Map<string, ProjectRollup>();
  for (const s of sessions) {
    const canonical = canonicalProjectName(s.projectName);
    const key = canonical;
    let cur = map.get(key);
    if (!cur) {
      cur = {
        projectDir: canonical,
        projectName: canonical,
        sessions: [],
        rawProjectDirs: [],
        worktreeCount: 0,
        metrics: highLevelMetrics([]),
        lastActiveMs: undefined,
      };
      map.set(key, cur);
    }
    cur.sessions.push(s);
    if (!cur.rawProjectDirs.includes(s.projectDir)) {
      cur.rawProjectDirs.push(s.projectDir);
    }
    const last = s.lastTimestamp ? Date.parse(s.lastTimestamp) : undefined;
    if (last && (!cur.lastActiveMs || last > cur.lastActiveMs)) {
      cur.lastActiveMs = last;
    }
  }
  for (const p of map.values()) {
    p.metrics = highLevelMetrics(p.sessions);
    // Count distinct worktrees — sessions whose projectName deviates
    // from the canonical (so has `/.worktrees/<name>`).
    const wtNames = new Set<string>();
    for (const s of p.sessions) {
      const wt = worktreeName(s.projectName);
      if (wt) wtNames.add(wt);
    }
    p.worktreeCount = wtNames.size;
  }
  return Array.from(map.values()).sort(
    (a, b) => (b.lastActiveMs ?? 0) - (a.lastActiveMs ?? 0),
  );
}
