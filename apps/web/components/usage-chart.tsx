"use client";

import { useMemo, useState } from "react";
import { Maximize2 } from "lucide-react";
import type { UsageSnapshot, UsageWindow } from "@/lib/usage-data";

type SeriesKey = "five_hour" | "seven_day" | "seven_day_sonnet";

/**
 * Sprint-burndown-style chart for a single usage window.
 *
 * Y-axis: remaining budget (100% at start, 0% when quota is exhausted)
 * X-axis: time from window start to reset
 *
 * Ideal line: dashed diagonal from (windowStart, 100%) to (resetsAt, 0%)
 *   — the "sustainable burn" trajectory
 * Actual line: solid, plots (100 - utilization) at each snapshot's captured_at
 *
 * ABOVE the ideal line = saving budget (on track)
 * BELOW the ideal line = burning faster than sustainable (behind schedule)
 */
export function UsageChart({
  snapshots,
  seriesKey,
  windowMs,
  colorVar,
  onExpand,
}: {
  snapshots: UsageSnapshot[];
  seriesKey: SeriesKey;
  windowMs: number;
  /** CSS variable for this window's color (e.g. 'var(--af-success)') */
  colorVar: string;
  /** If provided, render a fullscreen-expand button that calls this handler. */
  onExpand?: () => void;
}) {
  // ViewBox dimensions chosen for a wide, compact chart that fits two
  // per MBP screen without scrolling while keeping the burndown line
  // readable. ~6.4:1 aspect works well at full page width.
  const width = 1280;
  const height = 200;
  const padding = { top: 20, right: 26, bottom: 42, left: 64 };

  const computed = useMemo(() => {
    const valid = snapshots
      .map((s) => ({ capturedAt: new Date(s.captured_at).getTime(), window: s[seriesKey] }))
      .filter(
        (x): x is { capturedAt: number; window: UsageWindow } =>
          x.window !== null && x.window.utilization !== null,
      );

    if (valid.length === 0) return null;

    const latest = valid[valid.length - 1]!;
    const resetsAt = latest.window.resets_at ? new Date(latest.window.resets_at).getTime() : null;
    if (!resetsAt) return null;

    const windowStart = resetsAt - windowMs;
    const now = Date.now();
    const currentRemaining = 100 - (latest.window.utilization ?? 0);

    const points = valid
      .filter((x) => x.capturedAt >= windowStart && x.capturedAt <= resetsAt)
      .map((x) => [x.capturedAt, 100 - (x.window.utilization ?? 0)] as const);

    return { points, windowStart, windowEnd: resetsAt, now, currentRemaining, latest };
  }, [snapshots, seriesKey, windowMs]);

  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const [hover, setHover] = useState<{ x: number; t: number; actual: number; ideal: number } | null>(
    null,
  );

  if (!computed) {
    return (
      <div
        className="af-card"
        style={{
          padding: "14px 18px",
          textAlign: "center",
          fontSize: 12,
          color: "var(--af-text-tertiary)",
        }}
      >
        No data for this window yet.
      </div>
    );
  }

  const { points, windowStart, windowEnd, now, currentRemaining, latest } = computed;

  const xScale = (t: number): number =>
    padding.left + ((t - windowStart) / (windowEnd - windowStart)) * plotW;
  const yScale = (v: number): number => padding.top + plotH - (v / 100) * plotH;
  const unXScale = (x: number): number =>
    windowStart + ((x - padding.left) / plotW) * (windowEnd - windowStart);

  const idealAt = (t: number): number => {
    const pctThroughWindow = (t - windowStart) / (windowEnd - windowStart);
    return Math.max(0, Math.min(100, 100 - pctThroughWindow * 100));
  };

  const nowIdeal = idealAt(now);
  const delta = currentRemaining - nowIdeal;
  const toneColor =
    delta < -10
      ? "var(--af-danger)"
      : delta < 0
        ? "var(--af-warning)"
        : "var(--af-success)";
  const toneLabel =
    delta < -10 ? "behind schedule" : delta < 0 ? "slightly behind" : "on track";

  const linePath =
    points.length > 0
      ? points
          .map(([t, v], i) => `${i === 0 ? "M" : "L"} ${xScale(t).toFixed(1)} ${yScale(v).toFixed(1)}`)
          .join(" ")
      : "";

  const areaPath =
    points.length > 0
      ? `${linePath} L ${xScale(points[points.length - 1]![0]).toFixed(1)} ${yScale(0).toFixed(1)} L ${xScale(points[0]![0]).toFixed(1)} ${yScale(0).toFixed(1)} Z`
      : "";

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * width;
    if (svgX < padding.left || svgX > width - padding.right) {
      setHover(null);
      return;
    }
    const t = unXScale(svgX);
    let nearest = points[0]!;
    let nearestDist = Math.abs(nearest[0] - t);
    for (const p of points) {
      const d = Math.abs(p[0] - t);
      if (d < nearestDist) {
        nearest = p;
        nearestDist = d;
      }
    }
    setHover({ x: xScale(nearest[0]), t: nearest[0], actual: nearest[1], ideal: idealAt(nearest[0]) });
  };

  return (
    <div className="af-card" style={{ padding: "14px 18px" }}>
      {/* Compact inline header: big pct + delta + reset, all one row (no title — provided by section label outside) */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 14,
          flexWrap: "wrap",
          marginBottom: 8,
        }}
      >
        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            color: colorVar,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {currentRemaining.toFixed(1)}%
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: "var(--af-text-tertiary)",
              marginLeft: 4,
              letterSpacing: 0,
            }}
          >
            remaining
          </span>
        </div>
        <div style={{ fontSize: 11, color: toneColor, fontWeight: 500 }}>
          {toneLabel} ({delta >= 0 ? "+" : ""}
          {delta.toFixed(1)}%)
        </div>
        <div
          suppressHydrationWarning
          style={{
            fontSize: 11,
            color: "var(--af-text-tertiary)",
            marginLeft: "auto",
          }}
        >
          {formatWindowSize(windowMs)} · resets{" "}
          {formatRelative(new Date(windowEnd).toISOString())}
        </div>
        {onExpand && (
          <button
            type="button"
            onClick={onExpand}
            aria-label="Expand chart"
            title="Expand"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 24,
              height: 24,
              borderRadius: 5,
              background: "transparent",
              border: "1px solid var(--af-border-subtle)",
              color: "var(--af-text-tertiary)",
              cursor: "pointer",
              marginLeft: 4,
            }}
          >
            <Maximize2 size={12} />
          </button>
        )}
      </div>

      {/* Chart + tooltip */}
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
                  stroke="var(--af-border-subtle)"
                  strokeWidth="1"
                />
                <text
                  x={padding.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="13"
                  fill="var(--af-text-tertiary)"
                >
                  {pct}%
                </text>
              </g>
            );
          })}

          {/* Y-axis label */}
          <text
            x={14}
            y={padding.top + plotH / 2}
            textAnchor="middle"
            transform={`rotate(-90, 14, ${padding.top + plotH / 2})`}
            fontSize="12"
            fill="var(--af-text-tertiary)"
          >
            Remaining budget (%)
          </text>

          {/* X-axis labels */}
          <text
            x={padding.left}
            y={height - 20}
            textAnchor="start"
            fontSize="12"
            fill="var(--af-text-tertiary)"
          >
            Start
          </text>
          <text
            x={width - padding.right}
            y={height - 20}
            textAnchor="end"
            fontSize="12"
            fill="var(--af-text-tertiary)"
          >
            Reset
          </text>
          <text
            x={padding.left + plotW / 2}
            y={height - 4}
            textAnchor="middle"
            fontSize="12"
            fill="var(--af-text-tertiary)"
          >
            Time
          </text>

          {/* Danger (<10% remaining) and caution (10–30%) bands at the bottom */}
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

          {/* Area fill under actual line */}
          <path d={areaPath} fill={colorVar} fillOpacity="0.1" />

          {/* Ideal diagonal (100% → 0%) */}
          <line
            x1={xScale(windowStart)}
            y1={yScale(100)}
            x2={xScale(windowEnd)}
            y2={yScale(0)}
            stroke="var(--af-text-tertiary)"
            strokeOpacity="0.5"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />

          {/* Current-time vertical marker */}
          {now >= windowStart && now <= windowEnd && (
            <g>
              <line
                x1={xScale(now)}
                y1={padding.top}
                x2={xScale(now)}
                y2={padding.top + plotH}
                stroke="var(--af-text-secondary)"
                strokeOpacity="0.5"
                strokeWidth="1"
              />
              <text
                x={xScale(now)}
                y={padding.top - 6}
                textAnchor="middle"
                fontSize="12"
                fontWeight="600"
                fill="var(--af-text-secondary)"
              >
                now
              </text>
            </g>
          )}

          {/* Actual data line */}
          <path
            d={linePath}
            fill="none"
            stroke={colorVar}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Data point dots */}
          {points.map(([t, v], i) => (
            <circle key={i} cx={xScale(t)} cy={yScale(v)} r="3" fill={colorVar} />
          ))}

          {/* Hover crosshair + highlight dot */}
          {hover && (
            <g>
              <line
                x1={hover.x}
                y1={padding.top}
                x2={hover.x}
                y2={padding.top + plotH}
                stroke="var(--af-text-secondary)"
                strokeOpacity="0.7"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
              <circle
                cx={hover.x}
                cy={yScale(hover.actual)}
                r="5"
                fill={colorVar}
                stroke="var(--af-surface)"
                strokeWidth="1.5"
              />
            </g>
          )}
        </svg>

        {/* HTML tooltip */}
        {hover && (
          <div
            style={{
              pointerEvents: "none",
              position: "absolute",
              left: `${(hover.x / width) * 100}%`,
              top: 4,
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
            <div style={{ marginTop: 4, display: "flex", gap: 12 }}>
              <div>
                <span style={{ color: "var(--af-text-tertiary)" }}>Actual</span>{" "}
                <span
                  style={{
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                    color: colorVar,
                  }}
                >
                  {hover.actual.toFixed(1)}%
                </span>
              </div>
              <div>
                <span style={{ color: "var(--af-text-tertiary)" }}>Ideal</span>{" "}
                <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                  {hover.ideal.toFixed(1)}%
                </span>
              </div>
            </div>
            <div style={{ marginTop: 2, color: "var(--af-text-tertiary)" }}>
              Δ {hover.actual - hover.ideal >= 0 ? "+" : ""}
              {(hover.actual - hover.ideal).toFixed(1)}%
            </div>
          </div>
        )}
      </div>

      {/* Footer — minimal: only the snapshot count & recency */}
      <div
        style={{
          marginTop: 4,
          fontSize: 9,
          color: "var(--af-text-tertiary)",
          fontFamily: "var(--font-mono)",
          textAlign: "right",
        }}
        suppressHydrationWarning
      >
        {points.length} snapshot{points.length === 1 ? "" : "s"} · last{" "}
        {formatRelative(new Date(latest.capturedAt).toISOString())}
      </div>
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
