/**
 * Server-side filesystem scanner for Claude Code JSONL transcripts.
 *
 * Lives in its own subpath (`@claude-lens/parser/fs`) so pure browser
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
import { canonicalProjectName, toLocalDay, worktreeName } from "./analytics.js";
import { groupByTeam, type TeamView } from "./team.js";
import type { SessionDetail, SessionEvent, SessionMeta, SubagentRun, Usage } from "./types.js";
import {
  type CalibrationEvent,
  type PlanTier,
  type RateSource,
  RATE_PER_PCT_5H,
  RATE_PER_PCT_7D,
  buildSpendIndex,
  collectSnapPairRates,
  groupSnapsByCycle,
  modelFamily,
  predictAnchored,
  userSoloRate,
} from "./calibration.js";

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
type CalibrationEventsCacheEntry = { events: CalibrationEvent[]; mtimeMs: number; sizeBytes: number };

/** Per-file meta cache. Key = fullPath. Invalidates on mtime OR size change. */
const metaCache = new Map<string, MetaCacheEntry>();

/** Per-file detail cache. Key = fullPath. Same invalidation rule. */
const detailCache = new Map<string, DetailCacheEntry>();

/** Per-file calibration-events cache. Key = fullPath. Same invalidation rule.
 *  Without this, /usage re-reads + re-parses every JSONL on every render — on
 *  ~2k-file accounts that's ~1.7s warm versus ~50ms with the cache. */
const calibrationEventsCache = new Map<string, CalibrationEventsCacheEntry>();

/** Short-lived file-list cache so multiple calls within the same request
 *  don't re-stat the directory. TTL is 1 second by default — enough to
 *  cover an entire RSC render pass without caching stale data for long. */
let fileListCache: { files: FileRef[]; capturedAtMs: number; root: string } | null = null;
const FILE_LIST_TTL_MS = 1_000;

export type CacheStats = {
  metaEntries: number;
  detailEntries: number;
  calibrationEventsEntries: number;
};

/** Expose cache stats — useful for debug endpoints or logging. */
export function cacheStats(): CacheStats {
  return {
    metaEntries: metaCache.size,
    detailEntries: detailCache.size,
    calibrationEventsEntries: calibrationEventsCache.size,
  };
}

/** Drop all caches. Tests use this; hooks on file watch could too. */
export function clearCaches(): void {
  metaCache.clear();
  detailCache.clear();
  calibrationEventsCache.clear();
  fileListCache = null;
  clearCodexCaches();
}

/**
 * Drop the cached meta + detail entries for one specific file path,
 * and also invalidate the short-lived file-list cache so the next
 * list walk re-stats the directory. Called from the live-update SSE
 * watcher when a file changes or appears.
 */
export function invalidateFile(fullPath: string): void {
  metaCache.delete(fullPath);
  detailCache.delete(fullPath);
  calibrationEventsCache.delete(fullPath);
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

  let topEntries: import("node:fs").Dirent[];
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

/**
 * Aggregate token usage from a JSONL file's raw lines, sharing a dedup set
 * so the same message:requestId pair is only counted once across parent +
 * subagent files (matching ccusage's approach).
 */
function aggregateUsageFromLines(
  lines: unknown[],
  seenKeys: Set<string>,
  usage: Usage,
): void {
  for (const raw of lines) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (r.type !== "assistant") continue;
    const m = r.message as Record<string, unknown> | undefined;
    if (!m) continue;
    const mid = typeof m.id === "string" ? m.id : undefined;
    const rid = typeof r.requestId === "string" ? r.requestId : undefined;
    const key = mid != null && rid != null ? `${mid}:${rid}` : undefined;
    if (key && seenKeys.has(key)) continue;
    if (key) seenKeys.add(key);
    const u = m.usage as Record<string, unknown> | undefined;
    if (u) {
      const toNum = (v: unknown) => (typeof v === "number" ? v : 0);
      usage.input += toNum(u.input_tokens);
      usage.output += toNum(u.output_tokens);
      usage.cacheRead += toNum(u.cache_read_input_tokens);
      usage.cacheWrite += toNum(u.cache_creation_input_tokens);
    }
  }
}

/**
 * Compute total token usage across a parent session's JSONL + its subagent
 * JSONL files, using a shared dedup set so no message is counted twice.
 * This matches ccusage's global dedup approach.
 */
