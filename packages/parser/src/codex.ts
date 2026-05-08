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
import { canonicalProjectName, toLocalDay } from "./analytics.js";
import { isFrameworkInjectedUserInput } from "./user-input.js";
import type {
  ContentBlock,
  SessionDetail,
  SessionEvent,
  SessionMeta,
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
      if (typeof payload.cwd === "string") cwd = payload.cwd;
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

  const projectName = cwd ? canonicalProjectName(cwd) : "(unknown)";
  // Codex's projectDir slot mirrors the encoded-cwd convention used by Claude
  // — it's never read from disk, so a synthetic encoding is fine.
  const projectDir = cwd ? cwd.replace(/^\//, "-").replace(/\//g, "-") : "(unknown)";

  const meta: SessionMeta = {
    agent: "codex",
    id: file.sessionId,
    filePath: file.filePath,
    projectName,
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

  return { meta, events };
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

type MetaEntry = { meta: SessionMeta; mtimeMs: number; sizeBytes: number };
type DetailEntry = { detail: SessionDetail; mtimeMs: number; sizeBytes: number };
const metaCache = new Map<string, MetaEntry>();
const detailCache = new Map<string, DetailEntry>();

/** Drop all Codex caches. Wired into fs.ts's clearCaches() so test
 *  teardown and watcher invalidation hit every source uniformly. */
export function clearCodexCaches(): void {
  metaCache.clear();
  detailCache.clear();
}

export type ListCodexOptions = { root?: string; limit?: number };

export async function listCodexSessions(opts: ListCodexOptions = {}): Promise<SessionMeta[]> {
  const root = opts.root ?? DEFAULT_CODEX_ROOT;
  const files = await listRolloutFiles(root);
  const out: SessionMeta[] = [];
  for (const file of files) {
    const cached = metaCache.get(file.filePath);
    if (cached && cached.mtimeMs === file.mtimeMs && cached.sizeBytes === file.sizeBytes) {
      out.push(cached.meta);
      continue;
    }
    try {
      const lines = await readJsonl(file.filePath);
      const { meta } = parseRollout(file, lines);
      metaCache.set(file.filePath, {
        meta,
        mtimeMs: file.mtimeMs,
        sizeBytes: file.sizeBytes,
      });
      out.push(meta);
    } catch {
      // Skip files that fail to parse — keep listing the rest.
    }
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
  // Find the file by walking the tree — sessions are sparse, this is fast.
  const files = await listRolloutFiles(root);
  const file = files.find((f) => f.sessionId === id);
  if (!file) return null;
  const cached = detailCache.get(file.filePath);
  if (cached && cached.mtimeMs === file.mtimeMs && cached.sizeBytes === file.sizeBytes) {
    return cached.detail;
  }
  const lines = await readJsonl(file.filePath);
  const { meta, events } = parseRollout(file, lines);
  const detail: SessionDetail = { ...meta, events };
  detailCache.set(file.filePath, {
    detail,
    mtimeMs: file.mtimeMs,
    sizeBytes: file.sizeBytes,
  });
  return detail;
}

/**
 * Read the *latest* Codex rollout's most recent `token_count` event and
 * extract the rate-limit windows. Codex stores these in every token_count
 * event's `rate_limits.{primary,secondary}` — primary is the 5h window
 * (window_minutes=300), secondary is the 7d window (window_minutes=10080).
 *
 * Returns null when no Codex sessions exist yet, or when the latest
 * rollout never reached a token_count event (e.g. a freshly-started
 * session that hasn't logged usage yet).
 */
export type CodexUsageWindows = {
  /** 5h window — `rate_limits.primary` */
  five_hour: { utilization: number | null; resets_at: string | null };
  /** 7d window — `rate_limits.secondary` */
  seven_day: { utilization: number | null; resets_at: string | null };
  /** Plan label as Codex reports it ("plus", "pro", "free", …) */
  plan_type: string | null;
  /** Path of the rollout we read from — useful for daemon logs */
  source_path: string;
};

export async function getLatestCodexUsage(
  opts: { root?: string } = {},
): Promise<CodexUsageWindows | null> {
  const root = opts.root ?? DEFAULT_CODEX_ROOT;
  const files = await listRolloutFiles(root);
  if (files.length === 0) return null;
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const file of files) {
    const lines = await readJsonl(file.filePath);
    // Walk backwards for the newest token_count event.
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
      const fivePct = numberOf(primary?.used_percent);
      const sevenPct = numberOf(secondary?.used_percent);
      const fiveResetUnix = numberOf(primary?.resets_at);
      const sevenResetUnix = numberOf(secondary?.resets_at);
      const planType =
        typeof rl.plan_type === "string" ? (rl.plan_type as string) : null;
      return {
        five_hour: {
          utilization: fivePct ?? null,
          resets_at:
            fiveResetUnix !== undefined ? new Date(fiveResetUnix * 1000).toISOString() : null,
        },
        seven_day: {
          utilization: sevenPct ?? null,
          resets_at:
            sevenResetUnix !== undefined
              ? new Date(sevenResetUnix * 1000).toISOString()
              : null,
        },
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
