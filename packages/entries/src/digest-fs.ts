import { readFileSync, readdirSync, writeFileSync, renameSync, chmodSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { cclensPath } from "@claude-lens/parser/fs";
import type { DayDigest, WeekDigest, MonthDigest } from "./types.js";

let digestsDirCached: string | null = null;

function digestsDir(): string {
  if (digestsDirCached) return digestsDirCached;
  const envOverride = process.env.CCLENS_DIGESTS_DIR;
  digestsDirCached = envOverride ?? cclensPath("digests");
  return digestsDirCached;
}

/** @internal Test-only. */
export function __setDigestsDirForTest(path: string): void {
  digestsDirCached = path;
  mkdirSync(join(path, "day"), { recursive: true });
  mkdirSync(join(path, "week"), { recursive: true });
  mkdirSync(join(path, "month"), { recursive: true });
}

function dayDigestPath(date: string): string {
  return join(digestsDir(), "day", `${date}.json`);
}

function weekDigestPath(monday: string): string {
  return join(digestsDir(), "week", `${monday}.json`);
}

function monthDigestPath(yearMonth: string): string {
  return join(digestsDir(), "month", `${yearMonth}.json`);
}

export function writeDayDigest(digest: DayDigest): void {
  const final = dayDigestPath(digest.key);
  mkdirSync(dirname(final), { recursive: true });
  const tmp = `${final}.tmp`;
  writeFileSync(tmp, JSON.stringify(digest, null, 2), "utf8");
  if (process.platform !== "win32") {
    try { chmodSync(tmp, 0o600); } catch { /* best-effort */ }
  }
  renameSync(tmp, final);
}

export function readDayDigest(date: string): DayDigest | null {
  const p = dayDigestPath(date);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as DayDigest;
  } catch {
    return null;
  }
}

// ─── Today's digest: in-memory TTL cache (10 minutes) ─────────────────────

type TodayCacheEntry = { date: string; digest: DayDigest; writtenAtMs: number };
const TODAY_TTL_MS = 10 * 60 * 1000;
let todayCache: TodayCacheEntry | null = null;

export function getTodayDigestFromCache(date: string, nowMs: number): DayDigest | null {
  if (!todayCache) return null;
  if (todayCache.date !== date) return null;
  if (nowMs - todayCache.writtenAtMs > TODAY_TTL_MS) return null;
  return todayCache.digest;
}

export function setTodayDigestInCache(date: string, digest: DayDigest, nowMs: number): void {
  todayCache = { date, digest, writtenAtMs: nowMs };
}

/** @internal Test-only. */
export function __clearTodayCacheForTest(): void {
  todayCache = null;
  currentWeekCache = null;
  currentMonthCache = null;
}

// ─── Week digests ─────────────────────────────────────────────────────────

export function writeWeekDigest(digest: WeekDigest): void {
  const final = weekDigestPath(digest.key);
  mkdirSync(dirname(final), { recursive: true });
  const tmp = `${final}.tmp`;
  writeFileSync(tmp, JSON.stringify(digest, null, 2), "utf8");
  if (process.platform !== "win32") {
    try { chmodSync(tmp, 0o600); } catch { /* best-effort */ }
  }
  renameSync(tmp, final);
}

export function readWeekDigest(monday: string): WeekDigest | null {
  const p = weekDigestPath(monday);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as WeekDigest;
  } catch {
    return null;
  }
}

export function listWeekDigestKeys(): string[] {
  const dir = join(digestsDir(), "week");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .map(f => f.slice(0, -".json".length))
    .filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k));
}

type CurrentWeekCacheEntry = { monday: string; digest: WeekDigest; writtenAtMs: number };
const CURRENT_WEEK_TTL_MS = 10 * 60 * 1000;
let currentWeekCache: CurrentWeekCacheEntry | null = null;

export function getCurrentWeekDigestFromCache(monday: string, nowMs: number): WeekDigest | null {
  if (!currentWeekCache) return null;
  if (currentWeekCache.monday !== monday) return null;
  if (nowMs - currentWeekCache.writtenAtMs > CURRENT_WEEK_TTL_MS) return null;
  return currentWeekCache.digest;
}

export function setCurrentWeekDigestInCache(monday: string, digest: WeekDigest, nowMs: number): void {
  currentWeekCache = { monday, digest, writtenAtMs: nowMs };
}

// ─── Month digests ────────────────────────────────────────────────────────

export function writeMonthDigest(digest: MonthDigest): void {
  const final = monthDigestPath(digest.key);
  mkdirSync(dirname(final), { recursive: true });
  const tmp = `${final}.tmp`;
  writeFileSync(tmp, JSON.stringify(digest, null, 2), "utf8");
  if (process.platform !== "win32") {
    try { chmodSync(tmp, 0o600); } catch { /* best-effort */ }
  }
  renameSync(tmp, final);
}

export function readMonthDigest(yearMonth: string): MonthDigest | null {
  const p = monthDigestPath(yearMonth);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as MonthDigest;
  } catch {
    return null;
  }
}

export function listMonthDigestKeys(): string[] {
  const dir = join(digestsDir(), "month");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .map(f => f.slice(0, -".json".length))
    .filter(k => /^\d{4}-\d{2}$/.test(k));
}

type CurrentMonthCacheEntry = { yearMonth: string; digest: MonthDigest; writtenAtMs: number };
const CURRENT_MONTH_TTL_MS = 10 * 60 * 1000;
let currentMonthCache: CurrentMonthCacheEntry | null = null;

export function getCurrentMonthDigestFromCache(yearMonth: string, nowMs: number): MonthDigest | null {
  if (!currentMonthCache) return null;
  if (currentMonthCache.yearMonth !== yearMonth) return null;
  if (nowMs - currentMonthCache.writtenAtMs > CURRENT_MONTH_TTL_MS) return null;
  return currentMonthCache.digest;
}

export function setCurrentMonthDigestInCache(yearMonth: string, digest: MonthDigest, nowMs: number): void {
  currentMonthCache = { yearMonth, digest, writtenAtMs: nowMs };
}
