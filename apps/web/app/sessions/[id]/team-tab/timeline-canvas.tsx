"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import type { TimelineData, TeamTurn } from "./adapter";

type Props = {
  data: TimelineData;
  onTurnClick: (turn: TeamTurn) => void;
};

const LANE_HEIGHT = 96;
const LANE_LABEL_WIDTH = 140;
const MINIMAP_HEIGHT = 28;
const RULER_HEIGHT = 22;
const MIN_ZOOM = 1;
const MAX_ZOOM = 200;

export function TimelineCanvas({ data, onTurnClick }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [scrollX, setScrollX] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 800;
      setContainerWidth(Math.max(400, w - LANE_LABEL_WIDTH));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const span = Math.max(1, data.lastEventMs - data.firstEventMs);
  const basePxPerMs = containerWidth / span;
  const pxPerMs = basePxPerMs * zoom;
  const contentWidth = span * pxPerMs;

  const toX = useCallback(
    (tsMs: number) => (tsMs - data.firstEventMs) * pxPerMs,
    [data.firstEventMs, pxPerMs],
  );

  const onScroll = useCallback(() => {
    if (!scrollRef.current) return;
    setScrollX(scrollRef.current.scrollLeft);
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const el = scrollRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left + el.scrollLeft;
      const anchorMs = data.firstEventMs + cursorX / pxPerMs;
      const delta = -e.deltaY * 0.002;
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (1 + delta)));
      setZoom(nextZoom);
      requestAnimationFrame(() => {
        if (!scrollRef.current) return;
        const nextPxPerMs = basePxPerMs * nextZoom;
        const nextCursorX = (anchorMs - data.firstEventMs) * nextPxPerMs;
        scrollRef.current.scrollLeft = nextCursorX - (e.clientX - rect.left);
      });
    },
    [zoom, pxPerMs, basePxPerMs, data.firstEventMs],
  );

  const [dragStart, setDragStart] = useState<{ x: number; scroll: number } | null>(null);
  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-turn-block]")) return;
    if (!scrollRef.current) return;
    setDragStart({ x: e.clientX, scroll: scrollRef.current.scrollLeft });
  };
  useEffect(() => {
    if (!dragStart) return;
    const onMove = (e: MouseEvent) => {
      if (!scrollRef.current) return;
      scrollRef.current.scrollLeft = dragStart.scroll - (e.clientX - dragStart.x);
    };
    const onUp = () => setDragStart(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragStart]);

  const ruler = useMemo(() => {
    const visibleMs = containerWidth / pxPerMs;
    const targetTicks = 8;
    const rawInterval = visibleMs / targetTicks;
    const nice = pickNiceInterval(rawInterval);
    const ticks: { tsMs: number; label: string }[] = [];
    const first = Math.ceil(data.firstEventMs / nice) * nice;
    for (let t = first; t <= data.lastEventMs; t += nice) {
      ticks.push({ tsMs: t, label: formatTime(t, nice) });
    }
    return ticks;
  }, [containerWidth, pxPerMs, data.firstEventMs, data.lastEventMs]);

  const minimapScale = (containerWidth - 2) / span;
  const viewportLeft = (scrollX / pxPerMs) * minimapScale;
  const viewportWidth = Math.min(containerWidth, (containerWidth / pxPerMs) * minimapScale);

  const onMinimapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!scrollRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const targetMs = data.firstEventMs + clickX / minimapScale;
    const targetPx = (targetMs - data.firstEventMs) * pxPerMs;
    scrollRef.current.scrollLeft = targetPx - containerWidth / 2;
  };

  return (
    <div
      ref={containerRef}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
        border: "1px solid var(--af-border-subtle)",
        borderRadius: 6,
        background: "var(--af-surface-elevated)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid var(--af-border-subtle)",
          fontSize: 11,
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {data.tracks.map((t) => (
            <span key={t.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 10, height: 10, background: t.color, borderRadius: 2 }} />
              <span style={{ color: "var(--af-text-tertiary)" }}>
                {t.isLead ? "LEAD" : t.label}
              </span>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => {
              setZoom(MIN_ZOOM);
              if (scrollRef.current) scrollRef.current.scrollLeft = 0;
            }}
            style={{
              fontSize: 10,
              padding: "2px 8px",
              border: "1px solid var(--af-border-subtle)",
              borderRadius: 4,
              background: "transparent",
              color: "var(--af-text-tertiary)",
              cursor: "pointer",
            }}
          >
            Fit
          </button>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.5}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            style={{ width: 140 }}
          />
          <span style={{ fontSize: 10, color: "var(--af-text-tertiary)", minWidth: 40 }}>
            {zoom.toFixed(1)}x
          </span>
        </div>
      </div>

      <div
        onClick={onMinimapClick}
        style={{
          position: "relative",
          height: MINIMAP_HEIGHT,
          background: "var(--af-surface-hover)",
          borderBottom: "1px solid var(--af-border-subtle)",
          cursor: "pointer",
          margin: "0 1px",
        }}
      >
        {data.tracks.map((t, i) => {
          const laneHeight = MINIMAP_HEIGHT / Math.max(1, data.tracks.length);
          return (
            <div key={t.id}>
              {t.turns.map((turn) => {
                const left = (turn.startMs - data.firstEventMs) * minimapScale;
                const width = Math.max(1, (turn.endMs - turn.startMs) * minimapScale);
                return (
                  <div
                    key={turn.id}
                    style={{
                      position: "absolute",
                      left,
                      top: i * laneHeight,
                      width,
                      height: laneHeight - 1,
                      background: t.color,
                      opacity: 0.75,
                    }}
                  />
                );
              })}
            </div>
          );
        })}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: viewportLeft,
            width: viewportWidth,
            height: "100%",
            border: "1px solid var(--af-text)",
            background: "rgba(255,255,255,0.06)",
            pointerEvents: "none",
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          borderBottom: "1px solid var(--af-border-subtle)",
          background: "var(--af-surface-hover)",
        }}
      >
        <div
          style={{
            width: LANE_LABEL_WIDTH,
            borderRight: "1px solid var(--af-border-subtle)",
          }}
        />
        <div style={{ flex: 1, position: "relative", height: RULER_HEIGHT, overflow: "hidden" }}>
          <div
            style={{
              position: "relative",
              width: contentWidth,
              height: "100%",
              transform: `translateX(${-scrollX}px)`,
            }}
          >
            {ruler.map((tick, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: toX(tick.tsMs),
                  top: 0,
                  fontSize: 9,
                  color: "var(--af-text-tertiary)",
                  fontFamily: "ui-monospace, monospace",
                  paddingLeft: 2,
                  borderLeft: "1px solid var(--af-border-subtle)",
                  height: "100%",
                  whiteSpace: "nowrap",
                }}
              >
                {tick.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", position: "relative" }}>
        <div
          style={{
            width: LANE_LABEL_WIDTH,
            flexShrink: 0,
            borderRight: "1px solid var(--af-border-subtle)",
          }}
        >
          {data.tracks.map((t) => (
            <div
              key={t.id}
              style={{
                height: LANE_HEIGHT,
                padding: "8px 12px",
                borderBottom: "1px solid var(--af-border-subtle)",
                fontSize: 11,
                fontFamily: "ui-monospace, monospace",
                color: t.color,
                fontWeight: t.isLead ? 600 : 500,
                display: "flex",
                alignItems: "center",
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
          ref={scrollRef}
          onScroll={onScroll}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          style={{
            flex: 1,
            overflowX: "auto",
            overflowY: "hidden",
            cursor: dragStart ? "grabbing" : "grab",
          }}
        >
          <div
            style={{
              position: "relative",
              width: contentWidth,
              height: data.tracks.length * LANE_HEIGHT,
            }}
          >
            {data.tracks.map((t, i) => (
              <div
                key={t.id}
                style={{
                  position: "absolute",
                  top: i * LANE_HEIGHT,
                  left: 0,
                  right: 0,
                  height: LANE_HEIGHT,
                  borderBottom: "1px solid var(--af-border-subtle)",
                }}
              >
                {t.turns.map((turn) => (
                  <TurnBlock
                    key={turn.id}
                    turn={turn}
                    left={toX(turn.startMs)}
                    width={Math.max(4, (turn.endMs - turn.startMs) * pxPerMs)}
                    onClick={() => onTurnClick(turn)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TurnBlock({
  turn,
  left,
  width,
  onClick,
}: {
  turn: TeamTurn;
  left: number;
  width: number;
  onClick: () => void;
}) {
  const narrow = width < 80;
  const summary = turn.megaRow.summary;
  const durationStr = formatDuration(turn.endMs - turn.startMs);
  const preview = summary.firstAgentPreview ?? summary.finalAgentPreview ?? "";
  const tools = summary.toolNames.slice(0, 3);

  return (
    <div
      data-turn-block
      onClick={onClick}
      title={preview}
      style={{
        position: "absolute",
        top: 6,
        left,
        width,
        height: LANE_HEIGHT - 14,
        background: "var(--af-surface)",
        borderLeft: `3px solid ${turn.agentColor}`,
        borderTop: "1px solid var(--af-border-subtle)",
        borderRight: "1px solid var(--af-border-subtle)",
        borderBottom: "1px solid var(--af-border-subtle)",
        borderRadius: 3,
        padding: narrow ? 2 : "4px 6px",
        fontSize: 10,
        lineHeight: 1.3,
        overflow: "hidden",
        cursor: "pointer",
        boxSizing: "border-box",
      }}
    >
      {narrow ? (
        <div
          style={{
            fontSize: 9,
            color: "var(--af-text-tertiary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {durationStr}
        </div>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 9,
              color: "var(--af-text-tertiary)",
              marginBottom: 2,
            }}
          >
            <span>
              {summary.agentMessages} msg · {summary.toolCalls} tools
            </span>
            <span>{durationStr}</span>
          </div>
          <div
            style={{
              color: "var(--af-text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {preview}
          </div>
          {tools.length > 0 && width > 160 && (
            <div
              style={{
                display: "flex",
                gap: 3,
                marginTop: 3,
                flexWrap: "wrap",
              }}
            >
              {tools.map((t) => (
                <span
                  key={t.name}
                  style={{
                    fontSize: 8,
                    padding: "1px 4px",
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
        </>
      )}
    </div>
  );
}

function pickNiceInterval(rawMs: number): number {
  const intervals = [
    1000, 5000, 10_000, 30_000,
    60_000, 5 * 60_000, 10 * 60_000, 30 * 60_000,
    3600_000, 2 * 3600_000, 6 * 3600_000, 12 * 3600_000,
    86_400_000,
  ];
  for (const i of intervals) if (i >= rawMs) return i;
  return intervals[intervals.length - 1]!;
}

function formatTime(ms: number, interval: number): string {
  const d = new Date(ms);
  if (interval >= 86_400_000) {
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  if (interval >= 3600_000) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3600_000).toFixed(1)}h`;
}