async function computeSessionUsageWithSubagents(
  parentLines: unknown[],
  projectDirPath: string,
  sessionId: string,
): Promise<Usage> {
  const usage: Usage = { ...BLANK_USAGE };
  const seenKeys = new Set<string>();

  // 1. Parent session
  aggregateUsageFromLines(parentLines, seenKeys, usage);

  // 2. Subagent files
  const subagentsDir = path.join(projectDirPath, sessionId, "subagents");
  let entries: string[];
  try {
    entries = await fs.readdir(subagentsDir);
  } catch {
    return usage;
  }
  const jsonlFiles = entries.filter((f) => f.endsWith(".jsonl"));
  if (jsonlFiles.length === 0) return usage;

  await Promise.all(
    jsonlFiles.map(async (f) => {
      try {
        const lines = await readJsonlFile(path.join(subagentsDir, f));
        aggregateUsageFromLines(lines, seenKeys, usage);
      } catch {
        /* skip unreadable files */
      }
    }),
  );
  return usage;
}

/** Load (or reuse) the SessionMeta for a single file ref. */
async function getCachedMeta(f: FileRef): Promise<SessionMeta | null> {
  const cached = metaCache.get(f.fullPath);
  if (cached && cached.mtimeMs === f.mtimeMs && cached.sizeBytes === f.sizeBytes) {
    return cached.meta;
  }
  try {
    const rawLines = await readJsonlFile(f.fullPath);
    const { meta } = parseTranscript(rawLines);

    // Recompute usage across parent + subagents with shared dedup
    // so cost estimates match ccusage.
    const sessionId = sessionIdFromFileName(f.fileName);
    const projectDirPath = path.dirname(f.fullPath);
    meta.totalUsage = await computeSessionUsageWithSubagents(
      rawLines,
      projectDirPath,
      sessionId,
    );

    // Use the real cwd from the JSONL when available — the decoded
    // dir name is lossy (dashes in folder names become slashes).
    const full: SessionMeta = {
      ...meta,
      id: sessionId,
      filePath: f.fullPath,
      projectDir: f.projectDir,
      projectName: meta.cwd ?? decodeProjectName(f.projectDir),
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
      projectName: meta.cwd ?? decodeProjectName(f.projectDir),
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

      // Token dedup by message.id + requestId (matches ccusage).
      const mid = typeof m.id === "string" ? m.id : undefined;
      const rid = typeof r.requestId === "string" ? r.requestId : undefined;
      const dedupKey = mid != null && rid != null ? `${mid}:${rid}` : undefined;
      const fresh = dedupKey ? !seenMessageIds.has(dedupKey) : true;
      if (dedupKey && fresh) seenMessageIds.add(dedupKey);

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
  /** Stable project identifier — the canonical cwd path. Call sites
   *  should URL-encode it for use in href slugs. */
  projectDir: string;
  /** Canonical cwd path (worktrees rolled up to parent). */
  projectName: string;
  sessionCount: number;
  /** ms timestamp of the most recently-modified JSONL in this project */
  lastActiveMs: number;
  /** Number of distinct `.worktrees/<name>` subdirs rolled up here. */
  worktreeCount: number;
};

/**
 * Return one entry per canonical project with a session count and a
 * "last active" mtime. Worktrees (`cwd/.worktrees/<name>`) are aggregated
 * under their parent repo — running agents in five worktrees of the same
 * repo surfaces as one project with `worktreeCount: 5`, not five projects.
 *
 * Uses only fs.stat — no JSONL parsing at all — so it runs in <100ms even
 * on a cold cache with hundreds of sessions.
 */
export async function listProjects(root: string = DEFAULT_ROOT): Promise<ProjectRefLite[]> {
  const files = await walkJsonlFiles(root);
  const byRawDir = new Map<string, { count: number; lastActiveMs: number }>();
  for (const f of files) {
    const cur = byRawDir.get(f.projectDir) ?? { count: 0, lastActiveMs: 0 };
    cur.count++;
    if (f.mtimeMs > cur.lastActiveMs) cur.lastActiveMs = f.mtimeMs;
    byRawDir.set(f.projectDir, cur);
  }
  // Resolve the real cwd from the meta cache — any cached session in this
  // projectDir will have the correct cwd from the JSONL. Avoids the lossy
  // dash-to-slash decode.
  const cwdForProject = (dir: string): string | undefined => {
    for (const [, entry] of metaCache.entries()) {
      if (entry.meta.projectDir === dir && entry.meta.cwd) {
        return entry.meta.cwd;
      }
    }
    return undefined;
  };

  // Group raw dirs by their canonical project (parent repo).
  type Agg = {
    canonicalName: string;
    count: number;
    lastActiveMs: number;
    worktreeBranches: Set<string>;
  };
  const canonicalMap = new Map<string, Agg>();
  for (const [rawDir, { count, lastActiveMs }] of byRawDir) {
    const cwdOrDecoded = cwdForProject(rawDir) ?? decodeProjectName(rawDir);
    const canonical = canonicalProjectName(cwdOrDecoded);
    const wt = worktreeName(cwdOrDecoded);

    const agg =
      canonicalMap.get(canonical) ??
      ({
        canonicalName: canonical,
        count: 0,
        lastActiveMs: 0,
        worktreeBranches: new Set<string>(),
      } satisfies Agg);
    agg.count += count;
    if (lastActiveMs > agg.lastActiveMs) agg.lastActiveMs = lastActiveMs;
    if (wt) agg.worktreeBranches.add(wt);
    canonicalMap.set(canonical, agg);
  }

  return Array.from(canonicalMap.values())
    .map((a) => ({
      projectDir: a.canonicalName,
      projectName: a.canonicalName,
      sessionCount: a.count,
      lastActiveMs: a.lastActiveMs,
      worktreeCount: a.worktreeBranches.size,
    }))
    .sort((a, b) => b.lastActiveMs - a.lastActiveMs);
}

/**
 * Load the full team view for a given session. Returns null when the
 * session has no teamName (not part of any team). Otherwise, filters
 * `listSessions()` by teamName, loads each participant's SessionDetail,
 * clusters via groupByTeam, and returns the matching view.
 *
 * Called on-demand when the user opens the Team tab — it reuses the
 * module-scoped cache inside listSessions/getSession, so the fan-out
 * is cheap after the first call.
 */
export async function loadTeamForSession(
  sessionId: string,
  opts: { root?: string } = {},
): Promise<{
  view: TeamView;
  details: Map<string, SessionDetail>;
} | null> {
  const { root = DEFAULT_ROOT } = opts;

  const all = await listSessions({ root });
  const self = all.find((s) => s.sessionId === sessionId);
  if (!self || !self.teamName) return null;
  const teamName = self.teamName;

  const candidates = all.filter(
    (s) => s.teamName === teamName && !s.filePath.includes("/subagents/"),
  );

  const loaded = await Promise.all(
    candidates.map((c) => getSession(c.sessionId, { root })),
  );
  const details = new Map<string, SessionDetail>();
  candidates.forEach((c, i) => {
    const d = loaded[i];
    if (d) details.set(c.sessionId, d);
  });

  const views = groupByTeam(candidates, details);
  const view = views.find((v) => v.teamName === teamName);
  if (!view) return null;
  return { view, details };
}

/** Lightweight lookup: given a team member session, return the lead
 *  session ID + team name without loading full details. Returns null if
 *  the session isn't a team member or no lead is found. */
export async function findTeamLead(
  sessionId: string,
  opts: { root?: string } = {},
): Promise<{ leadSessionId: string; teamName: string; agentName: string } | null> {
  const { root = DEFAULT_ROOT } = opts;
  const all = await listSessions({ root });
  const self = all.find((s) => s.sessionId === sessionId);
  if (!self || !self.teamName || !self.agentName) return null;
  // Already a lead — no parent to navigate to.
  if (self.isTeamLead) return null;
  const candidates = all.filter(
    (s) =>
      s.teamName === self.teamName &&
      s.isTeamLead &&
      !s.filePath.includes("/subagents/"),
  );
  if (candidates.length === 0) return null;
  return {
    leadSessionId: candidates[0]!.sessionId,
    teamName: self.teamName,
    agentName: self.agentName,
  };
}

// ──────────────────────────────────────────────────────────────────
//         Usage daemon snapshots (~/.cclens/usage.jsonl)
// ──────────────────────────────────────────────────────────────────

const USAGE_LOG = path.join(os.homedir(), ".cclens", "usage.jsonl");

type UsageSnapshot = {
  captured_at?: string;
  /** Source agent. Absent on legacy snapshots written before multi-agent
   *  support — readers MUST treat undefined as "claude-code". */
  agent?: AgentKind;
  five_hour?: { utilization?: number; resets_at?: string };
  seven_day?: { utilization?: number; resets_at?: string };
  seven_day_sonnet?: { utilization?: number } | null;
};

/**
 * Per-day peak 5-hour plan utilization for the range [start, end] (inclusive),
 * computed from the daemon's JSONL log. The 5-hour window is the most
 * actionable signal for "how hot did I run today." Lines are in write order
 * (ascending time) so we break early once past endMs.
 */
export async function loadUsageByDay(
  start: Date,
  end: Date,
): Promise<{ by_day: { date: string; peak_util_pct: number }[] }> {
  let raw: string;
  try {
    raw = await fs.readFile(USAGE_LOG, "utf8");
  } catch {
    return { by_day: [] };
  }

  const startMs = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const endMs = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999).getTime();

  const byDay = new Map<string, number>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const snap = JSON.parse(trimmed) as UsageSnapshot;
      if (!snap.captured_at) continue;
      // Same rationale as loadCalibrationSnapshots: peak Claude utilization
      // can't include Codex's 5h reading or downstream charts skew.
      if ((snap.agent ?? "claude-code") !== "claude-code") continue;
      const ms = Date.parse(snap.captured_at);
      if (Number.isNaN(ms)) continue;
      if (ms < startMs) continue;
      if (ms > endMs) break;
      const key = toLocalDay(ms);
      const util = snap.five_hour?.utilization ?? 0;
      const cur = byDay.get(key) ?? 0;
      if (util > cur) byDay.set(key, util);
    } catch {
      /* skip malformed */
    }
  }

  // Fill the day range so callers don't need to
  const out: { date: string; peak_util_pct: number }[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const stop = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cur.getTime() <= stop.getTime()) {
    const k = toLocalDay(cur.getTime());
    out.push({ date: k, peak_util_pct: byDay.get(k) ?? 0 });
    cur.setDate(cur.getDate() + 1);
  }
  return { by_day: out };
}

