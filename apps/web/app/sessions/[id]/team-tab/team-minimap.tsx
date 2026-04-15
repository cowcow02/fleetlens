"use client";

import type { TimelineData } from "./adapter";

const LANE_HEIGHT = 22;
const LANE_GAP = 2;
const LABEL_WIDTH = 100;

type Props = {
  data: TimelineData;
  playheadMs: number | null;
  onSeek: (tsMs: number) => void;
};

export function TeamMinimap({ data, playheadMs, onSeek }: Props) {
  const span = Math.max(1, data.lastEventMs - data.firstEventMs);

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, e.clientX - rect.left);
    const frac = Math.min(1, x / Math.max(1, rect.width));
    onSeek(data.firstEventMs + frac * span);
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
        {data.tracks.map((t) => (
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
              onClick={onClick}
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
                    title={`${formatHM(turn.startMs)} — ${formatHM(turn.endMs)}`}
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
    </div>
  );
}

function formatHM(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
