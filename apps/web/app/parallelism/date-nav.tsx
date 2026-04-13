"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import Link from "next/link";

export type DayInfo = {
  date: string;
  sessions: number;
  /** Total airtime across sessions that started this day. */
  airTimeMs: number;
  /** Total parallel burst time on this day. */
  parallelMs: number;
  /** Number of bursts on this day. */
  burstCount: number;
  /** Peak concurrency on this day (max across all its bursts). */
  peakConcurrency: number;
};

/** Compact duration like "45m", "2h", "3h 20m". Used in tight cells. */
function fmtShortDur(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Custom date picker for the Timeline page. Shows a mini calendar
 * with session counts per day so the user can identify which days
 * are most interesting to explore.
 */
export function DateNav({
  date,
  today,
  prevDay,
  nextDay,
  dayStats,
}: {
  date: string;
  today: string;
  prevDay?: string;
  nextDay?: string;
  /** Per-day session counts for the calendar heatmap. */
  dayStats: DayInfo[];
}) {
  const router = useRouter();
  const [calOpen, setCalOpen] = useState(false);

  // Parse the selected date to determine the calendar month.
  const [selY, selM] = useMemo(() => {
    const [y, m] = date.split("-").map(Number) as [number, number, number];
    return [y, m];
  }, [date]);

  const [viewY, setViewY] = useState(selY);
  const [viewM, setViewM] = useState(selM);
  // Hover state for the custom per-cell tooltip — stores the day key
  // and the (x,y) position of the hovered button relative to the popover.
  const [hoverDay, setHoverDay] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  // Build a lookup: date → full day info.
  const statsMap = useMemo(() => {
    const map = new Map<string, DayInfo>();
    for (const d of dayStats) map.set(d.date, d);
    return map;
  }, [dayStats]);

  // Build calendar grid for the viewed month.
  const calDays = useMemo(() => {
    const firstOfMonth = new Date(viewY, viewM - 1, 1);
    const startDow = firstOfMonth.getDay(); // 0=Sun
    const daysInMonth = new Date(viewY, viewM, 0).getDate();

    const cells: (string | null)[] = [];
    // Leading blanks.
    for (let i = 0; i < startDow; i++) cells.push(null);
    // Days.
    for (let d = 1; d <= daysInMonth; d++) {
      const mm = String(viewM).padStart(2, "0");
      const dd = String(d).padStart(2, "0");
      cells.push(`${viewY}-${mm}-${dd}`);
    }
    return cells;
  }, [viewY, viewM]);

  // Intensity is driven by airTime (not session count) because airTime
  // more accurately reflects "how busy was this day" — 50 one-minute
  // sessions and one two-hour session tell different stories, and the
  // latter is the one you probably want to find.
  const maxAirTimeMs = useMemo(() => {
    let max = 0;
    for (const d of dayStats) if (d.airTimeMs > max) max = d.airTimeMs;
    return max;
  }, [dayStats]);

  const monthLabel = new Date(viewY, viewM - 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });

  const goMonth = (delta: number) => {
    let m = viewM + delta;
    let y = viewY;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setViewM(m);
    setViewY(y);
  };

  const pickDay = (d: string) => {
    setCalOpen(false);
    router.push(`/parallelism?date=${d}`);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", position: "relative" }}>
      {prevDay ? (
        <Link
          href={`/parallelism?date=${prevDay}`}
          style={{
            padding: "5px 10px",
            border: "1px solid var(--af-border-subtle)",
            borderRadius: 6,
            fontSize: 11,
            color: "var(--af-text-secondary)",
          }}
        >
          ←
        </Link>
      ) : (
        <span style={{ padding: "5px 10px", opacity: 0.3, fontSize: 11, color: "var(--af-text-tertiary)" }}>←</span>
      )}

      {/* Calendar toggle button — shows current date */}
      <button
        type="button"
        onClick={() => {
          setViewY(selY);
          setViewM(selM);
          setCalOpen((p) => !p);
        }}
        style={{
          padding: "5px 12px",
          fontSize: 12,
          fontFamily: "var(--font-mono)",
          border: "1px solid var(--af-border-subtle)",
          borderRadius: 6,
          background: calOpen ? "var(--af-accent-subtle)" : "transparent",
          color: calOpen ? "var(--af-accent)" : "var(--af-text)",
          cursor: "pointer",
          fontWeight: 500,
          minWidth: 120,
          textAlign: "center",
        }}
      >
        {date}
      </button>

      {nextDay ? (
        <Link
          href={`/parallelism?date=${nextDay}`}
          style={{
            padding: "5px 10px",
            border: "1px solid var(--af-border-subtle)",
            borderRadius: 6,
            fontSize: 11,
            color: "var(--af-text-secondary)",
          }}
        >
          →
        </Link>
      ) : (
        <span style={{ padding: "5px 10px", opacity: 0.3, fontSize: 11, color: "var(--af-text-tertiary)" }}>→</span>
      )}

      <Link
        href={`/parallelism?date=${today}`}
        style={{
          padding: "5px 12px",
          border: "1px solid var(--af-border-subtle)",
          borderRadius: 6,
          fontSize: 11,
          color: date === today ? "var(--af-accent)" : "var(--af-text-secondary)",
          background: date === today ? "var(--af-accent-subtle)" : "transparent",
          fontWeight: 500,
        }}
      >
        Today
      </Link>

      {/* Calendar popover — anchored right so it opens leftward from
          the button and stays inside the viewport. The DateNav sits in
          the top-right of the page header where left-anchoring would
          overflow the screen. */}
      {calOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            zIndex: 60,
            background: "var(--af-surface)",
            border: "1px solid var(--af-border-subtle)",
            borderRadius: 10,
            padding: "12px 14px",
            boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
            minWidth: 300,
          }}
        >
          {/* Month header with arrows */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 10,
            }}
          >
            <button
              type="button"
              onClick={() => goMonth(-1)}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--af-text-secondary)",
                fontSize: 14,
                padding: "2px 8px",
                borderRadius: 4,
              }}
            >
              ‹
            </button>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--af-text)" }}>
              {monthLabel}
            </span>
            <button
              type="button"
              onClick={() => goMonth(1)}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--af-text-secondary)",
                fontSize: 14,
                padding: "2px 8px",
                borderRadius: 4,
              }}
            >
              ›
            </button>
          </div>

          {/* Weekday headers */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 2,
              marginBottom: 4,
            }}
          >
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
              <div
                key={d}
                style={{
                  textAlign: "center",
                  fontSize: 9,
                  color: "var(--af-text-tertiary)",
                  fontWeight: 600,
                  padding: "2px 0",
                }}
              >
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 2,
            }}
          >
            {calDays.map((day, i) => {
              if (!day) {
                return <div key={`blank-${i}`} />;
              }
              const info = statsMap.get(day);
              const sessions = info?.sessions ?? 0;
              const airTimeMs = info?.airTimeMs ?? 0;
              const parallelMs = info?.parallelMs ?? 0;
              const burstCount = info?.burstCount ?? 0;
              const peakConcurrency = info?.peakConcurrency ?? 0;
              const isSelected = day === date;
              const isToday = day === today;
              const isFuture = day > today;

              // Intensity based on airTime.
              const intensity =
                airTimeMs > 0 && maxAirTimeMs > 0
                  ? Math.min(1, airTimeMs / maxAirTimeMs)
                  : 0;

              const dayNum = parseInt(day.split("-")[2]!, 10);

              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => pickDay(day)}
                  disabled={isFuture}
                  onMouseEnter={(e) => {
                    if (isFuture) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const parentRect =
                      e.currentTarget.offsetParent?.getBoundingClientRect() ??
                      rect;
                    setHoverDay(day);
                    setHoverPos({
                      // Center below the day cell, relative to the popover.
                      x: rect.left - parentRect.left + rect.width / 2,
                      y: rect.bottom - parentRect.top + 6,
                    });
                  }}
                  onMouseLeave={() => {
                    setHoverDay(null);
                    setHoverPos(null);
                  }}
                  style={{
                    position: "relative",
                    width: 40,
                    height: 40,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 1,
                    border: isSelected
                      ? "2px solid var(--af-accent)"
                      : isToday
                        ? "1px solid var(--af-text-tertiary)"
                        : "1px solid transparent",
                    borderRadius: 6,
                    background:
                      intensity > 0
                        ? `rgba(45, 212, 191, ${0.08 + intensity * 0.35})`
                        : "transparent",
                    color: isFuture
                      ? "var(--af-text-tertiary)"
                      : isSelected
                        ? "var(--af-accent)"
                        : "var(--af-text)",
                    cursor: isFuture ? "not-allowed" : "pointer",
                    fontSize: 11,
                    fontWeight: isSelected ? 700 : 400,
                    fontFamily: "var(--font-mono)",
                    padding: 0,
                    opacity: isFuture ? 0.4 : 1,
                  }}
                >
                  <span style={{ lineHeight: 1 }}>{dayNum}</span>
                  {airTimeMs > 0 && (
                    <span
                      style={{
                        fontSize: 8,
                        color: isSelected
                          ? "var(--af-accent)"
                          : "var(--af-text-tertiary)",
                        lineHeight: 1,
                        fontWeight: 600,
                        marginTop: 2,
                      }}
                    >
                      {fmtShortDur(airTimeMs)}
                    </span>
                  )}
                  {/* Parallelism indicator: small purple dot in the corner
                      when any bursts happened that day. */}
                  {burstCount > 0 && (
                    <span
                      style={{
                        position: "absolute",
                        top: 3,
                        right: 3,
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: "rgba(167, 139, 250, 0.95)",
                        boxShadow: "0 0 0 1px var(--af-surface)",
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginTop: 10,
              paddingTop: 8,
              borderTop: "1px solid var(--af-border-subtle)",
              fontSize: 9,
              color: "var(--af-text-tertiary)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span>less</span>
              <div style={{ display: "flex", gap: 2 }}>
                {[0, 0.15, 0.3, 0.5, 0.8].map((v, i) => (
                  <span
                    key={i}
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background:
                        v === 0
                          ? "var(--af-border-subtle)"
                          : `rgba(45, 212, 191, ${0.08 + v * 0.35})`,
                    }}
                  />
                ))}
              </div>
              <span>more active</span>
            </div>
            <div
              style={{ display: "flex", alignItems: "center", gap: 5 }}
              title="Days with at least one concurrency burst"
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: "rgba(167, 139, 250, 0.95)",
                }}
              />
              parallel
            </div>
          </div>

          {/* Custom hover tooltip — rendered inside the popover so it
              shares the popover's coordinate space and zIndex. */}
          {hoverDay && hoverPos && (() => {
            const info = statsMap.get(hoverDay);
            const sessions = info?.sessions ?? 0;
            const airTimeMs = info?.airTimeMs ?? 0;
            const parallelMs = info?.parallelMs ?? 0;
            const burstCount = info?.burstCount ?? 0;
            const peakConcurrency = info?.peakConcurrency ?? 0;
            return (
              <div
                style={{
                  position: "absolute",
                  left: Math.max(10, Math.min(hoverPos.x - 110, 290)),
                  top: hoverPos.y,
                  width: 220,
                  pointerEvents: "none",
                  background: "var(--af-surface-elevated)",
                  border: "1px solid var(--af-border-subtle)",
                  borderRadius: 8,
                  padding: "9px 12px",
                  boxShadow: "0 6px 22px rgba(0,0,0,0.22)",
                  fontSize: 11,
                  color: "var(--af-text)",
                  zIndex: 65,
                  lineHeight: 1.5,
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontWeight: 700,
                    fontSize: 11,
                    marginBottom: 4,
                  }}
                >
                  {hoverDay}
                </div>
                {sessions === 0 && airTimeMs === 0 && parallelMs === 0 ? (
                  <div style={{ color: "var(--af-text-tertiary)", fontSize: 10 }}>
                    no activity
                  </div>
                ) : (
                  <>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        color: "var(--af-text-secondary)",
                        fontSize: 10,
                      }}
                    >
                      <span>sessions</span>
                      <strong style={{ color: "var(--af-text)" }}>
                        {sessions}
                      </strong>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        color: "var(--af-text-secondary)",
                        fontSize: 10,
                      }}
                    >
                      <span>active time</span>
                      <strong style={{ color: "var(--af-text)" }}>
                        {airTimeMs > 0 ? fmtShortDur(airTimeMs) : "—"}
                      </strong>
                    </div>
                    {parallelMs > 0 && (
                      <>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            color: "var(--af-text-secondary)",
                            fontSize: 10,
                            marginTop: 4,
                            paddingTop: 4,
                            borderTop: "1px dashed var(--af-border-subtle)",
                          }}
                        >
                          <span>parallel time</span>
                          <strong style={{ color: "var(--af-text)" }}>
                            {fmtShortDur(parallelMs)}
                          </strong>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            color: "var(--af-text-secondary)",
                            fontSize: 10,
                          }}
                        >
                          <span>peak concurrency</span>
                          <strong
                            style={{ color: "rgba(167, 139, 250, 1)" }}
                          >
                            ×{peakConcurrency}
                          </strong>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            color: "var(--af-text-secondary)",
                            fontSize: 10,
                          }}
                        >
                          <span>bursts</span>
                          <strong style={{ color: "var(--af-text)" }}>
                            {burstCount}
                          </strong>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
