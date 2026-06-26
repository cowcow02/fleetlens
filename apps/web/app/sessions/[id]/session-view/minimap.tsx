"use client";

/* ------------------------------------------------------------------ */
/*  Mini-map                                                           */
/*                                                                     */
/*  Design:                                                            */
/*  - Renders ONE segment per presentation row (not per raw event)     */
/*    so density matches what the user sees in the transcript.         */
/*  - Variable heights by importance: User/Agent/Error/Interrupt       */
/*    full height; Tool/Model reduced; idle = full w/ stripes.         */
/*  - Minimum block width 5px so single events never disappear.        */
/*  - Scroll playhead: thin vertical line tracks the current transcript*/
/*    scroll position inside the <main> container.                     */
/*  - Time axis ticks below the bar, auto-scaled by total duration.    */
/*  - Rich hover card (role pill + preview) instead of bare SVG title. */
/* ------------------------------------------------------------------ */

import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  PresentationRow,
  PresentationRowKind,
  PrMarker,
  SessionEvent,
  SubagentRun,
  TurnMegaRow,
  WorkflowRun,
} from "@claude-lens/parser";
import { rowPrimaryIndex, type DisplayRow, type MinimapSeg } from "./types";
import { subagentColor, workflowColor } from "./colors";
import { ROLE_THEMES, rowPreview, shortenToolName } from "../turn-steps";
import {
  estimateCost,
  formatCost,
  formatGap,
  formatOffset,
  formatTokens,
} from "@/lib/format";

/** All rows render at full bar height — distinction comes from color/pattern
 *  alone, matching Claude Managed Agents' unified-height timeline. */
const ROW_IMPORTANCE: Record<PresentationRowKind, number> = {
  user: 1.0,
  agent: 1.0,
  interrupt: 1.0,
  error: 1.0,
  "tool-group": 1.0,
  model: 1.0,
  "task-notification": 1.0,
};

