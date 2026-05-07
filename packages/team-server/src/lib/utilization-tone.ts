/**
 * Utilization tone — same flip as the personal edition's
 * apps/web/lib/utilization-tone.ts. Kept in sync by hand; if either
 * thresholds drift, both editions will read inconsistently.
 *
 * High usage = good (getting plan value).
 * Low usage  = bad (paying for unused headroom).
 */

export type Tone = "success" | "warning" | "danger";

export const UTILIZATION_THRESHOLDS = { good: 70, low: 40 } as const;

export function utilizationTone(pct: number): Tone {
  if (pct >= UTILIZATION_THRESHOLDS.good) return "success";
  if (pct >= UTILIZATION_THRESHOLDS.low) return "warning";
  return "danger";
}

export function toneHex(tone: Tone): string {
  switch (tone) {
    case "success":
      return "#2c6e49";
    case "warning":
      return "#b58400";
    case "danger":
      return "#a93b2c";
  }
}

export function utilizationHex(pct: number): string {
  return toneHex(utilizationTone(pct));
}

/**
 * Pace label for the burndown chart.
 *
 * delta = currentRemaining − idealRemaining
 *   +ve  → under-burning (saving plan = wasting it)
 *   -ve  → over-burning (using more than ideal — good, up to a point)
 *
 * Both extremes warn:
 *   delta > 20  → "barely used"
 *   delta > 5   → "underutilizing"
 *   delta < -50 → "outpacing"
 *   else        → "on pace"
 */
export function paceLabel(delta: number): { tone: Tone; label: string } {
  if (delta < -50) return { tone: "danger", label: "outpacing" };
  if (delta > 20) return { tone: "danger", label: "barely used" };
  if (delta > 5) return { tone: "warning", label: "underutilizing" };
  return { tone: "success", label: "on pace" };
}

/**
 * Tone for an in-progress cycle/gauge — derived from pace (utilization vs
 * elapsed-fraction-of-cycle), not from absolute peak. Mid-cycle 50% on a
 * 7-day window means you're on pace (green) even though peak-tone would
 * call it amber. Use this for live cycles, `utilizationTone()` for
 * completed ones.
 */
export function paceToneForCycle(
  utilizationPct: number,
  cycleEndsAtMs: number,
  windowMs: number,
  nowMs: number = Date.now(),
): Tone {
  const cycleStart = cycleEndsAtMs - windowMs;
  const elapsed = Math.max(0, Math.min(1, (nowMs - cycleStart) / windowMs));
  const idealUsedPct = elapsed * 100;
  return paceLabel(idealUsedPct - utilizationPct).tone;
}
