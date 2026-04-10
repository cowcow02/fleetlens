/**
 * Ask Claude about a session.
 *
 * POST /api/ask
 *   { sessionId: string, question: string, model?: "haiku" | "sonnet" | "opus" }
 *
 * Returns a Server-Sent Events stream with:
 *   { type: "delta", text: string }         // incremental text chunk
 *   { type: "done", totalTokens?: number }  // stream finished
 *   { type: "error", message: string }       // fatal error
 *
 * Under the hood, spawns `claude -p` as a subprocess using the user's
 * local keychain auth (Max subscription). Session transcript is
 * rendered to a compact text summary and injected as system prompt
 * context. No API key management needed.
 */

import { getSession } from "@claude-sessions/parser/fs";
import { summarizeSessionForAI } from "@/lib/ai/session-summary";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are a session analyst for Claude Code transcripts. The user is viewing a session in the Claude Sessions dashboard and wants your help understanding it.

You will receive a structured summary of the session, then the user's question about it. Respond directly and concisely in markdown.

Some common tasks users ask about:
- **Identify errors**: Find all errors, exceptions, rate limits, or failed operations
- **Analyze performance**: Review tool execution times, token efficiency, caching ratio
- **Trace conversation flow**: Follow the logic and key decision points
- **Suggest improvements**: Recommend better prompting, tool usage, or workflow patterns

Be specific — cite timestamps, tool names, and event counts from the session data. Avoid generic advice. If the session data doesn't contain enough information to answer confidently, say so.`;

export async function POST(request: Request) {
  let body: { sessionId: string; question: string; model?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { sessionId, question, model = "haiku" } = body;
  if (!sessionId || !question) {
    return Response.json({ error: "sessionId and question are required" }, { status: 400 });
  }

  const session = await getSession(sessionId);
  if (!session) {
    return Response.json({ error: "session not found" }, { status: 404 });
  }

  const context = summarizeSessionForAI(session);
  const fullPrompt = `Here is the session transcript summary:\n\n${context}\n\n---\n\nUser's question: ${question}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      function send(data: { type: string; text?: string; message?: string; totalTokens?: number }) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      }

      // Resolve the claude binary — prefer the well-known location if it
      // exists, otherwise fall back to PATH resolution. The user must have
      // Claude Code installed and logged in.
      const claudeBin = "claude";

      const args = [
        "-p", // print mode (non-interactive)
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        model,
        "--tools",
        "", // no tools — pure analysis
        "--disable-slash-commands",
        "--no-session-persistence",
        "--setting-sources",
        "", // skip user settings for speed
        "--append-system-prompt",
        SYSTEM_PROMPT,
      ];

      const proc = spawn(claudeBin, args, {
        stdio: ["pipe", "pipe", "pipe"],
        // Inherit PATH so the claude binary is found.
        env: { ...process.env },
      });

      // Write the prompt to stdin and close.
      proc.stdin.write(fullPrompt);
      proc.stdin.end();

      let stderr = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        // stream-json emits one JSON object per line.
        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const obj = JSON.parse(trimmed) as Record<string, unknown>;

            // We care about assistant message content blocks of type "text".
            if (obj.type === "assistant") {
              const msg = obj.message as Record<string, unknown> | undefined;
              const content = msg?.content as Array<Record<string, unknown>> | undefined;
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === "text" && typeof block.text === "string") {
                    send({ type: "delta", text: block.text });
                  }
                }
              }
            }

            // Result event — extract total tokens for display.
            if (obj.type === "result") {
              const usage = obj.usage as Record<string, unknown> | undefined;
              const totalTokens =
                typeof usage?.input_tokens === "number" &&
                typeof usage?.output_tokens === "number"
                  ? usage.input_tokens + usage.output_tokens
                  : undefined;
              send({ type: "done", totalTokens: totalTokens ?? undefined });
            }
          } catch {
            // Skip non-JSON lines (verbose debug output, etc.)
          }
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      proc.on("close", (code) => {
        if (code !== 0 && !closed) {
          send({
            type: "error",
            message: stderr.trim().slice(0, 300) || `claude exited with code ${code}`,
          });
        }
        if (!closed) {
          try {
            controller.close();
          } catch {
            // already closed
          }
          closed = true;
        }
      });

      proc.on("error", (err) => {
        if (!closed) {
          send({ type: "error", message: `Failed to spawn claude: ${err.message}` });
          try {
            controller.close();
          } catch {
            // already closed
          }
          closed = true;
        }
      });

      // If the client aborts, kill the subprocess.
      request.signal.addEventListener("abort", () => {
        try {
          proc.kill("SIGTERM");
        } catch {
          // ignore
        }
        if (!closed) {
          try {
            controller.close();
          } catch {
            // already closed
          }
          closed = true;
        }
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
