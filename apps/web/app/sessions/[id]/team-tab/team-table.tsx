"use client";

import { useRef, useEffect, useCallback } from "react";
import type { TimelineData, TeamTurn, TeamTrack, IdleBand } from "./adapter";
import { yOfMs } from "./adapter";

const TIME_COL_WIDTH = 80;
const COL_GAP = 1;
const COL_MIN_WIDTH = 240;

type Props = {
  data: TimelineData;
  onPlayheadChange: (tsMs: number | null) => void;
  scrollTargetMs: number | null;
};

export function TeamTable({ data, onPlayheadChange, scrollTargetMs }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollTargetMs == null || !scrollRef.current) return;
    const targetY = yOfMs(data.yAnchors, scrollTargetMs);
    scrollRef.current.scrollTop = Math.max(0, targetY - 40);
  }, [scrollTargetMs, data.yAnchors]);

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
            }}
          >
            Time
          </div>
          {data.tracks.map((t) => (
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
              }}
              title={t.label}
            >
              {t.isLead ? "LEAD" : t.label}
            </div>
          ))}
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
              position: "relative",
              height: data.totalHeightPx + 20,
              borderRight: "1px solid var(--af-border-subtle)",
            }}
          >
            {data.timeTicks.map((tick, i) => (
              <div
                key={i}
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

          {data.tracks.map((track) => (
            <div
              key={track.id}
              style={{
                position: "relative",
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
                  />
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
}: {
  turn: TeamTurn;
  track: TeamTrack;
  top: number;
  height: number;
}) {
  const summary = turn.megaRow.summary;
  const preview = summary.firstAgentPreview ?? summary.finalAgentPreview ?? "";
  const tools = summary.toolNames.slice(0, 4);
  const durationStr = formatDuration(turn.durationMs);

  return (
    <div
      style={{
        position: "absolute",
        top: top + 2,
        left: 4,
        right: 4,
        height,
        background: "var(--af-surface)",
        borderLeft: `3px solid ${track.color}`,
        border: "1px solid var(--af-border-subtle)",
        borderLeftWidth: 3,
        borderRadius: 4,
        padding: "6px 8px",
        fontSize: 10,
        lineHeight: 1.4,
        overflow: "hidden",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 9,
          color: "var(--af-text-tertiary)",
          fontFamily: "ui-monospace, monospace",
        }}
      >
        <span>
          {summary.agentMessages} msg · {summary.toolCalls} tools
          {summary.errors > 0 ? ` · ${summary.errors} err` : ""}
        </span>
        <span>{durationStr}</span>
      </div>
      <div
        style={{
          color: "var(--af-text)",
          flex: 1,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: Math.max(2, Math.floor((height - 60) / 14)),
          WebkitBoxOrient: "vertical",
          textOverflow: "ellipsis",
        }}
      >
        {preview || (
          <span
            style={{ color: "var(--af-text-tertiary)", fontStyle: "italic" }}
          >
            (no preview)
          </span>
        )}
      </div>
      {tools.length > 0 && height > 90 && (
        <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
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
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 9,
        color: "var(--af-text-tertiary)",
        fontFamily: "ui-monospace, monospace",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        zIndex: 1,
        pointerEvents: "none",
      }}
    >
      {formatIdle(band.durationMs)} idle
    </div>
  );
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
