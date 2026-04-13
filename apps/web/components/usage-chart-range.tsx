"use client";

import { useMemo, useState } from "react";
import type { UsageSnapshot, UsageWindow } from "@/lib/usage-data";

type SeriesKey = "five_hour" | "seven_day" | "seven_day_sonnet";

type CycleData = {
  /** Cycle end (= resets_at of the window at that time), ms epoch */
  resetsAtMs: number;
  /** Cycle start — resetsAtMs - windowMs, ms epoch */
  startMs: number;
  /** Snapshots within this cycle, sorted by time */
  points: { t: number; u: number; remaining: number }[];
  /** Peak utilization (%) observed in this cycle */
  peak: number;
  /** Time of peak, ms epoch */
  peakT: number;
};

/**
 * Multi-cycle burndown chart over an arbitrary date range.
 *
 * Unlike the single-cycle `UsageChart`, this plots many cycles on one
 * canvas — each cycle is drawn as its own burndown segment (starts near
 * 100% remaining, declines toward 0%, resets back at the cycle boundary).
 *
 * Rendering:
 *   - X-axis: time (startMs → endMs)
 *   - Y-axis: remaining budget (100 → 0%)
 *   - Per cycle: solid colored burndown line + dashed 'ideal' diagonal
 *     from (cycleStart, 100%) to (cycleEnd, 0%)
 *   - Vertical dashed markers at each reset (visual 'line break' between
 *     cycles so the viewer sees the sawtooth)
 *   - Warning bands shaded at 0–10% (danger: <10% left) and 10–30% (caution)
 *
 * This gives the sawtooth pattern users expect: each cycle burns down
 * toward zero, then jumps back to 100% at reset.
 */
