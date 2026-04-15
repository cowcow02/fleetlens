"use client";

import { useState } from "react";
import type { TimelineData, TeamTrack, TeamTurn } from "./adapter";

const LANE_HEIGHT = 22;
const LANE_GAP = 2;
const LABEL_WIDTH = 100;
const DEFAULT_VISIBLE_LANES = 4;

type Props = {
  data: TimelineData;
  playheadMs: number | null;
  onSeek: (tsMs: number, trackId?: string) => void;
};

type HoverState = {
  turn: TeamTurn;
  track: TeamTrack;
  clientX: number;
  clientY: number;
};

export function TeamMinimap({ data, playheadMs, onSeek }: Props) {
  const span = Math.max(1, data.lastEventMs - data.firstEventMs);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [expanded, setExpanded] = useState(false);
  const hasOverflow = data.tracks.length > DEFAULT_VISIBLE_LANES;
  const visibleTracks =
    hasOverflow && !expanded
      ? data.tracks.slice(0, DEFAULT_VISIBLE_LANES)
      : data.tracks;
  const hiddenCount = data.tracks.length - DEFAULT_VISIBLE_LANES;

  const onLaneClick = (
    track: TeamTrack,
    e: React.MouseEvent<HTMLDivElement>,
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, e.clientX - rect.left);
    const frac = Math.min(1, x / Math.max(1, rect.width));
    onSeek(data.firstEventMs + frac * span, track.id);
  };

  const playheadFrac =
    playheadMs != null
      ? Math.max(0, Math.min(1, (playheadMs - data.firstEventMs) / span))
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
        <span>{new Date(data.firstEventMs).toLocaleTimeString()}</span>
        <span>{new Date(data.lastEventMs).toLocaleTimeString()}</span>
      </div>

      <div
        style={{ display: "flex", flexDirection: "column", gap: LANE_GAP }}
      >
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
                borderRadius: 2,
                overflow: "hidden",
                cursor: "pointer",
              }}
              onClick={(e) => onLaneClick(t, e)}
            >
              {t.turns.map((turn) => {
                const left =
                  ((turn.startMs - data.firstEventMs) / span) * 100;
                const width = Math.max(0.4, (turn.durationMs / span) * 100);
                return (
                  <div
                    key={turn.id}
                    style={{
                      position: "absolute",
                      left: `${left}%`,
                      top: 2,
                      width: `${width}%`,
                      height: LANE_HEIGHT - 4,
                      background: t.color,
                      opacity: 0.85,
                      borderRadius: 1,
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
                const left = ((sa.startMs - data.firstEventMs) / span) * 100;
                const w = sa.durationMs
                  ? Math.max(0.2, (sa.durationMs / span) * 100)
                  : 0.4;
                return (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      left: `${left}%`,
                      bottom: 1,
                      width: `${w}%`,
                      height: 3,
                      background: t.color,
                      opacity: 0.5,
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
            onClick={() => setExpanded((v) => !v)}
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

      {hover && <HoverCard hover={hover} />}
    </div>
  );
}

function HoverCard({ hover }: { hover: HoverState }) {
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
          {formatHM(turn.startMs)} → {formatHM(turn.endMs)} · {formatDuration(turn.durationMs)}
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

function formatHM(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3600_000).toFixed(1)}h`;
}
