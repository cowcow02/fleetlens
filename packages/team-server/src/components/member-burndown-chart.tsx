import type { CurrentCycleData } from "../lib/plan-queries";
import { paceLabel, toneHex } from "../lib/utilization-tone";

// Server-rendered burndown chart for the in-progress 7-day cycle.
// Visual mirrors the personal /usage page's UsageChart:
//   y-axis: remaining budget % (100 at start, 0 at exhaustion)
//   x-axis: time from cycle start to next reset
//   dashed diagonal: full-utilization trajectory
//   solid line: actual remaining-budget over time
//   "now" marker so admins see where in the cycle we are
//
// Pace label flips with the rest of the dashboard: burning at or above
// pace is GOOD (getting plan value); under-burning is the warning state.
//
// Pure SVG, no client JS.
export function MemberBurndownChart({ cycle }: { cycle: CurrentCycleData }) {
  const width = 1100;
  const height = 140;
  const pad = { top: 16, right: 24, bottom: 26, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  if (cycle.snapshots.length === 0) {
    return (
      <div
        className="af-card"
        style={{ padding: "24px 18px", textAlign: "center", fontSize: 12, color: "var(--mute)" }}
      >
        No snapshots in the current cycle yet.
      </div>
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
  const showNow = nowMs >= cycle.startMs && nowMs <= cycle.endMs;
  const latest = points[points.length - 1]!;
  const latestUtil = 100 - latest.remaining;
  const expectedAtNow = (1 - (nowMs - cycle.startMs) / (cycle.endMs - cycle.startMs)) * 100;
  const burnDelta = latest.remaining - expectedAtNow;
  const pace = paceLabel(burnDelta);
  const burnLabel = pace.label;
  const burnColor = toneHex(pace.tone);

  return (
    <div className="af-card" style={{ padding: "10px 14px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 14,
          flexWrap: "wrap",
          marginBottom: 6,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)" }}>
          {(100 - latestUtil).toFixed(0)}%{" "}
          <span style={{ fontSize: 11, fontWeight: 500, color: "var(--mute)", marginLeft: 4 }}>
            remaining
          </span>
        </div>
        <div style={{ fontSize: 11, color: burnColor, fontWeight: 600 }}>
          {burnLabel}
          {Math.abs(burnDelta) >= 0.5 && (
            <span style={{ marginLeft: 4, fontWeight: 400 }}>
              ({burnDelta >= 0 ? "+" : ""}
              {burnDelta.toFixed(0)}pp vs ideal)
            </span>
          )}
        </div>
        <div
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "var(--mute)",
            fontFamily: "var(--font-mono)",
          }}
        >
          resets {formatRelative(cycle.endMs)}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: "100%", aspectRatio: `${width} / ${height}`, display: "block" }}
      >
        {/* gridlines + y-axis labels */}
        {[0, 25, 50, 75, 100].map((pct) => {
          const y = yScale(pct);
          return (
            <g key={pct}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y}
                y2={y}
                stroke="var(--rule)"
                strokeWidth="1"
              />
              <text
                x={pad.left - 6}
                y={y + 4}
                textAnchor="end"
                fontSize="10"
                fill="var(--mute)"
              >
                {pct}%
              </text>
            </g>
          );
        })}
        {/* No static bands. Low-remaining used to be flagged red, but in
            the "high use = good" framing that band is the goal zone. */}
        {/* Ideal diagonal — start of cycle (100% remaining) → reset (0%) */}
        <line
          x1={xScale(cycle.startMs)}
          y1={yScale(100)}
          x2={xScale(cycle.endMs)}
          y2={yScale(0)}
          stroke="var(--mute)"
          strokeOpacity="0.5"
          strokeWidth="1.2"
          strokeDasharray="4 3"
        />
        {/* Filled area under actual line */}
        <path d={filled} fill="#2c6e49" fillOpacity="0.1" />
        {/* Actual burndown line */}
        <path
          d={path}
          fill="none"
          stroke="#2c6e49"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Snapshot dots */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={xScale(p.t)}
            cy={yScale(p.remaining)}
            r="2.5"
            fill="#2c6e49"
          />
        ))}
        {/* "now" vertical marker */}
        {showNow && (
          <g>
            <line
              x1={xScale(nowMs)}
              y1={pad.top}
              x2={xScale(nowMs)}
              y2={pad.top + plotH}
              stroke="var(--ink)"
              strokeOpacity="0.4"
              strokeWidth="1"
            />
            <text
              x={xScale(nowMs)}
              y={pad.top - 4}
              textAnchor="middle"
              fontSize="9"
              fill="var(--mute)"
              fontFamily="var(--font-mono)"
            >
              now
            </text>
          </g>
        )}
        {/* x-axis labels: cycle start + reset */}
        <text
          x={pad.left}
          y={height - 8}
          textAnchor="start"
          fontSize="10"
          fill="var(--mute)"
          fontFamily="var(--font-mono)"
        >
          {formatDate(cycle.startMs)}
        </text>
        <text
          x={width - pad.right}
          y={height - 8}
          textAnchor="end"
          fontSize="10"
          fill="var(--mute)"
          fontFamily="var(--font-mono)"
        >
          {formatDate(cycle.endMs)}
        </text>
      </svg>
    </div>
  );
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatRelative(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return "now";
  const totalH = Math.floor(diff / 3_600_000);
  const days = Math.floor(totalH / 24);
  const hours = totalH % 24;
  if (days > 0) return `in ${days}d ${hours}h`;
  return `in ${totalH}h`;
}