export function UsageChartRange({
  snapshots,
  seriesKey,
  startMs,
  endMs,
  windowMs,
  colorVar,
}: {
  snapshots: UsageSnapshot[];
  seriesKey: SeriesKey;
  startMs: number;
  endMs: number;
  /** Window duration in ms — 5h or 7d depending on seriesKey */
  windowMs: number;
  colorVar: string;
}) {
  const width = 1280;
  const height = 320;
  const padding = { top: 24, right: 32, bottom: 44, left: 60 };

  const computed = useMemo(() => {
    // 1. Collect valid snapshots (regardless of range — we'll filter cycles later)
    const valid: { t: number; u: number; resetsAt: string | null }[] = [];
    for (const snap of snapshots) {
      const t = new Date(snap.captured_at).getTime();
      const w = snap[seriesKey];
      if (!w || w.utilization === null) continue;
      valid.push({ t, u: w.utilization, resetsAt: w.resets_at });
    }
    if (valid.length === 0) return null;

    // 2. Group into cycles by resets_at. All snapshots sharing the same
    //    resets_at belong to the same rolling window.
    const byReset = new Map<string, typeof valid>();
    for (const p of valid) {
      if (!p.resetsAt) continue;
      const key = p.resetsAt;
      let bucket = byReset.get(key);
      if (!bucket) {
        bucket = [];
        byReset.set(key, bucket);
      }
      bucket.push(p);
    }

    const cycles: CycleData[] = [];
    for (const [resetsAtIso, points] of byReset) {
      const resetsAtMs = new Date(resetsAtIso).getTime();
      const cycleStartMs = resetsAtMs - windowMs;
      // Sort points by time
      points.sort((a, b) => a.t - b.t);
      // Convert utilization → remaining budget
      const withRemaining = points.map((p) => ({
        t: p.t,
        u: p.u,
        remaining: 100 - p.u,
      }));
      // Find peak utilization
      let peakIdx = 0;
      for (let i = 1; i < withRemaining.length; i++) {
        if (withRemaining[i]!.u > withRemaining[peakIdx]!.u) peakIdx = i;
      }
      cycles.push({
        resetsAtMs,
        startMs: cycleStartMs,
        points: withRemaining,
        peak: withRemaining[peakIdx]!.u,
        peakT: withRemaining[peakIdx]!.t,
      });
    }

    // 3. Filter to cycles that *intersect* the selected range
    const cyclesInRange = cycles
      .filter((c) => c.resetsAtMs >= startMs && c.startMs <= endMs)
      .sort((a, b) => a.resetsAtMs - b.resetsAtMs);

    if (cyclesInRange.length === 0) return null;

    // 4. Aggregate stats for the strip
    const allPoints = cyclesInRange.flatMap((c) => c.points);
    const peakOverall = Math.max(...allPoints.map((p) => p.u));
    const completeCycles = cyclesInRange.filter((c) => c.resetsAtMs <= endMs && c.resetsAtMs < Date.now()).length;
    const avgPeak =
      cyclesInRange.length > 0
        ? cyclesInRange.reduce((sum, c) => sum + c.peak, 0) / cyclesInRange.length
        : 0;

    return {
      cycles: cyclesInRange,
      allPoints,
      peakOverall,
      avgPeak,
      completeCycles,
    };
  }, [snapshots, seriesKey, startMs, endMs, windowMs]);

  const [hover, setHover] = useState<{
    x: number;
    t: number;
    u: number;
    remaining: number;
  } | null>(null);

  if (!computed) {
    return (
      <div
        className="af-card"
        style={{
          padding: "40px 32px",
          textAlign: "center",
          fontSize: 12,
          color: "var(--af-text-tertiary)",
        }}
      >
        No usage data in the selected range.
      </div>
    );
  }

  const { cycles, allPoints, peakOverall, avgPeak, completeCycles } = computed;
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const xScale = (t: number): number =>
    padding.left + ((t - startMs) / (endMs - startMs)) * plotW;
  const yScale = (v: number): number => padding.top + plotH - (v / 100) * plotH;
  const unXScale = (x: number): number =>
    startMs + ((x - padding.left) / plotW) * (endMs - startMs);

  // Clamp a scaled x to the plot area — cycles can extend outside the range.
  const clampX = (t: number): number => {
    const x = xScale(t);
    if (x < padding.left) return padding.left;
    if (x > width - padding.right) return width - padding.right;
    return x;
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * width;
    if (svgX < padding.left || svgX > width - padding.right) {
      setHover(null);
      return;
    }
    const targetT = unXScale(svgX);
    let nearest = allPoints[0]!;
    let nearestDist = Math.abs(nearest.t - targetT);
    for (const p of allPoints) {
      const d = Math.abs(p.t - targetT);
      if (d < nearestDist) {
        nearest = p;
        nearestDist = d;
      }
    }
    setHover({
      x: xScale(nearest.t),
      t: nearest.t,
      u: nearest.u,
      remaining: nearest.remaining,
    });
  };

  return (
    <div
      className="af-card"
      style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}
    >
      {/* Stat strip */}
      <div
        style={{
          display: "flex",
          gap: 28,
          fontSize: 11,
          color: "var(--af-text-tertiary)",
          flexWrap: "wrap",
        }}
      >
        <Stat label="Peak utilization" value={`${peakOverall.toFixed(1)}%`} color={colorVar} />
        <Stat
          label="Avg peak / cycle"
          value={cycles.length > 0 ? `${avgPeak.toFixed(1)}%` : "—"}
          color={colorVar}
        />
        <Stat
          label="Complete cycles"
          value={String(completeCycles)}
          color="var(--af-text)"
        />
        <Stat label="Data points" value={String(allPoints.length)} color="var(--af-text)" />
      </div>

      {/* Chart */}
      <div style={{ position: "relative" }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{
            width: "100%",
            aspectRatio: `${width} / ${height}`,
            display: "block",
          }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHover(null)}
        >
          {/* Horizontal gridlines (remaining budget %) */}
          {[0, 25, 50, 75, 100].map((pct) => {
            const y = yScale(pct);
            return (
              <g key={pct}>
                <line
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={y}
                  y2={y}
                  stroke="var(--af-border-subtle)"
                  strokeWidth="1"
                />
                <text
                  x={padding.left - 10}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="12"
                  fill="var(--af-text-tertiary)"
                >
                  {pct}%
                </text>
              </g>
            );
          })}

          {/* Y-axis label */}
          <text
            x={16}
            y={padding.top + plotH / 2}
            textAnchor="middle"
            transform={`rotate(-90, 16, ${padding.top + plotH / 2})`}
            fontSize="12"
            fill="var(--af-text-tertiary)"
          >
            Remaining budget (%)
          </text>

          {/* Danger (<10% remaining) and caution (10–30%) bands */}
          <rect
            x={padding.left}
            y={yScale(10)}
            width={plotW}
            height={yScale(0) - yScale(10)}
            fill="var(--af-danger)"
            fillOpacity="0.07"
          />
          <rect
            x={padding.left}
            y={yScale(30)}
            width={plotW}
            height={yScale(10) - yScale(30)}
            fill="var(--af-warning)"
            fillOpacity="0.05"
          />

          {/* Per-cycle rendering: ideal diagonal + actual burndown polyline */}
          {cycles.map((cycle, i) => {
            // Ideal diagonal endpoints (clipped to plot area)
            const idealX1 = clampX(cycle.startMs);
            const idealX2 = clampX(cycle.resetsAtMs);
            // Parametric form: remaining(t) = 100 - 100 * (t - startMs) / windowMs
            // Clamp requires computing Y at the clamped X.
            const idealY1 = yScale(
              100 - (100 * (unXScale(idealX1) - cycle.startMs)) / windowMs,
            );
            const idealY2 = yScale(
              100 - (100 * (unXScale(idealX2) - cycle.startMs)) / windowMs,
            );

            // Actual line — only snapshots within the visible range
            const visiblePts = cycle.points.filter(
              (p) => p.t >= startMs && p.t <= endMs,
            );
            const linePath = visiblePts
              .map(
                (p, j) =>
                  `${j === 0 ? "M" : "L"} ${xScale(p.t).toFixed(1)} ${yScale(p.remaining).toFixed(1)}`,
              )
              .join(" ");

            // Reset marker: vertical line at cycle end (skip if outside range
            // or if it's the very last cycle ending in the future)
            const showResetMarker =
              cycle.resetsAtMs >= startMs &&
              cycle.resetsAtMs <= endMs &&
              cycle.resetsAtMs <= Date.now();

            return (
              <g key={`cycle-${i}`}>
                {/* Ideal diagonal for this cycle */}
                <line
                  x1={idealX1}
                  y1={idealY1}
                  x2={idealX2}
                  y2={idealY2}
                  stroke="var(--af-text-tertiary)"
                  strokeOpacity="0.35"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />

                {/* Actual burndown line */}
                {linePath && (
                  <path
                    d={linePath}
                    fill="none"
                    stroke={colorVar}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}

                {/* Peak marker */}
                {cycle.peakT >= startMs && cycle.peakT <= endMs && (
                  <circle
                    cx={xScale(cycle.peakT)}
                    cy={yScale(100 - cycle.peak)}
                    r="3"
                    fill={colorVar}
                    stroke="var(--background)"
                    strokeWidth="1.5"
                  />
                )}

                {/* Reset boundary line */}
                {showResetMarker && (
                  <line
                    x1={xScale(cycle.resetsAtMs)}
                    y1={padding.top}
                    x2={xScale(cycle.resetsAtMs)}
                    y2={padding.top + plotH}
                    stroke="var(--af-text-tertiary)"
                    strokeOpacity="0.25"
                    strokeWidth="1"
                    strokeDasharray="1 3"
                  />
                )}
              </g>
            );
          })}

          {/* Current-time vertical marker */}
          {Date.now() >= startMs && Date.now() <= endMs && (
            <line
              x1={xScale(Date.now())}
              y1={padding.top}
              x2={xScale(Date.now())}
              y2={padding.top + plotH}
              stroke="var(--af-text-secondary)"
              strokeOpacity="0.5"
              strokeWidth="1"
            />
          )}

          {/* Hover crosshair */}
          {hover && (
            <g>
              <line
                x1={hover.x}
                y1={padding.top}
                x2={hover.x}
                y2={padding.top + plotH}
                stroke="var(--af-text-secondary)"
                strokeOpacity="0.6"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
              <circle
                cx={hover.x}
                cy={yScale(hover.remaining)}
                r="5"
                fill={colorVar}
                stroke="var(--background)"
                strokeWidth="2"
              />
            </g>
          )}

          {/* X-axis endpoint labels */}
          <text
            x={padding.left}
            y={height - 20}
            textAnchor="start"
            fontSize="11"
            fill="var(--af-text-tertiary)"
            suppressHydrationWarning
          >
            {formatAxisDate(startMs)}
          </text>
          <text
            x={width - padding.right}
            y={height - 20}
            textAnchor="end"
            fontSize="11"
            fill="var(--af-text-tertiary)"
            suppressHydrationWarning
          >
            {formatAxisDate(endMs)}
          </text>
          <text
            x={padding.left + plotW / 2}
            y={height - 6}
            textAnchor="middle"
            fontSize="11"
            fill="var(--af-text-tertiary)"
          >
            Time · {cycles.length} cycle{cycles.length === 1 ? "" : "s"} in view
          </text>
        </svg>

        {/* Hover tooltip */}
        {hover && (
          <div
            suppressHydrationWarning
            style={{
              pointerEvents: "none",
              position: "absolute",
              left: `${(hover.x / width) * 100}%`,
              top: 6,
              transform: "translateX(-50%)",
              background: "var(--af-surface-elevated)",
              border: "1px solid var(--af-border-subtle)",
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 11,
              boxShadow: "0 6px 24px rgba(0, 0, 0, 0.24)",
              whiteSpace: "nowrap",
              color: "var(--af-text)",
            }}
          >
            <div style={{ fontWeight: 600 }}>{new Date(hover.t).toLocaleString()}</div>
            <div style={{ marginTop: 2, display: "flex", gap: 10 }}>
              <div>
                <span style={{ color: "var(--af-text-tertiary)" }}>Remaining</span>{" "}
                <span
                  style={{
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                    color: colorVar,
                  }}
                >
                  {hover.remaining.toFixed(1)}%
                </span>
              </div>
              <div>
                <span style={{ color: "var(--af-text-tertiary)" }}>Used</span>{" "}
                <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                  {hover.u.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontSize: 9,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--af-text-tertiary)",
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: "-0.01em",
          color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function formatAxisDate(ms: number): string {
  const d = new Date(ms);
  const span = Math.abs(Date.now() - ms);
  // If the range is short (< 48h), show time; otherwise show date.
  if (span < 48 * 60 * 60 * 1000) {
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