// ──────────────────────────────────────────────────────────────────
// Calibration: JSONL → predicted utilization
// ──────────────────────────────────────────────────────────────────

/**
 * Walk all JSONL transcripts under `root` and return one CalibrationEvent
 * per unique message.id. Multi-block assistant messages emit thinking +
 * text + tool_use lines that all carry the same final usage block; summing
 * every line inflates tokens 2-3x. We keep the LAST line per id (its
 * "final state" usage). Non-Claude (glm-*) and synthetic events are
 * dropped — they aren't priced by Anthropic.
 */
export async function loadCalibrationEvents(
  root: string = DEFAULT_ROOT,
): Promise<CalibrationEvent[]> {
  const files = await walkJsonlFiles(root);
  // Per-file extraction so the mtime+size cache short-circuits unchanged files.
  // message.id is unique per Anthropic response, so per-file dedupe gives the
  // same set as the previous global Map<id, event>.
  const perFile = await Promise.all(
    files.map(async (f): Promise<CalibrationEvent[]> => {
      const cached = calibrationEventsCache.get(f.fullPath);
      if (cached && cached.mtimeMs === f.mtimeMs && cached.sizeBytes === f.sizeBytes) {
        return cached.events;
      }
      let lines: unknown[];
      try {
        lines = await readJsonlFile(f.fullPath);
      } catch {
        return [];
      }
      const byId = new Map<string, CalibrationEvent>();
      for (const raw of lines) {
        if (!raw || typeof raw !== "object") continue;
        const r = raw as Record<string, unknown>;
        if (r.type !== "assistant") continue;
        const ts = typeof r.timestamp === "string" ? r.timestamp : undefined;
        if (!ts) continue;
        const m = r.message as Record<string, unknown> | undefined;
        if (!m) continue;
        const u = m.usage as Record<string, unknown> | undefined;
        if (!u) continue;
        const family = modelFamily(typeof m.model === "string" ? m.model : undefined);
        if (family === null) continue;
        const mid = typeof m.id === "string" ? m.id : `__noid_${f.fullPath}_${ts}`;
        const cc = (u.cache_creation as Record<string, unknown> | undefined) ?? {};
        const toNum = (v: unknown) => (typeof v === "number" ? v : 0);
        byId.set(mid, {
          ts,
          family,
          input: toNum(u.input_tokens),
          output: toNum(u.output_tokens),
          cacheRead: toNum(u.cache_read_input_tokens),
          cache_1h: toNum(cc.ephemeral_1h_input_tokens),
          cache_5m: toNum(cc.ephemeral_5m_input_tokens),
        });
      }
      const events = Array.from(byId.values());
      calibrationEventsCache.set(f.fullPath, {
        events,
        mtimeMs: f.mtimeMs,
        sizeBytes: f.sizeBytes,
      });
      return events;
    }),
  );
  const out = perFile.flat();
  out.sort((a, b) => a.ts.localeCompare(b.ts));
  return out;
}

