import { notFound } from "next/navigation";
import {
  readSettings, readWeekDigest, readMonthDigest,
  getCurrentWeekDigestFromCache, getCurrentMonthDigestFromCache,
} from "@claude-lens/entries/node";
import { WeekDigestView } from "@/components/week-digest-view";
import { MonthDigestView } from "@/components/month-digest-view";
import { InsightsTopBar } from "@/components/insights-top-bar";
import { currentWeekMonday, currentYearMonth } from "@/lib/entries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WEEK_KEY = /^week-(\d{4}-\d{2}-\d{2})$/;
const MONTH_KEY = /^month-(\d{4}-\d{2})$/;

export default async function SavedInsightPage({
  params,
}: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const aiOn = readSettings().ai_features.enabled;

  const weekMatch = WEEK_KEY.exec(key);
  if (weekMatch) {
    const monday = weekMatch[1]!;
    // Current-week digests live in an in-memory TTL cache by default. When
    // the user explicitly forces generation we ALSO persist to disk
    // (digest-week-pipeline) so the result survives across Next.js route
    // bundles — fall back to disk here so the page actually reads what
    // they paid the LLM to produce.
    const isCurrent = monday === currentWeekMonday();
    const cached = isCurrent
      ? (getCurrentWeekDigestFromCache(monday, Date.now()) ?? readWeekDigest(monday))
      : readWeekDigest(monday);

    const prev = shiftMonday(monday, -7);
    const nextRaw = shiftMonday(monday, +7);
    const today = currentWeekMonday();
    const nextMonday = nextRaw > today ? null : nextRaw;
    const priorDigest = readWeekDigest(prev);
    const prevCached = !!priorDigest;
    const nextCached = nextMonday ? !!readWeekDigest(nextMonday) : false;

    return (
      <div>
        <InsightsTopBar
          scope="week"
          currentLabel={`Week of ${monday}`}
          rangeLabel={shortRangeMonday(monday)}
          prev={{ key: `week-${prev}`, label: shortLabelMonday(prev), cached: prevCached }}
          next={nextMonday ? { key: `week-${nextMonday}`, label: shortLabelMonday(nextMonday), cached: nextCached } : null}
        />
        <WeekDigestView initial={cached} monday={monday} aiEnabled={aiOn} prior={priorDigest} />
      </div>
    );
  }

  const monthMatch = MONTH_KEY.exec(key);
  if (monthMatch) {
    const yearMonth = monthMatch[1]!;
    const cached = yearMonth === currentYearMonth()
      ? getCurrentMonthDigestFromCache(yearMonth, Date.now())
      : readMonthDigest(yearMonth);

    const prev = shiftYearMonth(yearMonth, -1);
    const nextRaw = shiftYearMonth(yearMonth, +1);
    const today = currentYearMonth();
    const nextYM = nextRaw > today ? null : nextRaw;
    const prevCached = !!readMonthDigest(prev);
    const nextCached = nextYM ? !!readMonthDigest(nextYM) : false;

    return (
      <div>
        <InsightsTopBar
          scope="month"
          currentLabel={shortLabelMonth(yearMonth)}
          prev={{ key: `month-${prev}`, label: shortLabelMonth(prev), cached: prevCached }}
          next={nextYM ? { key: `month-${nextYM}`, label: shortLabelMonth(nextYM), cached: nextCached } : null}
        />
        <MonthDigestView initial={cached} yearMonth={yearMonth} aiEnabled={aiOn} />
      </div>
    );
  }

  notFound();
}

function shortRangeMonday(monday: string): string {
  const start = new Date(`${monday}T12:00:00`);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} — ${fmt(end)}`;
}

function shiftMonday(monday: string, days: number): string {
  const d = new Date(`${monday}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shiftYearMonth(yearMonth: string, months: number): string {
  const [y, m] = yearMonth.split("-");
  const d = new Date(Number(y), Number(m) - 1 + months, 1);
  const ny = d.getFullYear();
  const nm = String(d.getMonth() + 1).padStart(2, "0");
  return `${ny}-${nm}`;
}

function shortLabelMonday(monday: string): string {
  const d = new Date(`${monday}T12:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function shortLabelMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

