/**
 * Claude Code's filesystem adapter — reads `~/.claude/projects/`.
 *
 * Owns: session listing/loading, sub-agent transcripts, project rollups,
 * team-coordination view, and the AgentSource entry for the registry.
 *
 * Caching: per-file mtime+size cache, inspired by ccboard's 89x speedup
 * (https://github.com/FlorianBruniaux/ccboard). Module-scoped, shared
 * across all RSC requests in the same process.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseTranscript, type ParseResult } from "./parser.js";
import { worktreeName, projectRepoName, toLocalDay } from "./analytics.js";
import { groupByTeam, type TeamView } from "./team.js";
import type {
  AgentKind,
  SessionDetail,
  SessionEvent,
  SessionMeta,
  SubagentRun,
  Usage,
  WorkflowRun,
} from "./types.js";
import {
  type AgentMetadata,
  CLAUDE_CODE_METADATA,
} from "./agent-metadata.js";
import { type CalibrationEvent, modelFamily } from "./calibration.js";

export const DEFAULT_ROOT = path.join(os.homedir(), ".claude", "projects");

/** Claude Code encodes cwd as `-Users-me-Repo-foo`. Decode → `/Users/me/Repo/foo`. */
export function decodeProjectName(dir: string): string {
  if (!dir.startsWith("-")) return dir;
  return "/" + dir.slice(1).replace(/-/g, "/");
}

/** Encode a cwd into its `~/.claude/projects/` dir name (every `/` and `.` → `-`). */
function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

// Fleetlens's own tmux LLM runs — must match runtimeCwd() in tmux-runner.ts.
const FLEETLENS_RUNTIME_PROJECT_DIR = encodeProjectDir(
  path.join(os.homedir(), ".cclens", "runtime"),
);

export function isFleetlensRuntimeDir(projectDir: string): boolean {
  return projectDir === FLEETLENS_RUNTIME_PROJECT_DIR;
}

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

export function sessionIdFromFileName(fileName: string): string {
  return fileName.replace(/\.jsonl$/i, "");
}

/* ================================================================= */
/*  Module-scoped caches                                             */
/* ================================================================= */

type MetaCacheEntry = { meta: SessionMeta; mtimeMs: number; sizeBytes: number };
type DetailCacheEntry = { detail: SessionDetail; mtimeMs: number; sizeBytes: number };
type CalibrationEventsCacheEntry = { events: CalibrationEvent[]; mtimeMs: number; sizeBytes: number };

const metaCache = new Map<string, MetaCacheEntry>();
const detailCache = new Map<string, DetailCacheEntry>();
const calibrationEventsCache = new Map<string, CalibrationEventsCacheEntry>();

/** Short-lived file-list cache so multiple calls within the same RSC pass
 *  don't re-stat the directory. */
let fileListCache: { files: FileRef[]; capturedAtMs: number; root: string } | null = null;
const FILE_LIST_TTL_MS = 1_000;

export type ClaudeCodeCacheStats = {
  metaEntries: number;
  detailEntries: number;
  calibrationEventsEntries: number;
};

export function claudeCodeCacheStats(): ClaudeCodeCacheStats {
  return {
    metaEntries: metaCache.size,
    detailEntries: detailCache.size,
    calibrationEventsEntries: calibrationEventsCache.size,
  };
}

export function clearClaudeCodeCaches(): void {
  metaCache.clear();
  detailCache.clear();
  calibrationEventsCache.clear();
  fileListCache = null;
}

export function invalidateClaudeCodeFile(fullPath: string): void {
  metaCache.delete(fullPath);
  detailCache.delete(fullPath);
  calibrationEventsCache.delete(fullPath);
  fileListCache = null;
}

/* ================================================================= */
/*  File walking                                                     */
/* ================================================================= */

/**
 * Walk `~/.claude/projects/<encoded-cwd>/*.jsonl`, returning one ref per file.
 * Parallelizes per-project stat calls — ~600ms → ~80ms on 44 projects / 658 files.
 */