/**
 * All Claude Code snapshots from ~/.cclens/usage.jsonl, sorted by captured_at.
 *
 * The calibration curve maps Claude session activity to Claude plan-window
 * utilization, so it MUST exclude snapshots from other agents — otherwise a
 * Codex 5h-window reading gets read as a Claude burnrate sample and skews the
 * predicted line. Snapshots without an `agent` field default to "claude-code"
 * for back-compat with logs written before multi-agent support.
 */
export async function loadCalibrationSnapshots(): Promise<UsageSnapshot[]> {
  let raw: string;
  try {
    raw = await fs.readFile(USAGE_LOG, "utf8");
  } catch {
    return [];
  }
  const out: UsageSnapshot[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const s = JSON.parse(t) as UsageSnapshot;
      if (!s.captured_at) continue;
      if ((s.agent ?? "claude-code") !== "claude-code") continue;
      out.push(s);
    } catch {
      /* skip malformed */
    }
  }
  out.sort((a, b) => (a.captured_at ?? "").localeCompare(b.captured_at ?? ""));
  return out;
}

/**
 * One point on the calibration curve — pairs the daemon's measured
 * utilization (when a snapshot landed in the slot) with the JSONL-derived
 * prediction at that timestamp.
 */
export type CalibrationCurvePoint = {
  ts: string;
  real_5h: number | null;
  pred_5h: number;
  real_7d: number | null;
  pred_7d: number;
  /** ISO timestamp of the 5h cycle this point belongs to (= resets_at).
   * Lets consumers group points into cycles without having to detect
   * resets heuristically from value drops. */
  cycle_end_5h: string | null;
  cycle_end_7d: string | null;
};

