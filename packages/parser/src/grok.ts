/**
 * Grok Build (xAI) transcript reader.
 *
 * Official Grok Build persists sessions at:
 *   ($GROK_HOME || ~/.grok)/sessions/<url-encoded-cwd>/<session-id>/
 *     summary.json     — index/meta (id, cwd, model, timestamps, title)
 *     updates.jsonl    — ACP session/update stream (conversation authority)
 *     signals.json     — tool/turn counters + context-window usage
 *
 * Wire format (one JSON object per line in updates.jsonl):
 *   {
 *     timestamp: <unix seconds>,
 *     method: "session/update" | "_x.ai/session/update",
 *     params: {
 *       sessionId,
 *       update: { sessionUpdate: "user_message_chunk" | "agent_message_chunk"
 *                               | "agent_thought_chunk" | "tool_call"
 *                               | "tool_call_update" | "turn_completed" | … },
 *       _meta: { agentTimestampMs, eventId, promptId, totalTokens, … }
 *     }
 *   }
 *
 * Streaming chunks of the same type are coalesced until a different
 * sessionUpdate arrives so the UI is not flooded with one event per piece.
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
  SubagentRun,
  Usage,
} from "./types.js";
import { jsonlFileTooLarge, lruGet, lruSet, readJsonlFile } from "./jsonl-read.js";

/** Resolve at call time so GROK_HOME overrides are not frozen at import. */
export function resolveDefaultGrokRoot(): string {
  const home = process.env.GROK_HOME || path.join(os.homedir(), ".grok");
  return path.join(home, "sessions");
}

/** Default display path (~/.grok/sessions). Prefer resolveDefaultGrokRoot()
 *  for actual reads so GROK_HOME is honored at call time. */
export const DEFAULT_GROK_ROOT = path.join(os.homedir(), ".grok", "sessions");

/** Same idle threshold as Claude / Codex / Gemini parsers (agent-time).
 *  Keep in lockstep with those copies if the gap ever changes. */
const IDLE_GAP_MS = 3 * 60 * 1000;

type SessionDir = {
  /** Absolute path to the session directory. */
  dirPath: string;
  /** Absolute path to updates.jsonl (conversation authority). */
  updatesPath: string;
  /** Absolute path to summary.json. */
  summaryPath: string;
  /** Absolute path to signals.json if present. */
  signalsPath: string | null;
  sessionId: string;
  /** Raw group directory name under sessions/ (URL-encoded cwd, filesystem form). */
  groupName: string;
  /** Decoded absolute cwd for the project group (from summary or group name). */
  decodedCwd: string;
  mtimeMs: number;
  sizeBytes: number;
};

type GrokSummary = {
  info?: { id?: string; cwd?: string };
  session_summary?: string;
  generated_title?: string;
  created_at?: string;
  updated_at?: string;
  last_active_at?: string;
  current_model_id?: string;
  head_branch?: string;
  agent_name?: string;
  session_kind?: string;
  num_messages?: number;
  num_chat_messages?: number;
};

type GrokSignals = {
  turnCount?: number;
  toolCallCount?: number;
  contextTokensUsed?: number;
  contextWindowTokens?: number;
  /** 0–100 percent of context window used (preferred utilization signal). */
  contextWindowUsage?: number;
  agentLinesAdded?: number;
  agentLinesRemoved?: number;
  primaryModelId?: string;
  modelsUsed?: string[];
};

/** Sidecar under <parent>/subagents/<child-id>/meta.json */
type GrokSubagentMeta = {
  subagent_id?: string;
  parent_session_id?: string;
  child_session_id?: string;
  subagent_type?: string;
  description?: string;
  prompt?: string;
};

type ContentPart = { type?: string; text?: string };
type ToolContentItem = {
  type?: string;
  content?: ContentPart | string;
  text?: string;
};

type GrokUpdate = {
  sessionUpdate?: string;
  content?: ContentPart | string;
  toolCallId?: string;
  title?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  status?: string | { status?: string };
  kind?: string;
  _meta?: Record<string, unknown>;
};

type GrokLine = {
  timestamp?: number;
  method?: string;
  params?: {
    sessionId?: string;
    update?: GrokUpdate;
    _meta?: Record<string, unknown>;
  };
};

