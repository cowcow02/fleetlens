/**
 * Gemini CLI transcript reader.
 *
 * Gemini CLI persists per-session transcripts at:
 *   ~/.gemini/tmp/<project-slug>/chats/session-<YYYY-MM-DDTHH-MM>-<id8>.jsonl
 *
 * Slug → absolute cwd is recoverable from ~/.gemini/projects.json.
 *
 * File layout (current main of google-gemini/gemini-cli):
 *   line 1: PartialMetadataRecord     { sessionId, projectHash, startTime, ... }
 *   line N: MessageRecord             { id, timestamp, type, content, toolCalls?, tokens?, model? }
 *           OR { $rewindTo: <messageId> }   — drop this id and everything after it
 *           OR { $set: <metadata patch> }   — merge into the metadata
 *
 * Multi-write semantics: the same MessageRecord.id can appear multiple
 * times as tool-call status progresses (scheduled → executing → success)
 * or as tokens get attached at end-of-turn. Last write wins on replay.
 *
 * Legacy fallback: a few releases ago Gemini CLI wrote a single
 * pretty-printed JSON object (`*.json`) with the full ConversationRecord;
 * on resume that's converted to JSONL. Detect by JSON.parse-ing the whole
 * file.
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

export const DEFAULT_GEMINI_ROOT = path.join(os.homedir(), ".gemini", "tmp");
const GEMINI_PROJECTS_FILE = path.join(os.homedir(), ".gemini", "projects.json");

const SESSION_FILE_RE = /^session-.+\.(jsonl|json)$/;
/** Same idle threshold as the Claude / Codex parsers. */
const IDLE_GAP_MS = 3 * 60 * 1000;

type SessionFile = {
  filePath: string;
  /** Slug = parent dir of `chats/`. Maps back to absolute cwd via projects.json. */
  slug: string;
  /** Filename id8 — only used as a fallback when metadata `sessionId` is missing. */
  filenameId: string;
  /** Discriminator for the parser — JSONL append-only vs single JSON blob. */
  format: "jsonl" | "legacy-json";
  mtimeMs: number;
  sizeBytes: number;
};

async function safeReaddir(p: string): Promise<string[]> {
  return fs.readdir(p).catch(() => [] as string[]);
}

async function listSessionFiles(root: string): Promise<SessionFile[]> {
  const out: SessionFile[] = [];
  const slugs = await safeReaddir(root);
  for (const slug of slugs) {
    const chatsDir = path.join(root, slug, "chats");
    const entries = await safeReaddir(chatsDir);
    for (const entry of entries) {
      if (!SESSION_FILE_RE.test(entry)) continue;
      const full = path.join(chatsDir, entry);
      const stat = await fs.stat(full).catch(() => null);
      // Skip nested subagent dirs — those live at chats/<parentSessionId>/<subagent>.jsonl.
      if (!stat || !stat.isFile()) continue;
      const filenameId = entry.replace(/\.(jsonl|json)$/, "").split("-").pop() ?? entry;
      out.push({
        filePath: full,
        slug,
        filenameId,
        format: entry.endsWith(".jsonl") ? "jsonl" : "legacy-json",
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
      });
    }
  }
  return out;
}

/* ================================================================= */
/*  Slug → cwd                                                       */
/* ================================================================= */

type ProjectsRegistry = { projects?: Record<string, string> };
let projectsCache: { mtimeMs: number; slugToCwd: Map<string, string> } | null = null;

async function loadSlugToCwd(): Promise<Map<string, string>> {
  const stat = await fs.stat(GEMINI_PROJECTS_FILE).catch(() => null);
  if (!stat) return new Map();
  if (projectsCache && projectsCache.mtimeMs === stat.mtimeMs) {
    return projectsCache.slugToCwd;
  }
  const raw = await fs.readFile(GEMINI_PROJECTS_FILE, "utf8").catch(() => "");
  let parsed: ProjectsRegistry;
  try {
    parsed = JSON.parse(raw) as ProjectsRegistry;
  } catch {
    parsed = {};
  }
  const slugToCwd = new Map<string, string>();
  for (const [cwd, slug] of Object.entries(parsed.projects ?? {})) {
    if (typeof slug === "string") slugToCwd.set(slug, cwd);
  }
  projectsCache = { mtimeMs: stat.mtimeMs, slugToCwd };
  return slugToCwd;
}

/* ================================================================= */
/*  Gemini wire-format types (subset we need to parse)               */
/* ================================================================= */

type GeminiPart =
  | { text?: string }
  | { inlineData?: { mimeType?: string; data?: string } }
  | { functionCall?: { name?: string; args?: unknown } }
  | { functionResponse?: { name?: string; response?: unknown } }
  | Record<string, unknown>;

type GeminiContent = string | GeminiPart | GeminiPart[];

