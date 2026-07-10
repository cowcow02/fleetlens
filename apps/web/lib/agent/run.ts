/**
 * Detached agent runs. A run is a claude subprocess whose lifetime is
 * NOT tied to any HTTP request: events stream into the chat file (so a
 * closed tab loses nothing) and to any live SSE subscribers. The registry
 * lives on globalThis — see the note in index-store.ts.
 */

import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { cclensPath } from "@claude-lens/parser/fs";
import { applyRunEvent, writeChat, type Chat, type RunEvent, type RunEventBody, type StoredMessage } from "./chat-store";
import { agentSystemPrompt, buildUserPrompt, type ChatMessage } from "./prompt";

export const MAX_CONCURRENT_RUNS = 3;
const HARD_TIMEOUT_MS = 5 * 60_000;
const MCP_CONNECT_ATTEMPTS = 3;
const MCP_RETRY_DELAY_MS = 750;
const DELTA_FLUSH_MS = 750;
const TOOL_INPUT_PREVIEW_MAX = 300;

type RunListener = (event: RunEvent) => void;

type ActiveRun = {
  chatId: string;
  events: RunEvent[];
  subscribers: Set<RunListener>;
  stoppedByUser: boolean;
  /** Chat was deleted while running: never write its file again. */
  discarded: boolean;
  kill: () => void;
};

