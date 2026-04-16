"use client";

import Link from "next/link";
import { useRef, useEffect, useCallback, useState } from "react";
import { ExternalLink } from "lucide-react";
import { formatGap } from "@/lib/format";
import type { TimelineData, TeamTurn, TeamTrack, IdleBand } from "./adapter";
import { yOfMs } from "./adapter";
import { formatTeammatePreview } from "./format";

const HEADER_HEIGHT = 32;

const TIME_COL_WIDTH = 80;
const COL_GAP = 1;
const COL_MIN_WIDTH = 240;

/** When the vertical scroll moves to a point where no visible member
 *  column has any turn active, auto-scroll horizontally to bring the
 *  leftmost active one into view — but only after this quiet period
 *  has elapsed since the user last manually scrolled horizontally, so
 *  manual pan isn't fought by the auto-scroll. */
const USER_HSCROLL_GRACE_MS = 800;
/** Minimum time between two consecutive auto-scrolls so a continuous
 *  vertical scroll through a blank stretch doesn't thrash horizontally. */
const AUTOSCROLL_COOLDOWN_MS = 1200;

export type SeekTarget = { tsMs: number; trackId?: string };

type Props = {
  data: TimelineData;
  onPlayheadChange: (tsMs: number | null) => void;
  /** Publishes which member track ids currently have their midpoint inside
   *  the visible horizontal viewport, in track order. Used by the parent
   *  to keep the sticky minimap's visible lanes in sync with whatever the
   *  user is looking at in the table. */
  onVisibleTrackIdsChange: (ids: string[]) => void;
  scrollTarget: SeekTarget | null;
  onTurnClick: (turn: TeamTurn) => void;
};

/** Programmatically scroll horizontally. The container has
 *  `scroll-behavior: smooth` set as a persistent inline style, so a
 *  plain scrollLeft assignment becomes a smooth animation driven by
 *  the browser. */
function smoothScrollLeft(el: HTMLElement, targetLeft: number): void {
  el.scrollLeft = targetLeft;
}

