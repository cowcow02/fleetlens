/**
 * Detached assistant runs. A run is a claude subprocess whose lifetime is
 * NOT tied to any HTTP request: events stream into the chat file (so a
 * closed tab loses nothing) and to any live SSE subscribers. The registry
 * lives on globalThis — see the note in index-store.ts.
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { cclensPath } from "@claude-lens/parser/fs";
import { applyRunEvent, writeChat, type Chat, type RunEvent, type RunEventBody, type StoredMessage } from "./chat-store";
import { assistantSystemPrompt, buildUserPrompt, type ChatMessage } from "./prompt";

export const MAX_CONCURRENT_RUNS = 3;
const HARD_TIMEOUT_MS = 5 * 60_000;
const DELTA_FLUSH_MS = 750;
const TOOL_INPUT_PREVIEW_MAX = 300;

export type RunListener = (event: RunEvent) => void;

type ActiveRun = {
  chatId: string;
  events: RunEvent[];
  subscribers: Set<RunListener>;
  stoppedByUser: boolean;
  kill: () => void;
};

type Registry = { runs: Map<string, ActiveRun> };
const registry: Registry = ((globalThis as Record<string, unknown>).__fleetlensAssistantRuns ??= {
  runs: new Map<string, ActiveRun>(),
}) as Registry;

export function getRun(chatId: string): ActiveRun | undefined {
  return registry.runs.get(chatId);
}

export function activeRunCount(): number {
  return registry.runs.size;
}

export function killRun(chatId: string): void {
  const run = registry.runs.get(chatId);
  if (!run) return;
  run.stoppedByUser = true;
  run.kill();
}

/** A chat file that says "running" with no live run is a zombie (server
 *  restarted mid-run, or a crash beat the final flush). Repair on read. */
export function reconcileChat(chat: Chat): Chat {
  if (chat.status !== "running" || registry.runs.has(chat.id)) return chat;
  const repaired = applyRunEvent(chat, {
    seq: chat.lastSeq + 1,
    type: "error",
    message: "run interrupted — the server restarted while it was working",
  });
  try {
    writeChat(repaired);
  } catch {
    /* read-only repair still returned */
  }
  return repaired;
}

function pruneInput(input: unknown): unknown {
  const s = JSON.stringify(input) ?? "{}";
  if (s.length <= TOOL_INPUT_PREVIEW_MAX) return input;
  return { _truncated: s.slice(0, TOOL_INPUT_PREVIEW_MAX) + "…" };
}

/** Human line for a tool result: our own tools return JSON, so peek inside. */
function briefResult(text: string): string {
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    if (typeof obj.total_matches === "number") return `${obj.total_matches} matching sessions`;
    if (Array.isArray(obj.sessions)) return `${(obj.total as number) ?? obj.sessions.length} sessions`;
    if (Array.isArray(obj.projects)) return `${obj.projects.length} projects`;
  } catch {
    /* not JSON — fall through */
  }
  return `${text.length.toLocaleString()} chars`;
}

function toChatMessages(messages: StoredMessage[]): ChatMessage[] {
  return messages
    .map((m): ChatMessage => {
      if (m.role === "user") return { role: "user", text: m.text };
      const text = m.segments
        .filter((s): s is Extract<typeof s, { kind: "text" }> => s.kind === "text")
        .map((s) => s.text)
        .join("");
      return { role: "assistant", text };
    })
    .filter((m) => m.text.trim());
}

/** Start a detached run for `chat` (already persisted with the trailing
 *  user message + empty assistant message, status "running"). */
