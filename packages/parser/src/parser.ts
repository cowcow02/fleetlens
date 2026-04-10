/**
 * Parses a single Claude Code JSONL transcript into the SessionEvent model.
 *
 * Pure — no fs, no network. Takes already-JSON-parsed lines and produces
 * an ordered array of events plus aggregate metadata.
 */

import type { ContentBlock, EventRole, SessionEvent, SessionMeta, Usage } from "./types.js";

const BLANK_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function truncate(s: string, n = 200): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}

function extractUsage(u: unknown): Usage | undefined {
  if (!u || typeof u !== "object") return undefined;
  const r = u as Record<string, unknown>;
  const toNum = (v: unknown) => (typeof v === "number" ? v : 0);
  return {
    input: toNum(r.input_tokens),
    output: toNum(r.output_tokens),
    cacheRead: toNum(r.cache_read_input_tokens),
    cacheWrite: toNum(r.cache_creation_input_tokens),
  };
}

/** Map a raw JSONL line to a SessionEvent (minus offsets, filled later). */
function toEvent(raw: unknown, index: number): SessionEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const rawType = String(r.type ?? "");
  const uuid = r.uuid as string | undefined;
  const parentUuid = (r.parentUuid as string | null | undefined) ?? null;
  const timestamp = r.timestamp as string | undefined;

  // --- assistant (agent) ---
  if (rawType === "assistant") {
    const msg = (r.message ?? {}) as Record<string, unknown>;
    const content = (msg.content as ContentBlock[]) ?? [];
    const usage = extractUsage(msg.usage);
    const model = msg.model as string | undefined;
    const requestId = r.requestId as string | undefined;
    const messageId = msg.id as string | undefined;
    const stopReason = msg.stop_reason as string | undefined;

    const first = content[0];
    let role: EventRole = "agent";
    let preview = "";
    let toolName: string | undefined;
    let toolUseId: string | undefined;

    if (first?.type === "thinking") {
      role = "agent-thinking";
      preview = "[thinking] " + truncate(first.thinking, 140);
    } else if (first?.type === "tool_use") {
      role = "tool-call";
      toolName = first.name;
      toolUseId = first.id;
      preview = `${first.name} ` + truncate(JSON.stringify(first.input ?? {}), 100);
    } else if (first?.type === "text") {
      preview = truncate(first.text, 200);
    } else {
      preview = `<assistant:${first?.type ?? "empty"}>`;
    }

    return {
      index,
      uuid,
      parentUuid,
      timestamp,
      role,
      rawType,
      preview,
      blocks: content,
      usage,
      model,
      requestId,
      messageId,
      stopReason,
      toolName,
      toolUseId,
      raw,
    };
  }

  // --- user (text OR tool_result) ---
  if (rawType === "user") {
    const msg = (r.message ?? {}) as Record<string, unknown>;
    const c = msg.content;

    if (typeof c === "string") {
      return {
        index,
        uuid,
        parentUuid,
        timestamp,
        role: "user",
        rawType,
        preview: truncate(c, 200),
        blocks: [{ type: "text", text: c }],
        raw,
      };
    }

    if (Array.isArray(c)) {
      const first = c[0] as ContentBlock | undefined;
      if (first?.type === "tool_result") {
        const resultText =
          typeof first.content === "string" ? first.content : JSON.stringify(first.content);
        return {
          index,
          uuid,
          parentUuid,
          timestamp,
          role: "tool-result",
          rawType,
          preview: truncate(resultText, 200),
          blocks: c as ContentBlock[],
          toolUseId: first.tool_use_id,
          toolResult: r.toolUseResult,
          raw,
        };
      }
      const textBlock = (c as ContentBlock[]).find(
        (b): b is { type: "text"; text: string } => b?.type === "text",
      );
      return {
        index,
        uuid,
        parentUuid,
        timestamp,
        role: "user",
        rawType,
        preview: textBlock ? truncate(textBlock.text, 200) : truncate(JSON.stringify(c), 200),
        blocks: c as ContentBlock[],
        raw,
      };
    }
  }

  // --- attachment (system/meta) ---
  if (rawType === "attachment") {
    const a = (r.attachment ?? {}) as Record<string, unknown>;
    const at = String(a.type ?? "attachment");
    let preview = `<attachment: ${at}>`;
    if (typeof a.content === "string" && a.content.length > 0) {
      preview = `[${at}] ` + truncate(a.content, 140);
    } else if (Array.isArray(a.addedNames)) {
      preview = `[${at}] +${(a.addedNames as unknown[]).length} names`;
    }
    return {
      index,
      uuid,
      parentUuid,
      timestamp,
      role: "system",
      rawType,
      preview,
      blocks: [{ type: "text", text: JSON.stringify(a, null, 2) }],
      attachmentType: at,
      raw,
    };
  }

  // --- queue-operation / last-prompt / unknown => meta ---
  return {
    index,
    uuid,
    parentUuid,
    timestamp,
    role: "meta",
    rawType: rawType || "unknown",
    preview: `${rawType}: ${truncate(JSON.stringify(r), 140)}`,
    blocks: [{ type: "text", text: JSON.stringify(r, null, 2) }],
    raw,
  };
}

export type ParseResult = {
  meta: Omit<SessionMeta, "id" | "filePath" | "projectName" | "projectDir">;
  events: SessionEvent[];
};