export type CalibrationCurve = {
  model: string;
  tier: PlanTier;
  rate_per_pct: number;
  rate_per_pct_5h: number;
  rate_per_pct_7d: number;
  /** "user_calibrated" once a well-covered completed cycle has been
   * observed; "tier_default" until then. Surfaced so the UI can label the
   * predicted overlay (e.g. "calibrated from 3 cycles") instead of just
   * showing a line of unknown provenance. */
  rate_source_5h: RateSource;
  rate_source_7d: RateSource;
  cycles_used_5h: number;
  cycles_used_7d: number;
  granularity_min: number;
  curve: CalibrationCurvePoint[];
  first_snapshot_ts: string | null;
  real_count: number;
  total_count: number;
};

/**
 * Walk forward from each snapshot's `resets_at` to find the most recent
 * earlier snapshot whose reset value matches `ts`. Used to figure out
 * "which 5h or 7d cycle does this timestamp belong to" so we can pick
 * the right window start.
 */
function inferResetsAt(
  ts: number,
  snapResets: Array<[number, number]>,
  cycleHours: number,
): number | null {
  if (snapResets.length === 0) return null;
  for (const [snapMs, resetMs] of snapResets) {
    if (snapMs >= ts && resetMs > ts) {
      let r = resetMs;
      const cycleMs = cycleHours * 3_600_000;
      while (r - cycleMs > ts) r -= cycleMs;
      return r;
    }
  }
  // ts is after every known snapshot — extrapolate forward
  let last = snapResets[snapResets.length - 1]![1];
  const cycleMs = cycleHours * 3_600_000;
  while (last < ts) last += cycleMs;
  return last;
}

/**
 * Build a continuous predicted-utilization curve aligned with daemon
 * snapshots. The predictor passes EXACTLY through every observed OAuth
 * snapshot via spend-weighted interpolation between adjacent snaps in the
 * same cycle. Past the latest snap of a cycle (forward extrapolation) it
 * uses a $/pp rate fitted from the upper percentile of snap-pair rates
 * across all cycles — closest to the user's solo rate on shared accounts
 * where teammates contribute pp travel that we never see in JSONL.
 * See predictAnchored / collectSnapPairRates in calibration.ts.
 *
 * Cold-start back-fill: the curve extends up to 14 days before the first
 * snapshot so /usage shows estimates from JSONL spend even when the daemon
 * is brand new. After the first snapshot, real values are paired with
 * predictions for direct comparison.
 */