export async function walkJsonlFiles(root: string = DEFAULT_ROOT): Promise<FileRef[]> {
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

  const projectDirs = topEntries
    .filter((e) => e.isDirectory() && !isFleetlensRuntimeDir(e.name))
    .map((e) => e.name);

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

/* ================================================================= */
/*  Calibration-events extraction                                    */
/* ================================================================= */

/**
 * One CalibrationEvent per unique message.id across all transcripts under
 * `root`. Multi-block assistant messages emit thinking + text + tool_use
 * lines that all carry the same final usage block; summing every line
 * inflates tokens 2-3x — keep the LAST line per id ("final state" usage).
 * Non-Anthropic model lines (e.g. glm-*) are dropped.
 */
export async function loadCalibrationEvents(
  root: string = DEFAULT_ROOT,
): Promise<CalibrationEvent[]> {
  const files = await walkJsonlFiles(root);
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

/* ================================================================= */
/*  Meta / detail loaders with caching                               */
/* ================================================================= */

const BLANK_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** Aggregate token usage from raw JSONL lines. Shares a dedup set so the
 *  same message:requestId pair isn't double-counted across parent + subagent
 *  files (matches ccusage's approach). When `perDay` is supplied, each
 *  message's tokens are also bucketed by the local day of its own timestamp
 *  (falling back to `fallbackDay`) so the per-day split sums to the same total
 *  — subagent tokens included, even when a subagent ran past midnight. */
function aggregateUsageFromLines(
  lines: unknown[],
  seenKeys: Set<string>,
  usage: Usage,
  perDay?: Map<string, Usage>,
  fallbackDay?: string,
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
      const inp = toNum(u.input_tokens);
      const out = toNum(u.output_tokens);
      const cr = toNum(u.cache_read_input_tokens);
      const cw = toNum(u.cache_creation_input_tokens);
      usage.input += inp;
      usage.output += out;
      usage.cacheRead += cr;
      usage.cacheWrite += cw;
      if (perDay) {
        let day: string | undefined;
        const ts = typeof r.timestamp === "string" ? r.timestamp : undefined;
        if (ts) {
          const ms = Date.parse(ts);
          if (!Number.isNaN(ms)) day = toLocalDay(ms);
        }
        day = day ?? fallbackDay;
        if (day) {
          let d = perDay.get(day);
          if (!d) {
            d = { ...BLANK_USAGE };
            perDay.set(day, d);
          }
          d.input += inp;
          d.output += out;
          d.cacheRead += cr;
          d.cacheWrite += cw;
        }
      }
    }
  }
}

async function computeSessionUsageWithSubagents(
  parentLines: unknown[],
  projectDirPath: string,
  sessionId: string,
  fallbackDay?: string,
): Promise<{ usage: Usage; perDay: Map<string, Usage> }> {
  const usage: Usage = { ...BLANK_USAGE };
  const seenKeys = new Set<string>();
  const perDay = new Map<string, Usage>();

  aggregateUsageFromLines(parentLines, seenKeys, usage, perDay, fallbackDay);

  const subagentsDir = path.join(projectDirPath, sessionId, "subagents");
  let entries: string[];
  try {
    entries = await fs.readdir(subagentsDir);
  } catch {
    return { usage, perDay };
  }
  const jsonlFiles = entries.filter((f) => f.endsWith(".jsonl"));
  if (jsonlFiles.length === 0) return { usage, perDay };

  await Promise.all(
    jsonlFiles.map(async (f) => {
      try {
        const lines = await readJsonlFile(path.join(subagentsDir, f));
        aggregateUsageFromLines(lines, seenKeys, usage, perDay, fallbackDay);
      } catch {
        /* skip unreadable files */
      }
    }),
  );
  return { usage, perDay };
}

/** Overwrite dailyBreakdown's parent-only token split with the subagent-
 *  inclusive per-day map so sum(tokens) stays === totalUsage. Unions both day
 *  sets so a day with only subagent token activity isn't dropped. Any usage
 *  that couldn't be dated (parent lines with no parseable timestamp while a
 *  subagent supplied the only days) is folded onto the earliest day, so the
 *  invariant holds even on malformed transcripts. */
function mergeDailyTokens(
  base: SessionMeta["dailyBreakdown"],
  perDayTokens: Map<string, Usage>,
  totalUsage: Usage,
): SessionMeta["dailyBreakdown"] {
  const counts = new Map((base ?? []).map((d) => [d.day, d]));
  const days = new Set<string>([...counts.keys(), ...perDayTokens.keys()]);
  const out = [...days]
    .sort((a, b) => a.localeCompare(b))
    .map((day) => ({
      day,
      toolCalls: counts.get(day)?.toolCalls ?? 0,
      turns: counts.get(day)?.turns ?? 0,
      tokens: { ...(perDayTokens.get(day) ?? BLANK_USAGE) },
    }));
  if (out.length > 0) {
    const summed = out.reduce(
      (a, r) => ({
        input: a.input + r.tokens.input,
        output: a.output + r.tokens.output,
        cacheRead: a.cacheRead + r.tokens.cacheRead,
        cacheWrite: a.cacheWrite + r.tokens.cacheWrite,
      }),
      { ...BLANK_USAGE },
    );
    const first = out[0]!.tokens;
    first.input += totalUsage.input - summed.input;
    first.output += totalUsage.output - summed.output;
    first.cacheRead += totalUsage.cacheRead - summed.cacheRead;
    first.cacheWrite += totalUsage.cacheWrite - summed.cacheWrite;
  }
  return out;
}

type WorkflowAggregate = {
  workflowCount: number;
  spawnedAgentCount: number;
  /** Wall-clock execution spans (epoch ms) of completed runs — folded into
   *  the session's active segments so workflow execution counts as agent
   *  time (the parent transcript only shows a gap while the fleet works). */
  spans: { startMs: number; endMs: number }[];
};

/** Cheap aggregate over a session's `workflows/wf_*.json` journals — run
 *  count, summed agentCount, and execution spans. Used on the list/meta path
 *  where we want the "this session orchestrated N agents" badge + agent-time
 *  fold without paying for a full WorkflowRun build. Returns zeros when the
 *  dir is absent (the common case — most sessions never dispatch a workflow). */
async function scanWorkflowAggregate(
  projectDirPath: string,
  sessionId: string,
): Promise<WorkflowAggregate> {
  const dir = path.join(projectDirPath, sessionId, "workflows");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return { workflowCount: 0, spawnedAgentCount: 0, spans: [] };
  }
  const jsonFiles = entries.filter((f) => f.startsWith("wf_") && f.endsWith(".json"));
  if (jsonFiles.length === 0) return { workflowCount: 0, spawnedAgentCount: 0, spans: [] };
  let spawnedAgentCount = 0;
  const spans: { startMs: number; endMs: number }[] = [];
  // Count only journals that actually parse, so this matches the full
  // loadWorkflows() path (which drops unparseable files) — otherwise the list
  // badge and the detail header would disagree on a truncated/mid-write file.
  const parsed = await Promise.all(
    jsonFiles.map(async (f) => {
      try {
        const j = JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as {
          agentCount?: unknown;
          startTime?: unknown;
          durationMs?: unknown;
        };
        if (typeof j.agentCount === "number") spawnedAgentCount += j.agentCount;
        if (typeof j.startTime === "number" && typeof j.durationMs === "number" && j.durationMs > 0) {
          spans.push({ startMs: j.startTime, endMs: j.startTime + j.durationMs });
        }
        return true;
      } catch {
        return false; // skip unreadable / malformed journal
      }
    }),
  );
  return { workflowCount: parsed.filter(Boolean).length, spawnedAgentCount, spans };
}

