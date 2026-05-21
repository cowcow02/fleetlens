import type { CurrentCycleData } from "../lib/plan-queries";
import { paceLabel, toneHex } from "../lib/utilization-tone";

// Server-rendered mini burndown chart SVG for tables.
// Visual matches the full-size MemberBurndownChart but is compact:
//   width = 120, height = 30
//   y-axis: remaining budget % (100 at start, 0 at exhaustion)
//   x-axis: time from cycle start to next reset
//   dashed diagonal: full-utilization trajectory
//   solid line: actual remaining-budget over time
//   color changes based on pace tone (green/yellow/red)
// Pure SVG, no client-side Javascript.
export function MiniBurndownChart({ cycle }: { cycle: CurrentCycleData }) {
  const width = 120;
  const height = 30;
  const pad = { top: 2, right: 2, bottom: 2, left: 2 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  if (!cycle || cycle.snapshots.length === 0) {
    return (
      <div
        style={{
          width,
          height,
          background: "var(--rule)",
          opacity: 0.15,
          borderRadius: 2,
        }}
      />
    );
  }

  const xScale = (t: number) =>
    pad.left + ((t - cycle.startMs) / (cycle.endMs - cycle.startMs)) * plotW;
  const yScale = (v: number) => pad.top + plotH - (v / 100) * plotH;

  // Build the actual-remaining-budget polyline.
  const points = cycle.snapshots.map((s) => ({
    t: s.capturedAt.getTime(),
    remaining: 100 - s.utilization,
  }));
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.t).toFixed(1)} ${yScale(p.remaining).toFixed(1)}`)
    .join(" ");
  const filled = `${path} L ${xScale(points[points.length - 1]!.t).toFixed(1)} ${yScale(0).toFixed(1)} L ${xScale(points[0]!.t).toFixed(1)} ${yScale(0).toFixed(1)} Z`;

  const nowMs = Date.now();
  const latest = points[points.length - 1]!;
  const expectedAtNow = (1 - (nowMs - cycle.startMs) / (cycle.endMs - cycle.startMs)) * 100;
  const burnDelta = latest.remaining - expectedAtNow;
  const pace = paceLabel(burnDelta);
  const burnColor = toneHex(pace.tone);

  return (
    <svg
      width={width}
      height={height}
      style={{ display: "block", overflow: "visible" }}
    >
      <title>{`${(100 - latest.remaining).toFixed(0)}% peak · ${pace.label}`}</title>
      {/* Ideal diagonal — start of cycle (100% remaining) → reset (0%) */}
      <line
        x1={xScale(cycle.startMs)}
        y1={yScale(100)}
        x2={xScale(cycle.endMs)}
        y2={yScale(0)}
        stroke="var(--mute)"
        strokeOpacity="0.35"
        strokeWidth="1"
        strokeDasharray="2 2"
      />
      {/* Filled area under actual line */}
      <path d={filled} fill={burnColor} fillOpacity="0.08" />
      {/* Actual burndown line */}
      <path
        d={path}
        fill="none"
        stroke={burnColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Latest dot */}
      {points.length > 0 && (
        <circle
          cx={xScale(points[points.length - 1]!.t)}
          cy={yScale(points[points.length - 1]!.remaining)}
          r="2"
          fill={burnColor}
        />
      )}
    </svg>
  );
}