export function buildCalibrationCurve(
  events: CalibrationEvent[],
  snapshots: UsageSnapshot[],
  tier: PlanTier = "pro-max-20x",
  granularityMin = 30,
): CalibrationCurve | null {
  if (snapshots.length === 0 || events.length === 0) return null;

  const spend = buildSpendIndex(events);
  const tierDefault7d = RATE_PER_PCT_7D[tier];
  const tierDefault5h = RATE_PER_PCT_5H[tier];

  const snapsByCycle5h = groupSnapsByCycle(snapshots, (s) => s.five_hour);
  const snapsByCycle7d = groupSnapsByCycle(snapshots, (s) => s.seven_day);
  // Keep only pairs with ≥$10 (7d) / ≥$1 (5h) of user spend — filters out
  // low-spend pairs whose rates are dominated by 1pp utilization rounding
  // noise. The remaining pairs cluster tightly around the user's solo rate
  // on shared accounts (verified in /tmp/calibrate-bench-shared.mjs:
  // dropping the noise floor moved the p90 from $15.9 → $21.8 with no
  // sensitivity to maxGap). Cap at 24h to drop daemon-off pairs where
  // teammate contribution is unknowable.
  const pairs7d = collectSnapPairRates(snapsByCycle7d, spend, {
    minTravelPct: 1, minDollars: 10, maxGapMs: 24 * 3_600_000,
  });
  const pairs5h = collectSnapPairRates(snapsByCycle5h, spend, {
    minTravelPct: 1, minDollars: 1, maxGapMs: 2 * 3_600_000,
  });
  const fwdRate7d = userSoloRate(pairs7d, 0.9) ?? tierDefault7d;
  const fwdRate5h = userSoloRate(pairs5h, 0.9) ?? tierDefault5h;
  // Distinct cycles contributing to the fitted rate — surfaced as
  // `cycles_used_*` so the UI can label provenance.
  const cycles7d = new Set(pairs7d.map((p) => p.cycleEndMs)).size;
  const cycles5h = new Set(pairs5h.map((p) => p.cycleEndMs)).size;

  // (snap_ts, reset_ts) pairs for inferResetsAt — used to attribute each
  // curve-point timestamp to the cycle it belongs to.
  const snap5h: Array<[number, number]> = [];
  const snap7d: Array<[number, number]> = [];
  for (const s of snapshots) {
    const ms = Date.parse(s.captured_at!);
    if (Number.isNaN(ms)) continue;
    if (s.five_hour?.resets_at) {
      const r = Date.parse(s.five_hour.resets_at);
      if (!Number.isNaN(r)) snap5h.push([ms, r]);
    }
    if (s.seven_day?.resets_at) {
      const r = Date.parse(s.seven_day.resets_at);
      if (!Number.isNaN(r)) snap7d.push([ms, r]);
    }
  }
  const HOUR = 3_600_000;

  // Real-value lookup at minute granularity
  const realByMinute = new Map<number, [number | null, number | null]>();
  for (const s of snapshots) {
    const ms = Date.parse(s.captured_at!);
    if (Number.isNaN(ms)) continue;
    const k = Math.floor(ms / 60_000);
    realByMinute.set(k, [
      s.five_hour?.utilization ?? null,
      s.seven_day?.utilization ?? null,
    ]);
  }

  const firstSnapMs = Date.parse(snapshots[0]!.captured_at!);
  const lastSnapMs = Date.parse(snapshots[snapshots.length - 1]!.captured_at!);
  const firstEventMs = Date.parse(events[0]!.ts);
  const rangeStart = Math.max(firstEventMs, firstSnapMs - 14 * 86_400_000);
  const rangeEnd = lastSnapMs;
  const stepMs = granularityMin * 60_000;

  const curve: CalibrationCurvePoint[] = [];
  let cur = rangeStart;
  while (cur <= rangeEnd) {
    let real5: number | null = null;
    let real7: number | null = null;
    for (let off = 0; off < granularityMin; off++) {
      const k = Math.floor((cur + off * 60_000) / 60_000);
      const r = realByMinute.get(k);
      if (r) { real5 = r[0]; real7 = r[1]; break; }
    }

    const r5 = inferResetsAt(cur, snap5h, 5);
    const r7 = inferResetsAt(cur, snap7d, 168);
    // groupSnapsByCycle keys are hour-rounded so sub-second jitter on
    // resets_at doesn't fragment a cycle into multiple buckets. Round
    // the inferResetsAt result the same way so the lookup hits.
    const r5k = r5 != null ? Math.round(r5 / HOUR) * HOUR : null;
    const r7k = r7 != null ? Math.round(r7 / HOUR) * HOUR : null;

    const cycle5Snaps = r5k != null ? (snapsByCycle5h.get(r5k) ?? []) : [];
    const cycle7Snaps = r7k != null ? (snapsByCycle7d.get(r7k) ?? []) : [];
    const cycleEnd5 = r5k ?? cur + 5 * HOUR;
    const cycleEnd7 = r7k ?? cur + 168 * HOUR;

    const p5 = predictAnchored(spend, cycle5Snaps, fwdRate5h, cycleEnd5, 5, cur);
    const p7 = predictAnchored(spend, cycle7Snaps, fwdRate7d, cycleEnd7, 168, cur);

    curve.push({
      ts: new Date(cur).toISOString(),
      real_5h: real5,
      pred_5h: Math.max(0, Math.min(200, p5)),
      real_7d: real7,
      pred_7d: Math.max(0, Math.min(200, p7)),
      cycle_end_5h: r5k != null ? new Date(r5k).toISOString() : null,
      cycle_end_7d: r7k != null ? new Date(r7k).toISOString() : null,
    });
    cur += stepMs;
  }

  // "user_calibrated" when we fit a rate from this account's snap-pairs;
  // "tier_default" while still cold-starting (fewer than 3 usable pairs).
  const rateSource7d: RateSource = pairs7d.length >= 3 ? "user_calibrated" : "tier_default";
  const rateSource5h: RateSource = pairs5h.length >= 3 ? "user_calibrated" : "tier_default";

  return {
    model: `anchored-${tier}`,
    tier,
    rate_per_pct: fwdRate7d,
    rate_per_pct_5h: fwdRate5h,
    rate_per_pct_7d: fwdRate7d,
    rate_source_5h: rateSource5h,
    rate_source_7d: rateSource7d,
    cycles_used_5h: cycles5h,
    cycles_used_7d: cycles7d,
    granularity_min: granularityMin,
    curve,
    first_snapshot_ts: snapshots[0]!.captured_at ?? null,
    real_count: curve.filter((c) => c.real_7d !== null).length,
    total_count: curve.length,
  };
}

