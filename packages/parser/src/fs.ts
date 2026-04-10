/**
 * Server-side filesystem scanner for Claude Code JSONL transcripts.
 *
 * Lives in its own subpath (`@claude-sessions/parser/fs`) so pure browser
 * consumers can use the rest of the package without importing node:fs.
 *
 * ----------------------------------------------------------------------
 *  Caching
 * ----------------------------------------------------------------------
 * A module-scoped in-memory cache makes repeated scans near-instant. Any
 * file whose `mtimeMs` and `sizeBytes` match a previously-parsed entry
 * short-circuits the read+parse path entirely. First scan is unavoidable
 * (one-time cost); subsequent scans only touch files that actually changed
 * on disk.
 *
 * The cache lives in module scope, which means it's shared across ALL
 * Next.js RSC requests in the same process, including page navigation
 * and both the Sidebar (layout.tsx) and page-level data fetches. It's
 * cleared only when the process restarts.
 *
 * Inspired by ccboard's mtime-based cache (reported 89x speedup) — see
 * https://github.com/FlorianBruniaux/ccboard.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseTranscript } from "./parser.js";
import type { SessionDetail, SessionEvent, SessionMeta, SubagentRun, Usage } from "./types.js";

export const DEFAULT_ROOT = path.join(os.homedir(), ".claude", "projects");

/** Claude Code encodes cwd as `-Users-me-Repo-foo`. Decode → `/Users/me/Repo/foo`. */
export function decodeProjectName(dir: string): string {
  if (!dir.startsWith("-")) return dir;
  return "/" + dir.slice(1).replace(/-/g, "/");
}

/** Parse a JSONL file into one raw object per line, skipping malformed lines. */
export async function readJsonlFile(filePath: string): Promise<unknown[]> {
  const raw = await fs.readFile(filePath, "utf8");
  const out: unknown[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed lines rather than failing the whole session.
    }
  }
  return out;
}

export type FileRef = {
  projectDir: string;
  fileName: string;
  fullPath: string;
  mtimeMs: number;
  sizeBytes: number;
};

/* ================================================================= */
/*  Module-scoped caches                                             */
/* ================================================================= */

type MetaCacheEntry = { meta: SessionMeta; mtimeMs: number; sizeBytes: number };
type DetailCacheEntry = { detail: SessionDetail; mtimeMs: number; sizeBytes: number };

/** Per-file meta cache. Key = fullPath. Invalidates on mtime OR size change. */
const metaCache = new Map<string, MetaCacheEntry>();

/** Per-file detail cache. Key = fullPath. Same invalidation rule. */
const detailCache = new Map<string, DetailCacheEntry>();

/** Short-lived file-list cache so multiple calls within the same request
 *  don't re-stat the directory. TTL is 1 second by default — enough to
 *  cover an entire RSC render pass without caching stale data for long. */
let fileListCache: { files: FileRef[]; capturedAtMs: number; root: string } | null = null;
const FILE_LIST_TTL_MS = 1_000;

export type CacheStats = {
  metaEntries: number;
  detailEntries: number;
};

/** Expose cache stats — useful for debug endpoints or logging. */
export function cacheStats(): CacheStats {
  return { metaEntries: metaCache.size, detailEntries: detailCache.size };
}

/** Drop all caches. Tests use this; hooks on file watch could too. */
export function clearCaches(): void {
  metaCache.clear();
  detailCache.clear();
  fileListCache = null;
}

/* ================================================================= */
/*  File walking                                                     */
/* ================================================================= */

/**
 * Walk `~/.claude/projects/<encoded-cwd>/*.jsonl`, returning one ref per file
 * with mtime + size stats. Uses fs.readdir + withFileTypes for project-dir
 * detection (one syscall instead of N stats), and parallelizes the inner
 * file-stat calls per project.
 */
