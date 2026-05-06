import { listEntriesForDay, writeEntry } from "./fs.js";
import {
  readDayDigest, writeDayDigest,
  getTodayDigestFromCache, setTodayDigestInCache,
} from "./digest-fs.js";
import { enrichEntry, type CallLLM } from "./enrich.js";
import { generateDayDigest, buildDeterministicDigest } from "./digest-day.js";
import { appendSpend, monthToDateSpend } from "./budget.js";
import { writeInteractiveLock, removeInteractiveLock } from "./pipeline-lock.js";
import { listSessions } from "@claude-lens/parser/fs";
import { computeBurstsFromSessions, aggregateConcurrency } from "@claude-lens/parser";
import type { AiFeaturesSettings } from "./settings.js";
import type { DayDigest, Entry, EntryEnrichmentStatus, MonthDigest, WeekDigest } from "./types.js";

/** Compute the deterministic concurrency_peak for a single local day, using the
 *  same burst-merge rules as the /parallelism page and week-rollup so values
 *  agree across surfaces. Returns 0 on any failure (best-effort). */
async function computeDayConcurrencyPeak(date: string): Promise<number> {
  try {
    const metas = await listSessions({ limit: 10000 });
    const bursts = computeBurstsFromSessions(metas);
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    const start = new Date(y, m - 1, d, 0, 0, 0, 0);
    const end = new Date(y, m - 1, d, 23, 59, 59, 999);
    return aggregateConcurrency(bursts, { start, end }).peak;
  } catch { return 0; }
}

/** Shared event union across day/week/month pipelines.
 *  - day pipeline: emits status + entry + progress + digest + saved + error
 *  - week pipeline: also emits `dependency` (per missing day digest it generates) and the synth-phase status uses `phase: "load_dependencies"` while it walks the dependency graph
 *  - month pipeline: same as week, but dependencies are weeks not days */
export type PipelineEvent =
  | { type: "status"; phase: "enrich" | "synth" | "persist" | "load_dependencies"; text: string }
  | { type: "entry"; session_id: string; index: number; total: number; status: EntryEnrichmentStatus; cost_usd: number | null }
  | { type: "dependency"; kind: "day" | "week"; key: string; status: "cached" | "generated" | "failed" }
  | { type: "progress"; phase: "enrich" | "synth"; bytes: number; elapsed_ms: number }
  | { type: "digest"; digest: DayDigest | WeekDigest | MonthDigest }
  | { type: "saved"; path: string }
  | { type: "error"; message: string };

export type PipelineOptions = {
  settings: AiFeaturesSettings;
  force?: boolean;
  callLLM?: CallLLM;
  now?: () => number;
  /** The current local day in server TZ; if `date === todayLocalDay`, skip disk persistence. */
  todayLocalDay: string;
  /** Attribution for spend records. Defaults to "web". */
  caller?: "web" | "cli" | "daemon";
};

const THIRTY_MIN_MS = 30 * 60 * 1000;
const MAX_RETRY_COUNT = 3;

