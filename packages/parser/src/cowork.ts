/**
 * Cowork (Claude Desktop "local agent mode") transcript reader.
 *
 * Read from `audit.jsonl` rather than the per-session
 * `.claude/projects/<encoded>/<cliSessionId>.jsonl` mirror: the audit log
 * is at a fixed path and covers every session, including the few that
 * errored before the inner JSONL was written. Sessions resolve to a
 * user-facing project path via the sibling `spaces.json` (cowork's Spaces
 * feature) — the in-session `cwd` is the VM-internal `/sessions/<name>`
 * path and is not user-meaningful.
 *
 * `claude-code-sessions/<accountId>/<workspaceId>/` is the same shape
 * but holds Claude Code sessions launched from inside Desktop — out of
 * scope here; a future agent can extend or fork this adapter.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalProjectName, toLocalDay } from "./analytics.js";
import { summarizeSubagentLines } from "./claude-code.js";
import { parseTranscript } from "./parser.js";
import type { SessionDetail, SessionMeta, SubagentRun } from "./types.js";

export const DEFAULT_COWORK_ROOT = defaultCoworkRoot();

function defaultCoworkRoot(): string {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Claude", "local-agent-mode-sessions");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return path.join(appData, "Claude", "local-agent-mode-sessions");
  }
  return path.join(home, ".config", "Claude", "local-agent-mode-sessions");
}

const SESSION_ID_RE = /^local_[0-9a-f-]+$/;

type SessionFile = {
  /** Outer `local_<uuid>` slug — the user-facing session id. */
  sessionId: string;
  auditPath: string;
  metaPath: string;
  /** Workspace directory (contains `spaces.json`). */
  workspaceDir: string;
  auditMtimeMs: number;
  auditSize: number;
  /** mtime of `local_<uuid>.json` — Desktop rewrites it when the user
   *  attaches a folder, links a Space, or finishes a turn (lastActivityAt).
   *  Folded into the cache key so a sidecar-only edit invalidates the
   *  cached `projectName`/`cwd`/model. 0 when the sidecar is missing. */
  metaMtimeMs: number;
  /** mtime of the workspace's `spaces.json` — same invalidation story for
   *  folder renames or space deletions. 0 when missing. */
  spacesMtimeMs: number;
};

async function safeReaddir(p: string): Promise<string[]> {
  return fs.readdir(p).catch(() => [] as string[]);
}

async function statMs(p: string): Promise<number> {
  const s = await fs.stat(p).catch(() => null);
  return s ? s.mtimeMs : 0;
}

async function listSessionFiles(root: string): Promise<SessionFile[]> {
  const out: SessionFile[] = [];
  const accounts = await safeReaddir(root);
  for (const accountId of accounts) {
    const accountDir = path.join(root, accountId);
    const workspaces = await safeReaddir(accountDir);
    for (const workspaceId of workspaces) {
      const workspaceDir = path.join(accountDir, workspaceId);
      const spacesMtimeMs = await statMs(path.join(workspaceDir, "spaces.json"));
      const entries = await safeReaddir(workspaceDir);
      for (const entry of entries) {
        if (!SESSION_ID_RE.test(entry)) continue;
        const auditPath = path.join(workspaceDir, entry, "audit.jsonl");
        const auditStat = await fs.stat(auditPath).catch(() => null);
        if (!auditStat || !auditStat.isFile() || auditStat.size === 0) continue;
        const metaPath = path.join(workspaceDir, `${entry}.json`);
        const metaMtimeMs = await statMs(metaPath);
        out.push({
          sessionId: entry,
          auditPath,
          metaPath,
          workspaceDir,
          auditMtimeMs: auditStat.mtimeMs,
          auditSize: auditStat.size,
          metaMtimeMs,
          spacesMtimeMs,
        });
      }
    }
  }
  return out;
}

type SpacesCacheEntry = { mtimeMs: number; spaceIdToPath: Map<string, string> };
const spacesCache = new Map<string, SpacesCacheEntry>();