/**
 * Convenience entry point: load events + snapshots, build the curve.
 * Heavy on first call (walks every JSONL); fast afterward thanks to the
 * module-scoped cache. Wrap in React's `cache()` from the calling layer
 * to make it per-request memoized.
 */
export async function loadCalibrationCurve(
  tier: PlanTier = "pro-max-20x",
  root: string = DEFAULT_ROOT,
  granularityMin = 30,
): Promise<CalibrationCurve | null> {
  const [events, snapshots] = await Promise.all([
    loadCalibrationEvents(root),
    loadCalibrationSnapshots(),
  ]);
  return buildCalibrationCurve(events, snapshots, tier, granularityMin);
}

/* ================================================================= */
/*  Codex (OpenAI) re-export                                         */
/* ================================================================= */

import {
  DEFAULT_CODEX_ROOT as _DEFAULT_CODEX_ROOT,
  listCodexSessions as _listCodexSessions,
  getCodexSession as _getCodexSession,
  clearCodexCaches,
  getLatestCodexUsage,
} from "./codex.js";

export {
  DEFAULT_CODEX_ROOT,
  listCodexSessions,
  getCodexSession,
  codexSessionLocalDay,
  getLatestCodexUsage,
} from "./codex.js";
export type {
  ListCodexOptions,
  GetCodexOptions,
  CodexUsageWindows,
} from "./codex.js";


/* ================================================================= */
/*  Generic agent-source registry                                    */
/*                                                                   */
/*  Each coding-agent we observe (Claude Code, Codex, ...) is an     */
/*  AgentSource. Adding a new agent = drop in a new source object.   */
/*  Inlined here rather than a sibling module because the registry   */
/*  binds the Claude Code reader (this file) AND the Codex reader —  */
/*  splitting it creates a fs.ts ↔ agent-source.ts cycle that        */
/*  Next.js + turbopack reject during page-data collection.          */
/* ================================================================= */

