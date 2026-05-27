/**
 * /api/fluency/subagent
 *
 *   GET  → returns the cached SubagentScorecard for the current 30-day
 *          window, or { pending: true } if no cache exists yet.
 *   POST → runs the pipeline and streams progress events as SSE.
 *          When the scorecard parses, writes it to the disk cache so
 *          subsequent GETs return instantly.
 *
 * Mirrors the digest-week SSE-streaming pattern in
 * apps/web/app/api/digest/week/[startDate]/route.ts.
 */

import {
  Fluency,
} from "@claude-lens/entries";
import { runClaudeSubprocess } from "@claude-lens/entries/node";
import {
  listEntriesLast30Days,
  subagentCacheKey,
  readSubagentCache,
  writeSubagentCache,
} from "@/lib/fluency-data";
import { InflightCoalescer } from "@/lib/inflight-coalesce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const coalescer = new InflightCoalescer<string, void>();

const MEMBER = { id: "local", name: "you" } as const;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "1";

  const key = subagentCacheKey(MEMBER);
  if (!key) {
    return new Response(JSON.stringify({ error: "No entries in the 30-day window" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (!refresh) {
    const cached = readSubagentCache(key.cachePath);
    if (cached) {
      return new Response(JSON.stringify({ scorecard: cached }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
  }
  return new Response(
    JSON.stringify({
      pending: true,
      corpus_sessions: key.corpus.sessions,
      corpus_user_turns: key.corpus.user_turns,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get("refresh") === "1";

  const key = subagentCacheKey(MEMBER);
  if (!key) {
    return new Response(JSON.stringify({ error: "No entries in the 30-day window" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const coalesceKey = `subagent|${MEMBER.id}|${key.windowEnd}|${key.corpusHash}|${force ? "F" : ""}`;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: Fluency.SubagentPipelineEvent) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };
      const finish = () => {
        if (closed) return;
        try { controller.close(); } catch { /* ignore */ }
        closed = true;
      };

      const alreadyInflight = coalescer.inflight(coalesceKey);

      try {
        await coalescer.run(coalesceKey, async () => {
          if (alreadyInflight) return;

          // Honour a cache hit even if the client posted (race: another
          // tab already wrote the file).
          if (!force) {
            const cached = readSubagentCache(key.cachePath);
            if (cached) {
              send({ type: "status", phase: "persist", text: "Cache hit — returning prior result." });
              send({ type: "scorecard", scorecard: cached });
              return;
            }
          }

          // Fresh entries snapshot at run time
          const { entries, windowEnd } = listEntriesLast30Days();

          for await (const ev of Fluency.runSubagentScorecardPipeline({
            member: MEMBER,
            windowEnd,
            entries,
            corpusHash: key.corpusHash,
            onPersist: (sc) => writeSubagentCache(key.cachePath, sc),
            callLLM: async (args) => {
              const r = await runClaudeSubprocess({
                systemPrompt: args.systemPrompt,
                model: args.model,
                userPrompt: args.userPrompt,
                onProgress: args.onProgress,
              });
              return {
                content: r.content,
                model: r.model,
                input_tokens: r.input_tokens,
                output_tokens: r.output_tokens,
              };
            },
          })) {
            send(ev);
          }
        });

        if (alreadyInflight) {
          // Another tab triggered the same run; wait for it to land on
          // disk and stream the cached scorecard.
          const cached = readSubagentCache(key.cachePath);
          if (cached) {
            send({ type: "status", phase: "persist", text: "Coalesced with in-flight request." });
            send({ type: "scorecard", scorecard: cached });
          }
        }
      } catch (err) {
        send({ type: "error", message: (err as Error).message });
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
