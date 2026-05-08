/**
 * Utilization tone — same flip as the personal edition.
 * Kept in sync by hand; if either thresholds drift, both editions will read
 * inconsistently.
 *
 * High usage = good (getting plan value).
 * Low usage  = bad (paying for unused headroom).
 *
 * SYNC: apps/web/lib/utilization-tone.ts
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
 * Pace label for the burndown chart. Three states only — describing
 * the pattern, not judging it. ±15pp band around ideal is "on pace";
 * outside that, we name what's happening.
 *
 * delta = currentRemaining − idealRemaining
 *   delta < -15 → "may exhaust early" (danger — over-burning)
 *   delta > 15  → "below pace"        (warning — under-burn)
 *   else        → "on pace"           (success)
 *
 * The band is wider than feels intuitive on purpose: a 7d cycle has
 * ~14pp/day of ideal burn, so anything tighter flips amber every time
 * the user takes a night off.
 */
export function paceLabel(delta: number): { tone: Tone; label: string } {
  if (delta < -15) return { tone: "danger", label: "may exhaust early" };
  if (delta > 15) return { tone: "warning", label: "below pace" };
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
