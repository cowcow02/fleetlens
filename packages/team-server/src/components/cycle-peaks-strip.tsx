import type { MembershipCyclePeak } from "../lib/plan-queries";
import { utilizationHex } from "../lib/utilization-tone";

// Horizontal bar trend of recent 7d cycle peaks. Mirrors the visual on
// the personal /usage page. Bar height = peak utilization. Color flips on
// utilization: ≥70% = green (full plan use), 40–69% = amber, <40% = red
// (paying for unused headroom). Striped fill on cycles whose peak came
// from JSONL prediction; dashed border on the in-progress cycle.
export function CyclePeaksStrip({
  cycles,
  maxBars = 8,
}: {
  cycles: MembershipCyclePeak[];
  maxBars?: number;
}) {
  if (cycles.length === 0) {
    return (
      <span style={{ color: "var(--mute)", fontSize: 11, fontStyle: "italic" }}>
        no cycle data yet
      </span>
    );
  }
  const visible = cycles.slice(-maxBars);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))`,
        gap: 4,
        alignItems: "end",
        minWidth: 0,
      }}
    >
      {visible.map((c, i) => (
        <CycleBar key={i} cycle={c} />
      ))}
    </div>
  );
}

function CycleBar({ cycle }: { cycle: MembershipCyclePeak }) {
  const pct = Math.max(0, Math.min(100, cycle.peakPct));
  const color = utilizationHex(pct);
  const dateLabel = cycle.endsAt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <div
      title={`${cycle.isCurrent ? "Current cycle ends" : "Cycle ended"} ${cycle.endsAt.toLocaleString()}${cycle.source === "predicted" ? " · estimated from JSONL" : " · measured from daemon"}`}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: 2,
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 9,
          color,
          fontWeight: 700,
          textAlign: "right",
          letterSpacing: "0.02em",
        }}
      >
        {pct.toFixed(0)}%
      </div>
      <div
        style={{
          height: 36,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          background: "var(--rule)",
          borderRadius: 2,
          opacity: cycle.isCurrent ? 0.85 : 1,
          border: cycle.isCurrent ? `1px dashed ${color}` : "none",
        }}
      >
        <div
          style={{
            height: `${pct}%`,
            background: color,
            borderRadius: 2,
            opacity: cycle.source === "predicted" ? 0.55 : 1,
            backgroundImage:
              cycle.source === "predicted"
                ? "repeating-linear-gradient(45deg, transparent 0 3px, rgba(0,0,0,0.1) 3px 6px)"
                : undefined,
          }}
        />
      </div>
      <div
        className="mono"
        style={{
          fontSize: 9,
          color: "var(--mute)",
          textAlign: "center",
        }}
      >
        {dateLabel}
      </div>
    </div>
  );
}