type ToolCallRecord = {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  result?: GeminiContent | null;
  status?: string;
  timestamp?: string;
  agentId?: string;
  displayName?: string;
};

type TokensSummary = {
  input?: number;
  output?: number;
  cached?: number;
  thoughts?: number;
  tool?: number;
  total?: number;
};

type MessageRecord = {
  id: string;
  timestamp?: string;
  type?: "user" | "gemini" | "info" | "error" | "warning";
  content?: GeminiContent;
  displayContent?: GeminiContent;
  toolCalls?: ToolCallRecord[];
  thoughts?: Array<{ subject?: string; description?: string; timestamp?: string }>;
  tokens?: TokensSummary | null;
  model?: string;
};

type MetadataRecord = {
  sessionId?: string;
  projectHash?: string;
  startTime?: string;
  lastUpdated?: string;
  summary?: string;
  directories?: string[];
  kind?: "main" | "subagent";
};

type RewindMarker = { $rewindTo: string };
type SetMarker = { $set: Record<string, unknown> };

function isRewindMarker(o: unknown): o is RewindMarker {
  return !!o && typeof o === "object" && "$rewindTo" in (o as object);
}
function isSetMarker(o: unknown): o is SetMarker {
  return !!o && typeof o === "object" && "$set" in (o as object);
}
function isMessageRecord(o: unknown): o is MessageRecord {
  return (
    !!o &&
    typeof o === "object" &&
    typeof (o as Record<string, unknown>).id === "string" &&
    typeof (o as Record<string, unknown>).type === "string"
  );
}

/* ================================================================= */
/*  File reading + replay                                            */
/* ================================================================= */

type ReplayResult = {
  meta: MetadataRecord;
  /** Resolved messages in insertion order, after applying $set / $rewindTo / id-replace. */
  messages: MessageRecord[];
};

async function readAndReplay(file: SessionFile): Promise<ReplayResult> {
  const raw = await fs.readFile(file.filePath, "utf8");

  if (file.format === "legacy-json") {
    let blob: Record<string, unknown>;
    try {
      blob = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { meta: {}, messages: [] };
    }
    const meta: MetadataRecord = {
      sessionId: typeof blob.sessionId === "string" ? blob.sessionId : undefined,
      projectHash: typeof blob.projectHash === "string" ? blob.projectHash : undefined,
      startTime: typeof blob.startTime === "string" ? blob.startTime : undefined,
      lastUpdated: typeof blob.lastUpdated === "string" ? blob.lastUpdated : undefined,
      summary: typeof blob.summary === "string" ? blob.summary : undefined,
    };
    const msgs = Array.isArray(blob.messages) ? (blob.messages as unknown[]) : [];
    const messages = msgs.filter(isMessageRecord);
    return { meta, messages };
  }

  const meta: MetadataRecord = {};
  const byId = new Map<string, MessageRecord>();
  const order: string[] = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      // Same posture as Gemini CLI's own reader: skip malformed lines.
      continue;
    }

    if (isRewindMarker(obj)) {
      const target = obj.$rewindTo;
      const idx = order.indexOf(target);
      if (idx >= 0) {
        for (const id of order.slice(idx)) byId.delete(id);
        order.length = idx;
      }
      continue;
    }
    if (isSetMarker(obj)) {
      Object.assign(meta, obj.$set);
      continue;
    }
    if (isMessageRecord(obj)) {
      if (!byId.has(obj.id)) order.push(obj.id);
      byId.set(obj.id, obj);
      continue;
    }
    // First-line metadata. Only the first non-message, non-marker line is
    // treated as bulk metadata; later stray records get folded via $set.
    if (typeof obj === "object" && obj !== null) {
      const m = obj as Record<string, unknown>;
      if (typeof m.sessionId === "string" && !meta.sessionId) {
        meta.sessionId = m.sessionId;
        if (typeof m.projectHash === "string") meta.projectHash = m.projectHash;
        if (typeof m.startTime === "string") meta.startTime = m.startTime;
        if (typeof m.lastUpdated === "string") meta.lastUpdated = m.lastUpdated;
        if (typeof m.summary === "string") meta.summary = m.summary;
      }
    }
  }

  const messages: MessageRecord[] = [];
  for (const id of order) {
    const m = byId.get(id);
    if (m) messages.push(m);
  }
  return { meta, messages };
}

/* ================================================================= */
/*  MessageRecord → SessionEvent                                     */
/* ================================================================= */

