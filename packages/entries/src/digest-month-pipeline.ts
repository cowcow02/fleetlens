import {
  readMonthDigest, writeMonthDigest,
  readWeekDigest,
  getCurrentMonthDigestFromCache, setCurrentMonthDigestInCache,
} from "./digest-fs.js";
import { runWeekDigestPipeline, mondayFor, type WeekPipelineOptions } from "./digest-week-pipeline.js";
import { generateMonthDigest, buildDeterministicMonthDigest, mondaysInMonth } from "./digest-month.js";
import { appendSpend } from "./budget.js";
import { writeInteractiveLock, removeInteractiveLock } from "./pipeline-lock.js";
import type { CallLLM } from "./enrich.js";
import type { AiFeaturesSettings } from "./settings.js";
import type { MonthDigest, WeekDigest } from "./types.js";
import type { PipelineEvent } from "./digest-day-pipeline.js";

export type MonthPipelineOptions = {
  settings: AiFeaturesSettings;
  force?: boolean;
  callLLM?: CallLLM;
  now?: () => number;
  /** Current local YYYY-MM in server TZ. */
  currentYearMonth: string;
  /** Current local Monday — sub-pipelines need this. */
  currentWeekMonday: string;
  /** Current local day — sub-pipelines need this. */
  todayLocalDay: string;
  caller?: "web" | "cli" | "daemon";
};

export async function* runMonthDigestPipeline(
  yearMonth: string,
  opts: MonthPipelineOptions,
): AsyncGenerator<PipelineEvent, void, void> {
  const now = opts.now ?? (() => Date.now());
  const isCurrentMonth = yearMonth === opts.currentYearMonth;
  const aiOn = opts.settings.enabled;

  if (!isCurrentMonth && !opts.force) {
    const cached = readMonthDigest(yearMonth);
    if (cached) { yield { type: "digest", digest: cached }; return; }
  }
  if (isCurrentMonth && !opts.force) {
    const cached = getCurrentMonthDigestFromCache(yearMonth, now());
    if (cached) { yield { type: "digest", digest: cached }; return; }
  }

  yield { type: "status", phase: "load_dependencies", text: `Loading weeks for ${yearMonth}` };
  const mondays = mondaysInMonth(yearMonth);
  const weekDigests: WeekDigest[] = [];

  for (const monday of mondays) {
    const isFutureWeek = monday > opts.currentWeekMonday;
    if (isFutureWeek) {
      yield { type: "dependency", kind: "week", key: monday, status: "cached" };
      continue;
    }
    const isCurrentWeek = monday === opts.currentWeekMonday;

    const cached = isCurrentWeek ? null : readWeekDigest(monday);
    if (cached) {
      weekDigests.push(cached);
      yield { type: "dependency", kind: "week", key: monday, status: "cached" };
      continue;
    }

    if (isCurrentWeek) {
      // Read current week via week pipeline (TTL-cached). Never force.
      const subOpts: WeekPipelineOptions = {
        settings: opts.settings, force: false, callLLM: opts.callLLM, now: opts.now,
        currentWeekMonday: opts.currentWeekMonday,
        todayLocalDay: opts.todayLocalDay,
        caller: opts.caller,
      };
      let captured: WeekDigest | null = null;
      let failed = false;
      for await (const ev of runWeekDigestPipeline(monday, subOpts)) {
        if (ev.type === "digest" && ev.digest.scope === "week") captured = ev.digest as WeekDigest;
        if (ev.type === "error") { failed = true; break; }
      }
      if (captured) {
        weekDigests.push(captured);
        yield { type: "dependency", kind: "week", key: monday, status: "cached" };
      } else if (failed) {
        yield { type: "dependency", kind: "week", key: monday, status: "failed" };
      }
      continue;
    }

    // Past week, no cache → generate inline.
    const subOpts: WeekPipelineOptions = {
      settings: opts.settings, force: false, callLLM: opts.callLLM, now: opts.now,
      currentWeekMonday: opts.currentWeekMonday,
      todayLocalDay: opts.todayLocalDay,
      caller: opts.caller,
    };
    let captured: WeekDigest | null = null;
    let failed = false;
    for await (const ev of runWeekDigestPipeline(monday, subOpts)) {
      if (ev.type === "digest") {
        if (ev.digest.scope === "week") captured = ev.digest as WeekDigest;
        continue;
      }
      if (ev.type === "saved") continue;
      if (ev.type === "error") { failed = true; continue; }
      yield ev;
    }
    if (captured) {
      weekDigests.push(captured);
      yield { type: "dependency", kind: "week", key: monday, status: "generated" };
    } else if (failed) {
      yield { type: "dependency", kind: "week", key: monday, status: "failed" };
    }
  }

  if (weekDigests.length === 0) {
    yield { type: "error", message: `no week digests available for ${yearMonth}` };
    return;
  }

  if (aiOn) writeInteractiveLock();
  try {
    let digest: MonthDigest;
    if (aiOn) {
      yield { type: "status", phase: "synth", text: "Synthesizing month narrative" };
      const progressQueue: Array<{ bytes: number; elapsed_ms: number }> = [];
      const synthPromise = generateMonthDigest(yearMonth, weekDigests, {
        model: opts.settings.model, callLLM: opts.callLLM,
        onProgress: info => { progressQueue.push({ bytes: info.bytes, elapsed_ms: info.elapsedMs }); },
      });

      let done = false;
      synthPromise.finally(() => { done = true; });
      while (!done) {
        await new Promise(r => setTimeout(r, 500));
        if (progressQueue.length > 0) {
          const latest = progressQueue[progressQueue.length - 1]!;
          yield { type: "progress", phase: "synth", bytes: latest.bytes, elapsed_ms: latest.elapsed_ms };
          progressQueue.length = 0;
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
          kind: "month_digest", ref: yearMonth,
        });
      }
    } else {
      digest = buildDeterministicMonthDigest(yearMonth, weekDigests);
    }

    if (!isCurrentMonth) {
      writeMonthDigest(digest);
      yield { type: "saved", path: `~/.cclens/digests/month/${yearMonth}.json` };
    } else {
      digest.is_live = true;
      setCurrentMonthDigestInCache(yearMonth, digest, now());
      // Mirror digest-week-pipeline: force=true on the current month is an
      // explicit user-driven generation. The default in-memory TTL isn't
      // visible across Next.js route bundles, so the insights / print page's
      // RSC can't see what the API route just generated. Persist on force so
      // PDF export and direct revisits land on the same digest.
      if (opts.force === true) {
        writeMonthDigest(digest);
        yield { type: "saved", path: `~/.cclens/digests/month/${yearMonth}.json` };
      }
    }

    yield { type: "digest", digest };
  } finally {
    if (aiOn) removeInteractiveLock();
  }
}

/** Re-export for callers that prefer to import month-pipeline-only. */
export { mondayFor };