/** Union the parent session's active segments with workflow execution spans
 *  and recompute airTime, so a session's "agent time" reflects the wall-clock
 *  the fleet was working — not just the parent transcript's own activity (the
 *  parent just shows a gap while a Workflow tool call churns). Returns the
 *  patch to apply, or `{}` when there's nothing to fold. */
function foldWorkflowAgentTime(
  activeSegments: { startMs: number; endMs: number }[] | undefined,
  spans: { startMs: number; endMs: number }[],
): { activeSegments?: { startMs: number; endMs: number }[]; airTimeMs?: number } {
  if (spans.length === 0) return {};
  const all = [...(activeSegments ?? []), ...spans]
    .filter((s) => s.endMs > s.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  if (all.length === 0) return {};
  const merged: { startMs: number; endMs: number }[] = [{ ...all[0]! }];
  for (let i = 1; i < all.length; i++) {
    const cur = all[i]!;
    const last = merged[merged.length - 1]!;
    if (cur.startMs <= last.endMs) last.endMs = Math.max(last.endMs, cur.endMs);
    else merged.push({ ...cur });
  }
  const airTimeMs = merged.reduce((n, s) => n + (s.endMs - s.startMs), 0);
  return { activeSegments: merged, airTimeMs };
}

/**
 * Recompute a parsed meta's totals to be subagent-inclusive (so they match
 * ccusage) and rebuild its per-day token split to keep the invariant
 * sum(dailyBreakdown.tokens) === totalUsage. BOTH the list path
 * (getCachedMeta) and the detail path (getCachedDetail) must apply this:
 * getCachedDetail backfills the shared metaCache, so if it skipped this the
 * cache would be poisoned with parent-only totals and a later listSessions
 * would undercount that session's tokens by the entire subagent contribution.
 * Mutates `meta` in place.
 */
async function applySubagentUsage(meta: ParseResult["meta"], rawLines: unknown[], f: FileRef): Promise<void> {
  const sessionId = sessionIdFromFileName(f.fileName);
  const projectDirPath = path.dirname(f.fullPath);
  const fallbackDay = meta.firstTimestamp
    ? toLocalDay(Date.parse(meta.firstTimestamp))
    : undefined;
  const { usage, perDay: perDayTokens } = await computeSessionUsageWithSubagents(
    rawLines,
    projectDirPath,
    sessionId,
    fallbackDay,
  );
  meta.totalUsage = usage;
  meta.dailyBreakdown = mergeDailyTokens(meta.dailyBreakdown, perDayTokens, usage);
}

async function getCachedMeta(f: FileRef): Promise<SessionMeta | null> {
  const cached = metaCache.get(f.fullPath);
  if (cached && cached.mtimeMs === f.mtimeMs && cached.sizeBytes === f.sizeBytes) {
    return cached.meta;
  }
  try {
    const rawLines = await readJsonlFile(f.fullPath);
    const { meta } = parseTranscript(rawLines);

    await applySubagentUsage(meta, rawLines, f);

    const sessionId = sessionIdFromFileName(f.fileName);
    const projectDirPath = path.dirname(f.fullPath);
    const wf = await scanWorkflowAggregate(projectDirPath, sessionId);

    // Use the real cwd from the JSONL when available — the decoded dir name
    // is lossy (dashes in folder names become slashes).
    const full: SessionMeta = {
      ...meta,
      id: sessionId,
      filePath: f.fullPath,
      projectDir: f.projectDir,
      projectName: meta.cwd ?? decodeProjectName(f.projectDir),
      ...(wf.workflowCount > 0
        ? { workflowCount: wf.workflowCount, spawnedAgentCount: wf.spawnedAgentCount }
        : {}),
      ...foldWorkflowAgentTime(meta.activeSegments, wf.spans),
    };
    metaCache.set(f.fullPath, { meta: full, mtimeMs: f.mtimeMs, sizeBytes: f.sizeBytes });
    return full;
  } catch {
    return null;
  }
}

async function getCachedDetail(f: FileRef): Promise<SessionDetail | null> {
  const cached = detailCache.get(f.fullPath);
  if (cached && cached.mtimeMs === f.mtimeMs && cached.sizeBytes === f.sizeBytes) {
    return cached.detail;
  }
  try {
    const rawLines = await readJsonlFile(f.fullPath);
    const { meta, events } = parseTranscript(rawLines);
    const sessionId = sessionIdFromFileName(f.fileName);

    // Subagent-inclusive totals, same as the list path — otherwise the detail
    // (and the metaCache it backfills below) would carry parent-only tokens.
    await applySubagentUsage(meta, rawLines, f);

    // Keep the workflow aggregate on the detail (and thus the metaCache it
    // backfills) so opening a session never strips the "N agents" badge that
    // the list path computes.
    const wf = await scanWorkflowAggregate(path.dirname(f.fullPath), sessionId);
    const detail: SessionDetail = {
      ...meta,
      id: sessionId,
      filePath: f.fullPath,
      projectDir: f.projectDir,
      projectName: meta.cwd ?? decodeProjectName(f.projectDir),
      events,
      ...(wf.workflowCount > 0
        ? { workflowCount: wf.workflowCount, spawnedAgentCount: wf.spawnedAgentCount }
        : {}),
      ...foldWorkflowAgentTime(meta.activeSegments, wf.spans),
    };
    detailCache.set(f.fullPath, { detail, mtimeMs: f.mtimeMs, sizeBytes: f.sizeBytes });
    // Populate the meta cache from the detail so a later listSessions
    // doesn't have to re-parse the file.
    const metaOnly: SessionMeta = { ...detail };
    delete (metaOnly as SessionMeta & { events?: unknown }).events;
    metaCache.set(f.fullPath, { meta: metaOnly, mtimeMs: f.mtimeMs, sizeBytes: f.sizeBytes });
    return detail;
  } catch {
    return null;
  }
}

export type ListOptions = {
  root?: string;
  limit?: number;
  projectDir?: string;
};

export async function listSessions(opts: ListOptions = {}): Promise<SessionMeta[]> {
  const { root = DEFAULT_ROOT, limit = 500, projectDir } = opts;
  let files = await walkJsonlFiles(root);
  if (projectDir) files = files.filter((f) => f.projectDir === projectDir);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const sliced = files.slice(0, limit);
  const metas = await Promise.all(sliced.map((f) => getCachedMeta(f)));
  return metas.filter((m): m is SessionMeta => m !== null);
}

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
  const workflowsDir = path.join(
    path.dirname(hit.fullPath),
    sessionIdFromFileName(hit.fileName),
    "workflows",
  );
  const [subagents, workflows] = await Promise.all([
    loadSubagents(subagentsDir, sessionStartMs, detail.events),
    loadWorkflows(workflowsDir, sessionStartMs, detail.events),
  ]);
  // Recompute the aggregate from the fully-parsed runs so the detail view is
  // self-consistent (a malformed journal that scanWorkflowAggregate counted
  // but loadWorkflows dropped won't skew the header here).
  const spawnedAgentCount = workflows.reduce((n, w) => n + w.agentCount, 0);
  return {
    ...detail,
    subagents,
    workflows,
    ...(workflows.length > 0
      ? { workflowCount: workflows.length, spawnedAgentCount }
      : {}),
  };
}

