import { readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { cclensPath } from "@claude-lens/parser/fs";
import { entryKey, parseEntryKey, type Entry, type EntryEnrichmentStatus } from "./types.js";

let entriesDirCached: string | null = null;

export function entriesDir(): string {
  if (entriesDirCached) return entriesDirCached;
  const envOverride = process.env.CCLENS_ENTRIES_DIR;
  entriesDirCached = envOverride ?? cclensPath("entries");
  return entriesDirCached;
}

/** @internal Test-only. Do not use in production. */
export function __setEntriesDirForTest(path: string): void {
  entriesDirCached = path;
  mkdirSync(path, { recursive: true });
}

function pathFor(sessionId: string, localDay: string): string {
  return join(entriesDir(), `${entryKey(sessionId, localDay)}.json`);
}

/** Per-process unique tmp path so concurrent writers to the same key don't
 *  collide on the rename. Without this, two writers using the same `.tmp`
 *  suffix would interleave bytes and produce a corrupted file or fail with
 *  EEXIST on rename. */
function tmpPathFor(final: string): string {
  return `${final}.tmp.${process.pid}.${randomBytes(4).toString("hex")}`;
}

export function writeEntry(entry: Entry): void {
  const dir = entriesDir();
  mkdirSync(dir, { recursive: true });
  const final = pathFor(entry.session_id, entry.local_day);
  const tmp = tmpPathFor(final);
  const json = JSON.stringify(entry, null, 2);
  writeFileSync(tmp, json, { encoding: "utf8" });
  renameSync(tmp, final);
}

/**
 * Write a deterministic Entry rebuilt from JSONL while preserving any prior
 * committed enrichment on disk for the same (session_id, local_day) key —
 * but ONLY when the deterministic facets feeding enrichment haven't changed.
 *
 * The perception sweep reconstructs Entries from raw events whenever a JSONL
 * file grows past its tracked checkpoint — or, more dramatically, whenever
 * `~/.cclens/perception-state.json` is reset and the sweep re-scans every
 * file from byte 0. In the reset case, `buildEntries` produces fresh Entries
 * with `enrichment: { status: "pending" }`. Plain `writeEntry` would clobber
 * the enriched-on-disk version, wiping the LLM cost the user already paid.
 *
 * Behaviour:
 *
 *   - If existing.enrichment.status is "done" or "skipped_trivial" AND the
 *     deterministic-input hash matches between fresh and existing: keep that
 *     enrichment (the LLM work was committed for THIS exact entry shape).
 *   - If deterministic facets changed (more events appended, new PRs shipped,
 *     flags drifted): the prior enrichment described an older snapshot and
 *     is stale. Drop it so the next pipeline run can re-enrich.
 *   - If existing is pending/error or absent: write the fresh entry as-is.
 *
 * Concurrency: the read happens just before the rename to shrink (not
 * eliminate) the race window with a concurrent enricher writing a `done`
 * state. A unique tmp path per call avoids rename collisions when multiple
 * writers target the same key. True cross-process atomicity would require
 * filesystem-level advisory locks — left as a follow-up. The deterministic
 * hash means that even when the race fires, we'll only preserve enrichment
 * that's still valid for the current entry shape.
 */
const PRESERVABLE_STATUSES: ReadonlySet<EntryEnrichmentStatus> = new Set([
  "done", "skipped_trivial",
]);

/** Hash the subset of deterministic fields that feed enrichment. If this
 *  changes, prior enrichment described a different snapshot and is stale.
 *  Kept narrow on purpose: cosmetic field churn (e.g., new optional facets
 *  added in a future schema version) should NOT invalidate enrichment, only
 *  changes to the data the enrichment prompt actually consumes. */
function enrichmentInputHash(e: Entry): string {
  return [
    e.numbers.active_min,
    e.numbers.turn_count,
    e.numbers.tools_total,
    e.numbers.subagent_calls,
    e.numbers.skill_calls,
    e.numbers.exit_plan_calls,
    e.numbers.interrupts,
    e.numbers.prs,
    e.flags.slice().sort().join(","),
    e.pr_titles.length,
    e.end_iso,
  ].join("|");
}

export function writeEntryPreservingEnrichment(fresh: Entry): void {
  const dir = entriesDir();
  mkdirSync(dir, { recursive: true });
  const final = pathFor(fresh.session_id, fresh.local_day);

  // Late read: check the on-disk state RIGHT BEFORE writing tmp+rename, so
  // if a concurrent enricher landed a `done` state between our caller's
  // decision-making and now, we still preserve it.
  const existing = readEntry(fresh.session_id, fresh.local_day);

  let toWrite = fresh;
  if (existing && PRESERVABLE_STATUSES.has(existing.enrichment.status)
      && enrichmentInputHash(existing) === enrichmentInputHash(fresh)) {
    toWrite = { ...fresh, enrichment: existing.enrichment };
  }

  const tmp = tmpPathFor(final);
  writeFileSync(tmp, JSON.stringify(toWrite, null, 2), { encoding: "utf8" });
  renameSync(tmp, final);
}

export function readEntry(sessionId: string, localDay: string): Entry | null {
  const p = pathFor(sessionId, localDay);
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, "utf8");
  return JSON.parse(raw) as Entry;
}

export function listEntryKeys(): string[] {
  const dir = entriesDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .map(f => f.slice(0, -".json".length));
}

export function listEntriesForDay(localDay: string): Entry[] {
  const out: Entry[] = [];
  for (const key of listEntryKeys()) {
    const parsed = parseEntryKey(key);
    if (!parsed || parsed.local_day !== localDay) continue;
    const e = readEntry(parsed.session_id, parsed.local_day);
    if (e) out.push(e);
  }
  return out;
}

export function listEntriesForSession(sessionId: string): Entry[] {
  const out: Entry[] = [];
  for (const key of listEntryKeys()) {
    const parsed = parseEntryKey(key);
    if (!parsed || parsed.session_id !== sessionId) continue;
    const e = readEntry(parsed.session_id, parsed.local_day);
    if (e) out.push(e);
  }
  return out;
}

export {
  writeDayDigest, readDayDigest,
  getTodayDigestFromCache, setTodayDigestInCache,
  writeWeekDigest, readWeekDigest, listWeekDigestKeys,
  getCurrentWeekDigestFromCache, setCurrentWeekDigestInCache,
  writeMonthDigest, readMonthDigest, listMonthDigestKeys,
  getCurrentMonthDigestFromCache, setCurrentMonthDigestInCache,
  __setDigestsDirForTest, __clearTodayCacheForTest,
} from "./digest-fs.js";

export function listEntriesWithStatus(statuses: EntryEnrichmentStatus[]): Entry[] {
  const set = new Set(statuses);
  const out: Entry[] = [];
  for (const key of listEntryKeys()) {
    const parsed = parseEntryKey(key);
    if (!parsed) continue;
    const e = readEntry(parsed.session_id, parsed.local_day);
    if (!e) continue;
    if (set.has(e.enrichment.status)) out.push(e);
  }
  out.sort((a, b) => a.local_day.localeCompare(b.local_day)
    || a.session_id.localeCompare(b.session_id));
  return out;
}

