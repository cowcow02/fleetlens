/**
 * SSE-streaming pipeline for the Subagent-LLM fluency scorecard.
 *
 * Mirrors the shape of `digest-week-pipeline.ts`: an async generator
 * that yields `SubagentPipelineEvent`s the route handler can pipe to
 * the client. The client renders progress chunks while the LLM call
 * is in flight, then renders the scorecard when `complete` fires.
 *
 * Caching is the caller's responsibility — see
 * `apps/web/lib/fluency-data.ts` for the disk-cache helpers used by
 * the API route's GET path.
 */

import type { Entry } from "../types.js";
import {
  buildUserCorpus,
  parseSubagentScorecardOutput,
  SUBAGENT_FLUENCY_SYSTEM_PROMPT,
  type SubagentScorecard,
} from "./subagent-scorecard.js";

export type SubagentPipelineEvent =
  | { type: "status"; phase: "corpus" | "llm" | "parse" | "persist"; text: string }
  | { type: "progress"; phase: "llm"; bytes: number; elapsed_ms: number }
  | { type: "scorecard"; scorecard: SubagentScorecard }
  | { type: "error"; message: string }
  | { type: "done" };

export type SubagentPipelineOptions = {
  member: { id: string; name: string };
  windowEnd: string;
  entries: Entry[];
  /** Test seam — defaults to the entries `runClaudeSubprocess`. */
  callLLM: (args: {
    systemPrompt: string;
    model: string;
    userPrompt: string;
    onProgress?: (info: { bytes: number; elapsedMs: number }) => void;
  }) => Promise<{ content: string; model: string; input_tokens: number; output_tokens: number }>;
  /** Called after a fresh scorecard parses so the caller can persist. */
  onPersist?: (scorecard: SubagentScorecard, corpusHash: string) => void;
  /** sha256(corpus) used as the cache key. Caller computes it once and
   *  passes it through so the persist callback knows where to write. */
  corpusHash?: string;
};

/** Run the subagent scorecard end-to-end as an async generator. */
export async function* runSubagentScorecardPipeline(
  opts: SubagentPipelineOptions,
): AsyncGenerator<SubagentPipelineEvent, void, void> {
  // Phase 1 — build the corpus
  yield { type: "status", phase: "corpus", text: "Building user-message corpus from the last 30 days…" };
  const corpus = buildUserCorpus({
    member_name: opts.member.name,
    window_end: opts.windowEnd,
    entries: opts.entries,
  });
  if (corpus.user_turns === 0) {
    yield { type: "error", message: "No user turns found in the 30-day window." };
    yield { type: "done" };
    return;
  }
  yield {
    type: "status",
    phase: "corpus",
    text: `Corpus ready — ${corpus.sessions} sessions, ${corpus.user_turns} turns${corpus.truncated ? " (truncated)" : ""}.`,
  };

  // Phase 2 — call the LLM, streaming byte counts as it goes
  yield { type: "status", phase: "llm", text: "Calling Claude with the AI Fluency Framework system prompt…" };
  let res;
  try {
    res = await opts.callLLM({
      systemPrompt: SUBAGENT_FLUENCY_SYSTEM_PROMPT,
      model: "sonnet",
      userPrompt: corpus.markdown,
      onProgress: ({ bytes, elapsedMs }) => {
        // The async generator can't yield from inside the callback; we
        // emit progress via a side-channel through controller buffering
        // by storing the latest progress on `latestProgress` below.
        // (Implemented in the route handler via a polling loop.)
        latestProgress = { bytes, elapsed_ms: elapsedMs };
      },
    });
  } catch (err) {
    yield { type: "error", message: `LLM call failed: ${(err as Error).message}` };
    yield { type: "done" };
    return;
  }
  yield {
    type: "status",
    phase: "llm",
    text: `Claude returned ${res.output_tokens} tokens (${res.model}).`,
  };

  // Phase 3 — parse the marker-delimited output
  yield { type: "status", phase: "parse", text: "Parsing scorecard sections + evidence quotes…" };
  const cost = estimateCost(res.model, res.input_tokens, res.output_tokens);
  // Build prefix → full-id map so each LLM-cited quote can link to its
  // session page. First occurrence wins on prefix collision — at 8 hex
  // chars across <1k sessions the collision probability is negligible.
  const shortIdMap = new Map<string, string>();
  for (const e of opts.entries) {
    const short = e.session_id.slice(0, 8);
    if (!shortIdMap.has(short)) shortIdMap.set(short, e.session_id);
  }

  const parsed = parseSubagentScorecardOutput(res.content, {
    member_id: opts.member.id,
    member_name: opts.member.name,
    window_end: opts.windowEnd,
    corpus_user_turns: corpus.user_turns,
    corpus_sessions: corpus.sessions,
    llm: { model: res.model, cost_usd: cost },
    shortIdMap,
  });
  if (!parsed) {
    yield {
      type: "error",
      message: "Model output didn't match the expected marker schema (###SUMMARY### / ###SCORECARD### / ###INSIGHTS### / ###END###).",
    };
    yield { type: "done" };
    return;
  }

  // Phase 4 — persist + emit the parsed scorecard
  if (opts.onPersist && opts.corpusHash) {
    yield { type: "status", phase: "persist", text: "Writing scorecard to disk cache…" };
    try { opts.onPersist(parsed, opts.corpusHash); } catch { /* non-fatal */ }
  }
  yield { type: "scorecard", scorecard: parsed };
  yield { type: "done" };
}

/* ------------------------------------------------------------------ */

// Module-level latch the LLM progress callback writes to. The route
// handler can read this between SSE flushes when it wants to surface
// streaming-bytes progress. Per-generator-instance lifetime is enough
// because we only ever run one subagent pipeline at a time (the route
// uses an InflightCoalescer to enforce that).
let latestProgress: { bytes: number; elapsed_ms: number } | null = null;

/** Read + clear the latest streaming progress observed during the LLM
 *  call. Returns null when no new progress has been recorded since the
 *  last read. */
export function takeLatestSubagentProgress(): { bytes: number; elapsed_ms: number } | null {
  const p = latestProgress;
  latestProgress = null;
  return p;
}

function estimateCost(model: string, inT: number, outT: number): number | null {
  const m = model.toLowerCase();
  let p: { input: number; output: number } | undefined;
  if (m.includes("opus")) p = { input: 15, output: 75 };
  else if (m.includes("sonnet")) p = { input: 3, output: 15 };
  else if (m.includes("haiku")) p = { input: 1, output: 5 };
  if (!p) return null;
  return (inT * p.input + outT * p.output) / 1_000_000;
}