export async function walkJsonlFiles(root: string = DEFAULT_ROOT): Promise<FileRef[]> {
  // Short-TTL cache so a single RSC render doesn't re-walk for every
  // data-loader call (layout + page + nested components all calling
  // listSessions / getSession / listProjects).
  if (
    fileListCache &&
    fileListCache.root === root &&
    Date.now() - fileListCache.capturedAtMs < FILE_LIST_TTL_MS
  ) {
    return fileListCache.files;
  }

  let topEntries: import("node:fs").Dirent[] = [];
  try {
    topEntries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const projectDirs = topEntries.filter((e) => e.isDirectory()).map((e) => e.name);

  // Walk all project directories in parallel. Inside each, stat all .jsonl
  // files in parallel too. On my machine with 44 projects / 658 files this
  // drops from ~600ms (sequential) to ~80ms.
  const perProject = await Promise.all(
    projectDirs.map(async (projectDir): Promise<FileRef[]> => {
      const projectPath = path.join(root, projectDir);
      let files: string[];
      try {
        files = await fs.readdir(projectPath);
      } catch {
        return [];
      }
      const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
      const refs = await Promise.all(
        jsonlFiles.map(async (f): Promise<FileRef | null> => {
          const fullPath = path.join(projectPath, f);
          try {
            const stat = await fs.stat(fullPath);
            return {
              projectDir,
              fileName: f,
              fullPath,
              mtimeMs: stat.mtimeMs,
              sizeBytes: stat.size,
            };
          } catch {
            return null;
          }
        }),
      );
      return refs.filter((r): r is FileRef => r !== null);
    }),
  );

  const all = perProject.flat();
  fileListCache = { files: all, capturedAtMs: Date.now(), root };
  return all;
}

export function sessionIdFromFileName(fileName: string): string {
  return fileName.replace(/\.jsonl$/i, "");
}

/* ================================================================= */
/*  Meta / detail loaders with caching                               */
/* ================================================================= */

/** Load (or reuse) the SessionMeta for a single file ref. */
async function getCachedMeta(f: FileRef): Promise<SessionMeta | null> {
  const cached = metaCache.get(f.fullPath);
  if (cached && cached.mtimeMs === f.mtimeMs && cached.sizeBytes === f.sizeBytes) {
    return cached.meta;
  }
  try {
    const rawLines = await readJsonlFile(f.fullPath);
    const { meta } = parseTranscript(rawLines);
    const full: SessionMeta = {
      ...meta,
      id: sessionIdFromFileName(f.fileName),
      filePath: f.fullPath,
      projectDir: f.projectDir,
      projectName: decodeProjectName(f.projectDir),
    };
    metaCache.set(f.fullPath, { meta: full, mtimeMs: f.mtimeMs, sizeBytes: f.sizeBytes });
    return full;
  } catch {
    return null;
  }
}

/** Load (or reuse) the full SessionDetail for a single file ref. */
async function getCachedDetail(f: FileRef): Promise<SessionDetail | null> {
  const cached = detailCache.get(f.fullPath);
  if (cached && cached.mtimeMs === f.mtimeMs && cached.sizeBytes === f.sizeBytes) {
    return cached.detail;
  }
  try {
    const rawLines = await readJsonlFile(f.fullPath);
    const { meta, events } = parseTranscript(rawLines);
    const detail: SessionDetail = {
      ...meta,
      id: sessionIdFromFileName(f.fileName),
      filePath: f.fullPath,
      projectDir: f.projectDir,
      projectName: decodeProjectName(f.projectDir),
      events,
    };
    detailCache.set(f.fullPath, { detail, mtimeMs: f.mtimeMs, sizeBytes: f.sizeBytes });
    // Populate the meta cache from the detail so a later listSessions
    // doesn't have to re-parse the file too.
    const metaOnly: SessionMeta = { ...detail };
    delete (metaOnly as SessionMeta & { events?: unknown }).events;
    metaCache.set(f.fullPath, { meta: metaOnly, mtimeMs: f.mtimeMs, sizeBytes: f.sizeBytes });
    return detail;
  } catch {
    return null;
  }
}

export type ListOptions = {
  /** Override the ~/.claude/projects root */
  root?: string;
  /** Max number of sessions to return. Sorted newest-first by mtime. */
  limit?: number;
  /** Only include sessions with this projectDir prefix (filters by cwd) */
  projectDir?: string;
};

/**
 * List parsed session metadata, sorted newest-first by file mtime.
 *
 * Uses the module-scoped cache, so after the first call only files whose
 * mtime/size changed are re-parsed.
 */
export async function listSessions(opts: ListOptions = {}): Promise<SessionMeta[]> {
  const { root = DEFAULT_ROOT, limit = 500, projectDir } = opts;
  let files = await walkJsonlFiles(root);
  if (projectDir) files = files.filter((f) => f.projectDir === projectDir);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const sliced = files.slice(0, limit);

  // Parallelize — at first load this is CPU-bound (JSON.parse), but it
  // still overlaps the fs.readFile calls nicely.
  const metas = await Promise.all(sliced.map((f) => getCachedMeta(f)));
  return metas.filter((m): m is SessionMeta => m !== null);
}

/** Load a single session by id. Returns null if not found. */
export async function getSession(
  id: string,
  opts: { root?: string } = {},
): Promise<SessionDetail | null> {
  const { root = DEFAULT_ROOT } = opts;
  const files = await walkJsonlFiles(root);
  const hit = files.find((f) => sessionIdFromFileName(f.fileName) === id);
  if (!hit) return null;
  const detail = await getCachedDetail(hit);
  if (!detail) return detail;

  // Hydrate sub-agent runs if Claude Code wrote any. The directory is
  // a sibling of the .jsonl file, named after the session uuid (no
  // extension), with `subagents/agent-<id>.jsonl` + `.meta.json` inside.
  const sessionStartMs = detail.firstTimestamp ? Date.parse(detail.firstTimestamp) : undefined;
  const subagentsDir = path.join(
    path.dirname(hit.fullPath),
    sessionIdFromFileName(hit.fileName),
    "subagents",
  );
  const subagents = await loadSubagents(subagentsDir, sessionStartMs, detail.events);
  return { ...detail, subagents };
}

/* ================================================================= */
/*  Subagent loading                                                 */
/* ================================================================= */

const BLANK_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

type SubagentMeta = { agentType?: string; description?: string };

/**
 * Quick-pass parser for a subagent JSONL. Extracts everything the UI
 * needs to render a rich detail drawer — timing, deduped usage, tool
 * call counts, assistant message count, final text, and the initial
 * prompt — without running the full presentation layer (which is
 * expensive for large transcripts and isn't needed here: we only show
 * aggregate stats + final result).
 */
function summarizeSubagentLines(lines: unknown[]): {
  startMs?: number;
  endMs?: number;
  totalUsage: Usage;
  eventCount: number;
  finalPreview?: string;
  finalText?: string;
  model?: string;
  toolCalls: { name: string; count: number }[];
  toolCallCount: number;
  assistantMessageCount: number;
  /** Initial prompt extracted from the first user line (parentUuid=null).
   *  Used as a fallback when the meta.json sidecar has no description
   *  and we can't match to a parent Agent tool_use. */
  initialPrompt?: string;
} {
  let startMs: number | undefined;
  let endMs: number | undefined;
  const totalUsage: Usage = { ...BLANK_USAGE };
  const seenMessageIds = new Set<string>();
  let finalText: string | undefined;
  let model: string | undefined;
  let eventCount = 0;
  let assistantMessageCount = 0;
  let toolCallCount = 0;
  const toolCounts = new Map<string, number>();
  let initialPrompt: string | undefined;

  for (const raw of lines) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    eventCount++;

    const ts = typeof r.timestamp === "string" ? Date.parse(r.timestamp) : NaN;
    if (!Number.isNaN(ts)) {
      if (startMs === undefined || ts < startMs) startMs = ts;
      if (endMs === undefined || ts > endMs) endMs = ts;
    }

    // First user line with parentUuid=null holds the dispatched prompt.
    if (
      initialPrompt === undefined &&
      r.type === "user" &&
      (r.parentUuid === null || r.parentUuid === undefined)
    ) {
      const msg = r.message as Record<string, unknown> | undefined;
      const content = msg?.content;
      if (typeof content === "string") {
        initialPrompt = content;
      } else if (Array.isArray(content)) {
        const txt = content.find(
          (b) => b && typeof b === "object" && (b as { type?: string }).type === "text",
        ) as { text?: string } | undefined;
        if (txt?.text) initialPrompt = txt.text;
      }
    }

    if (r.type === "assistant") {
      const m = r.message as Record<string, unknown> | undefined;
      if (!m) continue;

      // First seen model wins.
      if (!model && typeof m.model === "string") model = m.model;

      // Token dedup by message.id (same fix as the main parser).
      const mid = typeof m.id === "string" ? m.id : undefined;
      const fresh = mid ? !seenMessageIds.has(mid) : true;
      if (mid && fresh) seenMessageIds.add(mid);

      if (fresh) {
        assistantMessageCount++;
        const u = m.usage as Record<string, unknown> | undefined;
        if (u) {
          const toNum = (v: unknown) => (typeof v === "number" ? v : 0);
          totalUsage.input += toNum(u.input_tokens);
          totalUsage.output += toNum(u.output_tokens);
          totalUsage.cacheRead += toNum(u.cache_read_input_tokens);
          totalUsage.cacheWrite += toNum(u.cache_creation_input_tokens);
        }
      }

      // Walk content blocks to capture final text + tool calls.
      const content = m.content as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== "object") continue;
          if (block.type === "text" && typeof block.text === "string") {
            finalText = block.text;
          } else if (block.type === "tool_use" && typeof block.name === "string") {
            toolCallCount++;
            toolCounts.set(block.name, (toolCounts.get(block.name) ?? 0) + 1);
          }
        }
      }
    }
  }

  const toolCalls = Array.from(toolCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const finalPreview =
    finalText !== undefined
      ? finalText.replace(/\s+/g, " ").trim().slice(0, 240)
      : undefined;

  return {
    startMs,
    endMs,
    totalUsage,
    eventCount,
    finalPreview,
    finalText,
    model,
    toolCalls,
    toolCallCount,
    assistantMessageCount,
    initialPrompt,
  };
}

