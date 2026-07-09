/**
 * Antigravity CLI transcript reader.
 *
 * Antigravity persists per-session transcripts at:
 *   ~/.gemini/antigravity-cli/brain/<uuid>/.system_generated/logs/transcript.jsonl
 *
 * conversationId -> absolute workspace cwd is recoverable from ~/.gemini/antigravity-cli/history.jsonl.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { toLocalDay } from "./analytics.js";
import { resolveProjectIdentity } from "./git-project.js";
import { isFrameworkInjectedUserInput } from "./user-input.js";
import type {
  SessionDetail,
  SessionEvent,
  SessionMeta,
  Usage,
} from "./types.js";

export const DEFAULT_ANTIGRAVITY_ROOT = path.join(os.homedir(), ".gemini", "antigravity-cli");

const IDLE_GAP_MS = 3 * 60 * 1000;

type SessionFile = {
  filePath: string;
  conversationId: string;
  cwd?: string;
  mtimeMs: number;
  sizeBytes: number;
};

async function safeReaddir(p: string): Promise<string[]> {
  return fs.readdir(p).catch(() => [] as string[]);
}

/* ================================================================= */
/*  history.jsonl mappings                                           */
/* ================================================================= */

let historyCache: { mtimeMs: number; slugToCwd: Map<string, string> } | null = null;

async function loadSlugToCwd(root: string): Promise<Map<string, string>> {
  const historyFile = path.join(root, "history.jsonl");
  const stat = await fs.stat(historyFile).catch(() => null);
  if (!stat) return new Map();
  if (historyCache && historyCache.mtimeMs === stat.mtimeMs) {
    return historyCache.slugToCwd;
  }
  const raw = await fs.readFile(historyFile, "utf8").catch(() => "");
  const slugToCwd = new Map<string, string>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.conversationId && parsed.workspace) {
        slugToCwd.set(parsed.conversationId, parsed.workspace);
      }
    } catch {
      // Skip malformed lines
    }
  }
  historyCache = { mtimeMs: stat.mtimeMs, slugToCwd };
  return slugToCwd;
}

async function listSessionFiles(root: string): Promise<SessionFile[]> {
  const slugToCwd = await loadSlugToCwd(root);
  const out: SessionFile[] = [];
  const brainDir = path.join(root, "brain");
  const entries = await safeReaddir(brainDir);
  for (const entry of entries) {
    const transcriptPath = path.join(brainDir, entry, ".system_generated", "logs", "transcript.jsonl");
    const stat = await fs.stat(transcriptPath).catch(() => null);
    if (stat && stat.isFile()) {
      out.push({
        filePath: transcriptPath,
        conversationId: entry,
        cwd: slugToCwd.get(entry),
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
      });
    }
  }
  return out;
}

/* ================================================================= */
/*  Parsing logic                                                    */
/* ================================================================= */

