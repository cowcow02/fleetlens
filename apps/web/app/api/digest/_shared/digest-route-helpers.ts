import "server-only";
import type {
  DayDigest, MonthDigest, WeekDigest,
} from "@claude-lens/entries";
import type { PipelineEvent } from "@claude-lens/entries/node";
import { InflightCoalescer } from "@/lib/inflight-coalesce";
import {
  type JobKind,
  registerJob, updateJob, completeJob, failJob,
} from "@/lib/jobs";

type AnyDigest = DayDigest | WeekDigest | MonthDigest;

// Shared coalescer instance for all digest periods. Per-period keys are
// already prefixed (day|/week|/month|) so a single instance is equivalent
// to the previous one-per-route setup.
const coalescer = new InflightCoalescer<string, void>();

export function updateJobFromEvent(jobId: string, ev: PipelineEvent): void {
  if (ev.type === "status") {
    updateJob(jobId, { progress: { phase: ev.phase, text: ev.text } });
  } else if (ev.type === "entry") {
    updateJob(jobId, { progress: { phase: "enrich", index: ev.index, total: ev.total } });
  } else if (ev.type === "progress") {
    updateJob(jobId, { progress: { phase: ev.phase, bytes: ev.bytes } });
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });
}

// 400 without content-type header — preserves byte-equality for the routes
// whose POST validation paths historically omitted it.
function jsonResponseBare(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status });
}

export type DigestGetSpec = {
  // Parsed/validated key for cache reads. null = invalid input.
  key: string | null;
  // Validation error response when key is null.
  invalidResponse: Response;
  // True if the key represents a future date/period.
  isFuture: boolean;
  futureResponse: Response;
  // True if the key represents the current (in-progress) period.
  isCurrent: boolean;
  // Lookup for the in-memory current-period cache (only consulted when isCurrent).
  readCurrentCache: () => AnyDigest | null | undefined;
  // Persisted-disk lookup (consulted for past periods, and as a fallback for
  // current periods that have already been persisted — week uses this fallback,
  // day and month do not).
  readPersisted: () => AnyDigest | null | undefined;
  // Payload shape for the "no cache yet" current-period response. Day uses
  // {pending:true, today:true}; week and month use {pending:true, current:true}.
  pendingCurrentPayload: Record<string, unknown>;
  // True if the current-period branch should also fall back to readPersisted
  // when the in-memory cache is empty. Week does this; day and month do not.
  currentFallsBackToPersisted: boolean;
};

export function handleDigestGet(spec: DigestGetSpec): Response {
  if (spec.key === null) return spec.invalidResponse;
  if (spec.isFuture) return spec.futureResponse;

  if (spec.isCurrent) {
    const cached = spec.currentFallsBackToPersisted
      ? (spec.readCurrentCache() ?? spec.readPersisted())
      : spec.readCurrentCache();
    if (cached) return jsonResponse(cached, 200);
    return jsonResponse(spec.pendingCurrentPayload, 200);
  }

  const cached = spec.readPersisted();
  if (cached) return jsonResponse(cached, 200);
  return jsonResponse({ pending: true }, 200);
}

export type DigestPostSpec = {
  // Parsed/validated key — feeds cache key, job target, resultUrl. null = invalid.
  key: string | null;
  invalidResponse: Response;
  isFuture: boolean;
  futureResponse: Response;
  // Coalescer key prefix: "day" / "week" / "month".
  coalesceScope: string;
  // ?force=1
  force: boolean;
  // Job-tracking fields.
  jobKind: JobKind;
  jobLabel: string;
  // resultUrl for completeJob.
  resultUrl: string;
  // Pre-bound pipeline factory — the helper never sees the per-period option shape.
  runPipeline: () => AsyncIterable<PipelineEvent>;
  // Fallback to deliver a final digest to a request that coalesced onto an
  // in-flight run. Returns the digest if available, else null/undefined.
  readDigestForCoalescedRequest: () => AnyDigest | null | undefined;
};

export function handleDigestPost(spec: DigestPostSpec): Response {
  if (spec.key === null) return spec.invalidResponse;
  if (spec.isFuture) return spec.futureResponse;

  const coalesceKey = `${spec.coalesceScope}|${spec.key}|${spec.force ? 1 : 0}`;
  const encoder = new TextEncoder();

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
          try { controller.close(); } catch { /* already */ }
          closed = true;
        }
      }

      const alreadyInflight = coalescer.inflight(coalesceKey);
      let jobId: string | null = null;

      try {
        await coalescer.run(coalesceKey, async () => {
          if (alreadyInflight) return;
          jobId = registerJob({
            kind: spec.jobKind,
            label: spec.jobLabel,
            target: spec.key as string,
            caller: "user",
          });
          updateJob(jobId, { status: "running" });
          for await (const ev of spec.runPipeline()) {
            send(ev);
            if (jobId) updateJobFromEvent(jobId, ev);
          }
          if (jobId) completeJob(jobId, spec.resultUrl);
        });

        if (alreadyInflight) {
          const d = spec.readDigestForCoalescedRequest();
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

// Re-export so route files can build their own validation responses without
// duplicating the JSON-body Response idiom.
export { jsonResponse, jsonResponseBare };