/**
 * Walk a session's `subagents/` dir, parse each agent-*.jsonl + .meta.json
 * pair, and return one SubagentRun per file. Matches each subagent to its
 * parent Agent tool_use call by `description` (the most reliable signal —
 * Claude Code copies the prompt's `description` into both meta.json and
 * the parent's tool_use input).
 */
async function loadSubagents(
  dir: string,
  sessionStartMs: number | undefined,
  parentEvents: SessionEvent[],
): Promise<SubagentRun[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  // Build a description → parent Agent tool_use lookup from the parent's
  // events. Claude Code copies the dispatched prompt's `description`
  // into both meta.json and the parent tool_use, so exact match is
  // the most reliable linkage signal when both sides have it.
  type ParentRef = {
    toolUseId: string;
    parentUuid: string;
    runInBackground: boolean;
    prompt?: string;
    tsMs?: number;
  };
  const byDesc = new Map<string, ParentRef>();
  // Time-ordered list of every Agent dispatch, for fallback matching
  // when the subagent's meta.json is missing / has no description
  // (older Claude Code versions wrote empty meta sidecars).
  const dispatchesByTs: ParentRef[] = [];
  for (const e of parentEvents) {
    if (e.role !== "tool-call" || e.toolName !== "Agent") continue;
    for (const b of e.blocks) {
      if (b?.type !== "tool_use" || b.name !== "Agent") continue;
      const input = (b.input as Record<string, unknown>) ?? {};
      const desc = typeof input.description === "string" ? input.description : undefined;
      const tsMs = e.timestamp ? Date.parse(e.timestamp) : undefined;
      const ref: ParentRef = {
        toolUseId: b.id,
        parentUuid: e.uuid ?? "",
        runInBackground: input.run_in_background === true,
        prompt: typeof input.prompt === "string" ? input.prompt : undefined,
        tsMs,
      };
      if (desc) byDesc.set(desc, ref);
      if (tsMs !== undefined) dispatchesByTs.push(ref);
    }
  }
  dispatchesByTs.sort((a, b) => (a.tsMs ?? 0) - (b.tsMs ?? 0));

  /** Find the most recent parent dispatch at or before a given start
   *  time, within a ±2s tolerance. Used when description-based
   *  matching fails (empty meta). Returns undefined if no candidate
   *  is within the window. */
  function matchByTime(startMs: number | undefined): ParentRef | undefined {
    if (startMs === undefined) return undefined;
    const TOLERANCE_MS = 2_000;
    let best: ParentRef | undefined;
    let bestDelta = Infinity;
    for (const ref of dispatchesByTs) {
      if (ref.tsMs === undefined) continue;
      const delta = Math.abs(startMs - ref.tsMs);
      if (delta < bestDelta && delta <= TOLERANCE_MS) {
        best = ref;
        bestDelta = delta;
      }
    }
    return best;
  }

  const jsonlFiles = entries.filter((f) => f.startsWith("agent-") && f.endsWith(".jsonl"));
  const runs = await Promise.all(
    jsonlFiles.map(async (f): Promise<SubagentRun | null> => {
      const agentId = f.replace(/^agent-/, "").replace(/\.jsonl$/, "");
      const jsonlPath = path.join(dir, f);
      const metaPath = path.join(dir, `agent-${agentId}.meta.json`);

      let meta: SubagentMeta = {};
      try {
        const raw = await fs.readFile(metaPath, "utf8");
        meta = JSON.parse(raw);
      } catch {
        // Some subagents may not have a meta sidecar — fall through with
        // an empty record.
      }

      let lines: unknown[];
      try {
        lines = await readJsonlFile(jsonlPath);
      } catch {
        return null;
      }

      const summary = summarizeSubagentLines(lines);

      // Parent matching has three fallbacks, in order:
      //   1. Exact description match (meta.json ↔ parent tool_use.input.description)
      //   2. Timestamp-based match (±2s of parent dispatch ts)
      //   3. No match — just use whatever meta / initial prompt we have
      const metaDesc = meta.description && meta.description.trim().length > 0
        ? meta.description
        : undefined;
      const parentRef = metaDesc
        ? byDesc.get(metaDesc)
        : matchByTime(summary.startMs);

      // Prefer meta.description → else the parent tool_use description
      // (we don't have direct access, but the matched parent's prompt
      // often starts with a recognizable header) → else the first line
      // of the initial prompt truncated → fall back to "(no description)".
      const description =
        metaDesc ??
        (summary.initialPrompt
          ? summary.initialPrompt
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 80)
          : "(no description)");

      // Prompt: prefer the parent tool_use's input.prompt (most
      // accurate), else the subagent's own first user line.
      const prompt = parentRef?.prompt ?? summary.initialPrompt;

      const startTOffsetMs =
        sessionStartMs !== undefined && summary.startMs !== undefined
          ? Math.max(0, summary.startMs - sessionStartMs)
          : undefined;
      const endTOffsetMs =
        sessionStartMs !== undefined && summary.endMs !== undefined
          ? Math.max(0, summary.endMs - sessionStartMs)
          : undefined;
      const durationMs =
        summary.startMs !== undefined && summary.endMs !== undefined
          ? summary.endMs - summary.startMs
          : undefined;

      return {
        agentId,
        agentType: meta.agentType ?? "unknown",
        description,
        startMs: summary.startMs,
        endMs: summary.endMs,
        durationMs,
        startTOffsetMs,
        endTOffsetMs,
        eventCount: summary.eventCount,
        totalUsage: summary.totalUsage,
        parentUuid: parentRef?.parentUuid,
        parentToolUseId: parentRef?.toolUseId,
        runInBackground: parentRef?.runInBackground,
        prompt,
        finalPreview: summary.finalPreview,
        finalText: summary.finalText,
        model: summary.model,
        toolCalls: summary.toolCalls,
        toolCallCount: summary.toolCallCount,
        assistantMessageCount: summary.assistantMessageCount,
      };
    }),
  );

  return runs
    .filter((r): r is SubagentRun => r !== null)
    .sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
}