export function startRun(chat: Chat, opts: { model: string; mcpUrl: string }): void {
  if (registry.runs.has(chat.id)) throw new Error("run already active for this chat");

  let seq = chat.lastSeq;
  let state = chat;
  let lastFlushMs = 0;

  const run: ActiveRun = {
    chatId: chat.id,
    events: [],
    subscribers: new Set(),
    stoppedByUser: false,
    kill: () => {
      try {
        proc.kill("SIGTERM");
      } catch {}
    },
  };
  registry.runs.set(chat.id, run);

  const persist = (force: boolean) => {
    const now = Date.now();
    if (!force && now - lastFlushMs < DELTA_FLUSH_MS) return;
    lastFlushMs = now;
    try {
      writeChat(state);
    } catch {
      /* a failed flush is recovered by the next one */
    }
  };

  const emit = (e: RunEventBody) => {
    const event = { seq: ++seq, ...e } as RunEvent;
    run.events.push(event);
    state = applyRunEvent(state, event);
    // Deltas flush on a timer; structural events flush immediately so the
    // file never shows a tool call without its eventual result for long.
    persist(event.type !== "delta");
    for (const fn of run.subscribers) {
      try {
        fn(event);
      } catch {
        /* a broken subscriber must not stall the run */
      }
    }
  };

  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model", opts.model,
    // Built-in tools off; the session-history MCP tools are the whole surface.
    "--tools", "",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--setting-sources", "",
    "--strict-mcp-config",
    "--mcp-config", JSON.stringify({ mcpServers: { fleetlens: { type: "http", url: opts.mcpUrl } } }),
    "--allowedTools",
    "mcp__fleetlens__search_sessions",
    "mcp__fleetlens__get_session",
    "mcp__fleetlens__list_sessions",
    "mcp__fleetlens__list_projects",
    "--effort", "medium",
    "--append-system-prompt", assistantSystemPrompt(),
  ];

  // Neutral cwd: spawned from inside a repo, Claude Code would load that
  // project's CLAUDE.md and auto-memory into context — the model then
  // cites memory files as if they were linkable pages.
  const runtimeDir = cclensPath("assistant-runtime");
  mkdirSync(runtimeDir, { recursive: true });
  const proc = spawn("claude", args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
    cwd: runtimeDir,
  });
  proc.stdin.write(buildUserPrompt(toChatMessages(chat.messages)));
  proc.stdin.end();

  const killTimer = setTimeout(() => {
    emit({ type: "error", message: `timed out after ${HARD_TIMEOUT_MS / 60000} minutes` });
    run.kill();
  }, HARD_TIMEOUT_MS);

  let stderr = "";
  let lineBuf = "";
  let sawTerminal = false;
  /** text_delta chars streamed for the in-flight assistant message — when
   *  the CLI predates --include-partial-messages we fall back to emitting
   *  the complete message's text blocks instead. */
  let partialChars = 0;
  const toolNames = new Map<string, string>();

  const handleLine = (t: string) => {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(t) as Record<string, unknown>;
    } catch {
      return;
    }
    if (obj.type === "stream_event") {
      const event = obj.event as Record<string, unknown> | undefined;
      if (event?.type === "content_block_delta") {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          partialChars += delta.text.length;
          emit({ type: "delta", text: delta.text });
        }
      }
      return;
    }
    if (obj.type === "assistant") {
      const msg = obj.message as Record<string, unknown> | undefined;
      const content = msg?.content as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && typeof block.text === "string" && partialChars === 0) {
            emit({ type: "delta", text: block.text });
          }
          if (block.type === "tool_use" && typeof block.name === "string") {
            const id = typeof block.id === "string" ? block.id : "";
            const name = block.name.replace(/^mcp__fleetlens__/, "");
            toolNames.set(id, name);
            emit({ type: "tool", id, name, input: pruneInput(block.input) });
          }
        }
      }
      partialChars = 0;
      return;
    }
    if (obj.type === "user") {
      const msg = obj.message as Record<string, unknown> | undefined;
      const content = msg?.content as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(content)) return;
      for (const block of content) {
        if (block.type !== "tool_result") continue;
        const id = typeof block.tool_use_id === "string" ? block.tool_use_id : "";
        const inner = block.content;
        const text = Array.isArray(inner)
          ? inner
              .map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : ""))
              .join("")
          : typeof inner === "string"
            ? inner
            : "";
        emit({
          type: "tool_result",
          id,
          name: toolNames.get(id) ?? "tool",
          brief: briefResult(text),
          isError: block.is_error === true,
        });
      }
      return;
    }
    if (obj.type === "result") {
      sawTerminal = true;
      const usage = obj.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      const totalTokens =
        typeof usage?.input_tokens === "number" && typeof usage?.output_tokens === "number"
          ? usage.input_tokens + usage.output_tokens
          : undefined;
      emit({ type: "done", totalTokens });
    }
  };

  proc.stdout.on("data", (chunk: Buffer) => {
    lineBuf += chunk.toString("utf8");
    const lines = lineBuf.split("\n");
    lineBuf = lines.pop()!;
    for (const line of lines) {
      const t = line.trim();
      if (t) handleLine(t);
    }
  });
  proc.stderr.on("data", (c: Buffer) => {
    // Only a 400-char tail is ever surfaced; cap so a chatty subprocess
    // can't grow the buffer unbounded before the kill timer.
    if (stderr.length < 4000) stderr += c.toString("utf8");
  });
  proc.on("close", (code) => {
    clearTimeout(killTimer);
    if (!sawTerminal && state.status === "running") {
      const message = run.stoppedByUser
        ? "stopped by user"
        : stderr.trim().slice(0, 400) || `claude exited with code ${code}`;
      emit({ type: "error", message });
    }
    persist(true);
    registry.runs.delete(chat.id);
  });
  proc.on("error", (err) => {
    clearTimeout(killTimer);
    emit({ type: "error", message: `Failed to spawn claude: ${err.message}` });
    persist(true);
    registry.runs.delete(chat.id);
  });
}