/* ================================================================= */
/*  Subagent loading                                                 */
/* ================================================================= */

type SubagentMeta = { agentType?: string; description?: string };

/** Quick-pass parser for a subagent JSONL. Skips the full presentation
 *  layer (expensive on large transcripts) and extracts just what the
 *  detail drawer needs: timing, deduped usage, tool counts, final text. */
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

      if (!model && typeof m.model === "string") model = m.model;

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

/** Walk a session's `subagents/` dir, parse each agent-*.jsonl + .meta.json
 *  pair, and return one SubagentRun per file. Matching strategy:
 *    1. Exact description (meta.json ↔ parent tool_use.input.description)
 *    2. Timestamp (±2s of parent dispatch ts)
 *    3. None — use whatever meta / initial prompt we have. */
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

  type ParentRef = {
    toolUseId: string;
    parentUuid: string;
    runInBackground: boolean;
    prompt?: string;
    tsMs?: number;
  };
  const byDesc = new Map<string, ParentRef>();
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

      const metaDesc = meta.description && meta.description.trim().length > 0
        ? meta.description
        : undefined;
      const parentRef = metaDesc
        ? byDesc.get(metaDesc)
        : matchByTime(summary.startMs);

      const description =
        metaDesc ??
        (summary.initialPrompt
          ? summary.initialPrompt
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 80)
          : "(no description)");

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
/*  Workflow loading                                                 */
/* ================================================================= */

