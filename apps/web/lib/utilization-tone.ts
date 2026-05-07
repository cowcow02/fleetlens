/**
 * Utilization tone — the "high usage = good" framing.
 *
 * Paying for a plan and barely touching it is the wasteful outcome,
 * not the safe one. ≥70% peaks = getting value (green). <40% = paying
 * for headroom you don't need (red). Throttling (real wall hits) is
 * tracked separately and stays red regardless.
 */

export type Tone = "success" | "warning" | "danger";

export const UTILIZATION_THRESHOLDS = { good: 70, low: 40 } as const;

export function utilizationTone(pct: number): Tone {
  if (pct >= UTILIZATION_THRESHOLDS.good) return "success";
  if (pct >= UTILIZATION_THRESHOLDS.low) return "warning";
  return "danger";
}

export function toneVar(tone: Tone): string {
  switch (tone) {
    case "success":
      return "var(--af-success)";
    case "warning":
      return "#b58400";
    case "danger":
      return "var(--af-danger)";
  }
}

export function utilizationVar(pct: number): string {
  return toneVar(utilizationTone(pct));
}

/**
 * Pace label for the burndown chart. Wording stays factual and
 * non-evaluative — the dashboard describes the pattern, the operator
 * decides whether anything needs to change. "Below pace" = lower than
 * the ideal-use trajectory at this point in the cycle, not a verdict
 * on the person.
 *
 * delta = currentRemaining − idealRemaining
 *   delta > 20  → "well below pace"    (danger color — admin financial signal)
 *   delta > 5   → "below pace"         (warning color)
 *   delta < -50 → "may exhaust early"  (danger color — throttling risk)
 *   else        → "on pace"            (success color)
 */
export function paceLabel(delta: number): { tone: Tone; label: string } {
  if (delta < -50) return { tone: "danger", label: "may exhaust early" };
  if (delta > 20) return { tone: "danger", label: "well below pace" };
  if (delta > 5) return { tone: "warning", label: "below pace" };
  return { tone: "success", label: "on pace" };
}

/**
 * Tone for an in-progress cycle/gauge — derived from pace (utilization vs
 * elapsed-fraction-of-cycle), not from absolute peak. A 50% peak halfway
 * through a cycle is on pace = green; the same 50% peak in a completed
 * cycle is moderate-use = amber. Use `utilizationTone()` for completed
 * cycles, this for live ones.
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