export function TeamTable({
  data,
  onPlayheadChange,
  onVisibleTrackIdsChange,
  scrollTarget,
  onTurnClick,
}: Props) {
  const lastVisibleIdsRef = useRef<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expandedTurns, setExpandedTurns] = useState<Set<string>>(new Set());
  const toggleExpand = useCallback((turnId: string) => {
    setExpandedTurns((prev) => {
      const next = new Set(prev);
      if (next.has(turnId)) next.delete(turnId);
      else next.add(turnId);
      return next;
    });
  }, []);

  // Track user vs. programmatic horizontal scroll, and cool-down the
  // auto-horizontal-scroll so a continuous vertical drag doesn't yank the
  // table left/right on every frame.
  const lastScrollTopRef = useRef(0);
  const lastScrollLeftRef = useRef(0);
  const lastUserHScrollRef = useRef(0);
  const lastAutoScrollRef = useRef(0);
  const programmaticLeftRef = useRef<number | null>(null);

  useEffect(() => {
    if (!scrollTarget || !scrollRef.current) return;
    const el = scrollRef.current;
    // Land the row a comfortable margin below the sticky column header
    // (HEADER_HEIGHT) so it's visible, not half-occluded.
    const rawY = yOfMs(data.yAnchors, scrollTarget.tsMs);
    const targetTop = Math.max(0, rawY - HEADER_HEIGHT - 12);

    let targetLeft = el.scrollLeft;
    if (scrollTarget.trackId) {
      const colIndex = data.tracks.findIndex((t) => t.id === scrollTarget.trackId);
      if (colIndex !== -1) {
        const targetColX = TIME_COL_WIDTH + colIndex * (COL_MIN_WIDTH + COL_GAP);
        const viewport = el.clientWidth;
        targetLeft = Math.max(
          0,
          targetColX - viewport / 2 + COL_MIN_WIDTH / 2,
        );
      }
    }
    // Single scrollTo for both axes so vertical and horizontal animate
    // together. Mark the horizontal target as programmatic so the
    // scroll listener's "user panned" grace timer doesn't fire.
    programmaticLeftRef.current = targetLeft;
    el.scrollTo({ top: targetTop, left: targetLeft, behavior: "smooth" });
  }, [scrollTarget, data.yAnchors, data.tracks]);

  const onScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const top = el.scrollTop;
    const left = el.scrollLeft;
    const dy = top - lastScrollTopRef.current;
    const dx = left - lastScrollLeftRef.current;
    lastScrollTopRef.current = top;
    lastScrollLeftRef.current = left;

    // Distinguish programmatic horizontal scroll (which we just triggered
    // ourselves) from a real user pan. Only the latter should reset the
    // "leave the user alone" timer.
    if (dx !== 0) {
      const wasProgrammatic =
        programmaticLeftRef.current !== null &&
        Math.abs(left - programmaticLeftRef.current) < 2;
      if (wasProgrammatic) programmaticLeftRef.current = null;
      else lastUserHScrollRef.current = Date.now();
    }

    const anchors = data.yAnchors;
    if (anchors.length === 0) {
      onPlayheadChange(null);
      return;
    }

    // Binary-search for the wall-clock ms at the top of the viewport.
    let lo = 0;
    let hi = anchors.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (anchors[mid]!.yPx <= top) lo = mid;
      else hi = mid;
    }
    const a = anchors[lo]!;
    const b = anchors[hi]!;
    let ts: number;
    if (b.yPx === a.yPx) ts = a.tsMs;
    else {
      const frac = (top - a.yPx) / (b.yPx - a.yPx);
      ts = a.tsMs + frac * (b.tsMs - a.tsMs);
    }
    onPlayheadChange(ts);

    // Compute which member columns have their midpoint inside the viewport
    // right now. Published on every scroll so the sticky minimap lanes can
    // stay in sync with whatever the user is looking at. Also reused below
    // for the blank-detection auto-scroll.
    const MEMBER_AREA_LEFT = TIME_COL_WIDTH + COL_MIN_WIDTH + COL_GAP * 2;
    const viewportW = el.clientWidth;
    const visibleMemberRangeStart = left + MEMBER_AREA_LEFT;
    const visibleMemberRangeEnd = left + viewportW;

    type MemberRange = { trackIdx: number; start: number; end: number };
    const memberRanges: MemberRange[] = [];
    for (let i = 1; i < data.tracks.length; i++) {
      const gridX = TIME_COL_WIDTH + i * (COL_MIN_WIDTH + COL_GAP);
      memberRanges.push({
        trackIdx: i,
        start: gridX,
        end: gridX + COL_MIN_WIDTH,
      });
    }
    // "Visible" means the column's midpoint is inside the viewport's member
    // area. A column that peeks in by a few pixels at the right edge doesn't
    // count — the user can't read a turn from a 30px-wide slice.
    const isVisible = (r: MemberRange) => {
      const mid = (r.start + r.end) / 2;
      return mid >= visibleMemberRangeStart && mid <= visibleMemberRangeEnd;
    };
    const visibleMembers = memberRanges.filter(isVisible);

    // Publish the current visible ids if they changed (string-compare via
    // joined key avoids churning React state on every scroll event).
    const visibleIds = visibleMembers.map(
      (r) => data.tracks[r.trackIdx]!.id,
    );
    const key = visibleIds.join(",");
    if (key !== lastVisibleIdsRef.current) {
      lastVisibleIdsRef.current = key;
      onVisibleTrackIdsChange(visibleIds);
    }

    // Auto-scroll: only on vertical movement, and only when the user hasn't
    // just panned horizontally themselves, and only when the cooldown has
    // elapsed. These guards prevent feedback loops and UX fights.
    if (dy === 0) return;
    const now = Date.now();
    if (now - lastUserHScrollRef.current < USER_HSCROLL_GRACE_MS) return;
    if (now - lastAutoScrollRef.current < AUTOSCROLL_COOLDOWN_MS) return;
    if (data.tracks.length <= 1) return;
    if (visibleMembers.length === 0) return;

    const hasTurnAtTs = (trackIdx: number) => {
      const turns = data.tracks[trackIdx]!.turns;
      if (turns.length === 0) return false;
      // Binary search — turns are sorted by startMs.
      let lo = 0;
      let hi = turns.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const t = turns[mid]!;
        if (t.endMs < ts) lo = mid + 1;
        else if (t.startMs > ts) hi = mid - 1;
        else return true;
      }
      return false;
    };
    const anyVisibleActive = visibleMembers.some((r) => hasTurnAtTs(r.trackIdx));
    if (anyVisibleActive) return;

    // Nothing visible has activity. Find the leftmost off-screen member that
    // IS active at this ts and animate the scroll so it lands right after
    // the sticky LEAD column.
    let targetIdx = -1;
    for (const r of memberRanges) {
      if (!isVisible(r) && hasTurnAtTs(r.trackIdx)) {
        targetIdx = r.trackIdx;
        break;
      }
    }
    if (targetIdx < 0) return;

    const targetX = TIME_COL_WIDTH + targetIdx * (COL_MIN_WIDTH + COL_GAP);
    const targetLeft = Math.max(0, targetX - MEMBER_AREA_LEFT - 8);
    lastAutoScrollRef.current = now;
    programmaticLeftRef.current = targetLeft;
    smoothScrollLeft(el, targetLeft);
  }, [data.tracks, data.yAnchors, onPlayheadChange, onVisibleTrackIdsChange]);

  const gridTemplate = `${TIME_COL_WIDTH}px repeat(${data.tracks.length}, minmax(${COL_MIN_WIDTH}px, 1fr))`;

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      data-team-scroll=""
      style={{
        position: "relative",
        flex: 1,
        minHeight: 400,
        overflowY: "auto",
        overflowX: "auto",
        // scroll-behavior: smooth on the container so that programmatic
        // scrollLeft/scrollTop assignments (and the blank-detection auto-
        // scroll) animate natively via the browser. User wheel scrolls are
        // NOT affected — Chrome only applies scroll-behavior to API-driven
        // scrolls (scrollTo, scrollBy, .scrollLeft= , etc.), not to wheel
        // or touch input. So manual panning stays direct.
        scrollBehavior: "smooth",
        border: "1px solid var(--af-border-subtle)",
        borderRadius: 6,
        background: "var(--af-surface-elevated)",
      }}
    >
      <div
        style={{
          position: "relative",
          width:
            TIME_COL_WIDTH + data.tracks.length * (COL_MIN_WIDTH + COL_GAP),
          minWidth: "100%",
          height: data.totalHeightPx + 72,
        }}
      >
        <div
          style={{
            position: "sticky",
            top: 0,
            display: "grid",
            gridTemplateColumns: gridTemplate,
            gap: COL_GAP,
            background: "var(--af-surface-hover)",
            borderBottom: "1px solid var(--af-border-subtle)",
            zIndex: 5,
            height: 32,
          }}
        >
          <div
            style={{
              padding: 8,
              fontSize: 9,
              color: "var(--af-text-tertiary)",
              fontFamily: "ui-monospace, monospace",
              textTransform: "uppercase",
              position: "sticky",
              left: 0,
              zIndex: 7,
              background: "var(--af-surface-hover)",
              borderRight: "1px solid var(--af-border-subtle)",
            }}
          >
            Time
          </div>
          {data.tracks.map((t, idx) => {
            const stickyLead = idx === 0;
            return (
              <Link
                key={t.id}
                href={`/sessions/${t.id}`}
                style={{
                  padding: 8,
                  fontSize: 11,
                  fontWeight: t.isLead ? 700 : 600,
                  color: t.color,
                  fontFamily: "ui-monospace, monospace",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  textDecoration: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  ...(stickyLead && {
                    position: "sticky",
                    left: TIME_COL_WIDTH + COL_GAP,
                    zIndex: 6,
                    background: "var(--af-surface-hover)",
                    borderRight: "1px solid var(--af-border-subtle)",
                  }),
                }}
                title={`${t.label} — open session`}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {t.isLead ? "LEAD" : t.label}
                </span>
                <ExternalLink size={10} style={{ opacity: 0.6, flexShrink: 0 }} />
              </Link>
            );
          })}
        </div>

        <div
          style={{
            position: "relative",
            display: "grid",
            gridTemplateColumns: gridTemplate,
            gap: COL_GAP,
          }}
        >
          <div
            style={{
              position: "sticky",
              left: 0,
              zIndex: 4,
              background: "var(--af-surface-elevated)",
              height: data.totalHeightPx + 20,
              borderRight: "1px solid var(--af-border-subtle)",
            }}
          >
            {data.timeTicks.map((tick, i) => (
              <div
                key={i}
                title={formatFullTimestamp(tick.tsMs)}
                style={{
                  position: "absolute",
                  top: tick.yPx,
                  left: 0,
                  right: 0,
                  fontSize: 9,
                  color: "var(--af-text-tertiary)",
                  fontFamily: "ui-monospace, monospace",
                  paddingLeft: 6,
                  paddingTop: 2,
                  borderTop: "1px solid var(--af-border-subtle)",
                }}
              >
                {tick.label}
              </div>
            ))}
          </div>

          {data.tracks.map((track, trackIdx) => (
            <div
              key={track.id}
              style={{
                position: trackIdx === 0 ? "sticky" : "relative",
                ...(trackIdx === 0 && {
                  left: TIME_COL_WIDTH + COL_GAP,
                  zIndex: 3,
                  background: "var(--af-surface-elevated)",
                }),
                height: data.totalHeightPx + 20,
                borderRight: "1px solid var(--af-border-subtle)",
              }}
            >
              {track.turns.map((turn) => {
                const top = yOfMs(data.yAnchors, turn.startMs);
                const bottom = yOfMs(data.yAnchors, turn.endMs);
                const height = Math.max(40, bottom - top - 4);
                return (
                  <TurnCell
                    key={turn.id}
                    turn={turn}
                    track={track}
                    top={top}
                    height={height}
                    onClick={() => onTurnClick(turn)}
                    isExpanded={expandedTurns.has(turn.id)}
                    onToggleExpand={() => toggleExpand(turn.id)}
                  />
                );
              })}
              {track.turns.slice(1).map((turn, i) => {
                const prev = track.turns[i]!;
                const gapMs = turn.startMs - prev.endMs;
                if (gapMs <= 0) return null;
                // Skip if fully inside a team-wide idle band (hatch already covers it)
                const coveredByTeamIdle = data.idleBands.some(
                  (b) => b.startMs <= prev.endMs && b.endMs >= turn.startMs,
                );
                if (coveredByTeamIdle) return null;
                const top = yOfMs(data.yAnchors, prev.endMs);
                const bottom = yOfMs(data.yAnchors, turn.startMs);
                const gapHeight = bottom - top;
                if (gapHeight <= 40) return null;
                return (
                  <div
                    key={`idle-${prev.id}-${turn.id}`}
                    title={`${formatFullTimestamp(prev.endMs)} → ${formatFullTimestamp(turn.startMs)}`}
                    style={{
                      position: "absolute",
                      top: top + 2,
                      left: 8,
                      right: 8,
                      height: gapHeight - 4,
                      pointerEvents: "none",
                      zIndex: 0,
                    }}
                  >
                    <span
                      style={{
                        position: "sticky",
                        top: HEADER_HEIGHT + 6,
                        display: "inline-block",
                        fontSize: 10,
                        fontStyle: "italic",
                        fontFamily: "ui-monospace, monospace",
                        color: "var(--af-text-tertiary)",
                      }}
                    >
                      idle {formatGap(gapMs)}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}

          {data.idleBands.map((band, i) => (
            <IdleBandStrip key={i} band={band} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TurnCell({
  turn,
  track,
  top,
  height,
  onClick,
  isExpanded,
  onToggleExpand,
}: {
  turn: TeamTurn;
  track: TeamTrack;
  top: number;
  height: number;
  onClick: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const [hover, setHover] = useState(false);
  const summary = turn.megaRow.summary;
  const durationStr = formatGap(turn.durationMs);

  const tmMsg =
    turn.userPrompt && "event" in turn.userPrompt
      ? turn.userPrompt.event.teammateMessage
      : undefined;
  const userText =
    turn.userPrompt && turn.userPrompt.kind === "user"
      ? (turn.userPrompt.displayPreview ?? turn.userPrompt.event.preview ?? "")
      : "";
  const userLabel = tmMsg
    ? `FROM ${tmMsg.teammateId}`
    : "HUMAN";
  const userPreview = tmMsg
    ? formatTeammatePreview(tmMsg)
    : userText;
  const firstAgent = summary.firstAgentPreview ?? "";
  const finalAgent = summary.finalAgentPreview ?? "";
  const showFinal = !!finalAgent && finalAgent !== firstAgent;
  const tools = summary.toolNames.slice(0, 5);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "absolute",
        top: top + 2,
        left: 4,
        right: 4,
        height: isExpanded ? "auto" : height,
        minHeight: isExpanded ? Math.max(height, 160) : undefined,
        background: hover ? "var(--af-surface-hover)" : "var(--af-surface)",
        borderLeft: `3px solid ${track.color}`,
        border: "1px solid var(--af-border-subtle)",
        borderLeftWidth: 3,
        borderRadius: 4,
        padding: "6px 8px",
        fontSize: 10,
        lineHeight: 1.3,
        // IMPORTANT: `overflow: hidden` creates a new scroll container in
        // Chrome, which would make the inner sticky content stick to the
        // cell instead of the team table's scroll viewport. Use clip-path
        // for visual clipping — it's paint-only and doesn't break sticky
        // propagation up to the real scroll ancestor.
        overflow: "visible",
        clipPath: isExpanded ? "none" : "inset(0)",
        boxSizing: "border-box",
        cursor: "pointer",
        outline: isExpanded
          ? `1px solid ${track.color}`
          : hover
            ? `1px solid ${track.color}`
            : "none",
        boxShadow: isExpanded ? "0 4px 16px rgba(0,0,0,0.18)" : undefined,
        zIndex: isExpanded ? 5 : undefined,
        transition: "background 0.1s ease",
      }}
    >
      {/* Sticky inner wrapper — pins the content just below the sticky
          column header row so text stays readable while the tall cell
          scrolls past. The nearest scroll ancestor is the table scrollRef. */}
      <div
        style={{
          position: "sticky",
          top: HEADER_HEIGHT + 8,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 6,
          fontSize: 9,
          color: "var(--af-text-tertiary)",
          fontFamily: "ui-monospace, monospace",
          flexShrink: 0,
        }}
      >
        <span>
          {summary.agentMessages} msg · {summary.toolCalls} tools
          {summary.errors > 0 ? ` · ${summary.errors} err` : ""}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span>{durationStr}</span>
          <button
            data-turn-toggle
            aria-label={isExpanded ? "Collapse" : "Expand"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            style={{
              background: "transparent",
              border: "1px solid var(--af-border-subtle)",
              color: "var(--af-text-secondary)",
              width: 16,
              height: 16,
              borderRadius: 2,
              fontSize: 9,
              lineHeight: 1,
              cursor: "pointer",
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {isExpanded ? "▲" : "▼"}
          </button>
        </span>
      </div>

      {userPreview && (
        <div style={{ flexShrink: 0 }}>
          <div
            style={{
              fontSize: 8,
              color: tmMsg ? "var(--af-text-tertiary)" : track.color,
              fontWeight: 600,
              letterSpacing: "0.05em",
              fontStyle: tmMsg ? "italic" : undefined,
            }}
          >
            {userLabel}
          </div>
          <div
            style={{
              color: tmMsg ? "var(--af-text-tertiary)" : "var(--af-text)",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            }}
          >
            {userPreview}
          </div>
        </div>
      )}

      {firstAgent && (
        <div style={{ flexShrink: 0, minHeight: 0 }}>
          <div
            style={{
              fontSize: 8,
              color: track.color,
              fontWeight: 600,
              letterSpacing: "0.05em",
            }}
          >
            AGENT
          </div>
          <div
            style={
              isExpanded
                ? {
                    color: "var(--af-text)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }
                : {
                    color: "var(--af-text)",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }
            }
          >
            {firstAgent}
          </div>
        </div>
      )}

      {tools.length > 0 && (
        <div style={{ display: "flex", gap: 3, flexWrap: "wrap", flexShrink: 0 }}>
          {tools.map((t) => (
            <span
              key={t.name}
              style={{
                fontSize: 8,
                padding: "1px 5px",
                background: "var(--af-surface-hover)",
                borderRadius: 2,
                color: "var(--af-text-tertiary)",
              }}
            >
              {t.name}
              {t.count > 1 ? ` ×${t.count}` : ""}
            </span>
          ))}
        </div>
      )}

      {showFinal && (isExpanded || height > 120) && (
        <div style={{ flexShrink: 0, minHeight: 0 }}>
          <div
            style={{
              fontSize: 8,
              color: track.color,
              fontWeight: 600,
              letterSpacing: "0.05em",
            }}
          >
            RESULT
          </div>
          <div
            style={
              isExpanded
                ? {
                    color: "var(--af-text)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }
                : {
                    color: "var(--af-text)",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }
            }
          >
            {finalAgent}
          </div>
        </div>
      )}

      {!userText && !firstAgent && (
        <div style={{ color: "var(--af-text-tertiary)", fontStyle: "italic" }}>
          (no preview)
        </div>
      )}
      </div>
    </div>
  );
}

function IdleBandStrip({
  band,
}: {
  band: IdleBand;
}) {
  return (
    <div
      title={`${formatFullTimestamp(band.startMs)} → ${formatFullTimestamp(band.endMs)}`}
      style={{
        position: "absolute",
        top: band.yPx,
        left: 0,
        right: 0,
        height: band.heightPx,
        background:
          "repeating-linear-gradient(135deg, var(--af-surface) 0, var(--af-surface) 6px, var(--af-surface-hover) 6px, var(--af-surface-hover) 12px)",
        borderTop: "1px solid var(--af-border-subtle)",
        borderBottom: "1px solid var(--af-border-subtle)",
        // Above sticky TIME col (zIndex:4) and sticky LEAD col (zIndex:3) so
        // the hatched pattern is continuous across the full width. Still
        // below the sticky column-header row (zIndex:5) so the header wins.
        zIndex: 4,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "sticky",
          left: "50%",
          top: 0,
          height: "100%",
          width: "fit-content",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 9,
          color: "var(--af-text-tertiary)",
          fontFamily: "ui-monospace, monospace",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          whiteSpace: "nowrap",
          padding: "0 8px",
          background: "var(--af-surface-elevated)",
          borderRadius: 3,
        }}
      >
        {formatGap(band.durationMs)} idle
      </div>
    </div>
  );
}

function formatFullTimestamp(tsMs: number): string {
  return new Date(tsMs).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