type WorkflowJournal = {
  runId?: unknown;
  workflowName?: unknown;
  summary?: unknown;
  status?: unknown;
  agentCount?: unknown;
  totalToolCalls?: unknown;
  totalTokens?: unknown;
  durationMs?: unknown;
  startTime?: unknown;
  defaultModel?: unknown;
  phases?: unknown;
  logs?: unknown;
  workflowProgress?: unknown;
};

/** Walk a session's `workflows/` dir, parse each `wf_*.json` journal the
 *  Workflow tool persists, and return one WorkflowRun per file. Each run is
 *  matched back to the parent `Workflow` tool_use by dispatch time — the
 *  journal's `startTime` lands a few seconds after the tool_use timestamp
 *  (script compile + first agent spawn), so a generous 60s window is used.
 *  A `scripts/` subdir and any non-`wf_` files are ignored. */
async function loadWorkflows(
  dir: string,
  sessionStartMs: number | undefined,
  parentEvents: SessionEvent[],
): Promise<WorkflowRun[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const jsonFiles = entries.filter((f) => f.startsWith("wf_") && f.endsWith(".json"));
  if (jsonFiles.length === 0) return [];

  type Dispatch = { toolUseId: string; parentUuid: string; tsMs: number };
  const dispatches: Dispatch[] = [];
  for (const e of parentEvents) {
    if (e.role !== "tool-call" || e.toolName !== "Workflow") continue;
    const tsMs = e.timestamp ? Date.parse(e.timestamp) : NaN;
    if (Number.isNaN(tsMs)) continue;
    for (const b of e.blocks) {
      if (b?.type !== "tool_use" || b.name !== "Workflow") continue;
      dispatches.push({ toolUseId: b.id, parentUuid: e.uuid ?? "", tsMs });
    }
  }
  dispatches.sort((a, b) => a.tsMs - b.tsMs);

  // The journal's startTime trails its Workflow tool_use (script compile +
  // first spawn), so the true parent fired at-or-before startMs. Prefer the
  // nearest dispatch at-or-before startMs within tolerance; only if none
  // precede (clock skew / resumed run) fall back to absolute nearest. This
  // stops a run being attributed to a Workflow call that fired *after* it.
  const matchDispatch = (startMs: number | undefined): Dispatch | undefined => {
    if (startMs === undefined || dispatches.length === 0) return undefined;
    const TOLERANCE_MS = 60_000;
    let before: Dispatch | undefined;
    let beforeDelta = Infinity;
    let nearest: Dispatch | undefined;
    let nearestDelta = Infinity;
    for (const d of dispatches) {
      const delta = Math.abs(startMs - d.tsMs);
      if (delta > TOLERANCE_MS) continue;
      if (delta < nearestDelta) {
        nearest = d;
        nearestDelta = delta;
      }
      if (d.tsMs <= startMs && delta < beforeDelta) {
        before = d;
        beforeDelta = delta;
      }
    }
    return before ?? nearest;
  };

  const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined;

  const runs = await Promise.all(
    jsonFiles.map(async (f): Promise<WorkflowRun | null> => {
      let j: WorkflowJournal;
      try {
        j = JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as WorkflowJournal;
      } catch {
        return null;
      }
      const runId = str(j.runId) ?? f.replace(/\.json$/, "");
      const startMs = num(j.startTime);
      const durationMs = num(j.durationMs);
      const endMs = startMs !== undefined && durationMs !== undefined ? startMs + durationMs : undefined;
      const startTOffsetMs =
        sessionStartMs !== undefined && startMs !== undefined
          ? Math.max(0, startMs - sessionStartMs)
          : undefined;
      const endTOffsetMs =
        sessionStartMs !== undefined && endMs !== undefined
          ? Math.max(0, endMs - sessionStartMs)
          : undefined;
      const phases = Array.isArray(j.phases)
        ? j.phases
            .filter(
              (p): p is { title: string; detail?: unknown } =>
                !!p && typeof p === "object" && typeof (p as { title?: unknown }).title === "string",
            )
            .map((p) => ({ title: p.title, detail: str((p as { detail?: unknown }).detail) }))
        : [];
      const logs = Array.isArray(j.logs)
        ? j.logs.filter((l): l is string => typeof l === "string")
        : [];
      // Per-agent runs live in workflowProgress as `workflow_agent` entries,
      // each tagged with the phase it ran in. Cap the free-text previews so a
      // 200-agent run doesn't bloat the RSC payload.
      const cap = (v: unknown, n: number): string | undefined => {
        const s = str(v);
        return s === undefined ? undefined : s.length > n ? s.slice(0, n) + "…" : s;
      };
      const progress = Array.isArray(j.workflowProgress) ? j.workflowProgress : [];
      const agents = progress
        .filter(
          (e): e is Record<string, unknown> =>
            !!e && typeof e === "object" && (e as { type?: unknown }).type === "workflow_agent",
        )
        .map((e) => ({
          index: num(e.index) ?? 0,
          label: str(e.label) ?? "(agent)",
          phaseIndex: num(e.phaseIndex),
          phaseTitle: str(e.phaseTitle),
          agentId: str(e.agentId),
          model: str(e.model),
          state: str(e.state),
          startedAt: num(e.startedAt),
          durationMs: num(e.durationMs),
          tokens: num(e.tokens),
          toolCalls: num(e.toolCalls),
          lastToolSummary: cap(e.lastToolSummary, 200),
          promptPreview: cap(e.promptPreview, 600),
          resultPreview: cap(e.resultPreview, 600),
        }))
        .sort((a, b) => a.index - b.index);
      const parent = matchDispatch(startMs);
      return {
        runId,
        name: str(j.workflowName) ?? runId,
        description: str(j.summary),
        status: str(j.status) ?? "unknown",
        agentCount: num(j.agentCount) ?? 0,
        toolCallCount: num(j.totalToolCalls) ?? 0,
        totalTokens: num(j.totalTokens) ?? 0,
        durationMs,
        startMs,
        endMs,
        startTOffsetMs,
        endTOffsetMs,
        model: str(j.defaultModel),
        phases,
        logs,
        agents,
        parentToolUseId: parent?.toolUseId,
        parentUuid: parent?.parentUuid,
      };
    }),
  );

  return runs
    .filter((r): r is WorkflowRun => r !== null)
    .sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
}

