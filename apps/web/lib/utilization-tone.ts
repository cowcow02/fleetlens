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
 * Pace label for the burndown chart. Three states only — describing
 * the pattern, not judging it. The "may exhaust early" label is the
 * one place we still flag actionable risk (throttling before reset).
 *
 * delta = currentRemaining − idealRemaining
 *   delta < -50 → "may exhaust early" (danger — throttling risk)
 *   delta > 5   → "below pace"        (warning — under-burn)
 *   else        → "on pace"           (success — at or above the line)
 */
export function paceLabel(delta: number): { tone: Tone; label: string } {
  if (delta < -50) return { tone: "danger", label: "may exhaust early" };
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
