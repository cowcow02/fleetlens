import "server-only";

export { listEntriesForDay, readDayDigest, writeDayDigest } from "@claude-lens/entries/fs";

export function toLocalDay(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function yesterdayLocal(nowMs: number = Date.now()): string {
  return toLocalDay(nowMs - 86_400_000);
}

export function todayLocal(nowMs: number = Date.now()): string {
  return toLocalDay(nowMs);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isValidDate(s: string): boolean {
  return DATE_RE.test(s);
}

const YEAR_MONTH_RE = /^\d{4}-\d{2}$/;
export function isValidYearMonth(s: string): boolean {
  return YEAR_MONTH_RE.test(s);
}

/** Monday of the ISO week containing localDay (Mon-Sun, server local TZ). */
export function mondayOf(localDay: string): string {
  const d = new Date(`${localDay}T00:00:00`);
  const dow = d.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + offset);
  return toLocalDay(d.getTime());
}

export function currentWeekMonday(nowMs: number = Date.now()): string {
  return mondayOf(todayLocal(nowMs));
}

/** Most recent COMPLETED week — last week's Monday. */
export function lastCompletedWeekMonday(nowMs: number = Date.now()): string {
  const thisMonday = currentWeekMonday(nowMs);
  const d = new Date(`${thisMonday}T00:00:00`);
  d.setDate(d.getDate() - 7);
  return toLocalDay(d.getTime());
}

export function currentYearMonth(nowMs: number = Date.now()): string {
  const today = todayLocal(nowMs);
  return today.slice(0, 7);
}

/** Validates and returns the Monday for `s` if `s` is itself a Monday in YYYY-MM-DD form. */
export function asMonday(s: string): string | null {
  if (!isValidDate(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  if (d.getDay() !== 1) return null;
  return s;
}
