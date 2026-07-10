/**
 * Search-index maintenance.
 *
 * GET  → current index stats (session count, last refresh, building flag)
 * POST → run an incremental refresh, streaming progress as SSE
 */

import { ensureIndex, indexStats } from "@/lib/assistant/index-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return Response.json(indexStats());
}

export async function POST() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      void (async () => {
        try {
          const docs = await ensureIndex((p) => send({ type: "progress", ...p }));
          send({ type: "done", sessions: docs.length });
        } catch (err) {
          send({ type: "error", message: (err as Error).message });
        }
        if (!closed) {
          try {
            controller.close();
          } catch {}
          closed = true;
        }
      })();
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