/**
 * Parse an array of already-JSON-parsed JSONL lines into events + aggregate
 * metadata. Use `readJsonlFile()` from `@claude-sessions/parser/fs` to get
 * the raw lines from a file on disk.
 */
export function parseTranscript(rawLines: unknown[]): ParseResult {
  const events: SessionEvent[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const ev = toEvent(rawLines[i], i);
    if (ev) events.push(ev);
  }

  // Session bounds: min/max across all timestamps, since JSONL isn't
  // guaranteed to be in chronological order.
  const timestamped = events
    .map((e) => (e.timestamp ? Date.parse(e.timestamp) : undefined))
    .filter((n): n is number => typeof n === "number" && !Number.isNaN(n));
  const startMs = timestamped.length ? Math.min(...timestamped) : undefined;
  const endMs = timestamped.length ? Math.max(...timestamped) : undefined;
  const firstTs = startMs !== undefined ? new Date(startMs).toISOString() : undefined;
  const lastTs = endMs !== undefined ? new Date(endMs).toISOString() : undefined;

  for (const ev of events) {
    if (!ev.timestamp) continue;
    const ms = Date.parse(ev.timestamp);
    if (Number.isNaN(ms)) continue;
    if (startMs !== undefined) ev.tOffsetMs = Math.max(0, ms - startMs);
  }

  const isConversational = (r: (typeof events)[number]["role"]) =>
    r === "user" ||
    r === "agent" ||
    r === "agent-thinking" ||
    r === "tool-call" ||
    r === "tool-result";

  const chrono = events
    .filter((e) => e.timestamp && isConversational(e.role))
    .map((e) => ({ e, ms: Date.parse(e.timestamp!) }))
    .filter((x) => !Number.isNaN(x.ms))
    .sort((a, b) => a.ms - b.ms);

  for (let i = 1; i < chrono.length; i++) {
    chrono[i]!.e.gapMs = Math.max(0, chrono[i]!.ms - chrono[i - 1]!.ms);
  }

  // Air-time: sum of gaps under the idle threshold. This approximates
  // how long the agent was actively working (filters out the user
  // stepping away, lid closed overnight, etc.). Same 3-minute
  // threshold as sessionAirTimeMs() in analytics.ts.
  const IDLE_THRESHOLD_MS = 3 * 60 * 1000;
  let airTimeMs = 0;
  for (let i = 1; i < chrono.length; i++) {
    const g = chrono[i]!.e.gapMs ?? 0;
    if (g > 0 && g <= IDLE_THRESHOLD_MS) airTimeMs += g;
  }

  // Aggregate usage + derive session-level metadata.
  // Usage dedup: Claude Code splits one API response into multiple JSONL
  // lines, each carrying the same `usage`. Sum only once per message.id.
  const totalUsage: Usage = { ...BLANK_USAGE };
  const seenMessageIds = new Set<string>();
  let model: string | undefined;
  let sessionId = "";
  let cwd: string | undefined;
  let gitBranch: string | undefined;
  let toolCallCount = 0;
  let turnCount = 0;
  let firstUserPreview: string | undefined;
  let lastAgentPreview: string | undefined;

  for (const e of events) {
    if (e.role === "tool-call") toolCallCount++;
    if (e.role === "user" && !firstUserPreview) {
      // Skip slash command, skill injection, task notification prefixes
      const txt = e.preview;
      if (
        !txt.startsWith("<command-name>") &&
        !txt.startsWith("Base directory for this skill:") &&
        !txt.startsWith("<task-notification>")
      ) {
        firstUserPreview = txt;
      }
    }
    if (e.role === "user") {
      const txt = e.preview;
      if (
        !txt.startsWith("<command-name>") &&
        !txt.startsWith("Base directory for this skill:") &&
        !txt.startsWith("<task-notification>")
      ) {
        turnCount++;
      }
    }
    if (e.role === "agent") {
      lastAgentPreview = e.preview;
    }
  }

  for (const r of rawLines) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.sessionId === "string" && !sessionId) sessionId = o.sessionId;
    if (typeof o.cwd === "string" && !cwd) cwd = o.cwd;
    if (typeof o.gitBranch === "string" && !gitBranch) gitBranch = o.gitBranch;
    if (o.type === "assistant") {
      const m = o.message as Record<string, unknown> | undefined;
      if (m) {
        if (typeof m.model === "string" && !model) model = m.model;
        const mid = typeof m.id === "string" ? m.id : undefined;
        if (mid && seenMessageIds.has(mid)) continue;
        if (mid) seenMessageIds.add(mid);
        const u = extractUsage(m.usage);
        if (u) {
          totalUsage.input += u.input;
          totalUsage.output += u.output;
          totalUsage.cacheRead += u.cacheRead;
          totalUsage.cacheWrite += u.cacheWrite;
        }
      }
    }
  }

  return {
    events,
    meta: {
      sessionId,
      firstTimestamp: firstTs,
      lastTimestamp: lastTs,
      durationMs: startMs !== undefined && endMs !== undefined ? endMs - startMs : undefined,
      eventCount: events.length,
      model,
      cwd,
      gitBranch,
      totalUsage,
      status: "idle",
      firstUserPreview,
      lastAgentPreview,
      toolCallCount,
      turnCount,
      airTimeMs,
    },
  };
}
