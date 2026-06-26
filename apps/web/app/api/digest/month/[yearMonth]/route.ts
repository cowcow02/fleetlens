import {
  runMonthDigestPipeline, readSettings,
  readMonthDigest, getCurrentMonthDigestFromCache,
} from "@claude-lens/entries/node";
import {
  isValidYearMonth, currentYearMonth, currentWeekMonday, todayLocal,
} from "@/lib/entries";
import {
  handleDigestGet, handleDigestPost, jsonResponse, jsonResponseBare,
} from "../../_shared/digest-route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ yearMonth: string }> };

export async function GET(_req: Request, ctx: Params) {
  const { yearMonth } = await ctx.params;
  const valid = isValidYearMonth(yearMonth);
  const isFuture = valid && yearMonth > currentYearMonth();
  return handleDigestGet({
    key: valid ? yearMonth : null,
    invalidResponse: jsonResponse({ error: "invalid year-month" }, 400),
    isFuture,
    futureResponse: jsonResponseBare({ error: "future month" }, 400),
    isCurrent: valid && yearMonth === currentYearMonth(),
    readCurrentCache: () => getCurrentMonthDigestFromCache(yearMonth, Date.now()),
    readPersisted: () => readMonthDigest(yearMonth),
    pendingCurrentPayload: { pending: true, current: true },
    currentFallsBackToPersisted: false,
  });
}

export async function POST(req: Request, ctx: Params) {
  const { yearMonth } = await ctx.params;
  const valid = isValidYearMonth(yearMonth);
  const isFuture = valid && yearMonth > currentYearMonth();
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const settings = readSettings();

  return handleDigestPost({
    key: valid ? yearMonth : null,
    invalidResponse: jsonResponseBare({ error: "invalid year-month" }, 400),
    isFuture,
    futureResponse: jsonResponseBare({ error: "future month" }, 400),
    coalesceScope: "month",
    force,
    jobKind: "monthly.synth",
    jobLabel: `Month digest · ${yearMonth}`,
    resultUrl: `/insights/month-${yearMonth}`,
    runPipeline: () => runMonthDigestPipeline(yearMonth, {
      settings: settings.ai_features,
      force,
      currentYearMonth: currentYearMonth(),
      currentWeekMonday: currentWeekMonday(),
      todayLocalDay: todayLocal(),
    }),
    readDigestForCoalescedRequest: () =>
      readMonthDigest(yearMonth) ?? getCurrentMonthDigestFromCache(yearMonth, Date.now()),
  });
}
