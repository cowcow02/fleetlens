/**
 * Parses a single Claude Code JSONL transcript into the SessionEvent model.
 *
 * Pure — no fs, no network. Takes already-JSON-parsed lines and produces
 * an ordered array of events plus aggregate metadata.
 */

import type { ContentBlock, EventRole, SessionEvent, SessionMeta, Usage } from "./types.js";

const BLANK_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** Strip XML tags and collapse whitespace for clean preview text. */
function cleanText(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function truncate(s: string, n = 200): string {
  const one = cleanText(s);
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}

// Matches any text that starts with <teammate-message> — handles both
// single-block and multi-block (batched) deliveries. Captures the first
// teammate_id and the first body for classification; multi-block messages
// are still classified from the first block.
const TEAMMATE_MSG_RE =
  /^\s*<teammate-message\s+teammate_id="([^"]+)"[^>]*>([\s\S]*?)<\/teammate-message>/;

function classifyTeammateMessage(
  text: string,
): SessionEvent["teammateMessage"] | undefined {
  const m = text.match(TEAMMATE_MSG_RE);
  if (!m) return undefined;
  const teammateId = m[1]!;
  const body = m[2]!.trim();
  type TmKind = NonNullable<SessionEvent["teammateMessage"]>["kind"];
  let kind: TmKind = "message";
  if (body.startsWith("{")) {
    try {
      const parsed = JSON.parse(body) as { type?: string };
      if (parsed.type === "idle_notification") kind = "idle-notification";
      else if (parsed.type === "shutdown_request") kind = "shutdown-request";
      else if (parsed.type === "shutdown_approved") kind = "shutdown-approved";
      else if (parsed.type === "task_assignment") kind = "task-assignment";
      else if (parsed.type === "teammate_terminated") kind = "teammate-terminated";
    } catch {
      /* not JSON, treat as message */
    }
  }
  return { teammateId, body, kind };
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
      const tm = classifyTeammateMessage(c);
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
        teammateMessage: tm,
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
      const tm = textBlock ? classifyTeammateMessage(textBlock.text) : undefined;
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
        teammateMessage: tm,
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
 * metadata. Use `readJsonlFile()` from `@claude-lens/parser/fs` to get
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

  // Conversational chrono — used to annotate `gapMs` on events (consumed
  // by the session-view UI to render "Session idle" dividers between
  // user messages). This keeps the historical behavior of gapMs being
  // a "gap between user-visible turns" number.
  const chrono = events
    .filter((e) => e.timestamp && isConversational(e.role))
    .map((e) => ({ e, ms: Date.parse(e.timestamp!) }))
    .filter((x) => !Number.isNaN(x.ms))
    .sort((a, b) => a.ms - b.ms);

  for (let i = 1; i < chrono.length; i++) {
    chrono[i]!.e.gapMs = Math.max(0, chrono[i]!.ms - chrono[i - 1]!.ms);
  }

  // Air-time + active segments: walk ALL timestamped events, not just
  // conversational ones. Non-conversational events (summary, sidechain,
  // system, etc.) still represent "agent activity touching the JSONL
  // file" and should count toward active time. Filtering them out caused
  // airTimeMs to undercount dramatically for sessions with lots of
  // auto-compact summaries or sidechain agents — a session where the
  // Gantt showed 2h of active segments could report just 2m of airtime.
  //
  // This matches `computeActiveSegments()` in analytics.ts so that all
  // "active time" numbers across the app (dashboard metric, per-session
  // mini-stat, Gantt row label, calendar picker) agree.
  const IDLE_THRESHOLD_MS = 3 * 60 * 1000;
  const allChrono = events
    .filter((e) => e.timestamp)
    .map((e) => Date.parse(e.timestamp!))
    .filter((ms) => !Number.isNaN(ms))
    .sort((a, b) => a - b);

  const activeSegments: { startMs: number; endMs: number }[] = [];
  let airTimeMs = 0;
  if (allChrono.length > 0) {
    let segStart = allChrono[0]!;
    let segEnd = allChrono[0]!;
    for (let i = 1; i < allChrono.length; i++) {
      const t = allChrono[i]!;
      const gap = t - segEnd;
      if (gap > IDLE_THRESHOLD_MS) {
        activeSegments.push({ startMs: segStart, endMs: segEnd });
        segStart = t;
      } else if (gap > 0) {
        airTimeMs += gap;
      }
      segEnd = t;
    }
    activeSegments.push({ startMs: segStart, endMs: segEnd });
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
  let teamName: string | undefined;
  let agentName: string | undefined;
  let hasTeamCreate = false;
  let hasOutboundDispatch = false;
  let toolCallCount = 0;
  let turnCount = 0;
  let firstUserPreview: string | undefined;
  let lastAgentPreview: string | undefined;
  let lastUserPreview: string | undefined;
  let linesAdded = 0;
  let linesRemoved = 0;
  const filesEdited = new Set<string>();

  for (const e of events) {
    if (e.role === "tool-call") {
      toolCallCount++;
      // Count lines added/removed from Edit and Write tool calls.
      const toolBlock = e.blocks.find(
        (b) => b && (b as { type?: string }).type === "tool_use",
      ) as { type: "tool_use"; name: string; input?: Record<string, unknown> } | undefined;
      if (toolBlock) {
        const input = toolBlock.input ?? {};
        // Team-orchestration evidence: a session is only a "lead" when it
        // actually creates a team or dispatches outbound messages. A bare
        // teamName field on events isn't enough — Claude Code can tag a
        // one-off chat with whatever team context happened to be active.
        if (toolBlock.name === "TeamCreate") hasTeamCreate = true;
        if (toolBlock.name === "SendMessage") {
          const to = typeof input.to === "string" ? (input.to as string) : "";
          if (to && to !== "team-lead") hasOutboundDispatch = true;
        }
        const fp = typeof input.file_path === "string" ? (input.file_path as string) : undefined;
        if (toolBlock.name === "Edit" && fp) {
          filesEdited.add(fp);
          const oldStr = typeof input.old_string === "string" ? (input.old_string as string) : "";
          const newStr = typeof input.new_string === "string" ? (input.new_string as string) : "";
          const oldLines = oldStr ? oldStr.split("\n").length : 0;
          const newLines = newStr ? newStr.split("\n").length : 0;
          linesAdded += Math.max(0, newLines - oldLines);
          linesRemoved += Math.max(0, oldLines - newLines);
        } else if (toolBlock.name === "Write" && fp) {
          filesEdited.add(fp);
          const content = typeof input.content === "string" ? (input.content as string) : "";
          linesAdded += content ? content.split("\n").length : 0;
        }
      }
    }
    if (e.role === "user") {
      // Detect hidden system messages from the RAW content (before XML
      // tags got stripped by cleanText). `e.preview` is already cleaned,
      // so a startsWith("<command-name>") check on it never matches.
      const rawMsg = (e.raw as { message?: { content?: unknown } } | undefined)
        ?.message;
      const rawContent =
        typeof rawMsg?.content === "string" ? rawMsg.content : "";
      const isHidden =
        rawContent.startsWith("<command-name>") ||
        rawContent.startsWith("<local-command-caveat>") ||
        rawContent.startsWith("Base directory for this skill:") ||
        rawContent.startsWith("<task-notification>");
      // Teammate messages on LEAD sessions are protocol noise (idle
      // notifications, task assignments) — skip them for preview/turn
      // counting. On MEMBER sessions the teammate message IS the task
      // instruction from the lead, so use it as the preview.
      // Members have agentName set; leads don't. Use this as a proxy
      // since the full isTeamLead flag is computed after the event loop.
      const isTeamNoise =
        e.teammateMessage !== undefined && !agentName;
      if (!isHidden && !isTeamNoise) {
        if (!firstUserPreview) {
          firstUserPreview = e.teammateMessage
            ? e.teammateMessage.body
            : e.preview;
        }
        turnCount++;
        // Track the most recent "real" user message so the live widget
        // can surface "what am I working on RIGHT NOW" instead of the
        // first thing asked in a long-running session.
        lastUserPreview = e.preview;
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
    if (typeof o.teamName === "string" && !teamName) teamName = o.teamName;
    if (typeof o.agentName === "string" && !agentName) agentName = o.agentName;
    if (o.type === "assistant") {
      const m = o.message as Record<string, unknown> | undefined;
      if (m) {
        if (typeof m.model === "string" && !model) model = m.model;
        // Dedup by message.id (primary) + optional requestId. Claude Code
        // splits one API response across multiple JSONL lines, each
        // carrying the same `usage` block, so summing per line would
        // double-count tokens. message.id is the stable identifier;
        // requestId is extra disambiguation when present.
        const mid = typeof m.id === "string" ? m.id : undefined;
        const rid = typeof o.requestId === "string" ? o.requestId : undefined;
        const dedupKey = mid != null ? `${mid}:${rid ?? ""}` : undefined;
        if (dedupKey && seenMessageIds.has(dedupKey)) continue;
        if (dedupKey) seenMessageIds.add(dedupKey);
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
      lastUserPreview,
      lastAgentPreview,
      toolCallCount,
      turnCount,
      airTimeMs,
      activeSegments,
      linesAdded,
      linesRemoved,
      filesEdited: filesEdited.size,
      teamName,
      agentName,
      isTeamLead:
        teamName !== undefined &&
        agentName === undefined &&
        (hasTeamCreate || hasOutboundDispatch),
    },
  };
}
