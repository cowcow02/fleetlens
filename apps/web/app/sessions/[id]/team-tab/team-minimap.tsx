"use client";

import { useState } from "react";
import type { TimelineData, TeamTrack, TeamTurn } from "./adapter";
import { xOfMs, msOfXFrac } from "./adapter";

const LANE_HEIGHT = 24;
const LANE_GAP = 2;
const LABEL_WIDTH = 100;
export const DEFAULT_VISIBLE_LANES = 4;

type Props = {
  data: TimelineData;
  playheadMs: number | null;
  onSeek: (tsMs: number, trackId?: string) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
};

type HoverState = {
  turn: TeamTurn;
  track: TeamTrack;
  clientX: number;
  clientY: number;
};

export function TeamMinimap({
  data,
  playheadMs,
  onSeek,
  expanded,
  onToggleExpanded,
}: Props) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const hasOverflow = data.tracks.length > DEFAULT_VISIBLE_LANES;
  const visibleTracks =
    hasOverflow && !expanded
      ? data.tracks.slice(0, DEFAULT_VISIBLE_LANES)
      : data.tracks;
  const hiddenCount = data.tracks.length - DEFAULT_VISIBLE_LANES;

  // Event-anchored x-scale — active intervals stay proportional with a floor,
  // all-idle intervals (including multi-day overnight gaps) collapse into
  // compact bands. Shared across lanes so cross-agent alignment holds.
  const xOf = (ms: number) => xOfMs(data.xAnchors, ms);

  const onLaneClick = (
    track: TeamTrack,
    e: React.MouseEvent<HTMLDivElement>,
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, e.clientX - rect.left);
    const frac = Math.min(1, x / Math.max(1, rect.width));
    onSeek(msOfXFrac(data.xAnchors, frac), track.id);
  };

  const playheadFrac =
    playheadMs != null
      ? Math.max(0, Math.min(1, xOf(playheadMs)))
      : null;

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        background: "var(--af-surface-elevated)",
        border: "1px solid var(--af-border-subtle)",
        borderRadius: 6,
        padding: 8,
        marginBottom: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 9,
          color: "var(--af-text-tertiary)",
          fontFamily: "ui-monospace, monospace",
          marginBottom: 6,
          paddingLeft: LABEL_WIDTH,
        }}
      >
        <span>{formatEdge(data.firstEventMs, data.multiDay)}</span>
        <span>{formatEdge(data.lastEventMs, data.multiDay)}</span>
      </div>

      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: LANE_GAP,
        }}
      >
        {/* Hatched idle bands spanning all lanes. Positioned as an overlay
            so they line up exactly with the lane strips' x axis (both use
            the shared xOfMs scale). */}
        {data.minimapIdleBands.map((band, i) => {
          const left = band.xFracStart * 100;
          const width = Math.max(0.5, (band.xFracEnd - band.xFracStart) * 100);
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `calc(${LABEL_WIDTH}px + ${left}% * (100% - ${LABEL_WIDTH}px) / 100%)`,
                width: `calc(${width}% * (100% - ${LABEL_WIDTH}px) / 100%)`,
                background:
                  "repeating-linear-gradient(135deg, transparent 0, transparent 4px, var(--af-border-subtle) 4px, var(--af-border-subtle) 6px)",
                zIndex: 1,
                cursor: "help",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 9,
                fontFamily: "ui-monospace, monospace",
                color: "var(--af-text-tertiary)",
                textAlign: "center",
                whiteSpace: "nowrap",
                overflow: "hidden",
              }}
              title={band.label}
            >
              {width > 3 ? band.label : ""}
            </div>
          );
        })}
        {visibleTracks.map((t) => (
          <div
            key={t.id}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <div
              style={{
                width: LABEL_WIDTH - 6,
                fontSize: 10,
                fontFamily: "ui-monospace, monospace",
                color: t.color,
                fontWeight: t.isLead ? 700 : 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={t.label}
            >
              {t.isLead ? "LEAD" : t.label}
            </div>
            <div
              style={{
                flex: 1,
                position: "relative",
                height: LANE_HEIGHT,
                background: "var(--af-surface-hover)",
                borderRadius: 3,
                overflow: "hidden",
                cursor: "pointer",
                padding: "3px 2px",
                boxSizing: "border-box",
              }}
              onClick={(e) => onLaneClick(t, e)}
            >
              {t.turns.map((turn) => {
                const leftFrac = xOf(turn.startMs);
                const rightFrac = xOf(turn.endMs);
                const left = leftFrac * 100;
                const width = Math.max(0.4, (rightFrac - leftFrac) * 100);
                return (
                  <div
                    key={turn.id}
                    style={{
                      position: "absolute",
                      left: `calc(${left}% + 1px)`,
                      top: 3,
                      width: `calc(${width}% - 2px)`,
                      minWidth: 4,
                      height: LANE_HEIGHT - 10,
                      background: t.color,
                      opacity: 0.88,
                      borderRadius: 3,
                      border: `1px solid ${t.color}`,
                      boxSizing: "border-box",
                    }}
                    onMouseEnter={(e) =>
                      setHover({
                        turn,
                        track: t,
                        clientX: e.clientX,
                        clientY: e.clientY,
                      })
                    }
                    onMouseMove={(e) =>
                      setHover((h) =>
                        h && h.turn.id === turn.id
                          ? { ...h, clientX: e.clientX, clientY: e.clientY }
                          : h,
                      )
                    }
                    onMouseLeave={() => setHover(null)}
                  />
                );
              })}
              {t.subagents.map((sa, i) => {
                if (sa.startMs == null) return null;
                const startFrac = xOf(sa.startMs);
                const endFrac = xOf(
                  sa.startMs + (sa.durationMs ?? 0),
                );
                const left = startFrac * 100;
                const w = Math.max(0.2, (endFrac - startFrac) * 100) || 0.4;
                return (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      left: `${left}%`,
                      bottom: 2,
                      width: `${w}%`,
                      height: 3,
                      background: t.color,
                      opacity: 0.5,
                      borderRadius: 1,
                    }}
                    title={`subagent: ${sa.agentType}`}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {hasOverflow && (
        <div
          style={{
            marginTop: 6,
            paddingLeft: LABEL_WIDTH + 6,
            display: "flex",
          }}
        >
          <button
            onClick={onToggleExpanded}
            style={{
              background: "var(--af-surface-hover)",
              border: "1px solid var(--af-border-subtle)",
              color: "var(--af-text-secondary)",
              fontSize: 10,
              fontFamily: "ui-monospace, monospace",
              padding: "2px 8px",
              borderRadius: 10,
              cursor: "pointer",
              lineHeight: 1.4,
            }}
          >
            {expanded
              ? "Show fewer"
              : `+ ${hiddenCount} more agent${hiddenCount === 1 ? "" : "s"} — show all`}
          </button>
        </div>
      )}

      {/* Playhead lives in an overlay that starts AFTER the label column so
          the % coordinate matches the strips exactly. */}
      {playheadFrac != null && (
        <div
          style={{
            position: "absolute",
            top: 24,
            bottom: 8,
            left: LABEL_WIDTH + 6,
            right: 8,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${playheadFrac * 100}%`,
              width: 1,
              background: "var(--af-text)",
              opacity: 0.7,
            }}
          />
        </div>
      )}

      {hover && <HoverCard hover={hover} multiDay={data.multiDay} />}
    </div>
  );
}

function HoverCard({
  hover,
  multiDay,
}: {
  hover: HoverState;
  multiDay: boolean;
}) {
  const { turn, track } = hover;
  const summary = turn.megaRow.summary;
  const userText =
    turn.userPrompt && turn.userPrompt.kind === "user"
      ? (turn.userPrompt.displayPreview ?? turn.userPrompt.event.preview ?? "")
      : "";
  const firstAgent = summary.firstAgentPreview ?? "";
  const finalAgent = summary.finalAgentPreview ?? "";
  const showFinal = finalAgent && finalAgent !== firstAgent;
  const tools = summary.toolNames.slice(0, 4);

  // Position card near the cursor, biased above-and-right to avoid covering
  // the bar itself. Clamp to viewport via simple offsets.
  const left = Math.min(window.innerWidth - 360, hover.clientX + 12);
  const top = Math.max(8, hover.clientY - 12);

  return (
    <div
      style={{
        position: "fixed",
        left,
        top,
        width: 340,
        background: "var(--af-surface)",
        border: "1px solid var(--af-border-subtle)",
        borderLeft: `3px solid ${track.color}`,
        borderRadius: 4,
        padding: "8px 10px",
        fontSize: 10,
        lineHeight: 1.4,
        boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        zIndex: 100,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 9,
          fontFamily: "ui-monospace, monospace",
          color: track.color,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          marginBottom: 4,
        }}
      >
        <span>{track.isLead ? "LEAD" : track.label}</span>
        <span style={{ color: "var(--af-text-tertiary)", fontWeight: 500 }}>
          {formatEdge(turn.startMs, multiDay)} → {formatEdge(turn.endMs, multiDay)} · {formatDuration(turn.durationMs)}
        </span>
      </div>
      <div
        style={{
          fontSize: 9,
          color: "var(--af-text-tertiary)",
          marginBottom: 6,
        }}
      >
        {summary.agentMessages} msg · {summary.toolCalls} tools
        {summary.errors > 0 ? ` · ${summary.errors} err` : ""}
      </div>
      {userText && (
        <div style={{ marginBottom: 5 }}>
          <div
            style={{
              fontSize: 8,
              color: track.color,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginBottom: 1,
            }}
          >
            HUMAN
          </div>
          <div
            style={{
              color: "var(--af-text)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {userText}
          </div>
        </div>
      )}
      {firstAgent && (
        <div style={{ marginBottom: 5 }}>
          <div
            style={{
              fontSize: 8,
              color: track.color,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginBottom: 1,
            }}
          >
            AGENT
          </div>
          <div
            style={{
              color: "var(--af-text)",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {firstAgent}
          </div>
        </div>
      )}
      {tools.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 3,
            flexWrap: "wrap",
            marginBottom: showFinal ? 5 : 0,
          }}
        >
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
      {showFinal && (
        <div>
          <div
            style={{
              fontSize: 8,
              color: track.color,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginBottom: 1,
            }}
          >
            RESULT
          </div>
          <div
            style={{
              color: "var(--af-text)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {finalAgent}
          </div>
        </div>
      )}
    </div>
  );
}

function formatEdge(ms: number, multiDay: boolean): string {
  const d = new Date(ms);
  if (!multiDay) {
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  const date = d.toLocaleDateString([], { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} ${time}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3600_000).toFixed(1)}h`;
}
