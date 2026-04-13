/**
 * Timeline Gantt chart — visualize how sessions overlap per day.
 *
 * Shows one row per session, with colored segments for active periods
 * and gaps for idle time. Time axis is 24 hours. Date picker to
 * navigate between days.
 */

import { listSessions, getSession } from "@/lib/data";
import {
  buildGanttDay,
  computeParallelismBursts,
  computeBurstsFromSessions,
  dailyActivity,
  type GanttDay,
  type ParallelismBurst,
} from "@claude-lens/parser";
import { GanttChart } from "./gantt-chart";
import { DateNav, type DayInfo } from "./date-nav";
import { toLocalDay } from "@claude-lens/parser";

export const dynamic = "force-dynamic";

export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; range?: string }>;
}) {
  const { date: dateParam } = await searchParams;

  // Default to today.
  const today = toLocalDay(Date.now());
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today;

  // Load all sessions, then load details for sessions that overlap
  // the target day. We use file mtime as a fast filter — only load
  // details for sessions whose mtime falls on the target day ± 1 day.
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dayStartMs = new Date(y, m - 1, d).getTime();
  const dayEndMs = new Date(y, m - 1, d + 1).getTime();
  // Widen the window by 1 day on each side to catch sessions that
  // started the day before and carried into the target day.
  const filterStartMs = dayStartMs - 24 * 60 * 60 * 1000;
  const filterEndMs = dayEndMs + 24 * 60 * 60 * 1000;

  const allSessions = await listSessions();
  const candidates = allSessions.filter((s) => {
    if (!s.firstTimestamp) return false;
    const startMs = Date.parse(s.firstTimestamp);
    if (Number.isNaN(startMs)) return false;
    const endMs = s.lastTimestamp ? Date.parse(s.lastTimestamp) : startMs;
    // Session overlaps the ±1 day window.
    return endMs >= filterStartMs && startMs <= filterEndMs;
  });

  // Load full details for candidates (to get events for segment computation).
  // Cap at 80 sessions to avoid extremely slow loads.
  const details = (
    await Promise.all(candidates.slice(0, 80).map((s) => getSession(s.id)))
  ).filter((d): d is NonNullable<typeof d> => !!d);

  const gantt: GanttDay = buildGanttDay(details, date);
  const bursts: ParallelismBurst[] = computeParallelismBursts(gantt);

  // Per-day activity (reuses dailyActivity which gives us both session
  // count and airTimeMs bucketed by day).
  const activityBuckets = dailyActivity(allSessions);
  const activityByDay = new Map(activityBuckets.map((b) => [b.date, b]));

  // Bursts across all history, bucketed by start day, so the picker can
  // show "this day had parallel work" without us recomputing per day.
  const allBursts = computeBurstsFromSessions(allSessions);
  type DayBurstAgg = { totalMs: number; count: number; peak: number };
  const burstsByDay = new Map<string, DayBurstAgg>();
  for (const b of allBursts) {
    const day = toLocalDay(b.startMs);
    const entry = burstsByDay.get(day) ?? { totalMs: 0, count: 0, peak: 0 };
    entry.totalMs += b.endMs - b.startMs;
    entry.count += 1;
    if (b.peak > entry.peak) entry.peak = b.peak;
    burstsByDay.set(day, entry);
  }

  // Union of days that have any activity OR any parallelism.
  const dayKeys = new Set<string>();
  for (const b of activityBuckets) if (b.sessions > 0) dayKeys.add(b.date);
  for (const d of burstsByDay.keys()) dayKeys.add(d);

  const dayStats: DayInfo[] = Array.from(dayKeys)
    .map((date) => {
      const activity = activityByDay.get(date);
      const burst = burstsByDay.get(date);
      return {
        date,
        sessions: activity?.sessions ?? 0,
        airTimeMs: activity?.airTimeMs ?? 0,
        parallelMs: burst?.totalMs ?? 0,
        burstCount: burst?.count ?? 0,
        peakConcurrency: burst?.peak ?? 0,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const sortedDays = dayStats.map((d) => d.date);
  const currentIdx = sortedDays.indexOf(date);
  const prevDay = currentIdx > 0 ? sortedDays[currentIdx - 1] : undefined;
  const nextDay =
    currentIdx >= 0 && currentIdx < sortedDays.length - 1
      ? sortedDays[currentIdx + 1]
      : undefined;

  // Day-level totals for the header tile row. Active time comes from
  // the per-day split in the Gantt (same as the calendar intensity —
  // consistent numbers everywhere).
  const dayActiveMs = gantt.sessions.reduce(
    (sum, s) => sum + s.activeMs,
    0,
  );
  const peakConcurrent = gantt.peakActiveParallelism;
  const totalParallelMs = bursts.reduce(
    (sum, b) => sum + (b.endMs - b.startMs),
    0,
  );
  const crossProjectBursts = bursts.filter((b) => b.crossProject).length;

  return (
    <div style={{ padding: "32px 40px", maxWidth: 1400 }}>
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 20,
          flexWrap: "wrap",
          gap: 14,
        }}
      >
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
            Timeline
          </h1>
          <p style={{ fontSize: 13, color: "var(--af-text-secondary)", marginTop: 4 }}>
            {date === today ? "Today" : "Activity on"}{" "}
            <strong>{date}</strong>
          </p>
        </div>

        <DateNav date={date} today={today} prevDay={prevDay} nextDay={nextDay} dayStats={dayStats} />
      </header>

      {gantt.sessions.length === 0 ? (
        <div className="af-empty">
          No active sessions on {date}. Try a different date.
        </div>
      ) : (
        <>
          <DayMetricRow
            sessionCount={gantt.sessions.length}
            activeMs={dayActiveMs}
            peakConcurrent={peakConcurrent}
            parallelMs={totalParallelMs}
            burstCount={bursts.length}
            crossProjectBursts={crossProjectBursts}
          />
          <GanttChart gantt={gantt} bursts={bursts} />
        </>
      )}
    </div>
  );
}

function DayMetricRow({
  sessionCount,
  activeMs,
  peakConcurrent,
  parallelMs,
  burstCount,
  crossProjectBursts,
}: {
  sessionCount: number;
  activeMs: number;
  peakConcurrent: number;
  parallelMs: number;
  burstCount: number;
  crossProjectBursts: number;
}) {
  const fmtDur = (ms: number) => {
    if (ms <= 0) return "—";
    const totalMin = Math.round(ms / 60_000);
    if (totalMin < 60) return `${totalMin}m`;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  };

  const tiles: Array<{
    label: string;
    value: string;
    sub?: string;
    color?: string;
  }> = [
    {
      label: "Sessions active",
      value: String(sessionCount),
      sub: "at least one segment today",
    },
    {
      label: "Agent time",
      value: fmtDur(activeMs),
      sub: "actively working",
    },
  ];

  if (burstCount > 0) {
    tiles.push({
      label: "Peak concurrency",
      value: `×${peakConcurrent}`,
      sub: "max agents at once",
      color: "rgba(167, 139, 250, 1)",
    });
    tiles.push({
      label: "Parallel time",
      value: fmtDur(parallelMs),
      sub: `${burstCount} burst${burstCount === 1 ? "" : "s"}${crossProjectBursts > 0 ? ` · ${crossProjectBursts} cross-project` : ""}`,
    });
  } else {
    tiles.push({
      label: "Peak concurrency",
      value: peakConcurrent > 1 ? `×${peakConcurrent}` : "—",
      sub: "no sustained bursts",
    });
  }

  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${tiles.length}, 1fr)`,
        gap: 12,
        marginBottom: 16,
      }}
    >
      {tiles.map((t) => (
        <div
          key={t.label}
          className="af-panel"
          style={{ padding: "14px 18px" }}
        >
          <div
            style={{
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: "var(--af-text-tertiary)",
              marginBottom: 4,
            }}
          >
            {t.label}
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              fontVariantNumeric: "tabular-nums",
              color: t.color ?? "var(--af-text)",
            }}
          >
            {t.value}
          </div>
          {t.sub && (
            <div
              style={{
                fontSize: 10,
                color: "var(--af-text-tertiary)",
                marginTop: 3,
              }}
            >
              {t.sub}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