export async function* runDayDigestPipeline(
  date: string,
  opts: PipelineOptions,
): AsyncGenerator<PipelineEvent, void, void> {
  const now = opts.now ?? (() => Date.now());
  const isToday = date === opts.todayLocalDay;
  const aiOn = opts.settings.enabled;

  // Short-circuit: past day, cached, !force → single digest event
  if (!isToday && !opts.force) {
    const cached = readDayDigest(date);
    if (cached) { yield { type: "digest", digest: cached }; return; }
  }

  // Short-circuit: today, cached in-memory TTL, !force → single digest event
  if (isToday && !opts.force) {
    const cached = getTodayDigestFromCache(date, now());
    if (cached) { yield { type: "digest", digest: cached }; return; }
  }

  const entries = listEntriesForDay(date) as Entry[];
  if (entries.length === 0) {
    yield { type: "error", message: `no entries for date ${date}` };
    return;
  }

  if (aiOn) writeInteractiveLock();
  try {
    // Stage 1: enrich
    if (aiOn) {
      // Force rescue: entries permanently stuck at retry_count >= MAX_RETRY_COUNT
      // get reset to pending+retry_count=0 so a force regen can try them again.
      // Prior runs of these entries may have failed due to rate-limits that
      // we now detect (and don't count) — but pre-fix entries are still stuck.
      if (opts.force) {
        for (const e of entries) {
          if (e.enrichment.status === "error" && (e.enrichment.retry_count ?? 0) >= MAX_RETRY_COUNT) {
            const rescued: Entry = {
              ...e,
              enrichment: { ...e.enrichment, status: "pending", retry_count: 0, error: null },
            };
            writeEntry(rescued);
          }
        }
      }
      // Re-read after any rescue writes so we pick up the now-pending entries.
      const freshForEnrich = opts.force ? listEntriesForDay(date) as Entry[] : entries;
      const pending = freshForEnrich.filter(e => {
        if (e.enrichment.status !== "pending" && e.enrichment.status !== "error") return false;
        if ((e.enrichment.retry_count ?? 0) >= MAX_RETRY_COUNT) return false;
        // Today's entries are normally excluded so a fresh sweep doesn't
        // burn LLM cost on still-evolving sessions. Override on force=true
        // so the user can deliberately request today's narrative.
        if (e.local_day === opts.todayLocalDay && !opts.force) return false;
        const endMs = Date.parse(e.end_iso);
        if (!Number.isNaN(endMs) && now() - endMs < THIRTY_MIN_MS) return false;
        return true;
      });

      if (pending.length > 0) {
        yield { type: "status", phase: "enrich", text: `Enriching ${pending.length} entries for ${date}` };
        const budget = opts.settings.monthlyBudgetUsd ?? Infinity;
        // Run up to ENRICH_CONCURRENCY entries in parallel. Each enrichment
        // call is independent (no shared state) and small (~5K cache_creation,
        // ~500-2K out tokens), so 3-way parallelism cuts the entry phase wall
        // time from ~639s to ~213s on a typical 46-entry week without
        // saturating the subscription rate-limit window.
        const ENRICH_CONCURRENCY = 3;
        let processed = 0;
        outer: for (let i = 0; i < pending.length; i += ENRICH_CONCURRENCY) {
          if (monthToDateSpend() >= budget) {
            yield { type: "status", phase: "enrich", text: `budget cap reached — stopping enrichment` };
            break;
          }
          const batch = pending.slice(i, i + ENRICH_CONCURRENCY);
          // Wrap each enrichment so a thrown error becomes a tagged result
          // rather than silently disappearing. Lets us emit a progress event
          // for the failed entry AND keeps the chunk going on partial fail.
          const results = await Promise.all(batch.map(entry =>
            enrichEntry(entry, { model: opts.settings.model, callLLM: opts.callLLM })
              .then(r => ({ ok: true as const, entry, result: r.entry, usage: r.usage }))
              .catch(err => {
                console.warn(`[enrich] ${entry.session_id} failed: ${(err as Error).message}`);
                return { ok: false as const, entry, error: (err as Error).message };
              }),
          ));
          for (const r of results) {
            processed++;
            if (!r.ok) {
              // Surface the error to the SSE consumer with a real index so the
              // "X/Y" progress counter doesn't stall on rejected calls.
              yield {
                type: "entry", session_id: r.entry.session_id,
                index: processed, total: pending.length,
                status: "error", cost_usd: 0,
              };
              continue;
            }
            const { result, usage } = r;
            writeEntry(result);
            // Append spend whenever the call returned token usage — including
            // failed-validation cases where the LLM consumed cache_creation +
            // output but the result didn't pass schema. Previously gated on
            // status="done" only, which silently undercounted budget.
            if (usage) {
              appendSpend({
                ts: new Date().toISOString(), caller: opts.caller ?? "web",
                model: result.enrichment.model ?? opts.settings.model,
                input_tokens: usage.input_tokens,
                output_tokens: usage.output_tokens,
                cost_usd: result.enrichment.cost_usd ?? 0,
                kind: "entry_enrich",
                ref: `${result.session_id}__${result.local_day}`,
              });
            }
            yield {
              type: "entry", session_id: result.session_id,
              index: processed, total: pending.length,
              status: result.enrichment.status, cost_usd: result.enrichment.cost_usd,
            };
          }
          // Cap re-checked after each chunk so we don't run forever on a
          // budget breach mid-batch. The chunk completes (overshoot up to
          // ENRICH_CONCURRENCY-1) then we stop.
          if (monthToDateSpend() >= budget) {
            yield { type: "status", phase: "enrich", text: `budget cap reached — stopping enrichment` };
            break outer;
          }
        }
      }
    }

    // Reload entries (may have updated enrichment)
    const fresh = listEntriesForDay(date) as Entry[];

    // Concurrency peak is computed once from session bursts so day / week /
    // month / parallelism-page values stay aligned.
    const concurrencyPeak = await computeDayConcurrencyPeak(date);

    // Stage 2: synthesize
    let digest: DayDigest;
    if (aiOn) {
      yield { type: "status", phase: "synth", text: "Synthesizing day narrative" };
      // Queue of synth-phase progress snapshots; drained by the poller below
      // while generateDayDigest awaits claude -p.
      const progressQueue: Array<{ bytes: number; elapsed_ms: number }> = [];
      const synthPromise = generateDayDigest(date, fresh, {
        model: opts.settings.model, callLLM: opts.callLLM,
        concurrencyPeak,
        onProgress: (info) => {
          progressQueue.push({ bytes: info.bytes, elapsed_ms: info.elapsedMs });
        },
      });

      // Poll progress every 500ms until synthesis resolves.
      const emissions: Array<{ bytes: number; elapsed_ms: number }> = [];
      let done = false;
      synthPromise.finally(() => { done = true; });
      while (!done) {
        await new Promise(r => setTimeout(r, 500));
        while (progressQueue.length > 0) {
          emissions.push(progressQueue.shift()!);
        }
        if (emissions.length > 0) {
          const latest = emissions[emissions.length - 1]!;
          yield { type: "progress", phase: "synth", bytes: latest.bytes, elapsed_ms: latest.elapsed_ms };
          emissions.length = 0;
        }
      }
      const r = await synthPromise;
      digest = r.digest;
      if (r.usage) {
        appendSpend({
          ts: new Date().toISOString(), caller: opts.caller ?? "web",
          model: digest.model ?? opts.settings.model,
          input_tokens: r.usage.input_tokens,
          output_tokens: r.usage.output_tokens,
          cost_usd: digest.cost_usd ?? 0,
          kind: "day_digest", ref: date,
        });
      }
    } else {
      digest = buildDeterministicDigest(date, fresh, { concurrencyPeak });
    }

    // Stage 3: persist
    if (!isToday) {
      writeDayDigest(digest);
      yield { type: "saved", path: `~/.cclens/digests/day/${date}.json` };
    } else {
      setTodayDigestInCache(date, digest, now());
    }

    yield { type: "digest", digest };
  } finally {
    if (aiOn) removeInteractiveLock();
  }
}
