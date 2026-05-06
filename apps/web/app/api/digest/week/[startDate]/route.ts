import {
  runWeekDigestPipeline, readSettings,
  readWeekDigest, getCurrentWeekDigestFromCache,
} from "@claude-lens/entries/node";
import type { PipelineEvent } from "@claude-lens/entries/node";
import { InflightCoalescer } from "@/lib/inflight-coalesce";
import { asMonday, currentWeekMonday, todayLocal } from "@/lib/entries";
import { registerJob, updateJob, completeJob, failJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ startDate: string }> };

const coalescer = new InflightCoalescer<string, void>();

function updateJobFromEvent(jobId: string, ev: PipelineEvent): void {
  if (ev.type === "status") {
    updateJob(jobId, { progress: { phase: ev.phase, text: ev.text } });
  } else if (ev.type === "entry") {
    updateJob(jobId, { progress: { phase: "enrich", index: ev.index, total: ev.total } });
  } else if (ev.type === "progress") {
    updateJob(jobId, { progress: { phase: ev.phase, bytes: ev.bytes } });
  }
}

export async function GET(_req: Request, ctx: Params) {
  const { startDate } = await ctx.params;
  const monday = asMonday(startDate);
  if (!monday) {
    return new Response(JSON.stringify({ error: "invalid Monday date" }), {
      status: 400, headers: { "content-type": "application/json" },
    });
  }
  const today = todayLocal();
  if (monday > today) {
    return new Response(JSON.stringify({ error: "future date" }), { status: 400 });
  }

  const isCurrent = monday === currentWeekMonday();
  if (isCurrent) {
    const cached =
      getCurrentWeekDigestFromCache(monday, Date.now()) ?? readWeekDigest(monday);
    if (cached) {
      return new Response(JSON.stringify(cached), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ pending: true, current: true }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }

  const cached = readWeekDigest(monday);
  if (cached) {
    return new Response(JSON.stringify(cached), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ pending: true }), {
    status: 200, headers: { "content-type": "application/json" },
  });
}

export async function POST(req: Request, ctx: Params) {
  const { startDate } = await ctx.params;
  const monday = asMonday(startDate);
  if (!monday) {
    return new Response(JSON.stringify({ error: "invalid Monday date" }), { status: 400 });
  }
  if (monday > todayLocal()) {
    return new Response(JSON.stringify({ error: "future date" }), { status: 400 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const key = `week|${monday}|${force ? 1 : 0}`;

  const encoder = new TextEncoder();
  const settings = readSettings();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      function send(event: PipelineEvent) {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          closed = true;
        }
      }
      function finish() {
        if (!closed) {
          try { controller.close(); } catch { /* ignore */ }
          closed = true;
        }
      }

      const alreadyInflight = coalescer.inflight(key);
      let jobId: string | null = null;

      try {
        await coalescer.run(key, async () => {
          if (alreadyInflight) return;
          jobId = registerJob({
            kind: "weekly.synth",
            label: `Week digest · ${monday}`,
            target: monday,
            caller: "user",
          });
          updateJob(jobId, { status: "running" });
          for await (const ev of runWeekDigestPipeline(monday, {
            settings: settings.ai_features,
            force,
            currentWeekMonday: currentWeekMonday(),
            todayLocalDay: todayLocal(),
          })) {
            send(ev);
            if (jobId) updateJobFromEvent(jobId, ev);
          }
          if (jobId) completeJob(jobId, `/insights/week-${monday}`);
        });

        if (alreadyInflight) {
          const d = readWeekDigest(monday) ?? getCurrentWeekDigestFromCache(monday, Date.now());
          if (d) send({ type: "digest", digest: d });
          send({ type: "status", phase: "persist", text: "coalesced with in-flight request" });
        }
      } catch (err) {
        send({ type: "error", message: (err as Error).message });
        if (jobId) failJob(jobId, (err as Error).message);
      } finally {
        try { controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`)); } catch { /* ignore */ }
        finish();
      }
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
