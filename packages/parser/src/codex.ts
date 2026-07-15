/**
 * Codex (OpenAI Codex CLI) transcript reader.
 *
 * Codex stores per-session "rollouts" at:
 *   ~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<ISO>-<sessionId>.jsonl
 *
 * Each line is a JSON object with a top-level `type` of:
 *   - "session_meta"  (id, cwd, model_provider, cli_version, ...)
 *   - "turn_context"  (cwd, model, sandbox_policy)
 *   - "event_msg"     (payload.type ∈ task_started, task_complete,
 *                      user_message, agent_message, token_count, ...)
 *   - "response_item" (payload.type ∈ message, reasoning, function_call,
 *                      function_call_output, image_generation_call)
 *
 * The reader emits the same SessionMeta / SessionDetail shapes as the
 * Claude Code parser so all downstream analytics, list pages, and detail
 * views work without branching on agent.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { toLocalDay } from "./analytics.js";
import { resolveProjectIdentity } from "./git-project.js";
import { isFrameworkInjectedUserInput } from "./user-input.js";
import type {
  ContentBlock,
  SessionDetail,
  SessionEvent,
  SessionMeta,
  SubagentRun,
  Usage,
} from "./types.js";

export const DEFAULT_CODEX_ROOT = path.join(os.homedir(), ".codex", "sessions");

const ROLLOUT_RE = /^rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-([0-9a-f-]+)\.jsonl$/;
/** Same idle threshold as Claude parser — keeps activeSegments comparable. */
const IDLE_GAP_MS = 3 * 60 * 1000;

type RolloutFile = {
  filePath: string;
  sessionId: string;
  mtimeMs: number;
  sizeBytes: number;
};

async function safeReaddir(p: string): Promise<string[]> {
  return fs.readdir(p).catch(() => [] as string[]);
}

async function listRolloutFiles(root: string): Promise<RolloutFile[]> {
  const out: RolloutFile[] = [];
  const years = await safeReaddir(root);
  for (const year of years) {
    if (!/^\d{4}$/.test(year)) continue;
    const yearDir = path.join(root, year);
    const months = await safeReaddir(yearDir);
    for (const month of months) {
      if (!/^\d{2}$/.test(month)) continue;
      const monthDir = path.join(yearDir, month);
      const days = await safeReaddir(monthDir);
      for (const day of days) {
        if (!/^\d{2}$/.test(day)) continue;
        const dayDir = path.join(monthDir, day);
        const entries = await safeReaddir(dayDir);
        for (const entry of entries) {
          const m = ROLLOUT_RE.exec(entry);
          if (!m) continue;
          const full = path.join(dayDir, entry);
          const stat = await fs.stat(full).catch(() => null);
          if (!stat) continue;
          out.push({
            filePath: full,
            sessionId: m[2],
            mtimeMs: stat.mtimeMs,
            sizeBytes: stat.size,
          });
        }
      }
    }
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
      // Skip malformed lines, same as the Claude reader.
    }
  }
  return out;
}

type Parsed = {
  meta: SessionMeta;
  events: SessionEvent[];
  threadSource?: string;
  rootSessionId?: string;
  parentThreadId?: string;
  agentNickname?: string;
  agentPath?: string;
};

