import "server-only";
import { statSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  entriesDir,
  listEntryKeys,
  readEntry,
  readDayDigest,
} from "@claude-lens/entries/fs";
import type { Entry, DayOutcome, DayHelpfulness, DayDigest } from "@claude-lens/entries";
import { sessionProjectKey } from "@claude-lens/parser";
import { cclensPath, resolveProjectIdentity } from "@claude-lens/parser/fs";
import { outcomePriority } from "@/components/outcome-pill";

export type EntriesIndex = {
  bySession: Map<string, Entry[]>;
  byDay: Map<string, Entry[]>;
  byProject: Map<string, Entry[]>;
  sessionOutcome: Map<string, DayOutcome | null>;
  dayOutcome: Map<string, DayOutcome | null>;
  /** Compact slice for the live-sessions widget — no full entries needed. */
  enrichmentStatusBySession: Map<string, Entry["enrichment"]["status"]>;
};

const EMPTY_INDEX: EntriesIndex = {
  bySession: new Map(),
  byDay: new Map(),
  byProject: new Map(),
  sessionOutcome: new Map(),
  dayOutcome: new Map(),
  enrichmentStatusBySession: new Map(),
};

let cache: { mtimeMs: number; index: EntriesIndex } | null = null;

function dirMtime(): number {
  const dir = entriesDir();
  if (!existsSync(dir)) return 0;
  return statSync(dir).mtimeMs;
}

export function rollupOutcome(entries: Entry[]): DayOutcome | null {
  let best: DayOutcome | null = null;
  let bestPri = 0;
  for (const e of entries) {
    const o = e.enrichment.outcome ?? null;
    if (!o) continue;
    const pri = outcomePriority(o);
    if (pri > bestPri) {
      bestPri = pri;
      best = o;
    }
  }
  return best;
}

export async function buildEntriesIndex(): Promise<EntriesIndex> {
  const mtime = dirMtime();
  if (mtime === 0) return EMPTY_INDEX;
  if (cache && cache.mtimeMs === mtime) return cache.index;

  const bySession = new Map<string, Entry[]>();
  const byDay = new Map<string, Entry[]>();
  const byProject = new Map<string, Entry[]>();
  const enrichmentStatusBySession = new Map<string, Entry["enrichment"]["status"]>();

  for (const key of listEntryKeys()) {
    const sep = key.lastIndexOf("__");
    if (sep === -1) continue;
    const sessionId = key.slice(0, sep);
    const localDay = key.slice(sep + 2);
    const e = readEntry(sessionId, localDay);
    if (!e) continue;

    const list = bySession.get(e.session_id);
    if (list) list.push(e); else bySession.set(e.session_id, [e]);

    const dlist = byDay.get(e.local_day);
    if (dlist) dlist.push(e); else byDay.set(e.local_day, [e]);

    // Keyed by the same project key used by /projects and team sync.
    const repo = sessionProjectKey(resolveProjectIdentity(e.project));
    const plist = byProject.get(repo);
    if (plist) plist.push(e); else byProject.set(repo, [e]);
  }

  // Sort each session's entries by local_day asc; the latest day's
  // enrichment status is the session's status. Reading after the sort
  // avoids the prior order-dependent bug where readdir order decided
  // whether a session showed 'enriched' (older day) or 'pending'
  // (today, still queued).
  for (const [sid, list] of bySession) {
    list.sort((a, b) => a.local_day.localeCompare(b.local_day));
    enrichmentStatusBySession.set(sid, list[list.length - 1]!.enrichment.status);
  }

  const sessionOutcome = new Map<string, DayOutcome | null>();
  for (const [sid, entries] of bySession) {
    sessionOutcome.set(sid, rollupOutcome(entries));
  }

  const dayOutcome = new Map<string, DayOutcome | null>();
  for (const [day, entries] of byDay) {
    dayOutcome.set(day, rollupOutcome(entries));
  }

  const index: EntriesIndex = {
    bySession,
    byDay,
    byProject,
    sessionOutcome,
    dayOutcome,
    enrichmentStatusBySession,
  };
  cache = { mtimeMs: mtime, index };
  return index;
}

/* ============================================================ */
/* Day-digest cache lookups (separate, lighter cache)            */
/* ============================================================ */

export type DayDigestSummary = {
  date: string;
  headline: string | null;
  outcome_day: DayOutcome | null;
  helpfulness_day: DayHelpfulness;
  agent_min: number;
  shipped_count: number;
};

let digestCache: { mtimeMs: number; map: Map<string, DayDigestSummary> } | null = null;

function digestsDir(): string {
  return process.env.CCLENS_DIGESTS_DIR ?? cclensPath("digests", "day");
}

function digestsDirMtime(): number {
  const d = digestsDir();
  if (!existsSync(d)) return 0;
  return statSync(d).mtimeMs;
}

export async function listCachedDayDigests(): Promise<Map<string, DayDigestSummary>> {
  const mtime = digestsDirMtime();
  if (mtime === 0) return new Map();
  if (digestCache && digestCache.mtimeMs === mtime) return digestCache.map;

  const dir = digestsDir();
  const out = new Map<string, DayDigestSummary>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const date = f.slice(0, -".json".length);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const d: DayDigest | null = readDayDigest(date);
    if (!d) continue;
    out.set(date, {
      date,
      headline: d.headline,
      outcome_day: d.outcome_day,
      helpfulness_day: d.helpfulness_day,
      agent_min: d.agent_min,
      shipped_count: d.shipped.length,
    });
  }
  digestCache = { mtimeMs: mtime, map: out };
  return out;
}

/** Reset both caches — test-only escape hatch. */
export function __resetEntriesIndexCacheForTest(): void {
  cache = null;
  digestCache = null;
}