function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function previewOf(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

type ParsedSession = {
  meta: SessionMeta;
  events: SessionEvent[];
};

async function parseSession(file: SessionFile): Promise<ParsedSession> {
  const raw = await fs.readFile(file.filePath, "utf8");
  const events: SessionEvent[] = [];
  const totalUsage = emptyUsage();

  let firstTimestamp: string | undefined;
  let lastTimestamp: string | undefined;
  let model: string | undefined;
  let toolCallCount = 0;
  let turnCount = 0;
  let firstUserPreview: string | undefined;
  let lastUserPreview: string | undefined;
  let lastAgentPreview: string | undefined;
  const tsMs: number[] = [];

  let idx = 0;

  function pushEvent(e: SessionEvent): void {
    events.push(e);
    if (e.timestamp && e.role !== "meta") {
      if (!firstTimestamp) firstTimestamp = e.timestamp;
      lastTimestamp = e.timestamp;
      const ms = Date.parse(e.timestamp);
      if (Number.isFinite(ms)) tsMs.push(ms);
    }
  }

  const pendingToolCalls: Array<{ id: string; name: string }> = [];

  // Erased-at-runtime shapes for fields we touch on antigravity JSONL records.
  // We cast through these so unknown-typed parses still satisfy tsc without rewriting
  // any truthy / `||` / `if` checks — preserving the existing skip-on-shape-mismatch behavior.
  type RawToolCall = { name: string; args?: unknown };
  type RawEvent = {
    step_index?: number | string;
    created_at?: string;
    timestamp?: string;
    type?: string;
    source?: string;
    status?: string;
    content?: unknown;
    thinking?: unknown;
    error?: unknown;
    tool_calls?: unknown[];
  };

  const parsedObjects: unknown[] = [];
  const indexMap = new Map<number, number>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as RawEvent;
      const stepIdx = obj.step_index;
      if (typeof stepIdx === "number") {
        if (indexMap.has(stepIdx)) {
          parsedObjects[indexMap.get(stepIdx)!] = obj;
        } else {
          indexMap.set(stepIdx, parsedObjects.length);
          parsedObjects.push(obj);
        }
      } else {
        parsedObjects.push(obj);
      }
    } catch {
      // Skip malformed lines
    }
  }

  for (const rawObj of parsedObjects) {
    const eventObj = rawObj as RawEvent;
    const ts = eventObj.created_at || eventObj.timestamp;

    if (eventObj.type === "USER_INPUT") {
      if (typeof eventObj.content === "string") {
        const matchNoNeed = eventObj.content.match(/Model Selection` from .*? to (.*?)\.\s*No need to/);
        if (matchNoNeed) {
          let rawModel = matchNoNeed[1].trim();
          rawModel = rawModel.replace(/\s*\(.*?\)\s*$/, "").trim();
          model = rawModel;
        } else {
          const matchDot = eventObj.content.match(/Model Selection` from .*? to ([^\n]+)/);
          if (matchDot) {
            let rawModel = matchDot[1].trim();
            if (rawModel.endsWith(".")) {
              rawModel = rawModel.slice(0, -1).trim();
            }
            rawModel = rawModel.replace(/\s*\(.*?\)\s*$/, "").trim();
            model = rawModel;
          }
        }
      }

      let text = (eventObj.content as string) || "";
      const requestMatch = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
      if (requestMatch) {
        text = requestMatch[1].trim();
      }
      const preview = previewOf(text);
      const isHidden = isFrameworkInjectedUserInput(text);
      if (text && !isHidden) {
        if (!firstUserPreview) firstUserPreview = preview;
        lastUserPreview = preview;
        turnCount += 1;
      }
      pushEvent({
        index: idx++,
        timestamp: ts,
        role: "user",
        rawType: "antigravity/user",
        preview,
        blocks: text ? [{ type: "text", text }] : [],
        messageId: eventObj.step_index?.toString(),
        raw: eventObj,
      });
      continue;
    }

    if (eventObj.type === "PLANNER_RESPONSE") {
      const thinking = eventObj.thinking as string;
      const content = eventObj.content as string;

      if (thinking) {
        pushEvent({
          index: idx++,
          timestamp: ts,
          role: "agent-thinking",
          rawType: "antigravity/thought",
          preview: previewOf(thinking),
          blocks: [{ type: "thinking", thinking }],
          model,
          raw: eventObj,
        });
      }

      if (content) {
        const preview = previewOf(content);
        lastAgentPreview = preview;
        pushEvent({
          index: idx++,
          timestamp: ts,
          role: "agent",
          rawType: "antigravity/agent",
          preview,
          blocks: [{ type: "text", text: content }],
          messageId: eventObj.step_index?.toString(),
          model,
          raw: eventObj,
        });
      }

      const toolCalls = eventObj.tool_calls || [];
      for (let cIdx = 0; cIdx < toolCalls.length; cIdx++) {
        const tc = toolCalls[cIdx] as RawToolCall;
        toolCallCount += 1;
        const toolUseId = `tool-${eventObj.step_index}-${cIdx}`;
        const argsStr = tc.args ? JSON.stringify(tc.args) : "";

        pendingToolCalls.push({ id: toolUseId, name: tc.name });

        pushEvent({
          index: idx++,
          timestamp: ts,
          role: "tool-call",
          rawType: "antigravity/tool_call",
          preview: `${tc.name}(${truncate(argsStr, 80)})`,
          blocks: [{ type: "tool_use", id: toolUseId, name: tc.name, input: (tc.args as Record<string, unknown>) || {} }],
          toolName: tc.name,
          toolUseId,
          model,
          raw: tc,
        });
      }
      continue;
    }

    // Antigravity serializes tool results positionally in execution order, so we match them positionally using a queue.
    if (
      eventObj.source === "MODEL" &&
      eventObj.type !== "PLANNER_RESPONSE" &&
      eventObj.type !== "ERROR_MESSAGE" &&
      pendingToolCalls.length > 0
    ) {
      const matchedCall = pendingToolCalls.shift();
      const toolUseId = matchedCall ? matchedCall.id : `tool-${eventObj.step_index}-unknown`;

      const contentStr = typeof eventObj.content === "string" ? eventObj.content : JSON.stringify(eventObj.content || "");
      const isError = eventObj.status === "ERROR" || eventObj.status === "FAILED" || eventObj.status === "CANCELED" || !!eventObj.error;

      pushEvent({
        index: idx++,
        timestamp: ts,
        role: "tool-result",
        rawType: "antigravity/tool_result",
        preview: previewOf(contentStr),
        blocks: [{
          type: "tool_result",
          tool_use_id: toolUseId,
          content: contentStr,
          is_error: isError
        }],
        toolUseId,
        toolResult: contentStr,
        raw: eventObj,
      });
      continue;
    }

    const text = ((eventObj.content as string) || (eventObj.error as string) || "");
    pushEvent({
      index: idx++,
      timestamp: ts,
      role: "meta",
      rawType: `antigravity/${eventObj.type?.toLowerCase() || "unknown"}`,
      preview: previewOf(text),
      blocks: text ? [{ type: "text", text }] : [],
      raw: eventObj,
    });
  }

  const startMs = firstTimestamp ? Date.parse(firstTimestamp) : undefined;
  if (startMs !== undefined && Number.isFinite(startMs)) {
    let prevMs: number | undefined;
    for (const ev of events) {
      if (!ev.timestamp) continue;
      const ms = Date.parse(ev.timestamp);
      if (!Number.isFinite(ms)) continue;
      ev.tOffsetMs = Math.max(0, ms - startMs);
      if (prevMs !== undefined) ev.gapMs = Math.max(0, ms - prevMs);
      prevMs = ms;
    }
  }

  const activeSegments = computeActiveSegments(tsMs);
  const airTimeMs = activeSegments.reduce((acc, s) => acc + (s.endMs - s.startMs), 0);
  const durationMs =
    firstTimestamp && lastTimestamp
      ? Date.parse(lastTimestamp) - Date.parse(firstTimestamp)
      : undefined;

  const sessionId = file.conversationId;
  const cwd = file.cwd;
  const project = cwd ? resolveProjectIdentity(cwd) : undefined;
  const projectName = project?.projectName ?? file.conversationId;
  const projectDir = cwd
    ? cwd.replace(/^\//, "-").replace(/\//g, "-")
    : file.conversationId;

  const meta: SessionMeta = {
    agent: "antigravity",
    id: sessionId,
    filePath: file.filePath,
    projectName,
    worktreeName: project?.worktreeName,
    repoName: project?.repoName,
    projectDir,
    sessionId,
    firstTimestamp,
    lastTimestamp,
    durationMs: durationMs && Number.isFinite(durationMs) ? durationMs : undefined,
    eventCount: events.length,
    model,
    cwd,
    totalUsage,
    status: "idle",
    firstUserPreview,
    lastUserPreview,
    lastAgentPreview,
    toolCallCount,
    turnCount,
    airTimeMs,
    activeSegments,
  };

  return { meta, events };
}