async function safeReaddir(p: string): Promise<string[]> {
  return fs.readdir(p).catch(() => [] as string[]);
}

async function safeReadJson<T>(p: string): Promise<T | null> {
  const raw = await fs.readFile(p, "utf8").catch(() => null);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Decode a project-group dir name. Prefer `.cwd` file (long paths), else
 *  decodeURIComponent of the dir name. */
async function resolveEncodedCwd(groupDir: string, encoded: string): Promise<string> {
  const cwdFile = path.join(groupDir, ".cwd");
  const fromFile = await fs.readFile(cwdFile, "utf8").catch(() => null);
  if (fromFile && fromFile.trim()) return fromFile.trim();
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

async function listSessionDirs(root: string): Promise<SessionDir[]> {
  const out: SessionDir[] = [];
  const groups = await safeReaddir(root);
  for (const group of groups) {
    // Skip non-session artifacts at the sessions root.
    if (group === "session_search.sqlite" || group.startsWith(".")) continue;
    const groupDir = path.join(root, group);
    const groupStat = await fs.stat(groupDir).catch(() => null);
    if (!groupStat?.isDirectory()) continue;

    const decodedCwd = await resolveEncodedCwd(groupDir, group);
    const entries = await safeReaddir(groupDir);
    for (const entry of entries) {
      // Skip project-level logs and non-session dirs.
      if (entry === "prompt_history.jsonl" || entry.startsWith(".")) continue;
      const dirPath = path.join(groupDir, entry);
      const summaryPath = path.join(dirPath, "summary.json");
      const updatesPath = path.join(dirPath, "updates.jsonl");
      const signalsCandidate = path.join(dirPath, "signals.json");

      const [summaryStat, updatesStat, signalsStat] = await Promise.all([
        fs.stat(summaryPath).catch(() => null),
        fs.stat(updatesPath).catch(() => null),
        fs.stat(signalsCandidate).catch(() => null),
      ]);
      // A real session needs at least summary.json (index entry). Prefer
      // updates.jsonl for size/mtime when present.
      if (!summaryStat?.isFile()) continue;
      const mtimeMs = Math.max(summaryStat.mtimeMs, updatesStat?.mtimeMs ?? 0);
      const sizeBytes = (updatesStat?.size ?? 0) + summaryStat.size;

      out.push({
        dirPath,
        updatesPath,
        summaryPath,
        signalsPath: signalsStat?.isFile() ? signalsCandidate : null,
        sessionId: entry,
        groupName: group,
        decodedCwd,
        mtimeMs,
        sizeBytes,
      });
    }
  }
  return out;
}

function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function previewOf(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function textFromContent(content: ContentPart | string | undefined | null): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (typeof content.text === "string") return content.text;
  return "";
}

function toolResultText(update: GrokUpdate): string {
  // Prefer human-readable content items over rawOutput (which may carry
  // byte-array stdout dumps).
  const items = (update as { content?: ToolContentItem[] }).content;
  if (Array.isArray(items)) {
    const parts: string[] = [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      if (typeof item.text === "string" && item.text) {
        parts.push(item.text);
        continue;
      }
      const inner = item.content;
      if (typeof inner === "string" && inner) parts.push(inner);
      else if (inner && typeof inner === "object" && typeof inner.text === "string") {
        parts.push(inner.text);
      }
    }
    if (parts.length) return parts.join("\n");
  }

  const raw = update.rawOutput;
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    // Common Grok tool envelopes.
    if (typeof r.output_for_prompt === "string") return r.output_for_prompt;
    if (typeof r.summary_for_prompt === "string") return r.summary_for_prompt;
    if (r.Content && typeof r.Content === "object") {
      const c = r.Content as Record<string, unknown>;
      if (typeof c.content === "string") return c.content;
    }
    if (r.TodosUpdated && typeof r.TodosUpdated === "object") {
      const t = r.TodosUpdated as Record<string, unknown>;
      if (typeof t.summary_for_prompt === "string") return t.summary_for_prompt;
    }
    // Avoid dumping multi-KB byte arrays into the event stream.
    if (Array.isArray(r.stdout) || Array.isArray(r.output)) {
      try {
        return JSON.stringify({
          type: r.type,
          exit_code: r.exit_code,
          note: "binary/stdout omitted",
        });
      } catch {
        return "";
      }
    }
    try {
      return JSON.stringify(raw);
    } catch {
      return "";
    }
  }
  return String(raw);
}

function toolNameOf(update: GrokUpdate): string {
  const meta = update._meta;
  if (meta && typeof meta === "object") {
    const xai = meta["x.ai/tool"];
    if (xai && typeof xai === "object") {
      const name = (xai as Record<string, unknown>).name;
      if (typeof name === "string" && name) return name;
    }
  }
  if (typeof update.title === "string" && update.title) {
    // Titles can be "Execute `cmd…`" — prefer short bare titles when simple.
    if (!update.title.includes(" ") && !update.title.includes("`")) return update.title;
    return update.title;
  }
  return "tool";
}

function statusOf(update: GrokUpdate): string | undefined {
  const s = update.status;
  if (typeof s === "string") return s;
  if (s && typeof s === "object" && typeof s.status === "string") return s.status;
  return undefined;
}

/** Prefer _meta.agentTimestampMs (ms); fall back to top-level timestamp (unix s). */
function lineTimestampIso(line: GrokLine): string | undefined {
  const meta = line.params?._meta;
  const agentMs = meta && typeof meta.agentTimestampMs === "number" ? meta.agentTimestampMs : undefined;
  if (agentMs != null && Number.isFinite(agentMs)) {
    return new Date(agentMs).toISOString();
  }
  const ts = line.timestamp;
  if (typeof ts === "number" && Number.isFinite(ts)) {
    // Grok writes unix seconds (not ms) on the top-level timestamp field.
    const ms = ts > 1e12 ? ts : ts * 1000;
    return new Date(ms).toISOString();
  }
  return undefined;
}

function computeActiveSegments(tsMs: number[]): { startMs: number; endMs: number }[] {
  if (tsMs.length === 0) return [];
  const sorted = [...tsMs].sort((a, b) => a - b);
  const out: { startMs: number; endMs: number }[] = [];
  let segStart = sorted[0]!;
  let segEnd = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    const t = sorted[i]!;
    if (t - segEnd > IDLE_GAP_MS) {
      out.push({ startMs: segStart, endMs: segEnd });
      segStart = t;
    }
    segEnd = t;
  }
  out.push({ startMs: segStart, endMs: segEnd });
  return out;
}

