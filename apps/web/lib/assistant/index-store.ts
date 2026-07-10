import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
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
  return cclensPath("assistant-index");
}

function docPath(sessionId: string): string {
  return join(indexDir(), `${sessionId}.json`);
}

const memory = new Map<string, IndexDoc>();
let lastRefreshMs: number | null = null;
let inflight: Promise<IndexDoc[]> | null = null;

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
      const cached = memory.get(meta.id) ?? readDiskDoc(meta.id);
      if (cached && cached.mtimeMs === st.mtimeMs && cached.sizeBytes === st.size) {
        memory.set(meta.id, cached);
        reused++;
        continue;
      }
      pending.push({ meta, source: agentSources[i]!, mtimeMs: st.mtimeMs, sizeBytes: st.size });
    }
  }

  // Drop sessions whose transcripts were pruned so search can't surface ghosts.
  for (const id of memory.keys()) {
    if (!alive.has(id)) memory.delete(id);
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
      memory.set(meta.id, doc);
      // Keep the parser's unbounded detail cache from ballooning during a
      // full first build over hundreds of transcripts.
      invalidateFile(meta.filePath);
    } catch {
      /* one broken transcript must not sink the whole index */
    }
    built++;
    if (built % 20 === 0 || built === pending.length) onProgress?.({ built, reused, total });
  }

  lastRefreshMs = Date.now();
  return Array.from(memory.values());
}

/** Incrementally refresh and return every IndexDoc. Fast when nothing
 *  changed (one stat per transcript); first-ever call parses everything. */
export function ensureIndex(onProgress?: (p: IndexProgress) => void): Promise<IndexDoc[]> {
  if (inflight) return inflight;
  inflight = refresh(onProgress).finally(() => {
    inflight = null;
  });
  return inflight;
}

export function indexStats(): IndexStats {
  let sessions = memory.size;
  if (sessions === 0) {
    try {
      sessions = readdirSync(indexDir()).filter((f) => f.endsWith(".json")).length;
    } catch {
      sessions = 0;
    }
  }
  return { sessions, lastRefreshMs, building: inflight !== null };
}

export function indexIsEmpty(): boolean {
  return memory.size === 0 && !existsSync(indexDir());
}
