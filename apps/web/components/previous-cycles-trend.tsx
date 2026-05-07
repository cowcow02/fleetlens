import type { CyclePeak } from "@/lib/calibration-data";
import { utilizationVar } from "@/lib/utilization-tone";

// Horizontal bar chart of the last few cycles' peak utilization. One bar
// per cycle, height proportional to peak %. Color flips on utilization:
// ≥70% = success (full plan use), 40–69% = amber, <40% = danger (paying
// for unused headroom). Right-most bar is the in-progress cycle, dashed
// border + slight transparency so it doesn't read as a finished trend point.
export function PreviousCyclesTrend({
  windowLabel,
  cycles,
}: {
  windowLabel: "5h" | "7d";
  cycles: CyclePeak[];
}) {
  if (cycles.length === 0) return null;
  return (
    <section
      style={{
        border: "1px solid var(--af-border-subtle)",
        borderRadius: 8,
        padding: "12px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ fontSize: 13, margin: 0, fontWeight: 700 }}>
          Previous {windowLabel} cycles
        </h2>
        <span style={{ fontSize: 11, color: "var(--af-text-tertiary)" }}>
          peak utilization · oldest → newest
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--af-text-tertiary)" }}>
          {trendLabel(cycles)}
        </span>
      </header>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${cycles.length}, minmax(0, 1fr))`,
          gap: 8,
          alignItems: "end",
        }}
      >
        {cycles.map((c, i) => (
          <CycleBar key={i} cycle={c} />
        ))}
      </div>
    </section>
  );
}

function CycleBar({ cycle }: { cycle: CyclePeak }) {
  const pct = Math.max(0, Math.min(100, cycle.peakPct));
  const color = utilizationVar(pct);
  const date = new Date(cycle.endsAt);
  // Compact "Apr 23" date label; "current" cycle gets "ends Apr 30" instead
  const label = cycle.current
    ? `ends ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: 4,
      }}
      title={`${cycle.current ? "Current cycle ends" : "Cycle ended"} ${date.toLocaleString()}${cycle.source === "predicted" ? " · estimated from JSONL" : " · measured from daemon"}`}
    >
      <div
        style={{
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          color,
          fontWeight: 700,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {pct.toFixed(0)}%
      </div>
      <div
        style={{
          height: 80,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          background: "var(--af-border-subtle)",
          borderRadius: 4,
          opacity: cycle.current ? 0.85 : 1,
          // Dashed border on in-progress cycle so it visually distinguishes
          // from completed ones.
          border: cycle.current ? `1px dashed ${color}` : "none",
        }}
      >
        <div
          style={{
            height: `${pct}%`,
            background: color,
            borderRadius: 4,
            opacity: cycle.source === "predicted" ? 0.55 : 1,
            // Striped fill for predicted cycles so estimated values are
            // visually distinct from measured ones.
            backgroundImage:
              cycle.source === "predicted"
                ? `repeating-linear-gradient(45deg, transparent 0 4px, rgba(0,0,0,0.08) 4px 8px)`
                : undefined,
          }}
        />
      </div>
      <div
        style={{
          fontSize: 10,
          color: "var(--af-text-tertiary)",
          textAlign: "center",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.02em",
        }}
      >
        {label}
        {cycle.source === "predicted" && (
          <>
            {" "}
            <span style={{ color: "#b58400" }}>·est</span>
          </>
        )}
      </div>
    </div>
  );
}

// One-line trend hint over the last few cycles. We don't try to be clever —
// just compare last completed peak to the prior one and label up/down/flat.
function trendLabel(cycles: CyclePeak[]): string {
  const completed = cycles.filter((c) => !c.current);
  if (completed.length < 2) return "";
  const last = completed[completed.length - 1]!.peakPct;
  const prev = completed[completed.length - 2]!.peakPct;
  const delta = last - prev;
  if (Math.abs(delta) < 5) return `flat vs prior (${delta >= 0 ? "+" : ""}${delta.toFixed(0)}pp)`;
  if (delta > 0) return `↑ up ${delta.toFixed(0)}pp from prior`;
  return `↓ down ${Math.abs(delta).toFixed(0)}pp from prior`;
}
