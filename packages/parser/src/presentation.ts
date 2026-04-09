/**
 * Presentation layer for the transcript UI.
 *
 * Takes raw SessionEvent[] and produces a meaningful row stream modeled
 * on Claude Managed Agents' Sessions view — only the actions a human
 * cares about, with noise hidden.
 *
 * What's HIDDEN:
 *   - attachments (hook_success, skill_listing, deferred_tools_delta, mcp_instructions_delta)
 *   - queue-operation / last-prompt meta lines
 *   - extended-thinking blocks (accessible via the drawer row only)
 *   - tool_result responses (implied by the preceding tool row)
 *
 * What's KEPT / TRANSFORMED:
 *   - user messages → "user" rows (with interrupt / slash-command / task-notification detection)
 *   - assistant text → "agent" rows (with error detection)
 *   - assistant tool_use, consecutive calls of any tool merged → "tool-group"
 *   - all-zero usage assistant → "model" rows (failed API attempts)
 *   - rate-limit/error assistant text → "error" rows
 */

import type { ContentBlock, SessionEvent, Usage } from "./types.js";

export type PresentationRow =
  | {
      kind: "user";
      event: SessionEvent;
      displayPreview?: string;
      displayBlocks?: ContentBlock[];
      tOffsetMs?: number;
      gapMs?: number;
    }
  | {
      kind: "agent";
      event: SessionEvent;
      groupedEvents: SessionEvent[];
      tOffsetMs?: number;
      gapMs?: number;
    }
  | {
      kind: "tool-group";
      toolNames: { name: string; count: number }[];
      count: number;
      events: SessionEvent[];
      tOffsetMs?: number;
      gapMs?: number;
    }
  | {
      kind: "interrupt";
      event: SessionEvent;
      tOffsetMs?: number;
      gapMs?: number;
    }
  | {
      kind: "model";
      event: SessionEvent;
      tOffsetMs?: number;
      gapMs?: number;
    }
  | {
      kind: "error";
      event: SessionEvent;
      message: string;
      tOffsetMs?: number;
      gapMs?: number;
    }
  | {
      kind: "task-notification";
      event: SessionEvent;
      status: "success" | "failed" | "running" | "unknown";
      summary: string;
      taskId?: string;
      toolUseId?: string;
      outputFile?: string;
      tOffsetMs?: number;
      gapMs?: number;
    };

export type PresentationRowKind = PresentationRow["kind"];

/* ================================================================= */
/*  Mega rows — collapse agent loops between user inputs into turns   */
/* ================================================================= */

export type MegaRow = PresentationRow | TurnMegaRow;

export type TurnMegaRow = {
  kind: "turn";
  rows: PresentationRow[];
  firstPrimaryIndex: number;
  tOffsetMs?: number;
  durationMs?: number;
  summary: TurnSummary;
};

export type TurnSummary = {
  agentMessages: number;
  toolCalls: number;
  errors: number;
  firstAgentPreview?: string;
  finalAgentPreview?: string;
  firstAgentIndex?: number;
  finalAgentIndex?: number;
  toolNames: { name: string; count: number }[];
  totalTokens: Usage;
};

export function rowPrimaryIndex(r: PresentationRow): number {
  if (r.kind === "tool-group") return r.events[0]!.index;
  return r.event.index;
}