function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function previewOf(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

function flattenContent(c: GeminiContent | undefined | null): string {
  if (!c) return "";
  if (typeof c === "string") return c;
  const parts = Array.isArray(c) ? c : [c];
  const out: string[] = [];
  for (const p of parts) {
    if (!p || typeof p !== "object") continue;
    const part = p as Record<string, unknown>;
    if (typeof part.text === "string") {
      out.push(part.text);
      continue;
    }
    const fr = part.functionResponse as { response?: unknown } | undefined;
    if (fr) {
      // Gemini's tool-result envelope: every native tool wraps its payload
      // as `functionResponse.response.{output|error}`. The string-typed
      // direct case happens too for some MCP tools.
      const resp = fr.response;
      if (typeof resp === "string") {
        out.push(resp);
      } else if (resp && typeof resp === "object") {
        const r = resp as Record<string, unknown>;
        if (typeof r.output === "string") out.push(r.output);
        else if (typeof r.error === "string") out.push(`error: ${r.error}`);
        else out.push(JSON.stringify(r));
      }
    }
    // inlineData (images), functionCall payloads, etc. are non-text — skip.
  }
  return out.join("\n");
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

type ParsedSession = {
  meta: SessionMeta;
  events: SessionEvent[];
};

async function parseSession(file: SessionFile): Promise<ParsedSession> {
  const { meta: metaRec, messages } = await readAndReplay(file);
  const slugToCwd = await loadSlugToCwd();
  const cwd = slugToCwd.get(file.slug);

  const events: SessionEvent[] = [];
  const totalUsage = emptyUsage();
  // Anchor the session window on conversational events only. Gemini CLI
  // logs login/OAuth as a stream of `info` records *before* the first
  // user message, and metadata.startTime is the file-creation moment
  // — neither should widen the session bar or get counted as agent time.
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

  for (const msg of messages) {
    const ts = msg.timestamp;

    if (msg.type === "user") {
      const text = flattenContent(msg.displayContent ?? msg.content);
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
        rawType: "gemini/user",
        preview,
        blocks: text ? [{ type: "text", text }] : [],
        messageId: msg.id,
        raw: msg,
      });
      continue;
    }

    if (msg.type === "gemini") {
      if (typeof msg.model === "string") model = msg.model;
      const text = flattenContent(msg.content);
      const preview = previewOf(text);
      if (text) lastAgentPreview = preview;

      // Sum token usage on the gemini message; Gemini reports cumulative
      // per-turn tokens, so summing across messages is the session total.
      let usage: Usage | undefined;
      if (msg.tokens) {
        const t = msg.tokens;
        const u: Usage = {
          input: t.input ?? 0,
          output: t.output ?? 0,
          cacheRead: t.cached ?? 0,
          cacheWrite: 0,
        };
        usage = u;
        totalUsage.input += u.input;
        totalUsage.output += u.output;
        totalUsage.cacheRead += u.cacheRead;
      }

      // Thinking / scratchpad first — Gemini stamps thoughts with their
      // own timestamps, which precede the final reply by a few seconds.
      // Emitting them before the agent text keeps event order monotonic.
      for (const th of msg.thoughts ?? []) {
        const thText = [th.subject, th.description].filter(Boolean).join(": ");
        if (!thText) continue;
        pushEvent({
          index: idx++,
          timestamp: th.timestamp ?? ts,
          role: "agent-thinking",
          rawType: "gemini/thought",
          preview: previewOf(thText),
          blocks: [{ type: "thinking", thinking: thText }],
          model,
          raw: th,
        });
      }

      if (text) {
        pushEvent({
          index: idx++,
          timestamp: ts,
          role: "agent",
          rawType: "gemini/agent",
          preview,
          blocks: [{ type: "text", text }],
          messageId: msg.id,
          model,
          usage,
          raw: msg,
        });
      } else if (usage) {
        // No prose but tokens were attached — still need to surface the
        // token count somewhere or the totals get lost.
        pushEvent({
          index: idx++,
          timestamp: ts,
          role: "agent",
          rawType: "gemini/agent",
          preview: "",
          blocks: [],
          messageId: msg.id,
          model,
          usage,
          raw: msg,
        });
      }

      // Tool calls — flatten to separate tool-call + tool-result events for
      // parity with the Claude/Codex shape.
      for (const tc of msg.toolCalls ?? []) {
        toolCallCount += 1;
        const argsStr = tc.args ? JSON.stringify(tc.args) : "";
        pushEvent({
          index: idx++,
          timestamp: tc.timestamp ?? ts,
          role: "tool-call",
          rawType: "gemini/tool_call",
          preview: `${tc.name}(${truncate(argsStr, 80)})`,
          blocks: [{ type: "tool_use", id: tc.id, name: tc.name, input: tc.args ?? {} }],
          toolName: tc.name,
          toolUseId: tc.id,
          model,
          raw: tc,
        });
        // Only emit a tool-result when the tool reached a terminal state.
        // `scheduled` / `executing` records have no result yet — they were
        // overwritten by the final status at replay time.
        const status = (tc.status ?? "").toLowerCase();
        const isTerminal = status === "success" || status === "error" || status === "cancelled";
        if (isTerminal) {
          const resultText = flattenContent(tc.result);
          pushEvent({
            index: idx++,
            timestamp: tc.timestamp ?? ts,
            role: "tool-result",
            rawType: "gemini/tool_result",
            preview: previewOf(resultText),
            blocks: [
              {
                type: "tool_result",
                tool_use_id: tc.id,
                content: resultText,
                is_error: status === "error" || status === "cancelled",
              },
            ],
            toolUseId: tc.id,
            toolResult: resultText,
            raw: tc,
          });
        }
      }
      continue;
    }

    if (msg.type === "info" || msg.type === "warning" || msg.type === "error") {
      const text = flattenContent(msg.content);
      pushEvent({
        index: idx++,
        timestamp: ts,
        role: "meta",
        rawType: `gemini/${msg.type}`,
        preview: previewOf(text),
        blocks: text ? [{ type: "text", text }] : [],
        raw: msg,
      });
      continue;
    }
  }

  // Compute tOffsetMs / gapMs against the resolved start.
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

  const sessionId = metaRec.sessionId ?? file.filenameId;
  const project = cwd ? resolveProjectIdentity(cwd) : undefined;
  const projectName = project?.projectName ?? file.slug;
  const projectDir = cwd
    ? cwd.replace(/^\//, "-").replace(/\//g, "-")
    : file.slug;

  const meta: SessionMeta = {
    agent: "gemini",
    id: sessionId,
    filePath: file.filePath,
    projectName,
    worktreeName: project?.worktreeName,
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

type MetaEntry = { meta: SessionMeta; mtimeMs: number; sizeBytes: number };
type DetailEntry = { detail: SessionDetail; mtimeMs: number; sizeBytes: number };
const metaCache = new Map<string, MetaEntry>();
const detailCache = new Map<string, DetailEntry>();

export function clearGeminiCaches(): void {
  metaCache.clear();
  detailCache.clear();
  projectsCache = null;
}

export type ListGeminiOptions = { root?: string; limit?: number };

export async function listGeminiSessions(opts: ListGeminiOptions = {}): Promise<SessionMeta[]> {
  const root = opts.root ?? DEFAULT_GEMINI_ROOT;
  const files = await listSessionFiles(root);
  const out: SessionMeta[] = [];
  for (const file of files) {
    const cached = metaCache.get(file.filePath);
    if (cached && cached.mtimeMs === file.mtimeMs && cached.sizeBytes === file.sizeBytes) {
      out.push(cached.meta);
      continue;
    }
    try {
      const { meta } = await parseSession(file);
      metaCache.set(file.filePath, {
        meta,
        mtimeMs: file.mtimeMs,
        sizeBytes: file.sizeBytes,
      });
      out.push(meta);
    } catch {
      // Skip files that fail to parse.
    }
  }
  out.sort((a, b) => (b.firstTimestamp ?? "").localeCompare(a.firstTimestamp ?? ""));
  if (opts.limit !== undefined) return out.slice(0, opts.limit);
  return out;
}

export type GetGeminiOptions = { root?: string };

export async function getGeminiSession(
  id: string,
  opts: GetGeminiOptions = {},
): Promise<SessionDetail | null> {
  const root = opts.root ?? DEFAULT_GEMINI_ROOT;
  const files = await listSessionFiles(root);
  // Match against `metaRec.sessionId` (resolved at parse time) primarily,
  // with a secondary fallback to the filename id8 fragment for files that
  // never committed a metadata line.
  let chosen: SessionFile | undefined;
  for (const file of files) {
    if (file.filenameId === id || id.startsWith(file.filenameId)) {
      chosen = file;
      break;
    }
  }
  if (!chosen) {
    // Last resort: parse every file to find a matching resolved sessionId.
    for (const file of files) {
      const { meta } = await parseSession(file).catch(() => ({ meta: { id: "" } as SessionMeta }));
      if (meta.id === id) {
        chosen = file;
        break;
      }
    }
  }
  if (!chosen) return null;
  const cached = detailCache.get(chosen.filePath);
  if (cached && cached.mtimeMs === chosen.mtimeMs && cached.sizeBytes === chosen.sizeBytes) {
    return cached.detail;
  }
  const { meta, events } = await parseSession(chosen);
  const detail: SessionDetail = { ...meta, events };
  detailCache.set(chosen.filePath, {
    detail,
    mtimeMs: chosen.mtimeMs,
    sizeBytes: chosen.sizeBytes,
  });
  return detail;
}

export function geminiSessionLocalDay(meta: SessionMeta): string | undefined {
  if (!meta.firstTimestamp) return undefined;
  const ms = Date.parse(meta.firstTimestamp);
  return Number.isFinite(ms) ? toLocalDay(ms) : undefined;
}