/* ================================================================= */
/*  Workflow-agent transcript (full step list, on demand)            */
/* ================================================================= */

export type WorkflowAgentStep = {
  /** 1-based order within the agent's run. */
  index: number;
  /** Tool name (Bash, Read, Edit, …). */
  tool: string;
  /** Salient one-line preview of the tool input (collapsed-row display). */
  preview: string;
  /** Full salient input, newlines preserved — the complete bash command, file
   *  path, etc. Shown when a step is expanded. Capped to keep the payload sane. */
  full?: string;
  /** True when the matching tool_result was an error. */
  isError?: boolean;
};

export type WorkflowAgentDetail = {
  agentId: string;
  /** Full dispatched prompt (untruncated). */
  prompt?: string;
  /** Full final assistant text (untruncated). */
  finalText?: string;
  /** Every step the agent took, in order. */
  steps: WorkflowAgentStep[];
  /** Per-tool totals, by count desc. */
  toolCalls: { name: string; count: number }[];
  toolCallCount: number;
  assistantMessageCount: number;
  eventCount: number;
  totalUsage: Usage;
  model?: string;
  durationMs?: number;
};

/** Pull the most informative field out of a tool_use input, untruncated and
 *  with newlines preserved (e.g. a full multi-line bash command). */
function salientToolInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  const pick = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : undefined);
  return (
    pick("command") ??
    pick("file_path") ??
    pick("path") ??
    pick("pattern") ??
    pick("url") ??
    pick("description") ??
    pick("query") ??
    pick("prompt") ??
    pick("old_string") ??
    JSON.stringify(o)
  );
}

/** Load the full transcript of one workflow-spawned agent and return its
 *  ordered step list + full prompt/result. These live in a nested
 *  `<session>/subagents/workflows/<runId>/agent-<agentId>.jsonl` — written by
 *  the Workflow runtime even though the agent has no top-level subagent file.
 *  Loaded on demand (one transcript at a time) so a 200-agent session's detail
 *  page stays light. */
