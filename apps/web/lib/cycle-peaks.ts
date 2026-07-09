// Pure helpers for deriving per-cycle peak utilization from the daemon's
// calibration curve. Lives separately from calibration-data.ts so it can
// be imported in unit tests (calibration-data.ts pulls in `server-only`
// for its fs-touching helpers).

export type CalibrationCurvePoint = {
  ts: string;
  real_5h: number | null;
  pred_5h: number;
  real_7d: number | null;
  pred_7d: number;
  cycle_end_5h?: string | null;
  cycle_end_7d?: string | null;
};

export type CalibrationLike = {
  curve: CalibrationCurvePoint[];
};

export type CyclePeak = {
  endsAt: string;
  peakPct: number;
  source: "real" | "predicted";
  current: boolean;
};

const HOUR = 3_600_000;

/** History of recent cycles for trend visuals. Each entry is one full
 *  cycle — `current: true` for the in-progress cycle, completed otherwise.
 *  Limited to the last `maxCycles` so the visual stays compact. */
export function previousCyclesTrend(
  dump: CalibrationLike | null,
  window: "5h" | "7d",
  maxCycles = 6,
  nowMs: number = Date.now(),
): CyclePeak[] {
  if (!dump || dump.curve.length < 2) return [];
  const cycleKey: "cycle_end_5h" | "cycle_end_7d" = window === "5h" ? "cycle_end_5h" : "cycle_end_7d";
  const predKey: "pred_5h" | "pred_7d" = window === "5h" ? "pred_5h" : "pred_7d";
  const realKey: "real_5h" | "real_7d" = window === "5h" ? "real_5h" : "real_7d";

  // Hour-round the cycle key so millisecond-jittered resets collapse, then
  // merge adjacent buckets within a window-specific tolerance. Anthropic's
  // rolling 7-day window can slide its anchor by a few hours within the
  // SAME cycle (different polls report different `seven_day.resets_at`
  // values); without this merge, a cycle that slid would render as two
  // bars labeled the same day. The 5-hour cycle's anchor is stable, so we
  // don't merge there beyond hour-rounding — distinct 5h cycles would
  // otherwise collapse.
  const TOLERANCE_MS = window === "7d" ? 12 * HOUR : 0;
  const byCycle = new Map<number, CalibrationCurvePoint[]>();
  for (const p of dump.curve) {
    const k = p[cycleKey];
    if (!k) continue;
    const ms = Date.parse(k);
    if (Number.isNaN(ms)) continue;
    const bucket = Math.round(ms / HOUR) * HOUR;
    const arr = byCycle.get(bucket) ?? [];
    arr.push(p);
    byCycle.set(bucket, arr);
  }
  const merged = mergeAdjacentBuckets(byCycle, TOLERANCE_MS);

  const cycles: CyclePeak[] = [];
  for (const { endMs, points } of merged) {
    let peak = 0;
    let source: "real" | "predicted" = "predicted";
    for (const p of points) {
      const r = p[realKey];
      if (typeof r === "number" && r > peak) { peak = r; source = "real"; }
      // Predicted is a forward extrapolation with no upper anchor — across a
      // snapshot gap on a heavy-spend stretch it runs past 100pp and overflows
      // the bar. Utilization is a share of the plan limit, so cap it. Real
      // readings are left alone: extra-usage overage can exceed 100.
      const v = Math.min(p[predKey] ?? 0, 100);
      if (v > peak) { peak = v; source = "predicted"; }
    }
    cycles.push({
      endsAt: new Date(endMs).toISOString(),
      peakPct: Math.round(peak * 10) / 10,
      source,
      current: endMs > nowMs,
    });
  }
  return cycles.slice(-maxCycles);
}

/** Merge buckets whose end-times are within `toleranceMs` of each other.
 *  Output sorted ascending by `endMs`. Each merged bucket adopts the
 *  LATEST endMs (so the rendered label reflects the most recent reset
 *  boundary) and the union of points from all merged buckets. */
export function mergeAdjacentBuckets<P>(
  byCycle: Map<number, P[]>,
  toleranceMs: number,
): Array<{ endMs: number; points: P[] }> {
  const merged: Array<{ endMs: number; points: P[] }> = [];
  for (const [endMs, points] of Array.from(byCycle.entries()).sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && endMs - last.endMs <= toleranceMs) {
      last.endMs = endMs;
      last.points.push(...points);
    } else {
      merged.push({ endMs, points: [...points] });
    }
  }
  return merged;
}
