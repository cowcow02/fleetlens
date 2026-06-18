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

import { invalidateFile, DEFAULT_ROOT, cclensHome } from "@claude-lens/parser/fs";
import { watch, promises as fs, existsSync } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";
// Edge runtime can't do fs.watch
export const runtime = "nodejs";

/** cclensHome()/usage.jsonl — written by the cclens daemon every 5 minutes. */
const USAGE_LOG_DIR = cclensHome();
const USAGE_LOG_FILE = "usage.jsonl";
const TEAM_LAST_PUSH_FILE = "team-last-push.json";

type LiveEvent =
  | {
      type: "session-updated";
      sessionId: string;
      projectDir: string;
      mtimeMs: number;
    }
  | {
      type: "usage-updated";
      mtimeMs: number;
    }
  | {
      type: "team-push";
      mtimeMs: number;
    }
  | { type: "heartbeat"; tsMs: number }
  | { type: "ready" };

const HEARTBEAT_MS = 15_000;

/** Per-file debounce so a burst of writes doesn't flood subscribers. */
const DEBOUNCE_MS = 150;

/** Subagent writes coalesce per PARENT session over a much longer window — a
 *  16-agent workflow fan-out writes constantly, so this caps that to at most
 *  one parent refresh every 2s instead of a storm. */
const SUBAGENT_DEBOUNCE_MS = 2_000;

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
              // Subagent child files under <session>/subagents/ are routed to
              // emitSubagent (throttled, mapped to the parent) by the dispatch
              // below — this early-return is a safety net so they never go
              // through the per-file fast path here.
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

      // Workflow journals (`<session>/workflows/wf_*.json`) aren't `.jsonl`
      // and live a level down, so the main emit() path skips them. Map the
      // journal back to its parent session, drop the parent's cached meta /
      // detail (so the list re-reads the spawned-agent aggregate), and emit a
      // session-updated for the parent — the run itself re-reads journals
      // fresh, so the detail page reflects new fan-out without a parent write.
      function emitWorkflow(fullPath: string) {
        const rel = path.relative(DEFAULT_ROOT, fullPath);
        const parts = rel.split(path.sep);
        const wfIdx = parts.lastIndexOf("workflows");
        if (wfIdx < 2) return;
        const projectDir = parts[0]!;
        const sessionId = parts[wfIdx - 1]!;
        const parentJsonl = path.join(DEFAULT_ROOT, projectDir, `${sessionId}.jsonl`);
        const prev = pending.get(parentJsonl);
        if (prev) clearTimeout(prev);
        pending.set(
          parentJsonl,
          setTimeout(async () => {
            pending.delete(parentJsonl);
            if (closed) return;
            invalidateFile(parentJsonl);
            // Report the JOURNAL's mtime, not the parent .jsonl's. A
            // journal-only write leaves the parent .jsonl untouched, so its
            // (stale) mtime would lose LiveRefresher's monotonic-per-source
            // dedup and the refresh would be silently dropped. The journal we
            // just saw change always carries a fresh mtime.
            let mtimeMs = Date.now();
            try {
              mtimeMs = (await fs.stat(fullPath)).mtimeMs;
            } catch {
              // journal might be gone already — fall back to now.
            }
            send({ type: "session-updated", sessionId, projectDir, mtimeMs });
          }, DEBOUNCE_MS),
        );
      }

      // Background-agent transcripts (`<session>/subagents/agent-*.jsonl`, and
      // workflow agents at `<session>/subagents/workflows/<runId>/agent-*.jsonl`)
      // are written while the parent session sits idle. Map them back to the
      // parent and emit a session-updated so the LIVE indicator (now nested-
      // aware via lastActivityMs) refreshes. Coalesced per-parent over a long
      // window so a big fan-out can't flood subscribers.
      function emitSubagent(fullPath: string) {
        const rel = path.relative(DEFAULT_ROOT, fullPath);
        const parts = rel.split(path.sep);
        const subIdx = parts.lastIndexOf("subagents");
        if (subIdx < 2) return;
        const projectDir = parts[0]!;
        const sessionId = parts[subIdx - 1]!;
        const parentJsonl = path.join(DEFAULT_ROOT, projectDir, `${sessionId}.jsonl`);
        const key = `sub:${parentJsonl}`;
        const prev = pending.get(key);
        if (prev) clearTimeout(prev);
        pending.set(
          key,
          setTimeout(async () => {
            pending.delete(key);
            if (closed) return;
            invalidateFile(parentJsonl);
            // Report the child's fresh mtime — the parent .jsonl may be stale,
            // and LiveRefresher dedups per source by a monotonic mtime.
            let mtimeMs = Date.now();
            try {
              mtimeMs = (await fs.stat(fullPath)).mtimeMs;
            } catch {
              // child gone already — fall back to now.
            }
            send({ type: "session-updated", sessionId, projectDir, mtimeMs });
          }, SUBAGENT_DEBOUNCE_MS),
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
            if (fullPath.endsWith(".jsonl")) {
              if (fullPath.includes(`${path.sep}subagents${path.sep}`)) emitSubagent(fullPath);
              else emit(fullPath);
              return;
            }
            const base = path.basename(fullPath);
            if (
              base.startsWith("wf_") &&
              base.endsWith(".json") &&
              fullPath.includes(`${path.sep}workflows${path.sep}`)
            ) {
              emitWorkflow(fullPath);
            }
          },
        );
      } catch (e) {
        // fs.watch can throw on some filesystems. Still keep the
        // connection open for heartbeats so the client doesn't
        // reconnect-loop; at worst they lose live updates.
        console.error("[events] fs.watch failed:", e);
      }

      // Combined to halve fs.watch noise — a single non-recursive watcher
      // over ~/.cclens/ filters down to the two files we care about.
      let cclensWatcher: ReturnType<typeof watch> | null = null;
      if (existsSync(USAGE_LOG_DIR)) {
        try {
          cclensWatcher = watch(USAGE_LOG_DIR, { persistent: false }, (_eventType, filename) => {
            const name = filename?.toString();
            if (name !== USAGE_LOG_FILE && name !== TEAM_LAST_PUSH_FILE) return;
            const key = `__cclens__${name}`;
            const prev = pending.get(key);
            if (prev) clearTimeout(prev);
            pending.set(
              key,
              setTimeout(async () => {
                pending.delete(key);
                if (closed) return;
                try {
                  const stat = await fs.stat(path.join(USAGE_LOG_DIR, name));
                  if (name === USAGE_LOG_FILE) {
                    send({ type: "usage-updated", mtimeMs: stat.mtimeMs });
                  } else {
                    send({ type: "team-push", mtimeMs: stat.mtimeMs });
                  }
                } catch {
                  // file may have been deleted — silently drop
                }
              }, DEBOUNCE_MS),
            );
          });
        } catch (e) {
          console.error("[events] cclens watch failed:", e);
        }
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
          cclensWatcher?.close();
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
