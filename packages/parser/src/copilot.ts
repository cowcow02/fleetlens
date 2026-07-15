/**
 * GitHub Copilot CLI transcript reader.
 *
 * Copilot stores each resumable session at:
 *   ~/.copilot/session-state/<sessionId>/events.jsonl
 *
 * The event log includes workspace context, messages, tool execution, model
 * selection, and a final token/code-change summary. The adapter normalizes
 * those records into Fleetlens's shared session model.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { toLocalDay } from "./analytics.js";
import { resolveProjectIdentity } from "./git-project.js";
import { isFrameworkInjectedUserInput } from "./user-input.js";
import type { SessionDetail, SessionEvent, SessionMeta, Usage } from "./types.js";

export const DEFAULT_COPILOT_ROOT = path.join(os.homedir(), ".copilot", "session-state");

const IDLE_GAP_MS = 3 * 60 * 1000;

type JsonRecord = Record<string, unknown>;

type CopilotFile = {
  filePath: string;
  sessionId: string;
  mtimeMs: number;
  sizeBytes: number;
};

function recordOf(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null ? value as JsonRecord : undefined;
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function previewOf(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

function tokenCount(details: JsonRecord | undefined, key: string): number | undefined {
  return numberOf(recordOf(details?.[key])?.tokenCount);
}

function syntheticProjectDir(cwd: string | undefined): string {
  return cwd ? cwd.replace(/^\//, "-").replace(/\//g, "-") : "(unknown)";
}

async function listSessionFiles(root: string): Promise<CopilotFile[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const out: CopilotFile[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const filePath = path.join(root, entry.name, "events.jsonl");
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile()) continue;
    out.push({
      filePath,
      sessionId: entry.name,
      mtimeMs: stat.mtimeMs,
      sizeBytes: stat.size,
    });
  }
  return out;
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
      // A concurrently-written final line may be incomplete until the next append.
    }
  }
  return out;
}

function computeActiveSegments(timestamps: number[]): { startMs: number; endMs: number }[] {
  const sorted = [...new Set(timestamps)].sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const segments: { startMs: number; endMs: number }[] = [];
  let start = sorted[0]!;
  let end = start;
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]!;
    if (next - end > IDLE_GAP_MS) {
      segments.push({ startMs: start, endMs: end });
      start = next;
    }
    end = next;
  }
  segments.push({ startMs: start, endMs: end });
  return segments;
}

function parseSession(file: CopilotFile, lines: unknown[]): { meta: SessionMeta; events: SessionEvent[] } {
  const records = lines.map(recordOf).filter((line): line is JsonRecord => line !== undefined);
  const executionCallIds = new Set<string>();
  for (const record of records) {
    if (record.type !== "tool.execution_start") continue;
    const callId = stringOf(recordOf(record.data)?.toolCallId);
    if (callId) executionCallIds.add(callId);
  }

  const events: SessionEvent[] = [];
  const timestamps: number[] = [];
  const totalUsage = emptyUsage();
  let firstMs: number | undefined;
  let lastMs: number | undefined;
  let cwd: string | undefined;
  let repository: string | undefined;
  let gitBranch: string | undefined;
  let model: string | undefined;
  let firstUserPreview: string | undefined;
  let lastUserPreview: string | undefined;
  let lastAgentPreview: string | undefined;
  let toolCallCount = 0;
  let turnCount = 0;
  let observedOutput = 0;
  let sawShutdown = false;
  let linesAdded: number | undefined;
  let linesRemoved: number | undefined;
  let filesEdited: number | undefined;
  let idx = 0;

  function push(event: Omit<SessionEvent, "index">): void {
    events.push({ index: idx++, ...event });
  }

  for (const obj of records) {
    const type = stringOf(obj.type) ?? "";
    const data = recordOf(obj.data) ?? {};
    const timestamp = stringOf(obj.timestamp);
    if (timestamp) {
      const ms = Date.parse(timestamp);
      if (Number.isFinite(ms)) {
        timestamps.push(ms);
        firstMs = firstMs === undefined ? ms : Math.min(firstMs, ms);
        lastMs = lastMs === undefined ? ms : Math.max(lastMs, ms);
      }
    }

    if (type === "session.start") {
      const context = recordOf(data.context);
      cwd = stringOf(context?.cwd) ?? cwd;
      repository = stringOf(context?.repository) ?? repository;
      gitBranch = stringOf(context?.branch) ?? gitBranch;
      push({
        timestamp,
        role: "meta",
        rawType: type,
        preview: "Copilot session started",
        blocks: [],
        raw: obj,
      });
      continue;
    }

    if (type === "session.model_change") {
      const selected = stringOf(data.newModel);
      if (selected && selected !== "auto") model = selected;
    } else if (type === "session.auto_mode_resolved") {
      model = stringOf(data.chosenModel) ?? model;
    } else if (type === "assistant.turn_start" || type === "assistant.message") {
      model = stringOf(data.model) ?? model;
    }

    if (type === "system.message") {
      push({
        timestamp,
        role: "system",
        rawType: type,
        preview: "Copilot system instructions",
        blocks: [],
        raw: obj,
      });
      continue;
    }

    if (type === "user.message") {
      const text = stringOf(data.content) ?? "";
      const preview = previewOf(text);
      if (text && !isFrameworkInjectedUserInput(text)) {
        firstUserPreview ??= preview;
        lastUserPreview = preview;
        turnCount += 1;
      }
      push({
        timestamp,
        role: "user",
        rawType: type,
        preview,
        blocks: text ? [{ type: "text", text }] : [],
        raw: obj,
      });
      continue;
    }

    if (type === "assistant.message") {
      const text = stringOf(data.content) ?? "";
      const outputTokens = numberOf(data.outputTokens) ?? 0;
      observedOutput += outputTokens;
      if (text) {
        const preview = previewOf(text);
        lastAgentPreview = preview;
        push({
          timestamp,
          role: "agent",
          rawType: type,
          messageId: stringOf(data.messageId),
          preview,
          blocks: [{ type: "text", text }],
          model,
          raw: obj,
        });
      }

      const requests = Array.isArray(data.toolRequests) ? data.toolRequests : [];
      for (const requestValue of requests) {
        const request = recordOf(requestValue);
        if (!request) continue;
        const callId = stringOf(request.toolCallId);
        if (callId && executionCallIds.has(callId)) continue;
        const name = stringOf(request.name) ?? "(unknown)";
        const input = recordOf(request.arguments) ?? request.arguments ?? null;
        toolCallCount += 1;
        push({
          timestamp,
          role: "tool-call",
          rawType: "assistant.message/tool_request",
          preview: `${name}(${previewOf(input).slice(0, 80)})`,
          blocks: [{ type: "tool_use", id: callId ?? `copilot-${idx}`, name, input }],
          toolName: name,
          toolUseId: callId,
          model,
          raw: obj,
        });
      }
      continue;
    }

    if (type === "tool.execution_start") {
      const callId = stringOf(data.toolCallId);
      const name = stringOf(data.toolName) ?? "(unknown)";
      const input = data.arguments ?? null;
      toolCallCount += 1;
      push({
        timestamp,
        role: "tool-call",
        rawType: type,
        preview: `${name}(${previewOf(input).slice(0, 80)})`,
        blocks: [{ type: "tool_use", id: callId ?? `copilot-${idx}`, name, input }],
        toolName: name,
        toolUseId: callId,
        model: stringOf(data.model) ?? model,
        raw: obj,
      });
      continue;
    }

    if (type === "tool.execution_complete") {
      const callId = stringOf(data.toolCallId);
      const resultRecord = recordOf(data.result);
      const result = resultRecord && "content" in resultRecord ? resultRecord.content : data.result;
      const success = data.success !== false;
      push({
        timestamp,
        role: "tool-result",
        rawType: type,
        preview: previewOf(result),
        blocks: [{ type: "tool_result", tool_use_id: callId ?? "", content: result, is_error: !success }],
        toolUseId: callId,
        toolResult: data.result,
        raw: obj,
      });
      continue;
    }

    if (type === "assistant.reasoning") {
      const text = stringOf(data.content) ?? "";
      push({
        timestamp,
        role: "agent-thinking",
        rawType: type,
        preview: previewOf(text),
        blocks: text ? [{ type: "thinking", thinking: text }] : [],
        model,
        raw: obj,
      });
      continue;
    }

    if (type === "session.shutdown") {
      sawShutdown = true;
      model = stringOf(data.currentModel) ?? model;
      const details = recordOf(data.tokenDetails);
      totalUsage.input = tokenCount(details, "input") ?? totalUsage.input;
      totalUsage.output = tokenCount(details, "output") ?? observedOutput;
      totalUsage.cacheRead = tokenCount(details, "cache_read") ?? totalUsage.cacheRead;
      totalUsage.cacheWrite = tokenCount(details, "cache_write") ?? totalUsage.cacheWrite;
      const changes = recordOf(data.codeChanges);
      linesAdded = numberOf(changes?.linesAdded);
      linesRemoved = numberOf(changes?.linesRemoved);
      const modified = changes?.filesModified;
      filesEdited = Array.isArray(modified) ? modified.length : undefined;
    }

    push({
      timestamp,
      role: "meta",
      rawType: type,
      preview: "",
      blocks: [],
      raw: obj,
    });
  }

  if (totalUsage.output === 0) totalUsage.output = observedOutput;
  if (totalUsage.input || totalUsage.output || totalUsage.cacheRead || totalUsage.cacheWrite) {
    const usageEvent = [...events].reverse().find((event) =>
      event.role === "agent" || event.role === "agent-thinking" || event.role === "tool-call",
    );
    if (usageEvent) {
      usageEvent.messageId = `copilot-${file.sessionId}-total`;
      usageEvent.usage = { ...totalUsage };
    }
  }

  const firstTimestamp = firstMs === undefined ? undefined : new Date(firstMs).toISOString();
  const lastTimestamp = lastMs === undefined ? undefined : new Date(lastMs).toISOString();
  if (firstMs !== undefined) {
    let previousMs: number | undefined;
    for (const event of events) {
      if (!event.timestamp) continue;
      const ms = Date.parse(event.timestamp);
      if (!Number.isFinite(ms)) continue;
      event.tOffsetMs = Math.max(0, ms - firstMs);
      if (previousMs !== undefined) event.gapMs = Math.max(0, ms - previousMs);
      previousMs = ms;
    }
  }

  const activeSegments = computeActiveSegments(timestamps);
  const airTimeMs = activeSegments.reduce((sum, segment) => sum + segment.endMs - segment.startMs, 0);
  const project = cwd ? resolveProjectIdentity(cwd) : undefined;
  const repoName = project?.repoName ?? repository?.split("/").filter(Boolean).at(-1);

  const meta: SessionMeta = {
    agent: "copilot",
    id: file.sessionId,
    filePath: file.filePath,
    projectName: project?.projectName ?? cwd ?? "(unknown)",
    worktreeName: project?.worktreeName,
    repoName,
    projectDir: syntheticProjectDir(cwd),
    sessionId: file.sessionId,
    firstTimestamp,
    lastTimestamp,
    lastActivityMs: file.mtimeMs,
    durationMs: firstMs !== undefined && lastMs !== undefined ? lastMs - firstMs : undefined,
    eventCount: events.length,
    model,
    cwd,
    gitBranch,
    totalUsage,
    status: sawShutdown || Date.now() - file.mtimeMs > IDLE_GAP_MS ? "idle" : "running",
    firstUserPreview,
    lastUserPreview,
    lastAgentPreview,
    toolCallCount,
    turnCount,
    linesAdded,
    linesRemoved,
    filesEdited,
    airTimeMs,
    activeSegments,
  };

  return { meta, events };
}

type MetaEntry = { meta: SessionMeta; mtimeMs: number; sizeBytes: number };
type DetailEntry = { detail: SessionDetail; mtimeMs: number; sizeBytes: number };
const metaCache = new Map<string, MetaEntry>();
const detailCache = new Map<string, DetailEntry>();

export function clearCopilotCaches(): void {
  metaCache.clear();
  detailCache.clear();
}

async function scanCopilot(root: string): Promise<{ file: CopilotFile; meta: SessionMeta }[]> {
  const files = await listSessionFiles(root);
  const out: { file: CopilotFile; meta: SessionMeta }[] = [];
  for (const file of files) {
    const cached = metaCache.get(file.filePath);
    if (cached && cached.mtimeMs === file.mtimeMs && cached.sizeBytes === file.sizeBytes) {
      out.push({ file, meta: cached.meta });
      continue;
    }
    try {
      const lines = await readJsonl(file.filePath);
      const { meta } = parseSession(file, lines);
      metaCache.set(file.filePath, { meta, mtimeMs: file.mtimeMs, sizeBytes: file.sizeBytes });
      out.push({ file, meta });
    } catch {
      // One unreadable session must not hide the rest of the source.
    }
  }
  return out;
}

export type ListCopilotOptions = { root?: string; limit?: number };

export async function listCopilotSessions(opts: ListCopilotOptions = {}): Promise<SessionMeta[]> {
  const root = opts.root ?? DEFAULT_COPILOT_ROOT;
  const sessions = (await scanCopilot(root)).map((entry) => entry.meta);
  sessions.sort((a, b) => (b.firstTimestamp ?? "").localeCompare(a.firstTimestamp ?? ""));
  return opts.limit === undefined ? sessions : sessions.slice(0, opts.limit);
}

export type GetCopilotOptions = { root?: string };

export async function getCopilotSession(
  id: string,
  opts: GetCopilotOptions = {},
): Promise<SessionDetail | null> {
  const root = opts.root ?? DEFAULT_COPILOT_ROOT;
  const entry = (await scanCopilot(root)).find((candidate) => candidate.meta.id === id);
  if (!entry) return null;
  const cached = detailCache.get(entry.file.filePath);
  if (cached && cached.mtimeMs === entry.file.mtimeMs && cached.sizeBytes === entry.file.sizeBytes) {
    return cached.detail;
  }
  const lines = await readJsonl(entry.file.filePath);
  const { meta, events } = parseSession(entry.file, lines);
  const detail: SessionDetail = { ...meta, events };
  detailCache.set(entry.file.filePath, {
    detail,
    mtimeMs: entry.file.mtimeMs,
    sizeBytes: entry.file.sizeBytes,
  });
  return detail;
}

export function copilotSessionLocalDay(meta: SessionMeta): string | undefined {
  if (!meta.firstTimestamp) return undefined;
  const ms = Date.parse(meta.firstTimestamp);
  return Number.isFinite(ms) ? toLocalDay(ms) : undefined;
}