export function buildMegaRows(rows: PresentationRow[]): MegaRow[] {
  const out: MegaRow[] = [];
  let buffer: PresentationRow[] = [];

  const flush = () => {
    if (buffer.length === 0) return;

    let agentMessages = 0;
    let toolCalls = 0;
    let errors = 0;
    let firstAgentIndex: number | undefined;
    const toolMap = new Map<string, number>();
    const seenMsgIds = new Set<string>();
    const tokens: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

    for (let i = 0; i < buffer.length; i++) {
      const r = buffer[i]!;
      if (r.kind === "agent") {
        agentMessages++;
        if (firstAgentIndex === undefined) firstAgentIndex = i;
        const msgId = r.event.messageId;
        const usage = r.event.usage;
        if (msgId && !seenMsgIds.has(msgId) && usage) {
          seenMsgIds.add(msgId);
          tokens.input += usage.input;
          tokens.output += usage.output;
          tokens.cacheRead += usage.cacheRead;
          tokens.cacheWrite += usage.cacheWrite;
        }
      } else if (r.kind === "tool-group") {
        toolCalls += r.count;
        for (const t of r.toolNames) {
          toolMap.set(t.name, (toolMap.get(t.name) ?? 0) + t.count);
        }
      } else if (r.kind === "error") {
        errors++;
      }
    }

    // Conclusion selection: walk backward and skip any agent message
    // immediately preceded by a task-notification (those are "ack" codas
    // to background task events, not the real conclusion).
    let finalAgentIndex: number | undefined;
    for (let i = buffer.length - 1; i >= 0; i--) {
      const r = buffer[i]!;
      if (r.kind !== "agent") continue;
      const prev = buffer[i - 1];
      if (prev?.kind === "task-notification") continue;
      finalAgentIndex = i;
      break;
    }
    if (finalAgentIndex === undefined) {
      for (let i = buffer.length - 1; i >= 0; i--) {
        if (buffer[i]!.kind === "agent") {
          finalAgentIndex = i;
          break;
        }
      }
    }

    const firstAgentPreview =
      firstAgentIndex !== undefined && buffer[firstAgentIndex]!.kind === "agent"
        ? (buffer[firstAgentIndex] as Extract<PresentationRow, { kind: "agent" }>).event.preview
        : undefined;
    const finalAgentPreview =
      finalAgentIndex !== undefined && buffer[finalAgentIndex]!.kind === "agent"
        ? (buffer[finalAgentIndex] as Extract<PresentationRow, { kind: "agent" }>).event.preview
        : undefined;

    const toolNames = Array.from(toolMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));

    const first = buffer[0]!;
    const last = buffer[buffer.length - 1]!;
    const start = first.tOffsetMs;
    const end = last.tOffsetMs;
    const durationMs = start !== undefined && end !== undefined ? end - start : undefined;

    out.push({
      kind: "turn",
      rows: buffer,
      firstPrimaryIndex: rowPrimaryIndex(first),
      tOffsetMs: start,
      durationMs,
      summary: {
        agentMessages,
        toolCalls,
        errors,
        firstAgentPreview,
        finalAgentPreview,
        firstAgentIndex,
        finalAgentIndex,
        toolNames,
        totalTokens: tokens,
      },
    });
    buffer = [];
  };

  for (const r of rows) {
    if (r.kind === "user" || r.kind === "interrupt") {
      flush();
      out.push(r);
    } else {
      buffer.push(r);
    }
  }
  flush();

  return out;
}

