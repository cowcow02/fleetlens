import type { MembershipCyclePeak } from "../lib/plan-queries";
import {
  paceToneForCycle,
  toneHex,
  utilizationTone,
} from "../lib/utilization-tone";

const SEVEN_DAYS_MS = 7 * 24 * 3_600_000;

// Horizontal bar trend of recent 7d cycle peaks. Bar height = peak
// utilization. Color depends on cycle state: completed cycles use the
// final peak (≥70% green = full plan use, <40% red = wasted headroom);
// the in-progress cycle uses PACE (utilization vs elapsed cycle
// fraction) so a 50% peak halfway through reads on-pace green, not
// amber. Striped fill = predicted from JSONL; dashed border = current.
export function CyclePeaksStrip({
  cycles,
  maxBars = 4,
  includeCurrent = true,
}: {
  cycles: MembershipCyclePeak[];
  maxBars?: number;
  includeCurrent?: boolean;
}) {
  const filtered = includeCurrent ? cycles : cycles.filter((c) => !c.isCurrent);

  if (filtered.length === 0) {
    return (
      <span style={{ color: "var(--mute)", fontSize: 11, fontStyle: "italic" }}>
        {includeCurrent ? "no cycles yet" : "no completed cycles yet"}
      </span>
    );
  }

  const visible = filtered.slice(-maxBars);

  // Pad left with nulls to ensure a consistent, right-aligned maxBars grid structure
  const padded = [
    ...Array(Math.max(0, maxBars - visible.length)).fill(null),
    ...visible,
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${maxBars}, minmax(0, 1fr))`,
        gap: 4,
        alignItems: "end",
        minWidth: 0,
      }}
    >
      {padded.map((c, i) =>
        c ? <CycleBar key={i} cycle={c} /> : <EmptyCycleBar key={i} />
      )}
    </div>
  );
}

function EmptyCycleBar() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: 2,
      }}
    >
      <div style={{ fontSize: 9, height: 11 }} />
      <div
        style={{
          height: 36,
          background: "var(--rule)",
          borderRadius: 2,
          opacity: 0.15,
        }}
      />
      <div style={{ fontSize: 9, height: 11 }} />
    </div>
  );
}


function CycleBar({ cycle }: { cycle: MembershipCyclePeak }) {
  const pct = Math.max(0, Math.min(100, cycle.peakPct));
  const tone = cycle.isCurrent
    ? paceToneForCycle(pct, cycle.endsAt.getTime(), SEVEN_DAYS_MS)
    : utilizationTone(pct);
  const color = toneHex(tone);
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