type ChunkBuf = {
  kind: "user" | "agent" | "thought";
  texts: string[];
  firstTs?: string;
  lastTs?: string;
  model?: string;
  promptId?: string;
  raw: unknown[];
};

type ParsedSession = {
  meta: SessionMeta;
  events: SessionEvent[];
  /** From summary.session_kind — "subagent" for spawned children. */
  sessionKind?: string;
};

async function parseSession(dir: SessionDir): Promise<ParsedSession> {
  if (jsonlFileTooLarge(dir.sizeBytes)) {
    throw new Error(`transcript too large to parse (${dir.sizeBytes} bytes)`);
  }
  const [summary, signals, updateLines] = await Promise.all([
    safeReadJson<GrokSummary>(dir.summaryPath),
    dir.signalsPath ? safeReadJson<GrokSignals>(dir.signalsPath) : Promise.resolve(null),
    readJsonlFile(dir.updatesPath).catch(() => [] as unknown[]),
  ]);

  const sessionId = summary?.info?.id ?? dir.sessionId;
  const cwd = summary?.info?.cwd ?? dir.decodedCwd;
  let model =
    summary?.current_model_id ??
    signals?.primaryModelId ??
    signals?.modelsUsed?.[0];

  const events: SessionEvent[] = [];
  const totalUsage = emptyUsage();
  // Best-effort token total: Grok exposes context-window usage, not
  // split input/output. Park it under `input` so dashboards show something.
  if (signals?.contextTokensUsed && signals.contextTokensUsed > 0) {
    totalUsage.input = signals.contextTokensUsed;
  }

  let firstTimestamp: string | undefined;
  let lastTimestamp: string | undefined;
  let toolCallCount = 0;
  let turnCount = 0;
  let firstUserPreview: string | undefined;
  let lastUserPreview: string | undefined;
  let lastAgentPreview: string | undefined;
  const tsMs: number[] = [];
  let idx = 0;
  const completedToolResults = new Set<string>();
  let maxTotalTokens = 0;

  function noteTs(ts: string | undefined, role: SessionEvent["role"]): void {
    if (!ts || role === "meta") return;
    if (!firstTimestamp) firstTimestamp = ts;
    lastTimestamp = ts;
    const ms = Date.parse(ts);
    if (Number.isFinite(ms)) tsMs.push(ms);
  }

  function pushEvent(e: SessionEvent): void {
    events.push(e);
    noteTs(e.timestamp, e.role);
  }

  let buf: ChunkBuf | null = null;

  function flushBuf(): void {
    if (!buf) return;
    const text = buf.texts.join("");
    const preview = previewOf(text);
    if (buf.kind === "user") {
      const isHidden = !text || isFrameworkInjectedUserInput(text);
      if (text && !isHidden) {
        if (!firstUserPreview) firstUserPreview = preview;
        lastUserPreview = preview;
        turnCount += 1;
      }
      if (text) {
        pushEvent({
          index: idx++,
          timestamp: buf.firstTs,
          role: "user",
          rawType: "grok/user_message",
          preview,
          blocks: [{ type: "text", text }],
          messageId: buf.promptId,
          raw: buf.raw.length === 1 ? buf.raw[0] : buf.raw,
        });
      }
    } else if (buf.kind === "agent") {
      if (text) lastAgentPreview = preview;
      if (text) {
        pushEvent({
          index: idx++,
          timestamp: buf.firstTs,
          role: "agent",
          rawType: "grok/agent_message",
          preview,
          blocks: [{ type: "text", text }],
          messageId: buf.promptId,
          model: buf.model ?? model,
          raw: buf.raw.length === 1 ? buf.raw[0] : buf.raw,
        });
      }
    } else if (buf.kind === "thought") {
      if (text) {
        pushEvent({
          index: idx++,
          timestamp: buf.firstTs,
          role: "agent-thinking",
          rawType: "grok/agent_thought",
          preview,
          blocks: [{ type: "thinking", thinking: text }],
          messageId: buf.promptId,
          model: buf.model ?? model,
          raw: buf.raw.length === 1 ? buf.raw[0] : buf.raw,
        });
      }
    }
    buf = null;
  }

  function appendChunk(
    kind: ChunkBuf["kind"],
    text: string,
    ts: string | undefined,
    promptId: string | undefined,
    modelId: string | undefined,
    raw: unknown,
  ): void {
    if (!text && kind === "user") return;
    if (buf && buf.kind !== kind) flushBuf();
    if (!buf) {
      buf = {
        kind,
        texts: [],
        firstTs: ts,
        lastTs: ts,
        model: modelId,
        promptId,
        raw: [],
      };
    }
    if (text) buf.texts.push(text);
    buf.lastTs = ts ?? buf.lastTs;
    if (modelId) buf.model = modelId;
    if (promptId) buf.promptId = promptId;
    buf.raw.push(raw);
  }

  for (const rawLine of updateLines) {
    const obj = rawLine as GrokLine;

    const update = obj.params?.update;
    if (!update || typeof update !== "object") continue;
    const st = update.sessionUpdate;
    if (!st) continue;

    const ts = lineTimestampIso(obj);
    const lineMeta = obj.params?._meta ?? {};
    const updateMeta = update._meta ?? {};
    const promptId =
      (typeof lineMeta.promptId === "string" && lineMeta.promptId) ||
      (typeof updateMeta.promptId === "string" && updateMeta.promptId) ||
      undefined;
    const modelId =
      (typeof updateMeta.modelId === "string" && updateMeta.modelId) ||
      (typeof lineMeta.modelId === "string" && lineMeta.modelId) ||
      undefined;
    if (modelId) model = modelId;
    const totalTok = lineMeta.totalTokens;
    if (typeof totalTok === "number" && totalTok > maxTotalTokens) {
      maxTotalTokens = totalTok;
    }

    if (st === "user_message_chunk") {
      const text = textFromContent(update.content);
      appendChunk("user", text, ts, promptId, modelId, obj);
      continue;
    }
    if (st === "agent_message_chunk") {
      const text = textFromContent(update.content);
      appendChunk("agent", text, ts, promptId, modelId, obj);
      continue;
    }
    if (st === "agent_thought_chunk") {
      const text = textFromContent(update.content);
      appendChunk("thought", text, ts, promptId, modelId, obj);
      continue;
    }

    // Any non-chunk update ends the current coalescing buffer.
    flushBuf();

    if (st === "tool_call") {
      const toolCallId = typeof update.toolCallId === "string" ? update.toolCallId : `grok-${idx}`;
      const name = toolNameOf(update);
      const input = update.rawInput ?? {};
      const argsStr = input ? JSON.stringify(input) : "";
      toolCallCount += 1;
      pushEvent({
        index: idx++,
        timestamp: ts,
        role: "tool-call",
        rawType: "grok/tool_call",
        preview: `${name}(${truncate(argsStr, 80)})`,
        blocks: [{ type: "tool_use", id: toolCallId, name, input }],
        toolName: name,
        toolUseId: toolCallId,
        model,
        raw: obj,
      });
      continue;
    }

    if (st === "tool_call_update") {
      const status = statusOf(update);
      if (status !== "completed" && status !== "failed" && status !== "error" && status !== "cancelled") {
        // in_progress / kind-only updates — skip.
        continue;
      }
      const toolCallId = typeof update.toolCallId === "string" ? update.toolCallId : "";
      if (toolCallId && completedToolResults.has(toolCallId)) continue;
      if (toolCallId) completedToolResults.add(toolCallId);
      const resultText = toolResultText(update);
      const isError = status === "failed" || status === "error" || status === "cancelled";
      pushEvent({
        index: idx++,
        timestamp: ts,
        role: "tool-result",
        rawType: "grok/tool_result",
        preview: previewOf(resultText),
        blocks: [
          {
            type: "tool_result",
            tool_use_id: toolCallId,
            content: resultText,
            is_error: isError || undefined,
          },
        ],
        toolUseId: toolCallId || undefined,
        toolResult: resultText,
        raw: obj,
      });
      continue;
    }

    if (st === "turn_completed") {
      // Already flushed; nothing else required for conversational timeline.
      continue;
    }

    // Hooks / plan / retry / recap — keep out of the main conversation
    // stream (same spirit as Gemini skipping non-chat noise).
  }
  flushBuf();

  // If signals didn't give tokens but we saw cumulative totalTokens on
  // the stream, use the peak as a best-effort context size.
  if (totalUsage.input === 0 && maxTotalTokens > 0) {
    totalUsage.input = maxTotalTokens;
  }

  // Prefer summary timestamps as the session window when the updates
  // stream is empty or missing conversational events.
  if (!firstTimestamp && summary?.created_at) firstTimestamp = summary.created_at;
  if (!lastTimestamp) {
    lastTimestamp = summary?.last_active_at ?? summary?.updated_at ?? firstTimestamp;
  }

  // Prefer signals counters when the stream under-counts (e.g. list path
  // can still show realistic rollups after a partial parse).
  if (signals?.toolCallCount != null && signals.toolCallCount > toolCallCount) {
    toolCallCount = signals.toolCallCount;
  }
  if (signals?.turnCount != null && signals.turnCount > turnCount) {
    turnCount = signals.turnCount;
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

  const project = cwd ? resolveProjectIdentity(cwd) : undefined;
  const projectName = project?.projectName ?? cwd ?? dir.decodedCwd;
  // Raw filesystem group name under ~/.grok/sessions/ (URL-encoded cwd).
  // Matches CLAUDE.md: projectDir is the encoded form, not slash-to-dash.
  const projectDir = dir.groupName || (cwd ? encodeURIComponent(cwd) : "(unknown)");

  // Previews from summary when the stream had no user text (edge case).
  if (!firstUserPreview) {
    const title = summary?.generated_title || summary?.session_summary;
    if (title) firstUserPreview = previewOf(title);
  }

  const spawnedAgentCount = await countSubagentChildren(dir.dirPath);

  const meta: SessionMeta = {
    agent: "grok",
    id: sessionId,
    filePath: dir.updatesPath,
    projectName,
    worktreeName: project?.worktreeName,
    repoName: project?.repoName,
    projectDir,
    sessionId,
    firstTimestamp,
    lastTimestamp,
    lastActivityMs: lastTimestamp ? Date.parse(lastTimestamp) : undefined,
    durationMs: durationMs && Number.isFinite(durationMs) ? durationMs : undefined,
    eventCount: events.length,
    model,
    cwd,
    gitBranch: summary?.head_branch,
    agentName: summary?.agent_name,
    totalUsage,
    status: "idle",
    firstUserPreview,
    lastUserPreview,
    lastAgentPreview,
    toolCallCount,
    turnCount,
    linesAdded: signals?.agentLinesAdded,
    linesRemoved: signals?.agentLinesRemoved,
    airTimeMs,
    activeSegments,
    ...(spawnedAgentCount > 0 ? { spawnedAgentCount } : {}),
  };

  return { meta, events, sessionKind: summary?.session_kind };
}

async function countSubagentChildren(dirPath: string): Promise<number> {
  const subRoot = path.join(dirPath, "subagents");
  const entries = await safeReaddir(subRoot);
  let n = 0;
  for (const e of entries) {
    const st = await fs.stat(path.join(subRoot, e)).catch(() => null);
    if (st?.isDirectory()) n += 1;
  }
  return n;
}

/**
 * Grok stores child agents as sibling session dirs (`session_kind: "subagent"`)
 * and indexes them under `<parent>/subagents/<child-id>/meta.json`. Load the
 * index + child summary/signals so the parent session page can show a
 * subagent rail like Claude Code.
 */
async function loadGrokSubagents(
  parentDir: SessionDir,
  parentStartMs: number | undefined,
): Promise<SubagentRun[]> {
  const subRoot = path.join(parentDir.dirPath, "subagents");
  const entries = await safeReaddir(subRoot);
  const groupDir = path.dirname(parentDir.dirPath);
  const runs: SubagentRun[] = [];

  for (const entry of entries) {
    const metaPath = path.join(subRoot, entry, "meta.json");
    const meta = await safeReadJson<GrokSubagentMeta>(metaPath);
    if (!meta) continue;
    const childId = meta.child_session_id ?? meta.subagent_id ?? entry;
    const childDir = path.join(groupDir, childId);
    const [childSummary, childSignals] = await Promise.all([
      safeReadJson<GrokSummary>(path.join(childDir, "summary.json")),
      safeReadJson<GrokSignals>(path.join(childDir, "signals.json")),
    ]);
    const startMs = childSummary?.created_at
      ? Date.parse(childSummary.created_at)
      : undefined;
    const endIso = childSummary?.last_active_at ?? childSummary?.updated_at;
    const endMs = endIso ? Date.parse(endIso) : undefined;
    const startOk = startMs !== undefined && Number.isFinite(startMs) ? startMs : undefined;
    const endOk = endMs !== undefined && Number.isFinite(endMs) ? endMs : undefined;
    const usage = emptyUsage();
    if (childSignals?.contextTokensUsed) usage.input = childSignals.contextTokensUsed;

    runs.push({
      agentId: childId,
      agentType: meta.subagent_type ?? childSummary?.agent_name ?? "subagent",
      description:
        (meta.description && meta.description.trim()) ||
        childSummary?.generated_title ||
        childSummary?.session_summary ||
        childId,
      startMs: startOk,
      endMs: endOk,
      durationMs:
        startOk !== undefined && endOk !== undefined
          ? Math.max(0, endOk - startOk)
          : undefined,
      startTOffsetMs:
        parentStartMs !== undefined && startOk !== undefined
          ? Math.max(0, startOk - parentStartMs)
          : undefined,
      endTOffsetMs:
        parentStartMs !== undefined && endOk !== undefined
          ? Math.max(0, endOk - parentStartMs)
          : undefined,
      eventCount: childSummary?.num_messages ?? childSummary?.num_chat_messages ?? 0,
      totalUsage: usage,
      prompt: typeof meta.prompt === "string" ? meta.prompt : undefined,
      model: childSummary?.current_model_id ?? childSignals?.primaryModelId,
      toolCallCount: childSignals?.toolCallCount,
    });
  }

  runs.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
  return runs;
}

/* ================================================================= */
/*  Caching                                                          */
/* ================================================================= */

type MetaEntry = { meta: SessionMeta; mtimeMs: number; sizeBytes: number };
type DetailEntry = { detail: SessionDetail; mtimeMs: number; sizeBytes: number };
const metaCache = new Map<string, MetaEntry>();
const detailCache = new Map<string, DetailEntry>();

export function clearGrokCaches(): void {
  metaCache.clear();
  detailCache.clear();
}

export type ListGrokOptions = { root?: string; limit?: number };

export async function listGrokSessions(opts: ListGrokOptions = {}): Promise<SessionMeta[]> {
  const root = opts.root ?? resolveDefaultGrokRoot();
  const dirs = await listSessionDirs(root);
  const out: SessionMeta[] = [];
  for (const dir of dirs) {
    // Cheap pre-filter: subagents are full session dirs with
    // summary.session_kind === "subagent". They are linked from the parent
    // under subagents/<id>/meta.json and must NOT appear as top-level rows.
    const summaryPeek = await safeReadJson<GrokSummary>(dir.summaryPath);
    if (summaryPeek?.session_kind === "subagent") continue;

    const cached = metaCache.get(dir.dirPath);
    if (cached && cached.mtimeMs === dir.mtimeMs && cached.sizeBytes === dir.sizeBytes) {
      out.push(cached.meta);
      continue;
    }
    if (jsonlFileTooLarge(dir.sizeBytes)) continue;
    try {
      const { meta, sessionKind } = await parseSession(dir);
      if (sessionKind === "subagent") continue;
      metaCache.set(dir.dirPath, {
        meta,
        mtimeMs: dir.mtimeMs,
        sizeBytes: dir.sizeBytes,
      });
      out.push(meta);
    } catch {
      // Skip sessions that fail to parse.
    }
  }
  out.sort((a, b) => (b.firstTimestamp ?? "").localeCompare(a.firstTimestamp ?? ""));
  if (opts.limit !== undefined) return out.slice(0, opts.limit);
  return out;
}

export type GetGrokOptions = { root?: string };

export async function getGrokSession(
  id: string,
  opts: GetGrokOptions = {},
): Promise<SessionDetail | null> {
  const root = opts.root ?? resolveDefaultGrokRoot();
  const dirs = await listSessionDirs(root);
  const chosen = dirs.find((d) => d.sessionId === id);
  if (!chosen) {
    // Fallback: match resolved summary.info.id after parse (rare rename case).
    for (const dir of dirs) {
      try {
        const { meta, events } = await parseSession(dir);
        if (meta.id === id) {
          const detail: SessionDetail = { ...meta, events };
          lruSet(detailCache, dir.dirPath, {
            detail,
            mtimeMs: dir.mtimeMs,
            sizeBytes: dir.sizeBytes,
          });
          return detail;
        }
      } catch {
        // continue
      }
    }
    return null;
  }

  const cached = lruGet(detailCache, chosen.dirPath);
  if (cached && cached.mtimeMs === chosen.mtimeMs && cached.sizeBytes === chosen.sizeBytes) {
    return cached.detail;
  }
  const { meta, events } = await parseSession(chosen);
  const parentStartMs = meta.firstTimestamp ? Date.parse(meta.firstTimestamp) : undefined;
  const subagents = await loadGrokSubagents(
    chosen,
    parentStartMs !== undefined && Number.isFinite(parentStartMs) ? parentStartMs : undefined,
  );
  const detail: SessionDetail = {
    ...meta,
    events,
    ...(subagents.length > 0
      ? { subagents, spawnedAgentCount: subagents.length }
      : {}),
  };
  lruSet(detailCache, chosen.dirPath, {
    detail,
    mtimeMs: chosen.mtimeMs,
    sizeBytes: chosen.sizeBytes,
  });
  // Keep list cache warm with the same parse.
  metaCache.set(chosen.dirPath, {
    meta: {
      ...meta,
      ...(subagents.length > 0 ? { spawnedAgentCount: subagents.length } : {}),
    },
    mtimeMs: chosen.mtimeMs,
    sizeBytes: chosen.sizeBytes,
  });
  return detail;
}

export function grokSessionLocalDay(meta: SessionMeta): string | undefined {
  if (!meta.firstTimestamp) return undefined;
  const ms = Date.parse(meta.firstTimestamp);
  return Number.isFinite(ms) ? toLocalDay(ms) : undefined;
}