export function Minimap({
  displayRows,
  durationMs,
  dayWindow,
  selectedIndex,
  onSelect,
  headerOffset,
  subagents,
  workflows,
  onWorkflowClick,
  selectedSubagentId,
  onSelectSubagent,
  prMarkers,
  coldResumeMarkers,
  rawIdleBands,
  model,
  onPlayheadChange,
}: {
  displayRows: DisplayRow[];
  durationMs: number;
  /** When set, scope the timeline to this offset window (one local day).
   *  null renders the full session. */
  dayWindow?: { startMs: number; endMs: number } | null;
  selectedIndex: number | null;
  onSelect: (i: number) => void;
  headerOffset: number;
  subagents?: SubagentRun[];
  workflows?: WorkflowRun[];
  onWorkflowClick?: (runId: string) => void;
  selectedSubagentId?: string | null;
  onSelectSubagent?: (id: string | null) => void;
  prMarkers?: PrMarker[];
  coldResumeMarkers?: {
    tOffsetMs: number;
    info: NonNullable<SessionEvent["coldResume"]>;
  }[];
  /** Idle bands derived directly from raw event timestamps. Used in place
   *  of the legacy "gap before user row" heuristic so Codex sessions
   *  (which spend most of their time in agent reasoning, not user input)
   *  surface their dead-air on the minimap. */
  rawIdleBands?: { start: number; end: number; durationMs: number }[];
  model?: string;
  /** Fires with the offset (ms) of the topmost on-screen transcript row — the
   *  same scroll signal that draws the playhead. SessionView uses it to make
   *  the selected day follow scroll. */
  onPlayheadChange?: (ms: number | null) => void;
}) {
  const WIDTH = 1400;
  /** Main timeline height. Sub-agent lanes stack below this. */
  const MAIN_H = 28;
  /** Per-subagent lane height including the inner gap. */
  const SUB_LANE_H = 11;
  /** Gap between the main timeline and the sub-agent lanes (when present). */
  const SUB_LANE_GAP = 6;
  /** Per-workflow lane height — a touch taller than subagent lanes so the
   *  workflow tier reads as distinct. */
  const WF_LANE_H = 13;
  const BAR_TOP = 3;
  const BAR_BOT = MAIN_H - 3;
  const BAR_H = BAR_BOT - BAR_TOP;
  /** Gap subtracted from each segment's width so blocks never touch. */
  const GAP = 3;
  const MIN_BLOCK = 6;
  /** Minimum displayed segment width in SVG units. Every segment gets at
   *  least this much space regardless of time duration, so tool-group
   *  blocks inside a 24-minute session are still visible + clickable. */
  const MIN_DISPLAY_WIDTH = 12;
  /** Error/interrupt rendered as thin vertical bars capped at this width. */
  const THIN_BAR_MAX = 5;

  const [hover, setHover] = useState<{
    clientX: number;
    row?: PresentationRow;
    turn?: TurnMegaRow;
    idleMs?: number;
    subagent?: SubagentRun;
    workflow?: WorkflowRun;
    pr?: PrMarker;
    cold?: {
      tOffsetMs: number;
      info: NonNullable<SessionEvent["coldResume"]>;
    };
  } | null>(null);
  const [playheadMs, setPlayheadMs] = useState<number | null>(null);
  // Read inside the observer so the latest callback fires without re-subscribing
  // the IntersectionObserver (its effect deps stay [displayRows.length, headerOffset]).
  const onPlayheadChangeRef = useRef(onPlayheadChange);
  onPlayheadChangeRef.current = onPlayheadChange;
  const containerRef = useRef<HTMLDivElement>(null);

  /* Playhead — track which transcript row is at the top of the viewport.
   *
   * The old implementation ran `querySelectorAll("[data-sl-row-index]")`
   * on every scroll event. For a session with ~2000 rows that's thousands
   * of DOM queries per second during scroll — enough to pin a CPU core
   * and make Chrome ask to kill the tab. IntersectionObserver is event-
   * driven: the browser only notifies us when rows enter or leave the region
   * below the sticky header, so the cost scales with *changes* instead of
   * with scroll rate × row count.
   */
  useEffect(() => {
    // The playhead observer roots on the nearest <main> ancestor. After the
    // Minimap extraction the DOM topology is unchanged so this still resolves —
    // but wrapping the minimap in a portal or a new scroll container would
    // sever that ancestry and silently break the playhead.
    const main = containerRef.current?.closest("main") as HTMLElement | null;
    if (!main) return;

    // Crop the observation region by the sticky header at the top and keep the
    // whole viewport below it. Every row visible below the header intersects
    // this region; the topmost (smallest offsetTop) is the row sitting at the
    // header line — the playhead. Using the full area (not a thin band) means
    // the playhead never blanks out in the gaps between sparse rows, so the
    // scroll→timeline highlight — and the day-follow that rides on it — stays
    // continuous. Still event-driven: a row only fires when it enters or
    // leaves, so cost scales with scroll distance, not row count.
    const rootMargin = `-${headerOffset}px 0px 0px 0px`;

    // Rows currently visible below the header. The topmost is the playhead.
    const visibleRows = new Set<HTMLElement>();

    const publishTopmost = () => {
      let value: number | null = null;
      if (visibleRows.size > 0) {
        let topmost: HTMLElement | null = null;
        let topmostOff = Infinity;
        for (const el of visibleRows) {
          const t = el.offsetTop;
          if (t < topmostOff) {
            topmostOff = t;
            topmost = el;
          }
        }
        if (topmost) {
          const tOff = Number(topmost.getAttribute("data-sl-toffset"));
          value = Number.isNaN(tOff) ? null : tOff;
        }
      }
      setPlayheadMs(value);
      onPlayheadChangeRef.current?.(value);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement;
          if (e.isIntersecting) visibleRows.add(el);
          else visibleRows.delete(el);
        }
        publishTopmost();
      },
      { root: main, rootMargin, threshold: 0 },
    );

    // Observe all current rows. Re-observes whenever the row count
    // changes (i.e. filter switch, turn expand/collapse).
    const rows = main.querySelectorAll<HTMLDivElement>("[data-sl-row-index]");
    for (const r of rows) observer.observe(r);

    return () => observer.disconnect();
  }, [displayRows.length, headerOffset]);

  // Offset window for the rendered timeline. `winEnd` is the absolute offset
  // of the right edge (session/day end); `safeDur` is the window LENGTH used
  // as the proportional-width divisor. For a single-day session (dayWindow
  // null) these collapse to [0, durationMs] — identical to the old behavior.
  const winStart = dayWindow?.startMs ?? 0;
  const winEnd = dayWindow?.endMs ?? durationMs;
  const safeDur = Math.max(winEnd - winStart, 1);

  // Subagent/workflow lanes are scoped to the same window as the main
  // timeline so a day view doesn't reserve empty lanes for runs that happened
  // on other days. Overlap test, not containment — a run straddling the
  // window edge still shows.
  const winSubagents = useMemo(
    () =>
      (subagents ?? []).filter(
        (s) =>
          s.startTOffsetMs !== undefined &&
          s.endTOffsetMs !== undefined &&
          s.endTOffsetMs >= winStart &&
          s.startTOffsetMs <= winEnd,
      ),
    [subagents, winStart, winEnd],
  );
  const winWorkflows = useMemo(
    () =>
      (workflows ?? []).filter(
        (w) =>
          w.startTOffsetMs !== undefined &&
          w.startTOffsetMs <= winEnd &&
          (w.endTOffsetMs ?? winEnd) >= winStart,
      ),
    [workflows, winStart, winEnd],
  );

  /* Build segments from the same display-row stream the transcript
     uses. Collapsed turns become one wide segment; expanded-turn
     headers are skipped; presentation rows (whether standalone or
     indented children of an expanded turn) become atomic segments. */
  const segs: MinimapSeg[] = useMemo(() => {
    const out: MinimapSeg[] = [];

    // Flatten to (item, start) pairs with the expanded-turn headers removed
    // and collapsed turns preserved as single-item entries.
    type WithTime =
      | { kind: "row"; row: PresentationRow; start: number; gapMs: number }
      | {
          kind: "turn";
          turn: TurnMegaRow;
          start: number;
          gapMs: number;
        };

    const withTime: WithTime[] = [];
    for (const d of displayRows) {
      if (d.kind === "turn-expanded-header") continue;
      if (d.kind === "turn-expanded-footer") continue;
      if (d.kind === "turn-collapsed") {
        if (d.turn.tOffsetMs === undefined) continue;
        if (d.turn.tOffsetMs < winStart || d.turn.tOffsetMs > winEnd) continue;
        withTime.push({
          kind: "turn",
          turn: d.turn,
          start: d.turn.tOffsetMs,
          gapMs: d.turn.rows[0]?.gapMs ?? 0,
        });
      } else {
        // presentation row
        if (d.row.tOffsetMs === undefined) continue;
        if (d.row.tOffsetMs < winStart || d.row.tOffsetMs > winEnd) continue;
        withTime.push({
          kind: "row",
          row: d.row,
          start: d.row.tOffsetMs,
          gapMs: d.row.gapMs ?? 0,
        });
      }
    }

    // A collapsed turn is one block spanning its whole duration; the idle
    // *inside* it (model thinking, a long tool call, a workflow the turn is
    // waiting on) is part of that turn, not separate dead air. Without this,
    // a turn with several internal gaps renders as a turn stub followed by a
    // run of back-to-back hatched idle bars — there's no activity segment
    // between them because the turn is a single item — and the turn block is
    // clipped at the first gap instead of spanning across a workflow that ran
    // inside it. Suppress any idle band that begins within a collapsed turn so
    // the turn owns its internal time; between-turn idle (which begins at/after
    // a turn's end) is untouched.
    const turnSpans = withTime.flatMap((w) =>
      w.kind === "turn"
        ? [{ start: w.start, end: w.start + (w.turn.durationMs ?? 0) }]
        : [],
    );
    const startsInsideTurn = (t: number) =>
      turnSpans.some((s) => t >= s.start && t < s.end);

    // Build a sorted copy of idle bands so we can clip row/turn ends to
    // the start of the next idle band (or the next row, whichever comes
    // first). This stops a row's rectangle from spanning across an idle
    // gap and visually swallowing it.
    const idleBands = (rawIdleBands ?? [])
      .filter((b) => b.end > winStart && b.start < winEnd)
      .filter((b) => !startsInsideTurn(b.start))
      .sort((a, b) => a.start - b.start);
    const nextIdleStartFrom = (t: number): number | undefined => {
      for (const b of idleBands) {
        if (b.start >= t) return b.start;
      }
      return undefined;
    };

    for (let i = 0; i < withTime.length; i++) {
      const item = withTime[i];
      const next = withTime[i + 1];
      const start = item.start;
      const nextRowStart = next?.start;
      const nextIdleStart = nextIdleStartFrom(start + 1);
      // Cap end to whichever comes first: next visible row, next idle band,
      // or the window's right edge (so a day's last segment doesn't bleed
      // past the scoped window into the next day).
      const cap = (raw: number) =>
        Math.min(
          raw,
          nextRowStart ?? Number.POSITIVE_INFINITY,
          nextIdleStart ?? Number.POSITIVE_INFINITY,
          winEnd,
        );

      if (item.kind === "turn") {
        const turnEnd = start + (item.turn.durationMs ?? 0);
        out.push({
          kind: "turn",
          turn: item.turn,
          primaryIndex: item.turn.firstPrimaryIndex,
          start,
          end: Math.max(cap(turnEnd), start + 1),
        });
      } else {
        const end = cap(nextRowStart ?? start + 800);
        out.push({
          kind: "row",
          row: item.row,
          primaryIndex: rowPrimaryIndex(item.row),
          start,
          end: Math.max(end, start + 1),
        });
      }
    }

    // Idle bands are computed from raw event timestamps (5s threshold) up
    // in the parent — append them and let the sort below interleave by
    // start time so they slot between rows correctly.
    for (const band of idleBands) {
      out.push({
        kind: "idle",
        start: band.start,
        end: band.end,
        durationMs: band.durationMs,
      });
    }
    out.sort((a, b) => a.start - b.start);

    // Fuse consecutive idle segments. Two idle bands with no activity segment
    // between them should read as ONE idle block — e.g. a between-turn gap that
    // rawIdleBands split in two because a lone meta/summary anchor sits in the
    // middle (the part before it classifies as in-turn, the part after as
    // between-turn). Safe to do here (post-window, post-sort): only segments
    // genuinely adjacent in render order collapse, so a real row between two
    // idle bands still keeps them apart.
    const fused: MinimapSeg[] = [];
    for (const seg of out) {
      const prev = fused[fused.length - 1];
      if (prev && prev.kind === "idle" && seg.kind === "idle") {
        prev.end = Math.max(prev.end, seg.end);
        prev.durationMs = (prev.durationMs ?? 0) + (seg.durationMs ?? 0);
      } else {
        fused.push(seg.kind === "idle" ? { ...seg } : seg);
      }
    }

    // Cap the number of rendered segments. Each <rect> carries two
    // event handlers (onMouseEnter + onClick), so 2000 raw-events in
    // "All events" mode becomes 4000 DOM event listeners — enough to
    // stall Chrome during paint. Sampling to MAX contiguous buckets
    // loses per-item hover precision but keeps the overall shape and
    // click-to-navigate behavior (clicks map to the first row inside
    // the bucket, which is the right anchor for "jump here" UX).
    const MAX_SEGMENTS = 600;
    if (fused.length <= MAX_SEGMENTS) return fused;

    const step = Math.ceil(fused.length / MAX_SEGMENTS);
    const bucketed: MinimapSeg[] = [];
    for (let i = 0; i < fused.length; i += step) {
      const first = fused[i]!;
      const last = fused[Math.min(i + step - 1, fused.length - 1)]!;
      // Merge bucket: keep the first seg's kind + primaryIndex (so clicks
      // jump to the first item of the bucket), but extend the end range
      // to cover the whole bucket's time span.
      if (first.kind === "idle") {
        bucketed.push({
          kind: "idle",
          start: first.start,
          end: last.end,
          durationMs: last.end - first.start,
        });
      } else if (first.kind === "turn") {
        bucketed.push({
          kind: "turn",
          turn: first.turn,
          primaryIndex: first.primaryIndex,
          start: first.start,
          end: last.end,
        });
      } else {
        bucketed.push({
          kind: "row",
          row: first.row,
          primaryIndex: first.primaryIndex,
          start: first.start,
          end: last.end,
        });
      }
    }
    return bucketed;
  }, [displayRows, safeDur, rawIdleBands, winStart, winEnd]);

  /* Sequential layout with a minimum displayed width per segment.
     - Raw proportional width = (seg.end - seg.start) / safeDur * WIDTH
     - Enforced width = max(raw, MIN_DISPLAY_WIDTH)
     - x positions are cumulative (not time-proportional), so tiny events
       stay visible next to a 24-minute turn.
     - If the cumulative width exceeds WIDTH, proportionally shrink so it
       all fits. Time ordering is preserved; exact time-to-pixel mapping
       is sacrificed. */
  const positions: { x: number; w: number }[] = useMemo(() => {
    if (segs.length === 0) return [];
    const raws = segs.map((s) => ((s.end - s.start) / safeDur) * WIDTH);
    const enforced = raws.map((w) => Math.max(w, MIN_DISPLAY_WIDTH));
    const total = enforced.reduce((a, b) => a + b, 0);
    const scale = WIDTH / total;
    const out: { x: number; w: number }[] = [];
    let cursor = 0;
    for (const w of enforced) {
      const scaled = w * scale;
      out.push({ x: cursor, w: scaled });
      cursor += scaled;
    }
    return out;
  }, [segs, safeDur]);

  /** Map a time offset (ms) to an x coordinate in the relaxed layout.
   *  Walks segments sequentially and interpolates within whichever one
   *  contains the target ms. Used for the playhead indicator. */
  const msToX = (ms: number): number => {
    if (segs.length === 0) return 0;
    if (ms <= segs[0].start) return positions[0]?.x ?? 0;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const p = positions[i];
      if (!p) continue;
      if (ms < s.start) return p.x;
      if (ms <= s.end) {
        const segDur = s.end - s.start;
        const frac = segDur > 0 ? (ms - s.start) / segDur : 0;
        return p.x + frac * p.w;
      }
    }
    const last = positions[positions.length - 1];
    return last ? last.x + last.w : WIDTH;
  };

  // ---- Sub-agent lane assignment -------------------------------------
  // Place each subagent in the lowest lane index where it doesn't
  // collide with the most recent bar in that lane. Greedy left→right
  // sweep — O(N×L) where L is the number of lanes (small in practice).
  // Returns a Map agentId → laneIndex plus the total lane count.
  const { laneOf, laneCount } = useMemo(() => {
    if (winSubagents.length === 0) {
      return { laneOf: new Map<string, number>(), laneCount: 0 };
    }
    const sorted = [...winSubagents].sort(
      (a, b) => (a.startTOffsetMs ?? 0) - (b.startTOffsetMs ?? 0),
    );
    const laneEnds: number[] = [];
    const laneOf = new Map<string, number>();
    for (const s of sorted) {
      const start = s.startTOffsetMs ?? 0;
      const end = s.endTOffsetMs ?? start + 1;
      let assigned = -1;
      for (let i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i]! <= start) {
          assigned = i;
          break;
        }
      }
      if (assigned === -1) {
        assigned = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[assigned] = end;
      laneOf.set(s.agentId, assigned);
    }
    return { laneOf, laneCount: laneEnds.length };
  }, [winSubagents]);

  const SUB_BLOCK_TOP = MAIN_H + SUB_LANE_GAP;
  const SUB_LANES_H = laneCount > 0 ? laneCount * SUB_LANE_H : 0;

  // ---- Workflow lane assignment --------------------------------------
  // Same greedy sweep as subagents. Workflow runs are mostly sequential
  // milestones, so this usually collapses to one lane — but overlap is
  // handled if two runs ever ran concurrently.
  const { wfLaneOf, wfLaneCount } = useMemo(() => {
    // Only place workflows we can actually draw (startTOffsetMs known). A
    // running run has no end yet — it extends to the session end (safeDur),
    // matching the open-ended bar the render draws. Counting only placeable
    // runs keeps wfLaneCount in lockstep with what renders, so no empty
    // reserved band appears.
    const placeable = winWorkflows;
    if (placeable.length === 0) {
      return { wfLaneOf: new Map<string, number>(), wfLaneCount: 0 };
    }
    const sorted = [...placeable].sort(
      (a, b) => (a.startTOffsetMs ?? 0) - (b.startTOffsetMs ?? 0),
    );
    const laneEnds: number[] = [];
    const wfLaneOf = new Map<string, number>();
    for (const w of sorted) {
      const start = w.startTOffsetMs ?? 0;
      const end = w.endTOffsetMs ?? winEnd;
      let assigned = -1;
      for (let i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i]! <= start) {
          assigned = i;
          break;
        }
      }
      if (assigned === -1) {
        assigned = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[assigned] = Math.max(end, start + 1);
      wfLaneOf.set(w.runId, assigned);
    }
    return { wfLaneOf, wfLaneCount: laneEnds.length };
  }, [winWorkflows, winEnd]);

  const SUB_BLOCK_BOTTOM = MAIN_H + (laneCount > 0 ? SUB_LANE_GAP + SUB_LANES_H : 0);
  const WF_BLOCK_TOP = SUB_BLOCK_BOTTOM + (wfLaneCount > 0 ? SUB_LANE_GAP : 0);
  const WF_LANES_H = wfLaneCount > 0 ? wfLaneCount * WF_LANE_H : 0;
  const TOTAL_H = SUB_BLOCK_BOTTOM + (wfLaneCount > 0 ? SUB_LANE_GAP + WF_LANES_H : 0);

  return (
    <div
      ref={containerRef}
      style={{
        padding: "8px 10px",
        position: "relative",
        background: "var(--af-surface)",
        border: "1px solid var(--af-border-subtle)",
        borderRadius: 8,
        marginTop: 2,
      }}
      onMouseLeave={() => setHover(null)}
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${TOTAL_H}`}
        preserveAspectRatio="none"
        style={{
          width: "100%",
          height: TOTAL_H,
          display: "block",
          overflow: "visible",
        }}
      >
        <defs>
          <pattern
            id="stripes"
            patternUnits="userSpaceOnUse"
            width="6"
            height="6"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" fill="rgba(120, 115, 108, 0.04)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(120, 115, 108, 0.28)" strokeWidth="2" />
          </pattern>
        </defs>

        {/* Segments — x/w come from the relaxed sequential layout, NOT
            from raw time proportions. See the positions memo above. */}
        {segs.map((seg, i) => {
          const pos = positions[i];
          if (!pos) return null;
          const xRaw = pos.x;
          const wRaw = pos.w;

          if (seg.kind === "idle") {
            // Idle block: fill its span minus a gap on each side, with a
            // subtle border so the diagonal stripes read as a distinct block.
            const w = Math.max(wRaw - GAP, MIN_BLOCK);
            return (
              <rect
                key={`idle-${i}`}
                x={xRaw + GAP / 2}
                y={BAR_TOP + 1}
                width={w}
                height={BAR_H - 2}
                fill="url(#stripes)"
                stroke="rgba(120, 115, 108, 0.35)"
                strokeWidth="0.6"
                rx="3"
                onMouseEnter={(e) =>
                  setHover({
                    clientX: e.clientX,
                    idleMs: seg.durationMs,
                  })
                }
              />
            );
          }

          // Resolve the theme + selection state. Turn segments use the
          // "agent" theme (a turn is the agent's work wrapped as one unit).
          const rowKind: PresentationRowKind = seg.kind === "turn" ? "agent" : seg.row.kind;
          const theme = ROLE_THEMES[rowKind];
          const importance = ROW_IMPORTANCE[rowKind];
          const h = BAR_H * importance;
          const y = BAR_TOP + (BAR_H - h) / 2;
          const isSelected = selectedIndex === seg.primaryIndex;

          // Error/interrupt: render as a THIN vertical bar regardless of
          // actual span. Consecutive errors become a visible comb of
          // narrow strokes separated by gaps, matching Claude's UI.
          const isThin =
            seg.kind === "row" && (seg.row.kind === "error" || seg.row.kind === "interrupt");
          let w: number;
          let x: number;
          if (isThin) {
            w = Math.min(Math.max(wRaw - GAP, 2), THIN_BAR_MAX);
            x = xRaw + Math.max((wRaw - w) / 2, GAP / 2);
          } else {
            w = Math.max(wRaw - GAP, MIN_BLOCK);
            x = xRaw + GAP / 2;
          }

          const ringPad = 2.5;
          const onHover = (e: React.MouseEvent) =>
            seg.kind === "turn"
              ? setHover({ clientX: e.clientX, turn: seg.turn })
              : setHover({ clientX: e.clientX, row: seg.row });
          return (
            <g key={`seg-${seg.primaryIndex}-${i}`}>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                fill={theme.mini}
                rx="3"
                style={{ cursor: "pointer" }}
                onClick={() => onSelect(seg.primaryIndex)}
                onMouseEnter={onHover}
              />
              {isSelected && (
                <rect
                  x={x - ringPad}
                  y={y - ringPad}
                  width={w + ringPad * 2}
                  height={h + ringPad * 2}
                  fill="none"
                  stroke="#5C84C3"
                  strokeWidth="2"
                  rx="5"
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}

        {/* Sub-agent lanes — one row per lane, colored by agentType.
            Background-mode runs are highlighted with a brighter fill +
            extra dashed outline so you can spot true parallelism at a
            glance. Bars use the same msToX mapping as the main timeline
            so the subagent's start/end aligns vertically with whatever
            was happening in the main session at that time. */}
        {laneCount > 0 && winSubagents.length > 0 && (
          <g>
            {/* Faint divider line above the subagent lane block */}
            <line
              x1={0}
              x2={WIDTH}
              y1={MAIN_H + SUB_LANE_GAP / 2}
              y2={MAIN_H + SUB_LANE_GAP / 2}
              stroke="var(--af-border-subtle)"
              strokeWidth="0.6"
              strokeDasharray="2 4"
            />
            {winSubagents.map((s) => {
              const lane = laneOf.get(s.agentId) ?? 0;
              if (s.startTOffsetMs === undefined || s.endTOffsetMs === undefined) return null;
              const startX = msToX(s.startTOffsetMs);
              const endX = msToX(s.endTOffsetMs);
              // Minimum 8px so a 78-second subagent in a 16-hour session is
              // still wide enough to read + hit-test. Long subagents render
              // at their actual proportional width.
              const w = Math.max(endX - startX, 8);
              const y = SUB_BLOCK_TOP + lane * SUB_LANE_H;
              const h = SUB_LANE_H - 2;
              const fill = subagentColor(s.agentType, s.runInBackground);
              const isSelected = selectedSubagentId === s.agentId;
              return (
                <g key={s.agentId}>
                  <rect
                    x={startX}
                    y={y}
                    width={w}
                    height={h}
                    fill={fill}
                    stroke={s.runInBackground ? "#fff" : "transparent"}
                    strokeWidth={s.runInBackground ? 0.5 : 0}
                    strokeDasharray={s.runInBackground ? "1.5 1.5" : undefined}
                    rx="2"
                    style={{ cursor: "pointer" }}
                    onMouseEnter={(e) => setHover({ clientX: e.clientX, subagent: s })}
                    onClick={() => onSelectSubagent?.(isSelected ? null : s.agentId)}
                  />
                  {isSelected && (
                    <rect
                      x={startX - 2}
                      y={y - 2}
                      width={w + 4}
                      height={h + 4}
                      fill="none"
                      stroke="var(--af-accent)"
                      strokeWidth="1.5"
                      rx="4"
                      pointerEvents="none"
                    />
                  )}
                </g>
              );
            })}
          </g>
        )}

        {/* Workflow lanes — one bar per dynamic-workflow run, on the same
            time axis as the main timeline, colored by status (orange tier,
            distinct from the blue/purple subagents). The agent count is the
            headline — a single Workflow tool call hides a whole fleet. */}
        {wfLaneCount > 0 && winWorkflows.length > 0 && (
          <g>
            <line
              x1={0}
              x2={WIDTH}
              y1={WF_BLOCK_TOP - SUB_LANE_GAP / 2}
              y2={WF_BLOCK_TOP - SUB_LANE_GAP / 2}
              stroke="var(--af-border-subtle)"
              strokeWidth="0.6"
              strokeDasharray="2 4"
            />
            {winWorkflows.map((w) => {
              if (w.startTOffsetMs === undefined) return null;
              const lane = wfLaneOf.get(w.runId) ?? 0;
              const startX = msToX(w.startTOffsetMs);
              // A still-running run has no endTOffsetMs — draw it open-ended to
              // the session end so it's visible (and dashed, to read as ongoing)
              // rather than vanishing while still occupying a reserved lane.
              const inProgress = w.endTOffsetMs === undefined;
              const endX = msToX(w.endTOffsetMs ?? winEnd);
              const wWidth = Math.max(endX - startX, 8);
              const y = WF_BLOCK_TOP + lane * WF_LANE_H;
              const h = WF_LANE_H - 2;
              const fill = workflowColor(w.status);
              // Center the agent count label inside the bar when there's room.
              const label = `${w.agentCount}`;
              const showLabel = wWidth > 22;
              return (
                <g key={w.runId} style={{ cursor: "pointer" }}>
                  <rect
                    x={startX}
                    y={y}
                    width={wWidth}
                    height={h}
                    fill={fill}
                    fillOpacity={inProgress ? 0.55 : 1}
                    stroke={inProgress ? fill : "transparent"}
                    strokeWidth={inProgress ? 0.8 : 0}
                    strokeDasharray={inProgress ? "2 2" : undefined}
                    rx="2"
                    onMouseEnter={(e) => setHover({ clientX: e.clientX, workflow: w })}
                    onClick={() => onWorkflowClick?.(w.runId)}
                  />
                  {showLabel && (
                    <text
                      x={startX + wWidth / 2}
                      y={y + h / 2 + 3}
                      textAnchor="middle"
                      fontSize="8.5"
                      fontWeight="700"
                      fill="#fff"
                      pointerEvents="none"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        )}

        {/* PR markers — diamond + vertical line at each `gh pr create` */}
        {prMarkers?.map((pr, i) => {
          if (pr.tOffsetMs === undefined) return null;
          if (pr.tOffsetMs < winStart || pr.tOffsetMs > winEnd) return null;
          const x = msToX(pr.tOffsetMs);
          return (
            <g
              key={`pr-${i}`}
              style={{ cursor: "pointer" }}
              onMouseEnter={(e) => setHover({ clientX: e.clientX, pr })}
            >
              <line
                x1={x}
                x2={x}
                y1={0}
                y2={TOTAL_H}
                stroke="#8b5cf6"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                opacity="0.7"
              />
              {/* Invisible wider hit area for easier hovering */}
              <rect
                x={x - 8}
                y={0}
                width={16}
                height={TOTAL_H}
                fill="transparent"
              />
              {/* Diamond marker at mid-height */}
              <polygon
                points={`${x},${MAIN_H / 2 - 5} ${x + 5},${MAIN_H / 2} ${x},${MAIN_H / 2 + 5} ${x - 5},${MAIN_H / 2}`}
                fill="#8b5cf6"
                stroke="var(--af-surface)"
                strokeWidth="1.5"
              />
            </g>
          );
        })}

        {coldResumeMarkers?.map((cr, i) => {
          if (cr.tOffsetMs < winStart || cr.tOffsetMs > winEnd) return null;
          const x = msToX(cr.tOffsetMs);
          return (
            <g
              key={`cold-${i}`}
              style={{ cursor: "pointer" }}
              onMouseEnter={(e) => setHover({ clientX: e.clientX, cold: cr })}
            >
              <line
                x1={x}
                x2={x}
                y1={0}
                y2={TOTAL_H}
                stroke="#D97706"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                opacity="0.75"
                pointerEvents="none"
              />
              {/* Hover hit-area limited to the diamond itself — a wider/taller
                  target used to swallow hovers+clicks meant for adjacent
                  user-prompt markers sitting right beside the cache-rebuild
                  point. */}
              <rect
                x={x - 6}
                y={MAIN_H / 2 - 8}
                width={12}
                height={16}
                fill="transparent"
              />
              <polygon
                points={`${x},${MAIN_H / 2 - 5} ${x + 5},${MAIN_H / 2} ${x},${MAIN_H / 2 + 5} ${x - 5},${MAIN_H / 2}`}
                fill="#D97706"
                stroke="var(--af-surface)"
                strokeWidth="1.5"
                pointerEvents="none"
              />
            </g>
          );
        })}

        {/* Playhead — positioned against the relaxed layout, not raw time.
            Spans the full SVG height (main + subagent lanes) so you can see
            which subagents were running at the current scroll position. */}
        {playheadMs !== null && (
          <line
            x1={msToX(playheadMs)}
            x2={msToX(playheadMs)}
            y1={0}
            y2={TOTAL_H}
            stroke="#0F172A"
            strokeWidth="1.25"
            strokeDasharray="2 2"
            opacity="0.65"
          />
        )}
      </svg>

      {/* Hover card */}
      {hover && (
        <MinimapHoverCard
          containerRef={containerRef}
          clientX={hover.clientX}
          row={hover.row}
          turn={hover.turn}
          idleMs={hover.idleMs}
          subagent={hover.subagent}
          workflow={hover.workflow}
          pr={hover.pr}
          cold={hover.cold}
          model={model}
        />
      )}

      {/* Sub-agent legend strip — only when there are subagent lanes. */}
      {laneCount > 0 && subagents && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 6,
            fontSize: 10,
            color: "var(--af-text-tertiary)",
          }}
        >
          <span style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Sub-agents
          </span>
          <span>·</span>
          <span>
            {subagents.length} run{subagents.length === 1 ? "" : "s"}
          </span>
          <span style={{ marginLeft: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {Array.from(new Set(subagents.map((s) => s.agentType))).map((type) => (
              <span
                key={type}
                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: subagentColor(type, false),
                  }}
                />
                {type}
              </span>
            ))}
            {subagents.some((s) => s.runInBackground) && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: "transparent",
                    border: "1px dashed var(--af-text-secondary)",
                  }}
                />
                background
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

function MinimapHoverCard({
  containerRef,
  clientX,
  row,
  turn,
  idleMs,
  subagent,
  workflow,
  pr,
  cold,
  model,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  clientX: number;
  row?: PresentationRow;
  turn?: TurnMegaRow;
  idleMs?: number;
  subagent?: SubagentRun;
  workflow?: WorkflowRun;
  pr?: PrMarker;
  cold?: { tOffsetMs: number; info: NonNullable<SessionEvent["coldResume"]> };
  model?: string;
}) {
  const rect = containerRef.current?.getBoundingClientRect();
  const localX = rect ? clientX - rect.left : 0;
  const left = Math.min(Math.max(localX - 140, 8), (rect?.width ?? 1400) - 300);
  // Always open below the minimap. The minimap lives inside the sticky
  // header, so there's never reliable space above it for a tooltip.
  const posStyle = { top: "calc(100% + 8px)", left };

  if (workflow) {
    const w = workflow;
    const startOff = formatOffset(w.startTOffsetMs);
    const endOff = formatOffset(w.endTOffsetMs);
    const dur = w.durationMs !== undefined ? formatGap(w.durationMs) : "";
    return (
      <div
        style={{
          position: "absolute",
          ...posStyle,
          zIndex: 100,
          background: "#0F172A",
          color: "#F1F5F9",
          borderRadius: 10,
          padding: "12px 14px",
          fontSize: 11,
          pointerEvents: "none",
          boxShadow: "0 6px 24px rgba(15,23,42,0.22)",
          maxWidth: 440,
          minWidth: 280,
          lineHeight: 1.45,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 4,
              background: workflowColor(w.status),
              color: "#fff",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            workflow · {w.status}
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              opacity: 0.7,
              marginLeft: "auto",
            }}
          >
            {startOff} → {endOff} · {dur}
          </span>
        </div>
        <div style={{ fontWeight: 600, marginBottom: 4, fontFamily: "var(--font-mono)" }}>
          {w.name}
        </div>
        {w.description && (
          <div style={{ opacity: 0.8, marginBottom: 6 }}>{w.description}</div>
        )}
        <div
          style={{
            fontSize: 10,
            opacity: 0.75,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            paddingTop: 6,
            borderTop: "1px solid rgba(241,245,249,0.08)",
            fontFamily: "var(--font-mono)",
          }}
        >
          <span style={{ color: "#FB923C", fontWeight: 600 }}>{w.agentCount} agents</span>
          <span>·</span>
          <span>{w.toolCallCount.toLocaleString()} tools</span>
          <span>·</span>
          <span>{formatTokens(w.totalTokens)} tok</span>
          {w.phases.length > 0 && (
            <>
              <span>·</span>
              <span>{w.phases.length} phases</span>
            </>
          )}
        </div>
        <div style={{ marginTop: 6, fontSize: 10, opacity: 0.55, fontStyle: "italic" }}>
          Click to open this run in the Workflows tab.
        </div>
      </div>
    );
  }

  if (subagent) {
    const startOff = formatOffset(subagent.startTOffsetMs);
    const endOff = formatOffset(subagent.endTOffsetMs);
    const dur = subagent.durationMs !== undefined ? formatGap(subagent.durationMs) : "";
    const totalIn =
      subagent.totalUsage.input + subagent.totalUsage.cacheRead + subagent.totalUsage.cacheWrite;
    return (
      <div
        style={{
          position: "absolute",
          ...posStyle,
          zIndex: 100,
          background: "#0F172A",
          color: "#F1F5F9",
          borderRadius: 10,
          padding: "12px 14px",
          fontSize: 11,
          pointerEvents: "none",
          boxShadow: "0 6px 24px rgba(15,23,42,0.22)",
          maxWidth: 440,
          minWidth: 280,
          lineHeight: 1.45,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 4,
              background: subagentColor(subagent.agentType, subagent.runInBackground),
              color: "#fff",
            }}
          >
            {subagent.agentType}
          </span>
          {subagent.runInBackground && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                padding: "1px 6px",
                borderRadius: 3,
                background: "rgba(251, 191, 36, 0.18)",
                color: "#FBBF24",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              background
            </span>
          )}
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              opacity: 0.7,
              marginLeft: "auto",
            }}
          >
            {startOff} → {endOff} · {dur}
          </span>
        </div>
        <div style={{ fontWeight: 500, marginBottom: 6 }}>{subagent.description}</div>
        <div
          style={{
            fontSize: 10,
            opacity: 0.65,
            display: "flex",
            gap: 8,
            paddingTop: 6,
            borderTop: "1px solid rgba(241,245,249,0.08)",
          }}
        >
          <span>{subagent.eventCount} events</span>
          <span>·</span>
          <span style={{ fontFamily: "var(--font-mono)" }}>
            {formatTokens(totalIn)}/{formatTokens(subagent.totalUsage.output)} tok
          </span>
        </div>
        {subagent.finalPreview && (
          <div
            style={{
              marginTop: 6,
              opacity: 0.78,
              fontStyle: "italic",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            → {subagent.finalPreview}
          </div>
        )}
      </div>
    );
  }

  if (cold) {
    const { trigger, gapMs, writeTokens, compact } = cold.info;
    const isCompact = trigger === "compact";
    const estUsd = estimateCost(
      { input: 0, output: 0, cacheRead: 0, cacheWrite: writeTokens },
      model,
    );
    let label: string;
    if (!isCompact) label = "⚡ CACHE REBUILD";
    else if (compact?.trigger === "auto") label = "⚡ AUTO-COMPACT";
    else label = "⚡ /COMPACT";
    const detailLine = isCompact
      ? `${formatTokens(writeTokens)} rewritten · pre-compact ${formatTokens(compact?.preTokens ?? 0)}`
      : `${formatTokens(writeTokens)} rewritten · idle ${formatGap(gapMs)}`;
    const hint = isCompact
      ? "Conversation was summarized; prefix had to be rewritten into a fresh cache."
      : "Prompt cache expired during idle; resuming within 5 min keeps it warm.";
    return (
      <div
        style={{
          position: "absolute",
          ...posStyle,
          zIndex: 100,
          background: "#0F172A",
          color: "#F1F5F9",
          borderRadius: 10,
          padding: "10px 14px",
          fontSize: 11,
          pointerEvents: "none",
          boxShadow: "0 6px 24px rgba(15,23,42,0.22)",
          maxWidth: 340,
          minWidth: 220,
          lineHeight: 1.45,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 4,
              background: "#D97706",
              color: "#fff",
            }}
          >
            {label}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, opacity: 0.7 }}>
            at {formatOffset(cold.tOffsetMs)}
          </span>
        </div>
        <div style={{ fontWeight: 500, fontFamily: "var(--font-mono)" }}>
          {detailLine}
          {estUsd >= 0.005 && ` · est. ${formatCost(estUsd)}`}
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 10,
            opacity: 0.65,
            fontStyle: "italic",
            whiteSpace: "normal",
          }}
        >
          {hint}
        </div>
      </div>
    );
  }

  if (pr) {
    const label = pr.title
      ? `PR${pr.prNumber ? ` #${pr.prNumber}` : ""}: ${pr.title}`
      : pr.prNumber
        ? `PR #${pr.prNumber}`
        : "PR created";
    return (
      <div
        style={{
          position: "absolute",
          ...posStyle,
          zIndex: 100,
          background: "#0F172A",
          color: "#F1F5F9",
          borderRadius: 10,
          padding: "10px 14px",
          fontSize: 11,
          pointerEvents: "none",
          boxShadow: "0 6px 24px rgba(15,23,42,0.22)",
          maxWidth: 360,
          minWidth: 200,
          lineHeight: 1.45,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 4,
              background: "#8b5cf6",
              color: "#fff",
            }}
          >
            PR
          </span>
          {pr.tOffsetMs !== undefined && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, opacity: 0.7 }}>
              at {formatOffset(pr.tOffsetMs)}
            </span>
          )}
        </div>
        <div style={{ fontWeight: 500 }}>{label}</div>
      </div>
    );
  }

  if (idleMs !== undefined) {
    return (
      <div
        style={{
          position: "absolute",
          ...posStyle,
          zIndex: 100,
          background: "#0F172A",
          color: "#F1F5F9",
          borderRadius: 10,
          padding: "8px 12px",
          fontSize: 11,
          pointerEvents: "none",
          boxShadow: "0 6px 24px rgba(15,23,42,0.22)",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 2 }}>Session idle</div>
        <div style={{ opacity: 0.78, fontFamily: "var(--font-mono)" }}>{formatGap(idleMs)}</div>
      </div>
    );
  }

  if (turn) {
    const theme = ROLE_THEMES.agent;
    const s = turn.summary;
    const dur = turn.durationMs !== undefined ? formatGap(turn.durationMs) : "";
    const startOff = formatOffset(turn.tOffsetMs);
    const endOff =
      turn.tOffsetMs !== undefined && turn.durationMs !== undefined
        ? formatOffset(turn.tOffsetMs + turn.durationMs)
        : undefined;
    const hasFirstLast =
      s.firstAgentPreview && s.finalAgentPreview && s.firstAgentPreview !== s.finalAgentPreview;
    // Top tools aggregated summary line (up to 3 entries)
    const topTools = s.toolNames
      .slice(0, 3)
      .map((t) =>
        t.count > 1 ? `${shortenToolName(t.name)} ×${t.count}` : shortenToolName(t.name),
      )
      .join(" · ");

    return (
      <div
        style={{
          position: "absolute",
          ...posStyle,
          zIndex: 100,
          background: "#0F172A",
          color: "#F1F5F9",
          borderRadius: 10,
          padding: "12px 14px",
          fontSize: 11,
          pointerEvents: "none",
          boxShadow: "0 6px 24px rgba(15,23,42,0.22)",
          maxWidth: 440,
          minWidth: 280,
          lineHeight: 1.45,
        }}
      >
        {/* Header: Turn pill + start→end range */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 4,
              background: theme.mini,
              color: "#fff",
            }}
          >
            Turn
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              opacity: 0.7,
            }}
          >
            {endOff ? `${startOff} → ${endOff}` : startOff}
          </span>
          {dur && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                opacity: 0.55,
              }}
            >
              · {dur}
            </span>
          )}
        </div>

        {/* First agent message */}
        {s.firstAgentPreview && (
          <div
            style={{
              opacity: 0.95,
              fontWeight: 500,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              marginBottom: 6,
            }}
          >
            {s.firstAgentPreview}
          </div>
        )}

        {/* Middle: stats + top tools */}
        <div
          style={{
            fontSize: 10,
            opacity: 0.65,
            marginBottom: hasFirstLast ? 6 : 0,
            borderTop: s.firstAgentPreview ? "1px solid rgba(241,245,249,0.08)" : undefined,
            paddingTop: s.firstAgentPreview ? 6 : 0,
          }}
        >
          {s.agentMessages} msg · {s.toolCalls} tools
          {s.errors > 0 ? ` · ${s.errors} err` : ""}
          {topTools && (
            <>
              <span style={{ opacity: 0.5, margin: "0 4px" }}>·</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>{topTools}</span>
              {s.toolNames.length > 3 && (
                <span style={{ opacity: 0.65 }}> +{s.toolNames.length - 3}</span>
              )}
            </>
          )}
        </div>

        {/* Last agent message */}
        {hasFirstLast && s.finalAgentPreview && (
          <div
            style={{
              opacity: 0.92,
              display: "flex",
              gap: 6,
              alignItems: "flex-start",
              borderTop: "1px solid rgba(241,245,249,0.08)",
              paddingTop: 6,
            }}
          >
            <span style={{ opacity: 0.5 }}>→</span>
            <span
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {s.finalAgentPreview}
            </span>
          </div>
        )}
      </div>
    );
  }

  if (!row) return null;

  const theme = ROLE_THEMES[row.kind];
  const preview = rowPreview(row);

  return (
    <div
      style={{
        position: "absolute",
        ...posStyle,
        zIndex: 100,
        background: "#0F172A",
        color: "#F1F5F9",
        borderRadius: 10,
        padding: "10px 14px",
        fontSize: 11,
        pointerEvents: "none",
        boxShadow: "0 6px 24px rgba(15,23,42,0.22)",
        maxWidth: 360,
        minWidth: 220,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: "2px 8px",
            borderRadius: 4,
            background: theme.mini,
            color: "#fff",
          }}
        >
          {theme.label}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            opacity: 0.65,
          }}
        >
          {formatOffset(row.tOffsetMs)}
        </span>
      </div>
      <div
        style={{
          lineHeight: 1.45,
          opacity: 0.92,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {preview}
      </div>
    </div>
  );
}