function computeActiveSegments(tsMs: number[]): { startMs: number; endMs: number }[] {
  if (tsMs.length === 0) return [];
  const sorted = [...tsMs].sort((a, b) => a - b);
  const out: { startMs: number; endMs: number }[] = [];
  let segStart = sorted[0];
  let segEnd = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - segEnd > IDLE_GAP_MS) {
      out.push({ startMs: segStart, endMs: segEnd });
      segStart = sorted[i];
    }
    segEnd = sorted[i];
  }
  out.push({ startMs: segStart, endMs: segEnd });
  return out;
}

/* ================================================================= */
/*  Caching                                                          */
/* ================================================================= */

type MetaEntry = { meta: SessionMeta; mtimeMs: number; sizeBytes: number; cwd?: string };
type DetailEntry = { detail: SessionDetail; mtimeMs: number; sizeBytes: number; cwd?: string };
const metaCache = new Map<string, MetaEntry>();
const detailCache = new Map<string, DetailEntry>();

export function clearAntigravityCaches(): void {
  metaCache.clear();
  detailCache.clear();
  historyCache = null;
}

export type ListAntigravityOptions = { root?: string; limit?: number };

export async function listAntigravitySessions(opts: ListAntigravityOptions = {}): Promise<SessionMeta[]> {
  const root = opts.root ?? DEFAULT_ANTIGRAVITY_ROOT;
  const files = await listSessionFiles(root);
  const out: SessionMeta[] = [];
  for (const file of files) {
    const cached = metaCache.get(file.filePath);
    if (
      cached &&
      cached.mtimeMs === file.mtimeMs &&
      cached.sizeBytes === file.sizeBytes &&
      cached.cwd === file.cwd
    ) {
      out.push(cached.meta);
      continue;
    }
    try {
      const { meta } = await parseSession(file);
      metaCache.set(file.filePath, {
        meta,
        mtimeMs: file.mtimeMs,
        sizeBytes: file.sizeBytes,
        cwd: file.cwd,
      });
      out.push(meta);
    } catch {
      // Skip files that fail to parse
    }
  }
  out.sort((a, b) => (b.firstTimestamp ?? "").localeCompare(a.firstTimestamp ?? ""));
  if (opts.limit !== undefined) return out.slice(0, opts.limit);
  return out;
}

