/**
 * Live event feed for one chat's active run.
 *
 * GET ?after=<seq> — replays buffered run events with seq > after, then
 * streams live ones until the run finishes. If no run is active, emits a
 * single sync frame (current status) and closes — the client renders from
 * the persisted chat it fetched first, so nothing is ever lost between
 * that snapshot and this subscription.
 */

import { readChat } from "@/lib/agent/chat-store";
import { getRun, reconcileChat } from "@/lib/agent/run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_MS = 20_000;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const after = Number(url.searchParams.get("after") ?? 0) || 0;

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
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {}
      };
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          closed = true;
        }
      }, HEARTBEAT_MS);

      const run = getRun(id);
      if (!run) {
        const chat = readChat(id);
        send({ type: "sync", status: chat ? reconcileChat(chat).status : "gone" });
        close();
        return;
      }

      const forward = (event: { seq: number; type: string }) => {
        if (event.seq > after) send(event);
        if (event.type === "done" || event.type === "error") {
          run.subscribers.delete(forward);
          close();
        }
      };
      for (const event of run.events) forward(event);
      if (!closed) run.subscribers.add(forward);

      request.signal.addEventListener("abort", () => {
        run.subscribers.delete(forward);
        close();
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