export async function loadWorkflowAgentDetail(
  sessionId: string,
  runId: string,
  agentId: string,
  opts: { root?: string } = {},
): Promise<WorkflowAgentDetail | null> {
  const { root = DEFAULT_ROOT } = opts;
  // Filename-safe ids only — guard against path traversal.
  if (!/^[\w.-]+$/.test(runId) || !/^[\w.-]+$/.test(agentId)) return null;
  const files = await walkJsonlFiles(root);
  const hit = files.find((f) => sessionIdFromFileName(f.fileName) === sessionId);
  if (!hit) return null;
  const file = path.join(
    path.dirname(hit.fullPath),
    sessionId,
    "subagents",
    "workflows",
    runId,
    `agent-${agentId}.jsonl`,
  );
  let lines: unknown[];
  try {
    lines = await readJsonlFile(file);
  } catch {
    return null;
  }

  // First pass: which tool_use ids errored (the tool_result.is_error lives in a
  // later user message keyed by tool_use_id).
  const errored = new Set<string>();
  for (const raw of lines) {
    if (!raw || typeof raw !== "object") continue;
    const content = (raw as { message?: { content?: unknown } }).message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (
        b && typeof b === "object" &&
        (b as { type?: unknown }).type === "tool_result" &&
        (b as { is_error?: unknown }).is_error === true &&
        typeof (b as { tool_use_id?: unknown }).tool_use_id === "string"
      ) {
        errored.add((b as { tool_use_id: string }).tool_use_id);
      }
    }
  }

  const steps: WorkflowAgentStep[] = [];
  const toolCounts = new Map<string, number>();
  const totalUsage: Usage = { ...BLANK_USAGE };
  const seen = new Set<string>();
  let prompt: string | undefined;
  let finalText: string | undefined;
  let model: string | undefined;
  let assistantMessageCount = 0;
  let eventCount = 0;
  let startMs: number | undefined;
  let endMs: number | undefined;

  for (const raw of lines) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    eventCount++;
    const ts = typeof r.timestamp === "string" ? Date.parse(r.timestamp) : NaN;
    if (!Number.isNaN(ts)) {
      if (startMs === undefined || ts < startMs) startMs = ts;
      if (endMs === undefined || ts > endMs) endMs = ts;
    }

    if (
      prompt === undefined &&
      r.type === "user" &&
      (r.parentUuid === null || r.parentUuid === undefined)
    ) {
      const c = (r.message as Record<string, unknown> | undefined)?.content;
      if (typeof c === "string") prompt = c;
      else if (Array.isArray(c)) {
        const t = c.find(
          (b) => b && typeof b === "object" && (b as { type?: string }).type === "text",
        ) as { text?: string } | undefined;
        if (t?.text) prompt = t.text;
      }
    }

    if (r.type !== "assistant") continue;
    const m = r.message as Record<string, unknown> | undefined;
    if (!m) continue;
    if (!model && typeof m.model === "string") model = m.model;
    const mid = typeof m.id === "string" ? m.id : undefined;
    const rid = typeof r.requestId === "string" ? r.requestId : undefined;
    const key = mid != null && rid != null ? `${mid}:${rid}` : undefined;
    const fresh = key ? !seen.has(key) : true;
    if (key && fresh) seen.add(key);
    if (fresh) {
      assistantMessageCount++;
      const u = m.usage as Record<string, unknown> | undefined;
      if (u) {
        const n = (v: unknown) => (typeof v === "number" ? v : 0);
        totalUsage.input += n(u.input_tokens);
        totalUsage.output += n(u.output_tokens);
        totalUsage.cacheRead += n(u.cache_read_input_tokens);
        totalUsage.cacheWrite += n(u.cache_creation_input_tokens);
      }
    }
    const content = m.content as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "text" && typeof b.text === "string") {
        finalText = b.text;
      } else if (b.type === "tool_use" && typeof b.name === "string") {
        toolCounts.set(b.name, (toolCounts.get(b.name) ?? 0) + 1);
        // Defensive cap — a runaway agent shouldn't ship 10k step rows.
        if (steps.length < 2000) {
          const salient = salientToolInput(b.input);
          const preview = salient.replace(/\s+/g, " ").trim().slice(0, 160);
          const full = salient.length > 4000 ? salient.slice(0, 4000) + "…" : salient;
          steps.push({
            index: steps.length + 1,
            tool: b.name,
            preview,
            // Only carry `full` when it adds something over the one-line preview.
            full: full.length > preview.length || full.includes("\n") ? full : undefined,
            isError: typeof b.id === "string" && errored.has(b.id),
          });
        }
      }
    }
  }

  const toolCalls = Array.from(toolCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return {
    agentId,
    prompt,
    finalText,
    steps,
    toolCalls,
    toolCallCount: steps.length,
    assistantMessageCount,
    eventCount,
    totalUsage,
    model,
    durationMs: startMs !== undefined && endMs !== undefined ? endMs - startMs : undefined,
  };
}

