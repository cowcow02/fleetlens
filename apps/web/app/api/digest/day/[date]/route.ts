import {
  runDayDigestPipeline, readSettings, getTodayDigestFromCache,
} from "@claude-lens/entries/node";
import { readDayDigest } from "@claude-lens/entries/fs";
import { isValidDate, todayLocal } from "@/lib/entries";
import {
  handleDigestGet, handleDigestPost, jsonResponse, jsonResponseBare,
} from "../../_shared/digest-route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ date: string }> };

export async function GET(_req: Request, ctx: Params) {
  const { date } = await ctx.params;
  const valid = isValidDate(date);
  const isFuture = valid && date > todayLocal();
  return handleDigestGet({
    key: valid ? date : null,
    invalidResponse: jsonResponse({ error: "invalid date" }, 400),
    isFuture,
    futureResponse: jsonResponse({ error: "future date" }, 400),
    isCurrent: valid && date === todayLocal(),
    readCurrentCache: () => getTodayDigestFromCache(date, Date.now()),
    readPersisted: () => readDayDigest(date),
    pendingCurrentPayload: { pending: true, today: true },
    currentFallsBackToPersisted: false,
  });
}

export async function POST(req: Request, ctx: Params) {
  const { date } = await ctx.params;
  const valid = isValidDate(date);
  const isFuture = valid && date > todayLocal();
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const settings = readSettings();

  return handleDigestPost({
    key: valid ? date : null,
    invalidResponse: jsonResponseBare({ error: "invalid date" }, 400),
    isFuture,
    futureResponse: jsonResponseBare({ error: "future date" }, 400),
    coalesceScope: "day",
    force,
    jobKind: "digest.day",
    jobLabel: `Day digest · ${date}`,
    resultUrl: `/day/${date}`,
    runPipeline: () => runDayDigestPipeline(date, {
      settings: settings.ai_features,
      force,
      todayLocalDay: todayLocal(),
    }),
    readDigestForCoalescedRequest: () =>
      readDayDigest(date) ?? getTodayDigestFromCache(date, Date.now()),
  });
}