const INTERRUPT_RE = /\[request interrupted|interrupted by user/i;
const RATE_LIMIT_RE = /rate.?limit|overloaded_error|api error|Error sending message/i;
const SKILL_CONTENT_RE = /^Base directory for this skill:/;
const SLASH_COMMAND_RE =
  /<command-name>(\/[^<\s]+)<\/command-name>(?:[\s\S]*?<command-args>([\s\S]*?)<\/command-args>)?/;
const TASK_NOTIFICATION_RE = /<task-notification>/;

function parseTaskNotification(text: string): {
  status: "success" | "failed" | "running" | "unknown";
  summary: string;
  taskId?: string;
  toolUseId?: string;
  outputFile?: string;
} | null {
  if (!TASK_NOTIFICATION_RE.test(text)) return null;
  const pick = (tag: string): string | undefined => {
    const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
    return m ? m[1]!.trim() : undefined;
  };
  const statusRaw = (pick("status") ?? "").toLowerCase();
  let status: "success" | "failed" | "running" | "unknown" = "unknown";
  if (
    statusRaw === "success" ||
    statusRaw === "ok" ||
    statusRaw === "done" ||
    statusRaw === "completed"
  )
    status = "success";
  else if (statusRaw === "failed" || statusRaw === "error" || statusRaw === "fail")
    status = "failed";
  else if (statusRaw === "running" || statusRaw === "in_progress") status = "running";
  return {
    status,
    summary: pick("summary") ?? "Background task notification",
    taskId: pick("task-id"),
    toolUseId: pick("tool-use-id"),
    outputFile: pick("output-file"),
  };
}

function isAttachmentOrMeta(e: SessionEvent): boolean {
  return e.role === "system" || e.role === "meta";
}

function firstTextOfBlocks(blocks: ContentBlock[]): string | undefined {
  for (const b of blocks) {
    if (b?.type === "text") return b.text;
  }
  return undefined;
}

function hasZeroUsage(e: SessionEvent): boolean {
  if (!e.usage) return false;
  const u = e.usage;
  return u.input === 0 && u.output === 0 && u.cacheRead === 0 && u.cacheWrite === 0;
}

export function buildPresentation(events: SessionEvent[]): PresentationRow[] {
  // Phase 1: index messages by id for the agent row's groupedEvents (drawer
  // uses this to surface thinking lines alongside the text block).
  const byMessageId = new Map<string, SessionEvent[]>();
  for (const e of events) {
    if (!e.messageId) continue;
    const list = byMessageId.get(e.messageId) ?? [];
    list.push(e);
    byMessageId.set(e.messageId, list);
  }

  const visible = events.filter((e) => {
    if (isAttachmentOrMeta(e)) return false;
    if (e.role === "tool-result") return false;
    if (e.role === "agent-thinking") return false;
    if (e.role === "user") {
      const txt = firstTextOfBlocks(e.blocks) ?? "";
      if (SKILL_CONTENT_RE.test(txt)) return false;
    }
    return true;
  });

  const rows: PresentationRow[] = [];
  for (let i = 0; i < visible.length; i++) {
    const e = visible[i]!;

    if (e.role === "tool-call") {
      const start = i;
      while (i + 1 < visible.length && visible[i + 1]!.role === "tool-call") {
        i++;
      }
      const group = visible.slice(start, i + 1);

      const order: string[] = [];
      const counts = new Map<string, number>();
      for (const ev of group) {
        const name = ev.toolName ?? "tool";
        if (!counts.has(name)) order.push(name);
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      const toolNames = order.map((name) => ({
        name,
        count: counts.get(name) ?? 1,
      }));

      rows.push({
        kind: "tool-group",
        toolNames,
        count: group.length,
        events: group,
        tOffsetMs: group[0]!.tOffsetMs,
        gapMs: group[0]!.gapMs,
      });
      continue;
    }

    if (e.role === "user") {
      const txt = firstTextOfBlocks(e.blocks) ?? "";

      const taskNotif = parseTaskNotification(txt);
      if (taskNotif) {
        rows.push({
          kind: "task-notification",
          event: e,
          status: taskNotif.status,
          summary: taskNotif.summary,
          taskId: taskNotif.taskId,
          toolUseId: taskNotif.toolUseId,
          outputFile: taskNotif.outputFile,
          tOffsetMs: e.tOffsetMs,
          gapMs: e.gapMs,
        });
        continue;
      }

      if (INTERRUPT_RE.test(txt)) {
        rows.push({
          kind: "interrupt",
          event: e,
          tOffsetMs: e.tOffsetMs,
          gapMs: e.gapMs,
        });
        continue;
      }

      const slashMatch = txt.match(SLASH_COMMAND_RE);
      if (slashMatch) {
        const cmd = slashMatch[1]!;
        const args = (slashMatch[2] ?? "").trim();
        const pretty = args ? `${cmd} ${args}` : cmd;
        rows.push({
          kind: "user",
          event: e,
          displayPreview: pretty,
          displayBlocks: [{ type: "text", text: pretty }],
          tOffsetMs: e.tOffsetMs,
          gapMs: e.gapMs,
        });
        continue;
      }

      rows.push({
        kind: "user",
        event: e,
        tOffsetMs: e.tOffsetMs,
        gapMs: e.gapMs,
      });
      continue;
    }

    if (e.role === "agent") {
      const txt = firstTextOfBlocks(e.blocks) ?? "";

      if (hasZeroUsage(e)) {
        rows.push({
          kind: "model",
          event: e,
          tOffsetMs: e.tOffsetMs,
          gapMs: e.gapMs,
        });
        if (RATE_LIMIT_RE.test(txt) && txt.length < 500) {
          rows.push({
            kind: "error",
            event: e,
            message: txt,
            tOffsetMs: e.tOffsetMs,
            gapMs: 0,
          });
        }
        continue;
      }

      if (RATE_LIMIT_RE.test(txt) && txt.length < 500) {
        rows.push({
          kind: "error",
          event: e,
          message: txt,
          tOffsetMs: e.tOffsetMs,
          gapMs: e.gapMs,
        });
        continue;
      }

      const grouped = e.messageId ? (byMessageId.get(e.messageId) ?? [e]) : [e];
      rows.push({
        kind: "agent",
        event: e,
        groupedEvents: grouped,
        tOffsetMs: e.tOffsetMs,
        gapMs: e.gapMs,
      });
      continue;
    }
  }
  return rows;
}
