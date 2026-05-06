import { listEntriesForDay, readDayDigest, readWeekDigest } from "@claude-lens/entries/fs";
import {
  readSettings, runDayDigestPipeline, runWeekDigestPipeline,
  weekDates, interactiveLockFresh,
} from "@claude-lens/entries/node";

export type BackfillReason =
  | "ai_disabled"
  | "autofill_disabled"
  | "already_cached"
  | "in_flight"
  | "no_entries"
  | "ok";

export type BackfillResult = {
  fired: boolean;
  reason: BackfillReason;
  /** Monday of the targeted week (YYYY-MM-DD), present when computable. */
  key?: string;
};

export type BackfillLogger = (level: "info" | "warn" | "error", msg: string) => void;

export type BackfillOptions = {
  now?: number;
  log?: BackfillLogger;
  /** Hook for tests to drive a synthetic pipeline instead of `runWeekDigestPipeline`. */
  runPipeline?: typeof runWeekDigestPipeline;
};

export type DayBackfillOptions = {
  now?: number;
  log?: BackfillLogger;
  /** Hook for tests to drive a synthetic pipeline instead of `runDayDigestPipeline`. */
  runPipeline?: typeof runDayDigestPipeline;
};

function toLocalDay(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function mondayOf(localDay: string): string {
  const d = new Date(`${localDay}T00:00:00`);
  const dow = d.getDay(); // 0=Sun, 1=Mon, ...
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + offset);
  return toLocalDay(d.getTime());
}

/** Most recent COMPLETED ISO week — last week's Monday. */
export function lastCompletedWeekMonday(nowMs: number = Date.now()): string {
  const thisMonday = mondayOf(toLocalDay(nowMs));
  const d = new Date(`${thisMonday}T00:00:00`);
  d.setDate(d.getDate() - 7);
  return toLocalDay(d.getTime());
}

/** Yesterday in local time (YYYY-MM-DD). */
export function yesterdayLocalDay(nowMs: number = Date.now()): string {
  return toLocalDay(nowMs - 86_400_000);
}

/**
 * Boot-time backfill of the most recently completed ISO week's narrative.
 *
 * "Already done?" is answered by the digest file on disk; "currently running?"
 * by the heartbeat-refreshed interactive pipeline lock. No standalone fire-
 * once-per-week file: a half-completed run leaves no digest and no fresh
 * lock, so the next caller (daemon boot, /insights visit) retries naturally.
 *
 * Best-effort: pipeline errors log warn but never crash the daemon.
 */
export async function backfillLastWeekDigest(
  opts: BackfillOptions = {},
): Promise<BackfillResult> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? Date.now();
  const monday = lastCompletedWeekMonday(now);
  const todayLocalDay = toLocalDay(now);
  const currentWeekMonday = mondayOf(todayLocalDay);

  const settings = readSettings();
  if (!settings.ai_features.enabled) {
    log("info", `auto-backfill: skipped (ai_disabled)`);
    return { fired: false, reason: "ai_disabled", key: monday };
  }
  if (!settings.ai_features.autoBackfillLastWeek) {
    log("info", `auto-backfill: skipped (autofill_disabled)`);
    return { fired: false, reason: "autofill_disabled", key: monday };
  }
  if (readWeekDigest(monday)) {
    log("info", `auto-backfill: skipped (already_cached)`);
    return { fired: false, reason: "already_cached", key: monday };
  }
  if (!weekDates(monday).some((d) => listEntriesForDay(d).length > 0)) {
    log("info", `auto-backfill: skipped (no_entries)`);
    return { fired: false, reason: "no_entries", key: monday };
  }
  if (interactiveLockFresh(now)) {
    log("info", `auto-backfill: skipped (in_flight)`);
    return { fired: false, reason: "in_flight", key: monday };
  }

  log("info", `auto-backfill: fired week-${monday}`);
  try {
    const run = opts.runPipeline ?? runWeekDigestPipeline;
    for await (const ev of run(monday, {
      settings: settings.ai_features,
      currentWeekMonday,
      todayLocalDay,
      caller: "daemon",
    })) {
      if (ev.type === "saved") log("info", `auto-backfill: ${ev.path}`);
      else if (ev.type === "error") log("warn", `auto-backfill: pipeline error — ${ev.message}`);
    }
  } catch (err) {
    log("warn", `auto-backfill: failed (${(err as Error).message})`);
  }
  return { fired: true, reason: "ok", key: monday };
}

/**
 * Boot-time backfill of yesterday's day digest.
 *
 * Mirrors backfillLastWeekDigest gates: ai_enabled → autofill flag →
 * cache-on-disk → entries-exist → interactive lock not fresh. The homepage
 * AutoGenerateYesterday trigger remains a fallback so users running with
 * --no-daemon still get the digest on first homepage visit.
 *
 * Best-effort: pipeline errors log warn but never crash the daemon.
 */
export async function backfillYesterdayDigest(
  opts: DayBackfillOptions = {},
): Promise<BackfillResult> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? Date.now();
  const yesterday = yesterdayLocalDay(now);
  const todayLocalDay = toLocalDay(now);

  const settings = readSettings();
  if (!settings.ai_features.enabled) {
    log("info", `auto-backfill-day: skipped (ai_disabled)`);
    return { fired: false, reason: "ai_disabled", key: yesterday };
  }
  if (!settings.ai_features.autoBackfillYesterday) {
    log("info", `auto-backfill-day: skipped (autofill_disabled)`);
    return { fired: false, reason: "autofill_disabled", key: yesterday };
  }
  if (readDayDigest(yesterday)) {
    log("info", `auto-backfill-day: skipped (already_cached)`);
    return { fired: false, reason: "already_cached", key: yesterday };
  }
  if (listEntriesForDay(yesterday).length === 0) {
    log("info", `auto-backfill-day: skipped (no_entries)`);
    return { fired: false, reason: "no_entries", key: yesterday };
  }
  if (interactiveLockFresh(now)) {
    log("info", `auto-backfill-day: skipped (in_flight)`);
    return { fired: false, reason: "in_flight", key: yesterday };
  }

  log("info", `auto-backfill-day: fired day-${yesterday}`);
  try {
    const run = opts.runPipeline ?? runDayDigestPipeline;
    for await (const ev of run(yesterday, {
      settings: settings.ai_features,
      todayLocalDay,
      caller: "daemon",
    })) {
      if (ev.type === "saved") log("info", `auto-backfill-day: ${ev.path}`);
      else if (ev.type === "error") log("warn", `auto-backfill-day: pipeline error — ${ev.message}`);
    }
  } catch (err) {
    log("warn", `auto-backfill-day: failed (${(err as Error).message})`);
  }
  return { fired: true, reason: "ok", key: yesterday };
}