/* ================================================================= */
/*  Lightweight projects list for the sidebar                        */
/* ================================================================= */

export type ProjectRefLite = {
  projectDir: string;
  projectName: string;
  sessionCount: number;
  /** ms timestamp of the most recently-modified JSONL in this project */
  lastActiveMs: number;
};

/**
 * Return one entry per project directory with a session count and a
 * "last active" mtime. Uses only fs.stat — no JSONL parsing at all, so it
 * runs in <100ms even on a cold cache with hundreds of sessions. Use this
 * for the sidebar / navigation; use `listSessions` when you actually need
 * session content (tokens, previews, etc.).
 */
export async function listProjects(root: string = DEFAULT_ROOT): Promise<ProjectRefLite[]> {
  const files = await walkJsonlFiles(root);
  const byProject = new Map<string, { count: number; lastActiveMs: number }>();
  for (const f of files) {
    const cur = byProject.get(f.projectDir) ?? { count: 0, lastActiveMs: 0 };
    cur.count++;
    if (f.mtimeMs > cur.lastActiveMs) cur.lastActiveMs = f.mtimeMs;
    byProject.set(f.projectDir, cur);
  }
  return Array.from(byProject.entries())
    .map(([projectDir, { count, lastActiveMs }]) => ({
      projectDir,
      projectName: decodeProjectName(projectDir),
      sessionCount: count,
      lastActiveMs,
    }))
    .sort((a, b) => b.lastActiveMs - a.lastActiveMs);
}