async function loadSpacesForWorkspace(workspaceDir: string): Promise<Map<string, string>> {
  const spacesPath = path.join(workspaceDir, "spaces.json");
  const stat = await fs.stat(spacesPath).catch(() => null);
  if (!stat) return new Map();
  const cached = spacesCache.get(workspaceDir);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.spaceIdToPath;
  const raw = await fs.readFile(spacesPath, "utf8").catch(() => "");
  const out = new Map<string, string>();
  try {
    const parsed = JSON.parse(raw) as { spaces?: Array<Record<string, unknown>> };
    for (const space of parsed.spaces ?? []) {
      const id = typeof space.id === "string" ? space.id : undefined;
      const folders = Array.isArray(space.folders) ? space.folders : [];
      const first = folders[0] as { path?: unknown } | undefined;
      const folderPath = typeof first?.path === "string" ? first.path : undefined;
      if (id && folderPath) out.set(id, folderPath);
    }
  } catch {
    // Skip malformed spaces.json — sessions fall back to userSelectedFolders.
  }
  spacesCache.set(workspaceDir, { mtimeMs: stat.mtimeMs, spaceIdToPath: out });
  return out;
}

type CoworkMeta = {
  spaceId?: string;
  userSelectedFolders?: string[];
  cwd?: string;
  model?: string;
  title?: string;
  createdAt?: number;
  lastActivityAt?: number;
};

async function readCoworkMeta(metaPath: string): Promise<CoworkMeta> {
  const raw = await fs.readFile(metaPath, "utf8").catch(() => "");
  if (!raw) return {};
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    return {
      spaceId: typeof j.spaceId === "string" ? j.spaceId : undefined,
      userSelectedFolders: Array.isArray(j.userSelectedFolders)
        ? (j.userSelectedFolders.filter((s) => typeof s === "string") as string[])
        : undefined,
      cwd: typeof j.cwd === "string" ? j.cwd : undefined,
      model: typeof j.model === "string" ? j.model : undefined,
      title: typeof j.title === "string" ? j.title : undefined,
      createdAt: typeof j.createdAt === "number" ? j.createdAt : undefined,
      lastActivityAt: typeof j.lastActivityAt === "number" ? j.lastActivityAt : undefined,
    };
  } catch {
    return {};
  }
}

/** spaceId trumps userSelectedFolders: a session can run inside a folder
 *  the user picked ad-hoc, but the Space is the durable grouping that
 *  the Desktop UI also uses. */
function resolveProject(
  meta: CoworkMeta,
  spaceIdToPath: Map<string, string>,
): { projectName: string; projectDir: string; cwd?: string } {
  let projectPath: string | undefined;
  if (meta.spaceId) projectPath = spaceIdToPath.get(meta.spaceId);
  if (!projectPath && meta.userSelectedFolders && meta.userSelectedFolders.length > 0) {
    projectPath = meta.userSelectedFolders[0];
  }
  if (!projectPath) {
    return { projectName: "cowork:unspaced", projectDir: "cowork-unspaced" };
  }
  return {
    projectName: canonicalProjectName(projectPath),
    projectDir: projectPath.replace(/^\//, "-").replace(/\//g, "-"),
    cwd: projectPath,
  };
}

async function readJsonl(filePath: string): Promise<unknown[]> {
  const raw = await fs.readFile(filePath, "utf8");
  const out: unknown[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed lines.
    }
  }
  return out;
}

/** Cowork's audit.jsonl logs each user message twice under the SAME `uuid`: the
 *  raw desktop input (no `timestamp`) and an `isReplay` copy fed into the agent
 *  runtime (carrying a real `timestamp` and a fresh inner `session_id`).
 *  parseTranscript would emit both, doubling every user turn in the transcript.
 *  Keep one line per uuid — prefer the copy that has a `timestamp` so the event
 *  still lands on the timeline. Lines without a uuid (system/result/rate-limit)
 *  pass through untouched. */
function dedupeReplayedLines(lines: unknown[]): unknown[] {
  const keepAt = new Map<string, number>();
  lines.forEach((line, i) => {
    const rec = line as { uuid?: unknown; timestamp?: unknown };
    if (typeof rec.uuid !== "string") return;
    const prev = keepAt.get(rec.uuid);
    if (prev === undefined) {
      keepAt.set(rec.uuid, i);
      return;
    }
    const prevHasTs = (lines[prev] as { timestamp?: unknown }).timestamp !== undefined;
    if (!prevHasTs && rec.timestamp !== undefined) keepAt.set(rec.uuid, i);
  });
  return lines.filter((line, i) => {
    const rec = line as { uuid?: unknown };
    return typeof rec.uuid !== "string" || keepAt.get(rec.uuid) === i;
  });
}

function textFromContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const b of content) {
      if (b && typeof b === "object" && (b as { type?: unknown }).type === "text") {
        const t = (b as { text?: unknown }).text;
        if (typeof t === "string") parts.push(t);
      }
    }
    if (parts.length) return parts.join("\n");
  }
  return undefined;
}

