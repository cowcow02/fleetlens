/**
 * Assistant chat — agentic search over local session history.
 *
 * POST { messages: [{role, text}...], model? }
 *
 * Spawns the local `claude -p` as the agent runtime with an MCP config
 * pointing back at this app's /api/assistant/mcp endpoint, so the model can
 * call search_sessions / get_session / list_sessions / list_projects while
 * we relay its stream as SSE:
 *
 *   { type: "delta", text }                        incremental assistant text
 *   { type: "tool", id, name, input }              tool call issued
 *   { type: "tool_result", id, name, brief, isError }
 *   { type: "done", totalTokens }
 *   { type: "error", message }
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { cclensPath } from "@claude-lens/parser/fs";
import { readSettings } from "@claude-lens/entries/node";
import { assistantSystemPrompt, buildUserPrompt, type ChatMessage } from "@/lib/assistant/prompt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HARD_TIMEOUT_MS = 5 * 60_000;
const TOOL_INPUT_PREVIEW_MAX = 300;

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

export async function POST(request: Request) {
  let body: { messages?: ChatMessage[]; model?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const messages = (body.messages ?? []).filter((m) => m && typeof m.text === "string" && m.text.trim());
  if (messages.length === 0 || messages[messages.length - 1]!.role !== "user") {
    return Response.json({ error: "messages must end with a user message" }, { status: 400 });
  }

  const model = body.model || readSettings().ai_features.model || "sonnet";
  const mcpUrl = new URL("/api/assistant/mcp", request.url).toString();
  const systemPrompt = assistantSystemPrompt();
  const userPrompt = buildUserPrompt(messages);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (data: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const finish = () => {
        if (!closed) {
          try {
            controller.close();
          } catch {}
          closed = true;
        }
      };

      const args = [
        "-p",
        "--output-format", "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--model", model,
        // Built-in tools off; the session-history MCP tools are the whole surface.
        "--tools", "",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--setting-sources", "",
        "--strict-mcp-config",
        "--mcp-config", JSON.stringify({ mcpServers: { fleetlens: { type: "http", url: mcpUrl } } }),
        "--allowedTools",
        "mcp__fleetlens__search_sessions",
        "mcp__fleetlens__get_session",
        "mcp__fleetlens__list_sessions",
        "mcp__fleetlens__list_projects",
        "--effort", "medium",
        "--append-system-prompt", systemPrompt,
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
      proc.stdin.write(userPrompt);
      proc.stdin.end();

      const killTimer = setTimeout(() => {
        send({ type: "error", message: `timed out after ${HARD_TIMEOUT_MS / 60000} minutes` });
        try {
          proc.kill("SIGTERM");
        } catch {}
      }, HARD_TIMEOUT_MS);

      let stderr = "";
      let lineBuf = "";
      let sawResult = false;
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
              send({ type: "delta", text: delta.text });
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
                send({ type: "delta", text: block.text });
              }
              if (block.type === "tool_use" && typeof block.name === "string") {
                const id = typeof block.id === "string" ? block.id : "";
                const name = block.name.replace(/^mcp__fleetlens__/, "");
                toolNames.set(id, name);
                send({ type: "tool", id, name, input: pruneInput(block.input) });
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
            send({
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
          sawResult = true;
          const usage = obj.usage as { input_tokens?: number; output_tokens?: number } | undefined;
          const totalTokens =
            typeof usage?.input_tokens === "number" && typeof usage?.output_tokens === "number"
              ? usage.input_tokens + usage.output_tokens
              : undefined;
          send({ type: "done", totalTokens });
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
        // Only the first 400 chars ever reach the client; cap the buffer so a
        // chatty subprocess can't grow it unbounded before the kill timer.
        if (stderr.length < 4000) stderr += c.toString("utf8");
      });
      proc.on("close", (code) => {
        clearTimeout(killTimer);
        if (code !== 0 && !sawResult) {
          send({ type: "error", message: stderr.trim().slice(0, 400) || `claude exited with code ${code}` });
        }
        finish();
      });
      proc.on("error", (err) => {
        clearTimeout(killTimer);
        send({ type: "error", message: `Failed to spawn claude: ${err.message}` });
        finish();
      });
      request.signal.addEventListener("abort", () => {
        try {
          proc.kill("SIGTERM");
        } catch {}
        finish();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
