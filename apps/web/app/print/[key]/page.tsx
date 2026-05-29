import { notFound } from "next/navigation";
import {
  readWeekDigest, readMonthDigest,
  getCurrentWeekDigestFromCache, getCurrentMonthDigestFromCache,
} from "@claude-lens/entries/node";
import { WeekDigest } from "@/components/week-digest";
import { MonthDigest } from "@/components/month-digest";
import { currentWeekMonday, currentYearMonth } from "@/lib/entries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WEEK_KEY = /^week-(\d{4}-\d{2}-\d{2})$/;
const MONTH_KEY = /^month-(\d{4}-\d{2})$/;

// Headless-render target for the PDF export. Sits on top of the root layout
// via a position:fixed overlay (z-index above the floating LiveSessions /
// JobQueue widgets, which use 99/100). No actions, no auto-fire — the digest
// must already exist on disk (the API route fails fast if it doesn't).
export default async function PrintPage({
  params,
}: { params: Promise<{ key: string }> }) {
  const { key } = await params;

  const weekMatch = WEEK_KEY.exec(key);
  if (weekMatch) {
    const monday = weekMatch[1]!;
    const digest = monday === currentWeekMonday()
      ? (getCurrentWeekDigestFromCache(monday, Date.now()) ?? readWeekDigest(monday))
      : readWeekDigest(monday);
    if (!digest) notFound();
    const prior = readWeekDigest(shiftMonday(monday, -7));
    return (
      <PrintShell>
        <WeekDigest digest={digest} aiEnabled={true} priorDigest={prior} />
      </PrintShell>
    );
  }

  const monthMatch = MONTH_KEY.exec(key);
  if (monthMatch) {
    const yearMonth = monthMatch[1]!;
    // Match the week branch: try in-memory cache for the current month, then
    // fall back to disk. Force-generated current-month digests get persisted
    // by digest-month-pipeline so PDF export survives the 10-min TTL.
    const digest = yearMonth === currentYearMonth()
      ? (getCurrentMonthDigestFromCache(yearMonth, Date.now()) ?? readMonthDigest(yearMonth))
      : readMonthDigest(yearMonth);
    if (!digest) notFound();
    return (
      <PrintShell>
        <MonthDigest digest={digest} aiEnabled={true} />
      </PrintShell>
    );
  }

  notFound();
}

function PrintShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      {children}
    </>
  );
}

// Reset html/body to the digest's own background so the PDF page bleeds
// edge-to-edge in the same color the digest renders against. @page disables
// the printer header/margin defaults; Chrome's --print-to-pdf paginates A4.
// --background is theme-aware (dark / light tokens in globals.css); never
// hardcode a fallback that would break the light theme.
const PRINT_CSS = `
  @page { size: A4; margin: 8mm; }
  html, body {
    background: var(--background) !important;
    color: var(--af-text);
    margin: 0 !important;
    padding: 0 !important;
  }
`;

function shiftMonday(monday: string, days: number): string {
  const d = new Date(`${monday}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
