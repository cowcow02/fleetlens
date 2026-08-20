/**
 * Time-adjusted burn rate for 7-day and monthly plan windows.
 *
 *   delta_pp = elapsed% of the window − used%
 *
 * Positive = burning slower than even spend (quota will expire unused).
 * Negative = burning faster than even spend (may exhaust before reset).
 * |delta_pp| ≤ 15 is on track — same ±15pp band as the /usage burndown
 * labels, so a night off does not flip the verdict.
 *
 * 5-hour windows are burst limiters and are never scored.
 */

export const PACE_BAND_PP = 15;
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export type PaceVerdict = "on_track" | "slow" | "fast";

export type WindowPace = {
  used_pct: number;
  elapsed_pct: number;
  /** elapsed_pct − used_pct. + = slow, − = fast. */
  delta_pp: number;
  verdict: PaceVerdict;
};

export type SnapshotPace = {
  seven_day?: WindowPace;
  monthly?: WindowPace;
};

/** Shared with `usage --json` and `--compact` so agents get one schema. */
export const PACE_LEGEND =
  "pace.delta_pp=elapsed_pct-used_pct of 7d/30d (+slow quota-expires / -fast may-exhaust; |delta_pp|<=15 on_track)";

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function paceVerdict(deltaPp: number): PaceVerdict {
  if (deltaPp < -PACE_BAND_PP) return "fast";
  if (deltaPp > PACE_BAND_PP) return "slow";
  return "on_track";
}

/** UTC calendar month ending at `resetsAt` (Copilot 1st-of-month and Command Code period-end). */
export function monthlyWindowMs(resetsAt: Date): number {
  const start = addUtcMonths(resetsAt, -1);
  return Math.max(HOUR_MS, resetsAt.getTime() - start.getTime());
}

export function addUtcMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const targetMonth = ((m % 12) + 12) % 12;
  const targetYear = y + Math.floor(m / 12);
  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(day, lastDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

export function windowPace(opts: {
  usedPct: number;
  resetsAtMs: number;
  windowMs: number;
  nowMs?: number;
}): WindowPace | null {
  const { usedPct, resetsAtMs, windowMs } = opts;
  if (
    !Number.isFinite(usedPct) ||
    !Number.isFinite(resetsAtMs) ||
    !Number.isFinite(windowMs) ||
    windowMs <= 0
  ) {
    return null;
  }
  const nowMs = opts.nowMs ?? Date.now();
  const startMs = resetsAtMs - windowMs;
  const elapsedPct = Math.max(0, Math.min(100, ((nowMs - startMs) / windowMs) * 100));
  const used = Math.max(0, Math.min(100, usedPct));
  const deltaPp = round1(elapsedPct - used);
  return {
    used_pct: round1(used),
    elapsed_pct: round1(elapsedPct),
    delta_pp: deltaPp,
    verdict: paceVerdict(deltaPp),
  };
}

export function paceForWindow(
  window: { utilization: number | null; resets_at: string | null } | null | undefined,
  kind: "seven_day" | "monthly",
  nowMs?: number,
): WindowPace | null {
  if (!window || window.utilization === null || !window.resets_at) return null;
  const resetsAtMs = Date.parse(window.resets_at);
  if (!Number.isFinite(resetsAtMs)) return null;
  const windowMs = kind === "monthly" ? monthlyWindowMs(new Date(resetsAtMs)) : SEVEN_DAYS_MS;
  return windowPace({
    usedPct: window.utilization,
    resetsAtMs,
    windowMs,
    nowMs,
  });
}

export function paceForSnapshot(
  snapshot: {
    seven_day?: { utilization: number | null; resets_at: string | null } | null;
    monthly?: { utilization: number | null; resets_at: string | null } | null;
  },
  nowMs?: number,
): SnapshotPace | undefined {
  const seven_day = paceForWindow(snapshot.seven_day, "seven_day", nowMs) ?? undefined;
  const monthly = paceForWindow(snapshot.monthly, "monthly", nowMs) ?? undefined;
  if (!seven_day && !monthly) return undefined;
  return { ...(seven_day ? { seven_day } : {}), ...(monthly ? { monthly } : {}) };
}