function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function previewOf(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

function parseRollout(file: RolloutFile, lines: unknown[]): Parsed {
  const events: SessionEvent[] = [];
  let firstTimestamp: string | undefined;
  let lastTimestamp: string | undefined;
  let cwd: string | undefined;
  let model: string | undefined;
  const totalUsage = emptyUsage();
  let toolCallCount = 0;
  let turnCount = 0;
  let firstUserPreview: string | undefined;
  let lastUserPreview: string | undefined;
  let lastAgentPreview: string | undefined;
  const tsMs: number[] = [];
  let threadSource: string | undefined;
  let rootSessionId: string | undefined;
  let parentThreadId: string | undefined;
  let agentNickname: string | undefined;
  let agentPath: string | undefined;

  let idx = 0;
  for (const line of lines) {
    if (typeof line !== "object" || line === null) continue;
    const obj = line as Record<string, unknown>;
    const ts = typeof obj.timestamp === "string" ? obj.timestamp : undefined;
    if (ts) {
      if (!firstTimestamp) firstTimestamp = ts;
      lastTimestamp = ts;
      const ms = Date.parse(ts);
      if (Number.isFinite(ms)) tsMs.push(ms);
    }
    const type = typeof obj.type === "string" ? obj.type : "";
    const payload = (obj.payload ?? {}) as Record<string, unknown>;
    const subtype = typeof payload.type === "string" ? payload.type : "";

    if (type === "session_meta") {
      // Only the first session_meta line is authoritative for thread identity.
      // Codex can emit additional session_meta lines mid-file (compaction,
      // context reset) that carry the root thread's source — those must not
      // overwrite the original thread_source classification.
      if (typeof payload.cwd === "string") cwd = payload.cwd;
      if (threadSource === undefined && typeof payload.thread_source === "string") threadSource = payload.thread_source;
      if (rootSessionId === undefined && typeof payload.session_id === "string") rootSessionId = payload.session_id;
      if (parentThreadId === undefined && typeof payload.parent_thread_id === "string") parentThreadId = payload.parent_thread_id;
      if (agentNickname === undefined && typeof payload.agent_nickname === "string") agentNickname = payload.agent_nickname;
      if (agentPath === undefined && typeof payload.agent_path === "string") agentPath = payload.agent_path;
      continue;
    }
    if (type === "turn_context") {
      if (typeof payload.cwd === "string") cwd = payload.cwd;
      if (typeof payload.model === "string") model = payload.model;
      continue;
    }
    if (type === "event_msg" && subtype === "token_count") {
      const info = (payload.info ?? null) as Record<string, unknown> | null;
      const total = (info?.total_token_usage ?? null) as Record<string, unknown> | null;
      if (total) {
        totalUsage.input = numberOf(total.input_tokens) ?? totalUsage.input;
        totalUsage.output = numberOf(total.output_tokens) ?? totalUsage.output;
        totalUsage.cacheRead = numberOf(total.cached_input_tokens) ?? totalUsage.cacheRead;
        // Codex does not emit cache-creation tokens — cacheWrite stays 0.
      }
      continue;
    }
    if (type === "event_msg" && subtype === "user_message") {
      const text = typeof payload.message === "string" ? payload.message : "";
      const preview = previewOf(text);
      const isHidden = isFrameworkInjectedUserInput(text);
      if (text && !isHidden) {
        if (!firstUserPreview) firstUserPreview = preview;
        lastUserPreview = preview;
        turnCount += 1;
      }
      events.push({
        index: idx++,
        timestamp: ts,
        role: "user",
        rawType: "event_msg/user_message",
        preview,
        blocks: text ? [{ type: "text", text }] : [],
        raw: obj,
      });
      continue;
    }
    if (type === "event_msg" && subtype === "agent_message") {
      const text = typeof payload.message === "string" ? payload.message : "";
      const preview = previewOf(text);
      if (text) lastAgentPreview = preview;
      events.push({
        index: idx++,
        timestamp: ts,
        role: "agent",
        rawType: "event_msg/agent_message",
        preview,
        blocks: text ? [{ type: "text", text }] : [],
        model,
        raw: obj,
      });
      continue;
    }
    if (type === "response_item" && subtype === "reasoning") {
      const summary = (payload.summary ?? []) as Array<Record<string, unknown>>;
      const text = summary
        .map((s) => (typeof s.text === "string" ? s.text : ""))
        .join("\n")
        .trim();
      events.push({
        index: idx++,
        timestamp: ts,
        role: "agent-thinking",
        rawType: "response_item/reasoning",
        preview: previewOf(text),
        blocks: text ? [{ type: "thinking", thinking: text }] : [],
        model,
        raw: obj,
      });
      continue;
    }
    // Codex emits some assistant prose as response_item/message with
    // role="assistant"; other roles duplicate user_message or carry
    // developer instructions and stay as meta.
    if (type === "response_item" && subtype === "message" && payload.role === "assistant") {
      const items = (payload.content ?? []) as Array<Record<string, unknown>>;
      const text = items
        .map((c) => (typeof c.text === "string" ? c.text : ""))
        .join("\n")
        .trim();
      const preview = previewOf(text);
      if (text) lastAgentPreview = preview;
      events.push({
        index: idx++,
        timestamp: ts,
        role: "agent",
        rawType: "response_item/message",
        preview,
        blocks: text ? [{ type: "text", text }] : [],
        model,
        raw: obj,
      });
      continue;
    }
    if (type === "response_item" && subtype === "function_call") {
      const name = typeof payload.name === "string" ? payload.name : "(unknown)";
      const callId = typeof payload.call_id === "string" ? payload.call_id : undefined;
      const args = typeof payload.arguments === "string" ? payload.arguments : "";
      const input = safeParse(args);
      toolCallCount += 1;
      events.push({
        index: idx++,
        timestamp: ts,
        role: "tool-call",
        rawType: "response_item/function_call",
        preview: `${name}(${truncate(args, 80)})`,
        blocks: [{ type: "tool_use", id: callId ?? `codex-${idx}`, name, input }],
        toolName: name,
        toolUseId: callId,
        model,
        raw: obj,
      });
      continue;
    }
    if (type === "response_item" && subtype === "function_call_output") {
      const callId = typeof payload.call_id === "string" ? payload.call_id : undefined;
      const output = typeof payload.output === "string" ? payload.output : "";
      // Codex's exec_command prints its exit status as plain text in the
      // output ("Process exited with code 1\n..."); no structured field.
      const is_error = /process exited with code [1-9]/i.test(output);
      events.push({
        index: idx++,
        timestamp: ts,
        role: "tool-result",
        rawType: "response_item/function_call_output",
        preview: previewOf(output),
        blocks: [{ type: "tool_result", tool_use_id: callId ?? "", content: output, is_error }],
        toolUseId: callId,
        toolResult: output,
        raw: obj,
      });
      continue;
    }
    events.push({
      index: idx++,
      timestamp: ts,
      role: "meta",
      rawType: subtype ? `${type}/${subtype}` : type,
      preview: "",
      blocks: [],
      raw: obj,
    });
  }

  // Codex emits cumulative `total_token_usage` on every token_count event;
  // attribute the final cumulative to the last agent event so buildEntries'
  // per-msgId dedup picks it up once.
  if (totalUsage.input > 0 || totalUsage.output > 0) {
    let lastAgentIdx = -1;
    for (let i = events.length - 1; i >= 0; i--) {
      const r = events[i]!.role;
      if (r === "agent" || r === "agent-thinking" || r === "tool-call") {
        lastAgentIdx = i;
        break;
      }
    }
    if (lastAgentIdx >= 0) {
      const ev = events[lastAgentIdx]!;
      ev.messageId = `codex-${file.sessionId}-total`;
      ev.usage = {
        input: totalUsage.input,
        output: totalUsage.output,
        cacheRead: totalUsage.cacheRead,
        cacheWrite: 0,
      };
    }
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
  const projectName = project?.projectName ?? "(unknown)";
  // Codex's projectDir slot mirrors the encoded-cwd convention used by Claude
  // — it's never read from disk, so a synthetic encoding is fine.
  const projectDir = cwd ? cwd.replace(/^\//, "-").replace(/\//g, "-") : "(unknown)";

  const meta: SessionMeta = {
    agent: "codex",
    id: file.sessionId,
    filePath: file.filePath,
    projectName,
    worktreeName: project?.worktreeName,
    repoName: project?.repoName,
    projectDir,
    sessionId: file.sessionId,
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

  return { meta, events, threadSource, rootSessionId, parentThreadId, agentNickname, agentPath };
}

function numberOf(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function safeParse(s: string): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
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

type MetaEntry = {
  meta: SessionMeta;
  mtimeMs: number;
  sizeBytes: number;
  threadSource?: string;
  rootSessionId?: string;
  parentThreadId?: string;
  agentNickname?: string;
  agentPath?: string;
};
type DetailEntry = { detail: SessionDetail; mtimeMs: number; sizeBytes: number };
const metaCache = new Map<string, MetaEntry>();
const detailCache = new Map<string, DetailEntry>();

/** Drop all Codex caches. Wired into fs.ts's clearCaches() so test
 *  teardown and watcher invalidation hit every source uniformly. */
export function clearCodexCaches(): void {
  metaCache.clear();
  detailCache.clear();
}

type ScannedFile = {
  file: RolloutFile;
  meta: SessionMeta;
  threadSource?: string;
  rootSessionId?: string;
  parentThreadId?: string;
  agentNickname?: string;
  agentPath?: string;
};

/** Parse every rollout under root, populating the meta cache. Returns both
 *  root sessions and subagent threads so callers can filter/group as needed. */
async function scanAllCodex(root: string): Promise<ScannedFile[]> {
  const files = await listRolloutFiles(root);
  const out: ScannedFile[] = [];
  for (const file of files) {
    const cached = metaCache.get(file.filePath);
    if (cached && cached.mtimeMs === file.mtimeMs && cached.sizeBytes === file.sizeBytes) {
      out.push({
        file,
        meta: cached.meta,
        threadSource: cached.threadSource,
        rootSessionId: cached.rootSessionId,
        parentThreadId: cached.parentThreadId,
        agentNickname: cached.agentNickname,
        agentPath: cached.agentPath,
      });
      continue;
    }
    try {
      const lines = await readJsonl(file.filePath);
      const parsed = parseRollout(file, lines);
      metaCache.set(file.filePath, {
        meta: parsed.meta,
        mtimeMs: file.mtimeMs,
        sizeBytes: file.sizeBytes,
        threadSource: parsed.threadSource,
        rootSessionId: parsed.rootSessionId,
        parentThreadId: parsed.parentThreadId,
        agentNickname: parsed.agentNickname,
        agentPath: parsed.agentPath,
      });
      out.push({
        file,
        meta: parsed.meta,
        threadSource: parsed.threadSource,
        rootSessionId: parsed.rootSessionId,
        parentThreadId: parsed.parentThreadId,
        agentNickname: parsed.agentNickname,
        agentPath: parsed.agentPath,
      });
    } catch {
      // Skip files that fail to parse — keep listing the rest.
    }
  }
  return out;
}

/** Build a SubagentRun from a parsed subagent rollout's meta + thread info. */
function buildSubagentRun(
  entry: ScannedFile,
  parentStartMs: number | undefined,
): SubagentRun {
  const meta = entry.meta;
  const startMs = meta.firstTimestamp ? Date.parse(meta.firstTimestamp) : undefined;
  const endMs = meta.lastTimestamp ? Date.parse(meta.lastTimestamp) : undefined;
  const startOk = startMs !== undefined && Number.isFinite(startMs) ? startMs : undefined;
  const endOk = endMs !== undefined && Number.isFinite(endMs) ? endMs : undefined;

  return {
    agentId: meta.id,
    agentType: entry.agentNickname ?? entry.agentPath ?? "subagent",
    description: entry.agentPath ?? entry.agentNickname ?? meta.id,
    startMs: startOk,
    endMs: endOk,
    durationMs: meta.durationMs,
    startTOffsetMs:
      parentStartMs !== undefined && startOk !== undefined
        ? Math.max(0, startOk - parentStartMs)
        : undefined,
    endTOffsetMs:
      parentStartMs !== undefined && endOk !== undefined
        ? Math.max(0, endOk - parentStartMs)
        : undefined,
    eventCount: meta.eventCount,
    totalUsage: meta.totalUsage,
    model: meta.model,
    toolCallCount: meta.toolCallCount,
    finalPreview: meta.lastAgentPreview,
  };
}

export type ListCodexOptions = { root?: string; limit?: number };

export async function listCodexSessions(opts: ListCodexOptions = {}): Promise<SessionMeta[]> {
  const root = opts.root ?? DEFAULT_CODEX_ROOT;
  const all = await scanAllCodex(root);

  const subagentsByRoot = new Map<string, ScannedFile[]>();
  for (const entry of all) {
    if (entry.threadSource !== "subagent" || !entry.rootSessionId) continue;
    const list = subagentsByRoot.get(entry.rootSessionId);
    if (list) list.push(entry);
    else subagentsByRoot.set(entry.rootSessionId, [entry]);
  }

  const out: SessionMeta[] = [];
  for (const entry of all) {
    if (entry.threadSource === "subagent") continue;
    const children = subagentsByRoot.get(entry.meta.id);
    if (!children || children.length === 0) {
      out.push(entry.meta);
      continue;
    }
    const merged: SessionMeta = {
      ...entry.meta,
      spawnedAgentCount: children.length,
      totalUsage: {
        input: entry.meta.totalUsage.input + children.reduce((s, c) => s + c.meta.totalUsage.input, 0),
        output: entry.meta.totalUsage.output + children.reduce((s, c) => s + c.meta.totalUsage.output, 0),
        cacheRead: entry.meta.totalUsage.cacheRead + children.reduce((s, c) => s + c.meta.totalUsage.cacheRead, 0),
        cacheWrite: entry.meta.totalUsage.cacheWrite + children.reduce((s, c) => s + c.meta.totalUsage.cacheWrite, 0),
      },
      toolCallCount:
        (entry.meta.toolCallCount ?? 0) +
        children.reduce((s, c) => s + (c.meta.toolCallCount ?? 0), 0),
    };
    for (const c of children) {
      if (c.meta.lastTimestamp && (!merged.lastTimestamp || c.meta.lastTimestamp > merged.lastTimestamp)) {
        merged.lastTimestamp = c.meta.lastTimestamp;
      }
    }
    out.push(merged);
  }

  out.sort((a, b) => (b.firstTimestamp ?? "").localeCompare(a.firstTimestamp ?? ""));
  if (opts.limit !== undefined) return out.slice(0, opts.limit);
  return out;
}

export type GetCodexOptions = { root?: string };

export async function getCodexSession(
  id: string,
  opts: GetCodexOptions = {},
): Promise<SessionDetail | null> {
  const root = opts.root ?? DEFAULT_CODEX_ROOT;
  const all = await scanAllCodex(root);

  const rootEntry = all.find((a) => a.meta.id === id && a.threadSource !== "subagent");

  // Backward compat: a subagent thread id matched directly (old bookmark).
  // Return it as a standalone SessionDetail without parent grouping.
  if (!rootEntry) {
    const direct = all.find((a) => a.meta.id === id);
    if (!direct) return null;
    const cached = detailCache.get(direct.file.filePath);
    if (cached && cached.mtimeMs === direct.file.mtimeMs && cached.sizeBytes === direct.file.sizeBytes) {
      return cached.detail;
    }
    const lines = await readJsonl(direct.file.filePath);
    const { meta, events } = parseRollout(direct.file, lines);
    const detail: SessionDetail = { ...meta, events };
    detailCache.set(direct.file.filePath, {
      detail,
      mtimeMs: direct.file.mtimeMs,
      sizeBytes: direct.file.sizeBytes,
    });
    return detail;
  }

  const file = rootEntry.file;
  const cached = detailCache.get(file.filePath);
  if (cached && cached.mtimeMs === file.mtimeMs && cached.sizeBytes === file.sizeBytes) {
    return cached.detail;
  }

  const lines = await readJsonl(file.filePath);
  const { meta, events } = parseRollout(file, lines);

  const children = all.filter(
    (a) => a.threadSource === "subagent" && a.rootSessionId === id,
  );
  const parentStartMs = meta.firstTimestamp ? Date.parse(meta.firstTimestamp) : undefined;
  const subagents = children
    .map((c) => buildSubagentRun(c, parentStartMs))
    .sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));

  const detail: SessionDetail = {
    ...meta,
    events,
    ...(subagents.length > 0 ? { subagents, spawnedAgentCount: subagents.length } : {}),
  };

  detailCache.set(file.filePath, {
    detail,
    mtimeMs: file.mtimeMs,
    sizeBytes: file.sizeBytes,
  });
  return detail;
}

/**
 * Offline/debug: read the *latest* Codex rollout's most recent `token_count`
 * event and extract rate-limit windows. The daemon does **not** use this for
 * live plan utilization — that polls ChatGPT's WHAM usage API (see
 * `packages/cli/src/usage/codex.ts`, same path as OpenUsage) so weekly resets
 * show up without a new Codex turn. Rollout rate_limits only update after a
 * turn and can stick at a pre-reset % for days.
 *
 * Codex stores windows in every token_count event's
 * `rate_limits.{primary,secondary}`. The slots are not stable: after the
 * 5-hour limit was removed, a weekly-only response puts the 7-day window in
 * `primary` and leaves `secondary` null. Classify by `window_minutes`, then
 * fall back to the old slot order for legacy payloads.
 *
 * Returns null when no Codex sessions exist yet, when no rollout has a
 * usable token_count.rate_limits payload, or when every rate_limits shell
 * is empty (e.g. limit_id "premium" with null primary/secondary — common
 * on short Desktop turns). Empty shells are skipped so a newer Desktop
 * session does not blank usage that an older CLI rollout still holds.
 */
export type CodexUsageWindows = {
  /** 5h window — null utilization when the account has no 5h limit */
  five_hour: { utilization: number | null; resets_at: string | null };
  /** 7d window — the current Codex weekly limit */
  seven_day: { utilization: number | null; resets_at: string | null };
  /** Plan label as Codex reports it ("plus", "pro", "free", …) */
  plan_type: string | null;
  /** Path of the rollout we read from — useful for daemon logs */
  source_path: string;
};

/**
 * Some Codex clients (Desktop alpha, SDK) emit token_count.rate_limits with
 * limit_id "premium" (or a mid-session empty "codex" shell) where primary and
 * secondary are both null. Those share the envelope but carry no 5h/7d
 * windows — treating them as authoritative blanks the menubar/usage UI.
 */
function hasUsableRateLimitWindows(
  primary: Record<string, unknown> | null,
  secondary: Record<string, unknown> | null,
): boolean {
  return (
    numberOf(primary?.used_percent) !== undefined ||
    numberOf(secondary?.used_percent) !== undefined
  );
}

const FIVE_HOUR_WINDOW_MINUTES = 5 * 60;
const SEVEN_DAY_WINDOW_MINUTES = 7 * 24 * 60;

type CodexUsageWindow = {
  utilization: number | null;
  resets_at: string | null;
};

function normalizeCodexWindow(
  raw: Record<string, unknown> | null,
  nowMs: number,
): CodexUsageWindow {
  const usedPercent = numberOf(raw?.used_percent);
  const resetUnix = numberOf(raw?.resets_at);
  const expired = resetUnix !== undefined && nowMs > resetUnix * 1000;
  return {
    utilization:
      usedPercent === undefined ? null : expired ? 0 : usedPercent,
    resets_at: resetUnix !== undefined ? new Date(resetUnix * 1000).toISOString() : null,
  };
}

export async function getLatestCodexUsage(
  opts: { root?: string } = {},
): Promise<CodexUsageWindows | null> {
  const root = opts.root ?? DEFAULT_CODEX_ROOT;
  const files = await listRolloutFiles(root);
  if (files.length === 0) return null;
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const file of files) {
    const lines = await readJsonl(file.filePath);
    // Walk backwards for the newest *usable* token_count event.
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (typeof line !== "object" || line === null) continue;
      const obj = line as Record<string, unknown>;
      if (obj.type !== "event_msg") continue;
      const payload = (obj.payload ?? {}) as Record<string, unknown>;
      if (payload.type !== "token_count") continue;
      const rl = (payload.rate_limits ?? null) as Record<string, unknown> | null;
      if (!rl) continue;
      const primary = (rl.primary ?? null) as Record<string, unknown> | null;
      const secondary = (rl.secondary ?? null) as Record<string, unknown> | null;
      // Skip empty premium / null-window shells; keep scanning older events
      // and older rollouts until we find real 5h/7d numbers.
      if (!hasUsableRateLimitWindows(primary, secondary)) continue;
      const planType =
        typeof rl.plan_type === "string" ? (rl.plan_type as string) : null;
      const nowMs = Date.now();
      let fiveHour: CodexUsageWindow | null = null;
      let sevenDay: CodexUsageWindow | null = null;

      // `primary`/`secondary` are response slots, not semantic names. The
      // window length is the stable contract across the weekly-only rollout
      // and the older two-window payload.
      for (const candidate of [primary, secondary]) {
        if (!candidate) continue;
        const windowMinutes = numberOf(candidate.window_minutes);
        if (windowMinutes === FIVE_HOUR_WINDOW_MINUTES) {
          fiveHour = normalizeCodexWindow(candidate, nowMs);
        } else if (windowMinutes === SEVEN_DAY_WINDOW_MINUTES) {
          sevenDay = normalizeCodexWindow(candidate, nowMs);
        }
      }

      const unknownWindows = [primary, secondary].filter(
        (candidate) => candidate !== null && numberOf(candidate.window_minutes) === undefined,
      );

      // Older Codex payloads did not always include window_minutes. Preserve
      // their positional meaning rather than dropping historical usage.
      if (!fiveHour && !sevenDay) {
        fiveHour = primary ? normalizeCodexWindow(primary, nowMs) : null;
        sevenDay = secondary ? normalizeCodexWindow(secondary, nowMs) : null;
      } else if (unknownWindows.length === 1) {
        // Transitional payloads can label one slot before the other. Infer
        // only the missing semantic window; never remap a weekly-only primary.
        const inferred = normalizeCodexWindow(unknownWindows[0]!, nowMs);
        if (!fiveHour) fiveHour = inferred;
        else if (!sevenDay) sevenDay = inferred;
      }

      return {
        five_hour: fiveHour ?? { utilization: null, resets_at: null },
        seven_day: sevenDay ?? { utilization: null, resets_at: null },
        plan_type: planType,
        source_path: file.filePath,
      };
    }
  }
  return null;
}

export function codexSessionLocalDay(meta: SessionMeta): string | undefined {
  if (!meta.firstTimestamp) return undefined;
  const ms = Date.parse(meta.firstTimestamp);
  return Number.isFinite(ms) ? toLocalDay(ms) : undefined;
}
