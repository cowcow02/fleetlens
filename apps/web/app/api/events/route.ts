/**
 * Server-Sent Events endpoint that broadcasts file-change notifications
 * from `~/.claude/projects/` to any connected dashboard client.
 *
 * Uses Node's fs.watch with `recursive: true`, which is supported on
 * macOS and Windows. Linux would need chokidar for recursive mode,
 * but we target macOS primarily for now.
 *
 * Event shape:
 *   { type: "session-updated", sessionId, projectDir, mtimeMs }
 *   { type: "heartbeat", tsMs }     // keep-alive every 15s
 *
 * The watcher also invalidates the parser's per-file cache for every
 * changed file so the next RSC render re-parses fresh data.
 */

import { invalidateFile, DEFAULT_ROOT } from "@claude-sessions/parser/fs";
import { watch, promises as fs } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";
// Edge runtime can't do fs.watch
export const runtime = "nodejs";

type LiveEvent =
  | {
      type: "session-updated";
      sessionId: string;
      projectDir: string;
      mtimeMs: number;
    }
  | { type: "heartbeat"; tsMs: number }
  | { type: "ready" };

const HEARTBEAT_MS = 15_000;

/** Per-file debounce so a burst of writes doesn't flood subscribers. */
const DEBOUNCE_MS = 150;

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      function send(event: LiveEvent) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Stream may already be closed if the client disconnected.
          closed = true;
        }
      }

      // Debounced emit per fullPath. Node's fs.watch often fires
      // twice for a single save (rename + change); 150ms dedupes.
      const pending = new Map<string, NodeJS.Timeout>();
      function emit(fullPath: string) {
        const prev = pending.get(fullPath);
        if (prev) clearTimeout(prev);
        pending.set(
          fullPath,
          setTimeout(async () => {
            pending.delete(fullPath);
            if (closed) return;
            try {
              const stat = await fs.stat(fullPath);
              // Derive sessionId + projectDir from the path.
              const rel = path.relative(DEFAULT_ROOT, fullPath);
              const parts = rel.split(path.sep);
              if (parts.length < 2) return;
              const projectDir = parts[0]!;
              const fileName = parts[parts.length - 1]!;
              if (!fileName.endsWith(".jsonl")) return;
              // Skip subagent child files under <session>/subagents/ —
              // they're noise; the parent session file mtime changes
              // whenever a subagent writes (Claude Code touches both).
              if (parts.includes("subagents")) return;
              const sessionId = fileName.replace(/\.jsonl$/, "");

              // Drop the stale cache entry so the next read re-parses.
              invalidateFile(fullPath);

              send({
                type: "session-updated",
                sessionId,
                projectDir,
                mtimeMs: stat.mtimeMs,
              });
            } catch {
              // File may have been deleted between the watch event and
              // our stat — silently drop.
            }
          }, DEBOUNCE_MS),
        );
      }

      let watcher: ReturnType<typeof watch> | null = null;
      try {
        watcher = watch(
          DEFAULT_ROOT,
          { recursive: true, persistent: false },
          (_eventType, filename) => {
            if (!filename) return;
            const fullPath = path.join(DEFAULT_ROOT, filename.toString());
            if (!fullPath.endsWith(".jsonl")) return;
            emit(fullPath);
          },
        );
      } catch (e) {
        // fs.watch can throw on some filesystems. Still keep the
        // connection open for heartbeats so the client doesn't
        // reconnect-loop; at worst they lose live updates.
        console.error("[events] fs.watch failed:", e);
      }

      // Initial "ready" ping so the client knows the stream is live
      // (and can clear any reconnecting indicator).
      send({ type: "ready" });

      // Keep-alive heartbeat so proxies / Next dev don't kill an idle
      // connection after ~60s of silence.
      const heartbeat = setInterval(() => {
        send({ type: "heartbeat", tsMs: Date.now() });
      }, HEARTBEAT_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        for (const t of pending.values()) clearTimeout(t);
        pending.clear();
        try {
          watcher?.close();
        } catch {
          // ignore
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // Client disconnected (browser closed tab, nav away, etc).
      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Some proxies buffer SSE unless told not to.
      "X-Accel-Buffering": "no",
    },
  });
}
