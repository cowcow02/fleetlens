"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import type { TimelineData, TeamTurn, TeamTrack, IdleBand } from "./adapter";
import { yOfMs } from "./adapter";

const HEADER_HEIGHT = 32;

const TIME_COL_WIDTH = 80;
const COL_GAP = 1;
const COL_MIN_WIDTH = 240;

export type SeekTarget = { tsMs: number; trackId?: string };

type Props = {
  data: TimelineData;
  onPlayheadChange: (tsMs: number | null) => void;
  scrollTarget: SeekTarget | null;
  onTurnClick: (turn: TeamTurn) => void;
};

export function TeamTable({ data, onPlayheadChange, scrollTarget, onTurnClick }: Props) {
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

  useEffect(() => {
    if (!scrollTarget || !scrollRef.current) return;
    const targetY = yOfMs(data.yAnchors, scrollTarget.tsMs);
    scrollRef.current.scrollTop = Math.max(0, targetY - 40);

    if (scrollTarget.trackId) {
      const colIndex = data.tracks.findIndex((t) => t.id === scrollTarget.trackId);
      if (colIndex !== -1) {
        const targetX = TIME_COL_WIDTH + colIndex * (COL_MIN_WIDTH + COL_GAP);
        const viewport = scrollRef.current.clientWidth;
        scrollRef.current.scrollLeft = Math.max(
          0,
          targetX - viewport / 2 + COL_MIN_WIDTH / 2,
        );
      }
    }
  }, [scrollTarget, data.yAnchors, data.tracks]);

  const onScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const top = scrollRef.current.scrollTop;
    const anchors = data.yAnchors;
    if (anchors.length === 0) {
      onPlayheadChange(null);
      return;
    }
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
  }, [data.yAnchors, onPlayheadChange]);

  const gridTemplate = `${TIME_COL_WIDTH}px repeat(${data.tracks.length}, minmax(${COL_MIN_WIDTH}px, 1fr))`;

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      style={{
        position: "relative",
        flex: 1,
        minHeight: 400,
        overflowY: "auto",
        overflowX: "auto",
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
              <div
                key={t.id}
                style={{
                  padding: 8,
                  fontSize: 11,
                  fontWeight: t.isLead ? 700 : 600,
                  color: t.color,
                  fontFamily: "ui-monospace, monospace",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  ...(stickyLead && {
                    position: "sticky",
                    left: TIME_COL_WIDTH + COL_GAP,
                    zIndex: 6,
                    background: "var(--af-surface-hover)",
                    borderRight: "1px solid var(--af-border-subtle)",
                  }),
                }}
                title={t.label}
              >
                {t.isLead ? "LEAD" : t.label}
              </div>
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
                      idle {formatIdle(gapMs)}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}

          {data.idleBands.map((band, i) => (
            <IdleBandStrip
              key={i}
              band={band}
              totalCols={data.tracks.length + 1}
            />
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
  const durationStr = formatDuration(turn.durationMs);

  const userText =
    turn.userPrompt && turn.userPrompt.kind === "user"
      ? (turn.userPrompt.displayPreview ?? turn.userPrompt.event.preview ?? "")
      : "";
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
        overflow: isExpanded ? "visible" : "hidden",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 4,
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

      {userText && (
        <div style={{ flexShrink: 0 }}>
          <div
            style={{
              fontSize: 8,
              color: track.color,
              fontWeight: 600,
              letterSpacing: "0.05em",
            }}
          >
            HUMAN
          </div>
          <div
            style={{
              color: "var(--af-text)",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            }}
          >
            {userText}
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
  );
}

function IdleBandStrip({
  band,
  totalCols: _totalCols,
}: {
  band: IdleBand;
  totalCols: number;
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
        zIndex: 1,
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
        {formatIdle(band.durationMs)} idle
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3600_000).toFixed(1)}h`;
}

function formatIdle(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m`;
  const h = Math.floor(ms / 3600_000);
  const m = Math.round((ms % 3600_000) / 60_000);
  return `${h}h ${m}m`;
}