type CoworkAgentRef = {
  parentUuid?: string;
  description?: string;
  agentType?: string;
  prompt?: string;
  /** The subagent's output, taken from the tool_result returned to the main
   *  agent — cowork's subagent group ends on a tool_result, not a final
   *  assistant text, so summarizeSubagentLines can't recover it. */
  finalText?: string;
};

/** Cowork interleaves each spawned subagent's own transcript INTO the audit
 *  log, tagged with `parent_tool_use_id` = the dispatching `Agent` tool_use id
 *  (Claude Code instead keeps them in sibling `subagents/*.jsonl` files). Lift
 *  those inline events off the main timeline and re-expose them as SubagentRuns
 *  so the viewer renders lanes + a drawer instead of flattening a chapter's
 *  worth of subagent Writes into the parent transcript. The dispatching Agent
 *  call and the tool_result carrying the subagent's output both stay on the
 *  main timeline — their own `parent_tool_use_id` is null. */
function partitionCoworkLines(lines: unknown[]): {
  mainLines: unknown[];
  subagentGroups: Map<string, unknown[]>;
} {
  const mainLines: unknown[] = [];
  const subagentGroups = new Map<string, unknown[]>();
  for (const line of lines) {
    const ptid = (line as { parent_tool_use_id?: unknown }).parent_tool_use_id;
    if (typeof ptid === "string") {
      const g = subagentGroups.get(ptid);
      if (g) g.push(line);
      else subagentGroups.set(ptid, [line]);
    } else {
      mainLines.push(line);
    }
  }
  return { mainLines, subagentGroups };
}

function buildCoworkSubagents(
  subagentGroups: Map<string, unknown[]>,
  allLines: unknown[],
  sessionStartMs: number | undefined,
): SubagentRun[] {
  if (subagentGroups.size === 0) return [];

  // Index every Agent dispatch + the tool_result returning its output, keyed by
  // tool_use id. Scan all lines so a subagent that itself dispatched an Agent
  // still resolves its parent.
  const refs = new Map<string, CoworkAgentRef>();
  for (const line of allLines) {
    const rec = line as { uuid?: unknown; message?: { content?: unknown } };
    const content = rec.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || typeof b !== "object") continue;
      const block = b as Record<string, unknown>;
      if (block.type === "tool_use" && block.name === "Agent" && typeof block.id === "string") {
        const input = (block.input as Record<string, unknown>) ?? {};
        const ref = refs.get(block.id) ?? {};
        if (typeof rec.uuid === "string") ref.parentUuid = rec.uuid;
        if (typeof input.description === "string") ref.description = input.description;
        if (typeof input.subagent_type === "string") ref.agentType = input.subagent_type;
        if (typeof input.prompt === "string") ref.prompt = input.prompt;
        refs.set(block.id, ref);
      } else if (
        block.type === "tool_result" &&
        typeof block.tool_use_id === "string" &&
        subagentGroups.has(block.tool_use_id)
      ) {
        const ref = refs.get(block.tool_use_id) ?? {};
        ref.finalText = textFromContent(block.content) ?? ref.finalText;
        refs.set(block.tool_use_id, ref);
      }
    }
  }

  const runs: SubagentRun[] = [];
  for (const [toolUseId, groupLines] of subagentGroups) {
    const summary = summarizeSubagentLines(groupLines);
    const ref = refs.get(toolUseId) ?? {};
    const finalText = ref.finalText ?? summary.finalText;
    const finalPreview = finalText
      ? finalText.replace(/\s+/g, " ").trim().slice(0, 240)
      : summary.finalPreview;
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
    runs.push({
      agentId: toolUseId,
      agentType: ref.agentType ?? "unknown",
      description:
        ref.description ??
        (ref.prompt ? ref.prompt.replace(/\s+/g, " ").trim().slice(0, 80) : "(no description)"),
      startMs: summary.startMs,
      endMs: summary.endMs,
      durationMs,
      startTOffsetMs,
      endTOffsetMs,
      eventCount: summary.eventCount,
      totalUsage: summary.totalUsage,
      parentUuid: ref.parentUuid,
      parentToolUseId: toolUseId,
      runInBackground: false,
      finalPreview,
      finalText,
      prompt: ref.prompt,
      model: summary.model,
      toolCalls: summary.toolCalls,
      toolCallCount: summary.toolCallCount,
      assistantMessageCount: summary.assistantMessageCount,
    });
  }
  runs.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
  return runs;
}

