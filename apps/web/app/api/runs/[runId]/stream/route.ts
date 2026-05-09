import { existsSync, readdirSync, statSync, watch, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { cclensPath } from "@claude-lens/parser/fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUNS_DIR = cclensPath("llm-runs");

/**
 * GET /api/runs/<runId>/stream  → SSE tail of a per-run trace file
 * GET /api/runs/latest/stream
 * GET /api/runs/<prefix>/stream
 *
 * Emits one SSE message per JSONL line as the file grows, then closes when
 * an end record (`_meta.type === "end"`) appears. Falls back to closing on
 * 30s of inactivity if the writer dies.
 */

function resolvePath(runId: string): { path: string; resolvedId: string } | { error: string; status: number; matches?: string[] } {
  if (!existsSync(RUNS_DIR)) return { error: "no traces", status: 404 };

  if (runId === "latest") {
    const all = readdirSync(RUNS_DIR)
      .filter(f => f.endsWith(".jsonl"))
      .map(f => ({ id: f.replace(/\.jsonl$/, ""), path: join(RUNS_DIR, f), mtime: statSync(join(RUNS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (all.length === 0) return { error: "no traces", status: 404 };
    return { path: all[0]!.path, resolvedId: all[0]!.id };
  }

  const exact = join(RUNS_DIR, `${runId}.jsonl`);
  if (existsSync(exact)) return { path: exact, resolvedId: runId };

  const matches = readdirSync(RUNS_DIR)
    .filter(f => f.endsWith(".jsonl") && f.includes(runId))
    .map(f => f.replace(/\.jsonl$/, ""));
  if (matches.length === 1) {
    return { path: join(RUNS_DIR, `${matches[0]}.jsonl`), resolvedId: matches[0]! };
  }
  if (matches.length > 1) return { error: "ambiguous", status: 400, matches };
  return { error: "not found", status: 404 };
}

export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }): Promise<Response> {
  const { runId } = await ctx.params;
  const r = resolvePath(runId);
  if ("error" in r) {
    return new Response(JSON.stringify({ error: r.error, ...("matches" in r ? { matches: r.matches } : {}) }), {
      status: r.status, headers: { "content-type": "application/json" },
    });
  }
  const { path, resolvedId } = r;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let buf = "";
      let pos = 0;
      let watcher: ReturnType<typeof watch> | null = null;
      let idleTimer: NodeJS.Timeout | null = null;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const close = (reason: string) => {
        if (closed) return;
        send("done", { reason });
        if (watcher) try { watcher.close(); } catch { /* ignore */ }
        if (idleTimer) clearTimeout(idleTimer);
        try { controller.close(); } catch { /* ignore */ }
        closed = true;
      };

      const resetIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => close("idle-30s"), 30_000);
      };

      // Drain any new bytes from `pos` to current EOF, parsing complete lines and
      // streaming each as either a `meta` (for `_meta.*` records) or `event` SSE
      // message. Anything past the last newline goes back into `buf`.
      const drain = () => {
        if (closed || !existsSync(path)) return;
        const fd = openSync(path, "r");
        try {
          const stat = statSync(path);
          const end = stat.size;
          if (end <= pos) return;
          const chunk = Buffer.alloc(end - pos);
          readSync(fd, chunk, 0, chunk.length, pos);
          pos = end;
          buf += chunk.toString("utf-8");
          let nl: number;
          while ((nl = buf.indexOf("\n")) !== -1) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let parsed: unknown;
            try { parsed = JSON.parse(line); } catch { send("raw", { line }); continue; }
            const obj = parsed as { _meta?: { type?: string } };
            if (obj._meta && obj._meta.type) {
              send("meta", obj);
              if (obj._meta.type === "end" || obj._meta.type === "spawn_error") {
                close(obj._meta.type);
                return;
              }
            } else {
              send("event", obj);
            }
          }
          resetIdle();
        } finally {
          closeSync(fd);
        }
      };

      // Avoid SSE event names that collide with EventSource's built-in DOM
      // events (`open`, `error`). The DOM event fires with no `data`, which
      // crashes any client `JSON.parse(e.data)` listener.
      send("connected", { run_id: resolvedId, path: path.replace(homedir(), "~") });
      drain();
      if (closed) return;

      try {
        watcher = watch(path, () => drain());
      } catch (e) {
        send("stream_error", { message: `watch failed: ${(e as Error).message}` });
        close("watch-error");
        return;
      }
      resetIdle();
    },
    cancel() {
      // client disconnected; nothing to clean up on our side beyond the watcher
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
