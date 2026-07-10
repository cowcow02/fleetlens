import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentSources, cclensPath, invalidateFile } from "@claude-lens/parser/fs";
import type { SessionMeta } from "@claude-lens/parser";
import { parseEntryKey } from "@claude-lens/entries";
import { listEntryKeys, readEntry } from "@claude-lens/entries/fs";
import { extractIndexDoc } from "./extract";
import { INDEX_VERSION, type IndexDoc } from "./types";

export type IndexProgress = { built: number; reused: number; total: number };
export type IndexStats = { sessions: number; lastRefreshMs: number | null; building: boolean };

function indexDir(): string {
  return cclensPath("agent-index");
}

function docPath(sessionId: string): string {
  return join(indexDir(), `${sessionId}.json`);
}

/** Next compiles each route into its own module graph, so plain module
 *  state would give every API route a private copy of the index (and its
 *  own inflight latch → concurrent full rebuilds). globalThis is the one
 *  store they all share — same trick as the canonical dev-safe singleton. */
type Store = {
  memory: Map<string, IndexDoc>;
  lastRefreshMs: number | null;
  inflight: Promise<IndexDoc[]> | null;
  progressListeners: Set<(p: IndexProgress) => void>;
};
const store: Store = ((globalThis as Record<string, unknown>).__fleetlensAgentIndex ??= {
  memory: new Map<string, IndexDoc>(),
  lastRefreshMs: null,
  inflight: null,
  progressListeners: new Set(),
}) as Store;

function readDiskDoc(sessionId: string): IndexDoc | null {
  try {
    const raw = readFileSync(docPath(sessionId), "utf8");
    const doc = JSON.parse(raw) as IndexDoc;
    return doc.version === INDEX_VERSION ? doc : null;
  } catch {
    return null;
  }
}

function writeDiskDoc(doc: IndexDoc): void {
  mkdirSync(indexDir(), { recursive: true });
  const final = docPath(doc.sessionId);
  const tmp = `${final}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(doc), "utf8");
  renameSync(tmp, final);
}

/** brief_summary chunks from enriched entries — a free semantic layer on top
 *  of the raw transcript text. Read only for the sessions being (re)built. */
function entrySummaries(sessionIds: Set<string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (sessionIds.size === 0) return out;
  for (const key of listEntryKeys()) {
    const parsed = parseEntryKey(key);
    if (!parsed || !sessionIds.has(parsed.session_id)) continue;
    const entry = readEntry(parsed.session_id, parsed.local_day);
    const brief = entry?.enrichment?.brief_summary;
    if (!brief) continue;
    const list = out.get(parsed.session_id) ?? [];
    list.push(brief);
    out.set(parsed.session_id, list);
  }
  return out;
}

async function refresh(onProgress?: (p: IndexProgress) => void): Promise<IndexDoc[]> {
  const metaLists = await Promise.all(agentSources.map((s) => s.listSessions().catch(() => [] as SessionMeta[])));
  type Pending = { meta: SessionMeta; source: (typeof agentSources)[number]; mtimeMs: number; sizeBytes: number };
  const alive = new Set<string>();
  const pending: Pending[] = [];
  let reused = 0;

  for (let i = 0; i < agentSources.length; i++) {
    for (const meta of metaLists[i]!) {
      alive.add(meta.id);
      let st;
      try {
        st = statSync(meta.filePath);
      } catch {
        continue;
      }
      // Version check matters for memory hits too: the globalThis store
      // outlives hot reloads, so a bumped INDEX_VERSION must evict them.
      const cached = store.memory.get(meta.id) ?? readDiskDoc(meta.id);
      if (cached && cached.version === INDEX_VERSION && cached.mtimeMs === st.mtimeMs && cached.sizeBytes === st.size) {
        store.memory.set(meta.id, cached);
        reused++;
        continue;
      }
      pending.push({ meta, source: agentSources[i]!, mtimeMs: st.mtimeMs, sizeBytes: st.size });
    }
  }

  // Drop sessions whose transcripts were pruned so search can't surface
  // ghosts — from memory AND disk (a stale disk doc would re-inflate the
  // indexStats readdir count on the next cold boot).
  for (const id of store.memory.keys()) {
    if (!alive.has(id)) store.memory.delete(id);
  }
  try {
    for (const f of readdirSync(indexDir())) {
      if (!f.endsWith(".json")) continue;
      const id = f.slice(0, -".json".length);
      if (!alive.has(id)) rmSync(join(indexDir(), f), { force: true });
    }
  } catch {
    /* index dir may not exist yet */
  }

  const total = pending.length + reused;
  const summaries = entrySummaries(new Set(pending.map((p) => p.meta.id)));
  let built = 0;
  onProgress?.({ built, reused, total });

  for (const { meta, source, mtimeMs, sizeBytes } of pending) {
    try {
      const detail = await source.getSession(meta.id);
      if (!detail) continue;
      const doc = extractIndexDoc(detail, { mtimeMs, sizeBytes });
      for (const brief of summaries.get(meta.id) ?? []) {
        doc.chunks.unshift({ role: "summary", text: brief });
      }
      writeDiskDoc(doc);
      store.memory.set(meta.id, doc);
      // Keep the parser's unbounded detail cache from ballooning during a
      // full first build over hundreds of transcripts.
      invalidateFile(meta.filePath);
    } catch {
      /* one broken transcript must not sink the whole index */
    }
    built++;
    if (built % 20 === 0 || built === pending.length) onProgress?.({ built, reused, total });
  }

  store.lastRefreshMs = Date.now();
  return Array.from(store.memory.values());
}

/** A refresh is stat-cheap but still lists + stats every transcript; one
 *  agent turn calls several tools back-to-back, so results this fresh are
 *  served from memory. */
const FRESH_MS = 15_000;

/** Incrementally refresh and return every IndexDoc. Fast when nothing
 *  changed (one stat per transcript); first-ever call parses everything. */
export function ensureIndex(
  onProgress?: (p: IndexProgress) => void,
  opts?: { force?: boolean },
): Promise<IndexDoc[]> {
  // Join the inflight refresh rather than returning its bare promise — a
  // joiner's onProgress must still fire or its progress stream sits silent.
  if (onProgress) store.progressListeners.add(onProgress);
  if (store.inflight) return store.inflight;
  if (
    !opts?.force &&
    store.memory.size > 0 &&
    store.lastRefreshMs !== null &&
    Date.now() - store.lastRefreshMs < FRESH_MS
  ) {
    if (onProgress) store.progressListeners.delete(onProgress);
    return Promise.resolve(Array.from(store.memory.values()));
  }
  store.inflight = refresh((p) => {
    for (const fn of store.progressListeners) {
      try {
        fn(p);
      } catch {
        /* one broken listener must not stall the build */
      }
    }
  }).finally(() => {
    store.inflight = null;
    store.progressListeners.clear();
  });
  return store.inflight;
}

/** Whatever is in memory right now — no refresh, no blocking. Empty until
 *  the first ensureIndex() of this server process completes. */
export function peekDocs(): IndexDoc[] {
  return Array.from(store.memory.values());
}

export function indexStats(): IndexStats {
  let sessions = store.memory.size;
  if (sessions === 0) {
    try {
      sessions = readdirSync(indexDir()).filter((f) => f.endsWith(".json")).length;
    } catch {
      sessions = 0;
    }
  }
  return { sessions, lastRefreshMs: store.lastRefreshMs, building: store.inflight !== null };
}

export function indexIsEmpty(): boolean {
  return store.memory.size === 0 && !existsSync(indexDir());
}
