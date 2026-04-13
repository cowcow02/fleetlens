"use client";

import { useMemo } from "react";
import type { UsageSnapshot, UsageWindow } from "@/lib/usage-data";

type SeriesKey = "five_hour" | "seven_day" | "seven_day_opus" | "seven_day_sonnet";

export function UsageChart({
  snapshots,
  seriesKey,
  title,
  windowMs,
  color,
}: {
  snapshots: UsageSnapshot[];
  seriesKey: SeriesKey;
  title: string;
  /** Rolling window duration in milliseconds (5h, 7d, etc.). */
  windowMs: number;
  /** Line color for this series. */
  color: string;
}) {
  const width = 800;
  const height = 200;
  const padding = { top: 12, right: 16, bottom: 28, left: 36 };

  const computed = useMemo(() => {
    // Collect only snapshots that have data for this window
    const valid = snapshots
      .map((s) => ({ capturedAt: new Date(s.captured_at).getTime(), window: s[seriesKey] }))
      .filter(
        (x): x is { capturedAt: number; window: UsageWindow } =>
          x.window !== null && x.window.utilization !== null,
      );

    if (valid.length === 0) return null;

    // Window bounds: anchor to the latest snapshot's resets_at so the
    // x-axis always represents "this window, ending at next reset".
    const latest = valid[valid.length - 1]!;
    const resetsAt = latest.window.resets_at ? new Date(latest.window.resets_at).getTime() : null;
    if (!resetsAt) return null;

    const windowStart = resetsAt - windowMs;
    const now = Date.now();
    const current = latest.window.utilization ?? 0;

    // Project current snapshot point onto the window timeline
    const points = valid
      .filter((x) => x.capturedAt >= windowStart && x.capturedAt <= resetsAt)
      .map((x) => [x.capturedAt, x.window.utilization ?? 0] as const);

    return { points, windowStart, windowEnd: resetsAt, now, current, latest };
  }, [snapshots, seriesKey, windowMs]);

  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  if (!computed) {
    return (
      <EmptyChart title={title} message="No data for this window yet." />
    );
  }

  const { points, windowStart, windowEnd, now, current } = computed;

  const xScale = (t: number): number =>
    padding.left + ((t - windowStart) / (windowEnd - windowStart)) * plotW;
  const yScale = (v: number): number => padding.top + plotH - (v / 100) * plotH;

  // Data path
  const linePath =
    points.length > 0
      ? points
          .map(([t, v], i) => `${i === 0 ? "M" : "L"} ${xScale(t).toFixed(1)} ${yScale(v).toFixed(1)}`)
          .join(" ")
      : "";

  // Sustainable-burn diagonal: 0% at window start → 100% at window end
  const diagStart = { x: xScale(windowStart), y: yScale(0) };
  const diagEnd = { x: xScale(windowEnd), y: yScale(100) };

  // Determine tone based on whether we're above/below the diagonal at "now"
  const expectedNowPct = ((now - windowStart) / (windowEnd - windowStart)) * 100;
  const burnRateTone =
    current > expectedNowPct + 10
      ? "text-red-500"
      : current > expectedNowPct
        ? "text-amber-500"
        : "text-emerald-500";
  const burnRateLabel =
    current > expectedNowPct + 10
      ? "above sustainable"
      : current > expectedNowPct
        ? "slightly above"
        : "below sustainable";

  return (
    <div className="rounded-lg border border-af-border bg-af-surface p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-af-muted">
            Window: {formatWindowSize(windowMs)} · resets {formatRelative(new Date(windowEnd).toISOString())}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums" style={{ color }}>
            {current.toFixed(1)}%
          </div>
          <div className={`text-xs ${burnRateTone}`}>{burnRateLabel}</div>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-44 w-full"
        preserveAspectRatio="none"
      >
        {/* Horizontal gridlines */}
        {[0, 25, 50, 75, 100].map((pct) => {
          const y = yScale(pct);
          return (
            <g key={pct}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeOpacity="0.08"
              />
              <text
                x={padding.left - 6}
                y={y + 4}
                textAnchor="end"
                className="fill-current text-[10px] opacity-50"
              >
                {pct}%
              </text>
            </g>
          );
        })}

        {/* Warning bands */}
        <rect
          x={padding.left}
          y={yScale(100)}
          width={plotW}
          height={yScale(90) - yScale(100)}
          fill="#ef4444"
          fillOpacity="0.08"
        />
        <rect
          x={padding.left}
          y={yScale(90)}
          width={plotW}
          height={yScale(70) - yScale(90)}
          fill="#f59e0b"
          fillOpacity="0.06"
        />

        {/* Sustainable-burn diagonal */}
        <line
          x1={diagStart.x}
          y1={diagStart.y}
          x2={diagEnd.x}
          y2={diagEnd.y}
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth="1"
          strokeDasharray="3 3"
        />

        {/* Current-time vertical marker */}
        {now >= windowStart && now <= windowEnd && (
          <line
            x1={xScale(now)}
            y1={padding.top}
            x2={xScale(now)}
            y2={padding.top + plotH}
            stroke="currentColor"
            strokeOpacity="0.35"
            strokeWidth="1"
          />
        )}

        {/* Data line */}
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Current data point */}
        {points.length > 0 && (
          <circle
            cx={xScale(points[points.length - 1]![0])}
            cy={yScale(points[points.length - 1]![1])}
            r="3"
            fill={color}
          />
        )}
      </svg>
      <div className="mt-2 flex justify-between text-[10px] text-af-muted">
        <span>{new Date(windowStart).toLocaleString()}</span>
        <span>{points.length} snapshot{points.length === 1 ? "" : "s"}</span>
        <span>{new Date(windowEnd).toLocaleString()}</span>
      </div>
    </div>
  );
}

function EmptyChart({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-lg border border-af-border bg-af-surface p-6">
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-4 text-center text-xs text-af-muted">{message}</div>
    </div>
  );
}

function formatWindowSize(ms: number): string {
  const hours = ms / (60 * 60 * 1000);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = hours / 24;
  return `${days} day${days === 1 ? "" : "s"}`;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((then - now) / 1000);
  const abs = Math.abs(diffSec);
  const past = diffSec < 0;

  let value: string;
  if (abs < 60) {
    value = `${abs}s`;
  } else if (abs < 3600) {
    value = `${Math.floor(abs / 60)}m`;
  } else if (abs < 86400) {
    const h = Math.floor(abs / 3600);
    const m = Math.floor((abs % 3600) / 60);
    value = m > 0 ? `${h}h${m}m` : `${h}h`;
  } else {
    const d = Math.floor(abs / 86400);
    const h = Math.floor((abs % 86400) / 3600);
    value = h > 0 ? `${d}d${h}h` : `${d}d`;
  }

  return past ? `${value} ago` : `in ${value}`;
}