export type GetAntigravityOptions = { root?: string };

export async function getAntigravitySession(
  id: string,
  opts: GetAntigravityOptions = {},
): Promise<SessionDetail | null> {
  const root = opts.root ?? DEFAULT_ANTIGRAVITY_ROOT;
  const files = await listSessionFiles(root);
  let chosen: SessionFile | undefined;
  for (const file of files) {
    if (file.conversationId === id) {
      chosen = file;
      break;
    }
  }
  if (!chosen) return null;
  const cached = detailCache.get(chosen.filePath);
  if (
    cached &&
    cached.mtimeMs === chosen.mtimeMs &&
    cached.sizeBytes === chosen.sizeBytes &&
    cached.cwd === chosen.cwd
  ) {
    return cached.detail;
  }
  const { meta, events } = await parseSession(chosen);
  const detail: SessionDetail = { ...meta, events };
  detailCache.set(chosen.filePath, {
    detail,
    mtimeMs: chosen.mtimeMs,
    sizeBytes: chosen.sizeBytes,
    cwd: chosen.cwd,
  });
  return detail;
}

export function antigravitySessionLocalDay(meta: SessionMeta): string | undefined {
  if (!meta.firstTimestamp) return undefined;
  const ms = Date.parse(meta.firstTimestamp);
  return Number.isFinite(ms) ? toLocalDay(ms) : undefined;
}
