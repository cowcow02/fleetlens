import {
  runWeekDigestPipeline, readSettings,
  readWeekDigest, getCurrentWeekDigestFromCache,
} from "@claude-lens/entries/node";
import { asMonday, currentWeekMonday, todayLocal } from "@/lib/entries";
import {
  handleDigestGet, handleDigestPost, jsonResponse, jsonResponseBare,
} from "../../_shared/digest-route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ startDate: string }> };

export async function GET(_req: Request, ctx: Params) {
  const { startDate } = await ctx.params;
  const monday = asMonday(startDate);
  const today = todayLocal();
  const isFuture = monday !== null && monday > today;
  return handleDigestGet({
    key: monday,
    invalidResponse: jsonResponse({ error: "invalid Monday date" }, 400),
    isFuture,
    futureResponse: jsonResponseBare({ error: "future date" }, 400),
    isCurrent: monday !== null && monday === currentWeekMonday(),
    readCurrentCache: () =>
      monday !== null ? getCurrentWeekDigestFromCache(monday, Date.now()) : null,
    readPersisted: () => (monday !== null ? readWeekDigest(monday) : null),
    pendingCurrentPayload: { pending: true, current: true },
    currentFallsBackToPersisted: true,
  });
}

export async function POST(req: Request, ctx: Params) {
  const { startDate } = await ctx.params;
  const monday = asMonday(startDate);
  const isFuture = monday !== null && monday > todayLocal();
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const settings = readSettings();

  return handleDigestPost({
    key: monday,
    invalidResponse: jsonResponseBare({ error: "invalid Monday date" }, 400),
    isFuture,
    futureResponse: jsonResponseBare({ error: "future date" }, 400),
    coalesceScope: "week",
    force,
    jobKind: "weekly.synth",
    jobLabel: `Week digest · ${monday}`,
    resultUrl: `/insights/week-${monday}`,
    runPipeline: () => runWeekDigestPipeline(monday as string, {
      settings: settings.ai_features,
      force,
      currentWeekMonday: currentWeekMonday(),
      todayLocalDay: todayLocal(),
    }),
    readDigestForCoalescedRequest: () =>
      monday !== null
        ? (readWeekDigest(monday) ?? getCurrentWeekDigestFromCache(monday, Date.now()))
        : null,
  });
}