type Parsed = {
  meta: SessionMeta;
  events: SessionDetail["events"];
  subagents: SubagentRun[];
};

async function parseCoworkSession(file: SessionFile): Promise<Parsed> {
  const [lines, coworkMeta, spaceIdToPath] = await Promise.all([
    readJsonl(file.auditPath),
    readCoworkMeta(file.metaPath),
    loadSpacesForWorkspace(file.workspaceDir),
  ]);
  const deduped = dedupeReplayedLines(lines);
  const { mainLines, subagentGroups } = partitionCoworkLines(deduped);
  const { meta: baseMeta, events } = parseTranscript(mainLines);
  // Subagent lane offsets share the main timeline's t=0 (min main-event ts).
  const sessionStartMs = baseMeta.firstTimestamp
    ? Date.parse(baseMeta.firstTimestamp)
    : undefined;
  const subagents = buildCoworkSubagents(subagentGroups, deduped, sessionStartMs);
  const { projectName, projectDir, cwd } = resolveProject(coworkMeta, spaceIdToPath);

  // The audit JSONL's `cwd` field is the VM path (`/sessions/<vmProcessName>`)
  // and is never user-meaningful — prefer the resolved Space path.
  const meta: SessionMeta = {
    ...baseMeta,
    agent: "cowork",
    id: file.sessionId,
    sessionId: file.sessionId,
    filePath: file.auditPath,
    projectName,
    projectDir,
    cwd: cwd ?? baseMeta.cwd,
    model: baseMeta.model ?? coworkMeta.model,
  };
  return { meta, events, subagents };
}

type CacheKey = {
  auditMtimeMs: number;
  auditSize: number;
  metaMtimeMs: number;
  spacesMtimeMs: number;
};

function cacheKeyFor(file: SessionFile): CacheKey {
  return {
    auditMtimeMs: file.auditMtimeMs,
    auditSize: file.auditSize,
    metaMtimeMs: file.metaMtimeMs,
    spacesMtimeMs: file.spacesMtimeMs,
  };
}

function cacheKeyMatches(a: CacheKey, b: CacheKey): boolean {
  return (
    a.auditMtimeMs === b.auditMtimeMs &&
    a.auditSize === b.auditSize &&
    a.metaMtimeMs === b.metaMtimeMs &&
    a.spacesMtimeMs === b.spacesMtimeMs
  );
}

type MetaEntry = { meta: SessionMeta; key: CacheKey };
type DetailEntry = { detail: SessionDetail; key: CacheKey };
const metaCache = new Map<string, MetaEntry>();
const detailCache = new Map<string, DetailEntry>();

export function clearCoworkCaches(): void {
  metaCache.clear();
  detailCache.clear();
  spacesCache.clear();
}

export type ListCoworkOptions = { root?: string; limit?: number };

export async function listCoworkSessions(
  opts: ListCoworkOptions = {},
): Promise<SessionMeta[]> {
  const root = opts.root ?? DEFAULT_COWORK_ROOT;
  const files = await listSessionFiles(root);
  const out: SessionMeta[] = [];
  for (const file of files) {
    const key = cacheKeyFor(file);
    const cached = metaCache.get(file.auditPath);
    if (cached && cacheKeyMatches(cached.key, key)) {
      out.push(cached.meta);
      continue;
    }
    try {
      const { meta } = await parseCoworkSession(file);
      metaCache.set(file.auditPath, { meta, key });
      out.push(meta);
    } catch {
      // Skip files that fail to parse — keep listing the rest.
    }
  }
  out.sort((a, b) => (b.firstTimestamp ?? "").localeCompare(a.firstTimestamp ?? ""));
  if (opts.limit !== undefined) return out.slice(0, opts.limit);
  return out;
}

export type GetCoworkOptions = { root?: string };

export async function getCoworkSession(
  id: string,
  opts: GetCoworkOptions = {},
): Promise<SessionDetail | null> {
  const root = opts.root ?? DEFAULT_COWORK_ROOT;
  const files = await listSessionFiles(root);
  const file = files.find((f) => f.sessionId === id);
  if (!file) return null;
  const key = cacheKeyFor(file);
  const cached = detailCache.get(file.auditPath);
  if (cached && cacheKeyMatches(cached.key, key)) return cached.detail;
  const { meta, events, subagents } = await parseCoworkSession(file);
  const detail: SessionDetail = {
    ...meta,
    events,
    ...(subagents.length ? { subagents } : {}),
  };
  detailCache.set(file.auditPath, { detail, key });
  return detail;
}