type Registry = { runs: Map<string, ActiveRun> };
const registry: Registry = ((globalThis as Record<string, unknown>).__fleetlensAgentRuns ??= {
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

/** Kill + forget: for chat deletion. The close handler must not re-persist
 *  the file (that would resurrect the deleted chat), and the concurrency
 *  slot frees immediately rather than when the subprocess finishes dying. */
export function discardRun(chatId: string): void {
  const run = registry.runs.get(chatId);
  if (!run) return;
  run.stoppedByUser = true;
  run.discarded = true;
  registry.runs.delete(chatId);
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

/** Same trace format as llm-runner.ts so agent runs show up on /runs
 *  and a misbehaving run (e.g. fabricated tool output) leaves a raw stream
 *  to diagnose. */
function newTrace(model: string, userPromptChars: number, systemPrompt: string, userPrompt: string) {
  const runsDir = cclensPath("llm-runs");
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}_agent_chat_${randomUUID().slice(0, 8)}`;
  const path = join(runsDir, `${runId}.jsonl`);
  const write = (record: unknown, first = false) => {
    try {
      const line = JSON.stringify(record) + "\n";
      if (first) {
        mkdirSync(runsDir, { recursive: true });
        writeFileSync(path, line);
      } else {
        appendFileSync(path, line);
      }
    } catch {
      /* never block the run on a trace write */
    }
  };
  write(
    {
      _meta: {
        type: "start",
        run_id: runId,
        kind: "agent_chat",
        model,
        ts: new Date().toISOString(),
        runtime: "detached",
        user_prompt_chars: userPromptChars,
      },
    },
    true,
  );
  write({ _meta: { type: "payload", run_id: runId, system_prompt: systemPrompt, user_prompt: userPrompt } });
  return {
    line: (raw: string) => {
      try {
        appendFileSync(path, raw + "\n");
      } catch {}
    },
    end: (fields: Record<string, unknown>) =>
      write({ _meta: { type: "end", run_id: runId, ts: new Date().toISOString(), ...fields } }),
  };
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
    discarded: false,
    kill: () => {}, // rebound to the live subprocess by each launch()
  };
  registry.runs.set(chat.id, run);

  const persist = (force: boolean) => {
    if (run.discarded) return; // deleted mid-run — don't resurrect the file
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
    "--append-system-prompt", agentSystemPrompt(),
  ];

  // Neutral cwd: spawned from inside a repo, Claude Code would load that
  // project's CLAUDE.md and auto-memory into context — the model then
  // cites memory files as if they were linkable pages.
  const runtimeDir = cclensPath("agent-runtime");
  mkdirSync(runtimeDir, { recursive: true });
  const userPrompt = buildUserPrompt(toChatMessages(chat.messages));

  const killTimer = setTimeout(() => {
    emit({ type: "error", message: `timed out after ${HARD_TIMEOUT_MS / 60000} minutes` });
    run.kill();
  }, HARD_TIMEOUT_MS);

  const finish = () => {
    clearTimeout(killTimer);
    persist(true);
    registry.runs.delete(chat.id);
  };

  const launch = (attempt: number) => {
    if (run.stoppedByUser || state.status !== "running") {
      if (run.stoppedByUser && state.status === "running") emit({ type: "error", message: "stopped by user" });
      finish();
      return;
    }

    const trace = newTrace(opts.model, userPrompt.length, agentSystemPrompt(), userPrompt);
    const startMs = Date.now();
    const proc = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      cwd: runtimeDir,
    });
    run.kill = () => {
      try {
        proc.kill("SIGTERM");
      } catch {}
    };
    proc.stdin.write(userPrompt);
    proc.stdin.end();

    /** This attempt was superseded by a retry — swallow everything else it produces. */
    let abandoned = false;
    let stderr = "";
    let lineBuf = "";
    let sawTerminal = false;
    let usage: { input_tokens?: number; output_tokens?: number } | undefined;
    /** Content-block indices that streamed text deltas for the in-flight
     *  assistant message. The complete-message frame only re-emits a text
     *  block if ITS deltas never arrived (CLI without partial messages, or
     *  a dropped delta line) — a per-message flag would drop a block whose
     *  deltas were lost whenever any other block streamed. */
    let deltaBlocks = new Set<number>();
    const toolNames = new Map<string, string>();

    const handleLine = (t: string) => {
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(t) as Record<string, unknown>;
      } catch {
        return;
      }
      if (obj.type !== "stream_event") trace.line(t); // partial deltas would bloat the trace
      if (obj.type === "system" && obj.subtype === "init") {
        // The subprocess can race ahead of the HTTP MCP handshake: init
        // reports the fleetlens server "pending" and the model runs with
        // ZERO tools — it then "narrates" tool calls as text instead of
        // making them. The tool list is fixed at init, so a pending server
        // means a degraded run. Respawn (the handshake wins next time).
        const servers = obj.mcp_servers as Array<{ name?: string; status?: string }> | undefined;
        const fleetlens = servers?.find((s) => s.name === "fleetlens");
        if (fleetlens && fleetlens.status !== "connected") {
          abandoned = true;
          trace.end({ runtime: "detached", elapsed_ms: Date.now() - startMs, mcp_status: fleetlens.status, retried: attempt < MCP_CONNECT_ATTEMPTS });
          try {
            proc.kill("SIGTERM");
          } catch {}
          if (attempt < MCP_CONNECT_ATTEMPTS) {
            setTimeout(() => launch(attempt + 1), MCP_RETRY_DELAY_MS);
          } else {
            emit({ type: "error", message: `session tools failed to connect (mcp status: ${fleetlens.status}) — try again` });
            finish();
          }
        }
        return;
      }
      if (obj.type === "stream_event") {
        const event = obj.event as Record<string, unknown> | undefined;
        if (event?.type === "content_block_delta") {
          const delta = event.delta as Record<string, unknown> | undefined;
          if (delta?.type === "text_delta" && typeof delta.text === "string") {
            if (typeof event.index === "number") deltaBlocks.add(event.index);
            emit({ type: "delta", text: delta.text });
          }
        }
        return;
      }
      if (obj.type === "assistant") {
        const msg = obj.message as Record<string, unknown> | undefined;
        const content = msg?.content as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(content)) {
          content.forEach((block, i) => {
            if (block.type === "text" && typeof block.text === "string" && !deltaBlocks.has(i)) {
              emit({ type: "delta", text: block.text });
            }
            if (block.type === "tool_use" && typeof block.name === "string") {
              const id = typeof block.id === "string" ? block.id : "";
              const name = block.name.replace(/^mcp__fleetlens__/, "");
              toolNames.set(id, name);
              emit({ type: "tool", id, name, input: pruneInput(block.input) });
            }
          });
        }
        deltaBlocks = new Set();
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
        usage = obj.usage as { input_tokens?: number; output_tokens?: number } | undefined;
        const totalTokens =
          typeof usage?.input_tokens === "number" && typeof usage?.output_tokens === "number"
            ? usage.input_tokens + usage.output_tokens
            : undefined;
        emit({ type: "done", totalTokens });
      }
    };

    // Streaming decoder: chunk.toString("utf8") would mangle a multi-byte
    // character split across stdout reads, corrupting that JSON line.
    const decoder = new TextDecoder("utf-8");
    proc.stdout.on("data", (chunk: Buffer) => {
      if (abandoned) return;
      lineBuf += decoder.decode(chunk, { stream: true });
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (t && !abandoned) handleLine(t);
      }
    });
    proc.stderr.on("data", (c: Buffer) => {
      // Only a 400-char tail is ever surfaced; cap so a chatty subprocess
      // can't grow the buffer unbounded before the kill timer.
      if (stderr.length < 4000) stderr += c.toString("utf8");
    });
    proc.on("close", (code) => {
      if (abandoned) return; // the retry owns the run lifecycle now
      if (!sawTerminal && state.status === "running") {
        const message = run.stoppedByUser
          ? "stopped by user"
          : stderr.trim().slice(0, 400) || `claude exited with code ${code}`;
        emit({ type: "error", message });
      }
      trace.end({
        runtime: "detached",
        elapsed_ms: Date.now() - startMs,
        exit_code: code ?? 0,
        input_tokens: usage?.input_tokens,
        output_tokens: usage?.output_tokens,
      });
      finish();
    });
    proc.on("error", (err) => {
      if (abandoned) return;
      emit({ type: "error", message: `Failed to spawn claude: ${err.message}` });
      trace.end({ runtime: "detached", elapsed_ms: Date.now() - startMs, exit_code: -1, error: err.message });
      finish();
    });
  };

  launch(1);
}