/* ================================================================= */
/*  Project rollup                                                   */
/* ================================================================= */

export type ProjectRefLite = {
  /** Stable project identifier — the canonical cwd path. URL-encode for slugs. */
  projectDir: string;
  /** Canonical cwd path (worktrees rolled up to parent). */
  projectName: string;
  sessionCount: number;
  lastActiveMs: number;
  /** Number of distinct `.worktrees/<name>` subdirs rolled up here. */
  worktreeCount: number;
};

/** One entry per canonical project. Worktrees (`cwd/.worktrees/<name>`)
 *  aggregate under their parent repo. fs.stat only — no JSONL parsing. */
export async function listProjects(root: string = DEFAULT_ROOT): Promise<ProjectRefLite[]> {
  const files = await walkJsonlFiles(root);
  const byRawDir = new Map<string, { count: number; lastActiveMs: number }>();
  for (const f of files) {
    const cur = byRawDir.get(f.projectDir) ?? { count: 0, lastActiveMs: 0 };
    cur.count++;
    if (f.mtimeMs > cur.lastActiveMs) cur.lastActiveMs = f.mtimeMs;
    byRawDir.set(f.projectDir, cur);
  }
  // Resolve real cwd from the meta cache — any cached session in this
  // projectDir has the cwd from the JSONL, avoiding the lossy decode.
  const cwdForProject = (dir: string): string | undefined => {
    for (const [, entry] of metaCache.entries()) {
      if (entry.meta.projectDir === dir && entry.meta.cwd) {
        return entry.meta.cwd;
      }
    }
    return undefined;
  };

  type Agg = {
    canonicalName: string;
    count: number;
    lastActiveMs: number;
    worktreeBranches: Set<string>;
  };
  const canonicalMap = new Map<string, Agg>();
  for (const [rawDir, { count, lastActiveMs }] of byRawDir) {
    const cwdOrDecoded = cwdForProject(rawDir) ?? decodeProjectName(rawDir);
    // Fold by repo name so the same repo reached via different harnesses
    // collapses into one project — matching groupByProject.
    const repo = projectRepoName(cwdOrDecoded);
    const wt = worktreeName(cwdOrDecoded);

    const agg =
      canonicalMap.get(repo) ??
      ({
        canonicalName: repo,
        count: 0,
        lastActiveMs: 0,
        worktreeBranches: new Set<string>(),
      } satisfies Agg);
    agg.count += count;
    if (lastActiveMs > agg.lastActiveMs) agg.lastActiveMs = lastActiveMs;
    if (wt) agg.worktreeBranches.add(wt);
    canonicalMap.set(repo, agg);
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

/* ================================================================= */
/*  Team coordination                                                */
/* ================================================================= */

/** Full team view for a session. Returns null when the session has no
 *  teamName (not part of any team). Reuses the listSessions/getSession
 *  caches, so the team fan-out is cheap after the first call. */
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

/** Lightweight: given a team-member session, return the lead session id +
 *  team name without loading full details. Null when not a member or no
 *  lead is found. */
export async function findTeamLead(
  sessionId: string,
  opts: { root?: string } = {},
): Promise<{ leadSessionId: string; teamName: string; agentName: string } | null> {
  const { root = DEFAULT_ROOT } = opts;
  const all = await listSessions({ root });
  const self = all.find((s) => s.sessionId === sessionId);
  if (!self || !self.teamName || !self.agentName) return null;
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

/* ================================================================= */
/*  AgentSource                                                      */
/* ================================================================= */

export type ClaudeCodeSource = AgentMetadata & {
  defaultRoot: string;
  listSessions(opts?: ListOptions): Promise<SessionMeta[]>;
  getSession(id: string, opts?: { root?: string }): Promise<SessionDetail | null>;
};

export const claudeCodeSource: ClaudeCodeSource = {
  ...CLAUDE_CODE_METADATA,
  defaultRoot: DEFAULT_ROOT,
  async listSessions(opts) {
    const sessions = await listSessions(opts);
    for (const s of sessions) if (!s.agent) s.agent = "claude-code" satisfies AgentKind;
    return sessions;
  },
  async getSession(id, opts) {
    const detail = await getSession(id, opts);
    if (detail && !detail.agent) detail.agent = "claude-code" satisfies AgentKind;
    return detail;
  },
  // No usagePoller: Claude's OAuth path lives in cli, and the daemon's
  // tick() drives backoff off OAuth outcomes — calls fetchUsage() directly.
};
