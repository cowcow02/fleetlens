import Link from "next/link";
import { readSettings, readWeekDigest, interactiveLockFresh } from "@claude-lens/entries/node";
import { listEntryKeys } from "@claude-lens/entries/fs";
import { parseEntryKey } from "@claude-lens/entries";
import { lastCompletedWeekMonday, currentWeekMonday } from "@/lib/entries";
import { WeekDigestView } from "@/components/week-digest-view";
import { InsightsTopBar } from "@/components/insights-top-bar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function priorMonday(monday: string): string {
  const d = new Date(`${monday}T00:00:00`);
  d.setDate(d.getDate() - 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function weekDates(monday: string): string[] {
  const out: string[] = [];
  const start = new Date(`${monday}T00:00:00`);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  return out;
}

// Build once from the entries dir, then test the 7 weekdays against it.
// Earlier this called listEntriesForDay per day per render, which opened
// and parsed every matching entry file 14× before deciding the week is empty.
function presentDays(): Set<string> {
  const out = new Set<string>();
  for (const key of listEntryKeys()) {
    const parsed = parseEntryKey(key);
    if (parsed) out.add(parsed.local_day);
  }
  return out;
}

function hasAnyEntries(monday: string, present: Set<string>): boolean {
  for (const d of weekDates(monday)) {
    if (present.has(d)) return true;
  }
  return false;
}

function shortDateRange(monday: string): string {
  const start = new Date(`${monday}T12:00:00`);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} — ${fmt(end)}`;
}

export default async function InsightsPage() {
  const settings = readSettings();
  const aiOn = settings.ai_features.enabled;
  const lastWeek = lastCompletedWeekMonday();
  const cached = readWeekDigest(lastWeek);
  const prior = readWeekDigest(priorMonday(lastWeek));
  const present = presentDays();
  const hasData = !!cached || hasAnyEntries(lastWeek, present);

  // Auto-fire when AI is on and the digest isn't already cached. The interactive
  // pipeline lock (heartbeat-refreshed) suppresses concurrent fires from the
  // daemon's boot backfill or another tab; we never fire on top of an in-flight run.
  const autoFire = aiOn && !cached && !interactiveLockFresh(Date.now());

  // Prev/next nav targets — prev is the week before lastWeek; next is the
  // current in-progress week (if any data) since we're already viewing the
  // most recent completed.
  const prevMonday = priorMonday(lastWeek);
  const currentMonday = currentWeekMonday();
  const nextMonday = currentMonday > lastWeek ? currentMonday : null;
  const nextHasData = nextMonday ? hasAnyEntries(nextMonday, present) : false;

  return (
    <div style={{ paddingBottom: 64 }}>
      <InsightsTopBar
        scope="week"
        currentLabel={`Week of ${lastWeek}`}
        rangeLabel={shortDateRange(lastWeek)}
        prev={{ key: `week-${prevMonday}`, label: shortDateRange(prevMonday).split(" — ")[0]!, cached: !!prior }}
        next={nextMonday && nextHasData
          ? { key: `week-${nextMonday}`, label: shortDateRange(nextMonday).split(" — ")[0]!, cached: false }
          : null}
      />

      <section style={{ paddingTop: 8 }}>
        {hasData ? (
          <WeekDigestView
            initial={cached}
            monday={lastWeek}
            aiEnabled={aiOn}
            autoFire={autoFire}
            prior={prior}
          />
        ) : (
          <EmptyState aiOn={aiOn} />
        )}
      </section>
    </div>
  );
}

function EmptyState({ aiOn }: { aiOn: boolean }) {
  return (
    <div style={{
      maxWidth: 720, margin: "16px auto 0", padding: "20px 40px",
    }}>
      <div style={{
        padding: "20px 22px", borderRadius: 12,
        background: "var(--af-surface)",
        border: "1px dashed var(--af-border)",
      }}>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
          textTransform: "uppercase", color: "var(--af-text-tertiary)", marginBottom: 6,
        }}>No data yet</div>
        <p style={{ fontSize: 13, lineHeight: 1.6, margin: "0 0 12px", color: "var(--af-text)" }}>
          A week digest needs per-day perception entries first. Each session you run with Claude Code generates entries automatically; once a few days have passed, this page will start producing a weekly retrospective.
        </p>
        <p style={{ fontSize: 12, lineHeight: 1.6, margin: "0 0 14px", color: "var(--af-text-secondary)" }}>
          {aiOn
            ? "AI features are on. Run any session, then revisit — or use the home page to backfill recent days from existing transcripts."
            : "AI narratives are off. Enable them in Settings to see headlines, friction patterns, and weekly suggestions."}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/" style={ctaPrimary}>
            Home · backfill recent days
          </Link>
          {!aiOn && (
            <Link href="/settings" style={ctaSecondary}>
              Settings · enable AI features
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

const ctaPrimary: React.CSSProperties = {
  padding: "7px 12px", borderRadius: 6,
  background: "var(--af-accent)", color: "white",
  fontSize: 12, fontWeight: 600, textDecoration: "none",
};

const ctaSecondary: React.CSSProperties = {
  padding: "7px 12px", borderRadius: 6,
  background: "transparent", border: "1px solid var(--af-border)",
  color: "var(--af-text)", fontSize: 12, fontWeight: 500, textDecoration: "none",
};
