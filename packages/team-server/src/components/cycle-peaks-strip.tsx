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

  // Grid stays maxBars wide so bar width is consistent across members, but a
  // short history renders ONLY its real bars, right-aligned via column offset —
  // no grey placeholder tiles for cycles that never existed.
  const offset = Math.max(0, maxBars - visible.length);

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
      {visible.map((c, i) => (
        <div key={i} style={i === 0 ? { gridColumnStart: offset + 1 } : undefined}>
          <CycleBar cycle={c} />
        </div>
      ))}
    </div>
  );
}


function CycleBar({ cycle }: { cycle: MembershipCyclePeak }) {
  // Bar height / tone stay clamped to 100; the LABEL shows the true value so
  // an overage cycle reads "247%", not a misleading "100%".
  const pct = Math.max(0, Math.min(100, cycle.peakPct));
  const labelPct = Math.max(0, cycle.peakPct);
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
        {labelPct.toFixed(0)}%
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