import type { AgentKind } from "./types.js";
import {
  type AgentMetadata,
  CLAUDE_CODE_METADATA,
  CODEX_METADATA,
} from "./agent-metadata.js";

/**
 * A coding-agent's pluggable adapter. Adding a new agent (Gemini CLI,
 * OpenCode, …) means writing one parser module and pushing one source
 * object to `agentSources` below — every consumer (daemon, UI, prompts,
 * digest pipeline) iterates the registry instead of switching on kinds.
 *
 * Structurally extends AgentMetadata so the kind / displayName /
 * shortLabel / accentColor fields stay in sync — change them in
 * agent-metadata.ts and the AgentSource shape follows automatically.
 */
export type AgentSource = AgentMetadata & {
  // ── On-disk layout ──────────────────────────────────────────────
  /** Default root directory the source reads from. Shown in help text
   *  and in the /sessions subtitle so users see where the data lives. */
  defaultRoot: string;

  // ── Reading sessions ────────────────────────────────────────────
  listSessions(opts?: ListOptions): Promise<SessionMeta[]>;
  getSession(id: string, opts?: { root?: string }): Promise<SessionDetail | null>;

  // ── Optional capabilities ───────────────────────────────────────
  /** Polled by the daemon every cycle. Return null when there's
   *  nothing new to report (no sessions yet, agent not installed). */
  usagePoller?(): Promise<UsageSnapshotLike | null>;
};

/** Minimal shape the daemon expects from any source's usagePoller. The
 *  full UsageSnapshot type lives in the cli package; using a structural
 *  subset here keeps parser → cli direction one-way (no cycle). */
type UsageSnapshotLike = {
  captured_at: string;
  agent?: AgentKind;
  five_hour: { utilization: number | null; resets_at: string | null };
  seven_day: { utilization: number | null; resets_at: string | null };
};

const claudeCodeSource: AgentSource = {
  ...CLAUDE_CODE_METADATA,
  defaultRoot: DEFAULT_ROOT,
  async listSessions(opts) {
    const sessions = await listSessions(opts);
    for (const s of sessions) if (!s.agent) s.agent = "claude-code";
    return sessions;
  },
  async getSession(id, opts) {
    const detail = await getSession(id, opts);
    if (detail && !detail.agent) detail.agent = "claude-code";
    return detail;
  },
  // Claude's usage poller intentionally absent: the OAuth path lives in
  // the cli package (network + token storage) and the daemon's tick()
  // loop calls fetchUsage() directly because OAuth outcomes drive the
  // backoff state. Other sources expose a poller here; Claude doesn't.
};

const codexSource: AgentSource = {
  ...CODEX_METADATA,
  defaultRoot: _DEFAULT_CODEX_ROOT,
  async listSessions(opts) {
    return _listCodexSessions(opts);
  },
  async getSession(id) {
    return _getCodexSession(id);
  },
  // Codex's poller is pure — reads from disk, no network — so it can
  // live right here in the parser package.
  async usagePoller() {
    const w = await getLatestCodexUsage();
    if (!w) return null;
    return {
      captured_at: new Date().toISOString(),
      agent: "codex",
      five_hour: w.five_hour,
      seven_day: w.seven_day,
    };
  },
};

export const agentSources: AgentSource[] = [claudeCodeSource, codexSource];

export function getAgentSource(kind: AgentKind): AgentSource | undefined {
  return agentSources.find((s) => s.kind === kind);
}

export async function listAllSessions(opts: { limit?: number } = {}): Promise<SessionMeta[]> {
  const lists = await Promise.all(agentSources.map((s) => s.listSessions(opts)));
  const merged: SessionMeta[] = [];
  for (const lst of lists) merged.push(...lst);
  merged.sort((a, b) => (b.firstTimestamp ?? "").localeCompare(a.firstTimestamp ?? ""));
  if (opts.limit !== undefined) return merged.slice(0, opts.limit);
  return merged;
}

export async function getAnySession(id: string): Promise<SessionDetail | null> {
  for (const source of agentSources) {
    const detail = await source.getSession(id);
    if (detail) return detail;
  }
  return null;
}
