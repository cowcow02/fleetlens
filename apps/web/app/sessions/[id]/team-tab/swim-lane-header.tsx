import type { MultiTrackProps } from "./adapter";

export function SwimLaneHeader({
  tracks,
  messages,
  firstEventMs,
  lastEventMs,
}: MultiTrackProps) {
  const span = Math.max(1, lastEventMs - firstEventMs);
  return (
    <div style={{
      position: "sticky",
      top: 0,
      zIndex: 10,
      borderRadius: 6,
      border: "1px solid var(--af-border-subtle)",
      background: "var(--af-surface-elevated)",
      padding: "8px 12px",
    }}>
      <TimeRuler firstMs={firstEventMs} lastMs={lastEventMs} />
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
        {tracks.map((t) => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 112,
                fontSize: 10,
                fontFamily: "ui-monospace, monospace",
                color: t.color,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={t.label}
            >
              {t.isLead ? "LEAD" : t.label}
            </div>
            <div style={{
              flex: 1,
              position: "relative",
              height: 12,
              borderRadius: 2,
              background: "var(--af-border-subtle)",
            }}>
              {t.activeSegments.map((seg, i) => {
                const left = ((seg.startMs - firstEventMs) / span) * 100;
                const width = ((seg.endMs - seg.startMs) / span) * 100;
                return (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      top: 2,
                      height: 8,
                      left: `${left}%`,
                      width: `${Math.max(0.3, width)}%`,
                      background: t.color,
                      opacity: 0.85,
                      borderRadius: 2,
                    }}
                  />
                );
              })}
              {messages
                .filter((m) => m.fromTrackId === t.id || m.toTrackId === t.id)
                .map((m, i) => {
                  const otherId = m.fromTrackId === t.id ? m.toTrackId : m.fromTrackId;
                  const other = tracks.find((x) => x.id === otherId);
                  const left = ((m.tsMs - firstEventMs) / span) * 100;
                  return (
                    <div
                      key={i}
                      style={{
                        position: "absolute",
                        top: -2,
                        width: 2,
                        height: 16,
                        left: `${left}%`,
                        background: other?.color ?? "#888",
                      }}
                      title={m.label}
                    />
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimeRuler({ firstMs, lastMs }: { firstMs: number; lastMs: number }) {
  const ticks: number[] = [];
  const span = lastMs - firstMs;
  const step = span / 5;
  for (let i = 0; i <= 5; i++) ticks.push(firstMs + step * i);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 112 }} />
      <div style={{
        flex: 1,
        display: "flex",
        justifyContent: "space-between",
        fontSize: 9,
        color: "var(--af-text-tertiary, #888)",
        fontFamily: "ui-monospace, monospace",
      }}>
        {ticks.map((t, i) => (
          <span key={i}>
            {new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        ))}
      </div>
    </div>
  );
}
