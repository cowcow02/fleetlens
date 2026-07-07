import type { Recommendation } from "../lib/plan-optimizer";
import { UtilizationSparkline } from "./utilization-sparkline";
import { CyclePeaksStrip } from "./cycle-peaks-strip";
import { MemberBurndownChart } from "./member-burndown-chart";
import type {
  MemberPlanSummary,
  MembershipCyclePeak,
  CurrentCycleData,
} from "../lib/plan-queries";
import {
  paceToneForCycle,
  toneHex,
  utilizationHex,
} from "../lib/utilization-tone";
import { advisoryColor, type AdvisoryTone } from "../lib/advisory-tone";

const SEVEN_DAYS_MS = 7 * 24 * 3_600_000;

// Plain-language status. Wording is factual and non-evaluative —
// describes the plan-fit pattern, doesn't judge the member. The page
// is a financial dashboard for the admin, not a scorecard for the
// member; pressure on individuals to "use more" isn't the goal.
const ACTION_LABEL: Record<Recommendation["action"], string> = {
  insufficient_data: "Collecting data",
  review_manually: "Custom plan — review manually",
  top_up_needed: "At the cap — needs more headroom",
  upgrade_urgent: "At the cap — needs upgrade soon",
  upgrade: "Trending toward the cap",
  downgrade: "Light use of plan — could downsize",
  stay: "Plan well-matched",
};

// `downgrade` is `warn`, not `danger` — light use is an optimization
// opportunity for the admin, not a problem for the member. Red is
// reserved for the genuinely-bad states (at-the-cap throttling).
const ACTION_TONE: Record<Recommendation["action"], AdvisoryTone> = {
  insufficient_data: "info",
  review_manually: "info",
  top_up_needed: "danger",
  upgrade_urgent: "danger",
  upgrade: "warn",
  downgrade: "warn",
  stay: "good",
};

export function MemberPlanBlock({
  summary,
  cyclePeaks = [],
  currentCycle,
}: {
  summary: MemberPlanSummary;
  cyclePeaks?: MembershipCyclePeak[];
  currentCycle?: CurrentCycleData | null;
}) {
  const tone = ACTION_TONE[summary.recommendation.action];

  // Most recently completed cycle (drops the in-progress one). Used to
  // render the "Last cycle" callout that mirrors the personal edition's
  // headline number on the trend strip.
  const completed = cyclePeaks.filter((c) => !c.isCurrent);
  const lastCompleted = completed.length > 0 ? completed[completed.length - 1] : null;
  const trendDelta = (() => {
    if (completed.length < 2) return null;
    const last = completed[completed.length - 1]!.peakPct;
    const prev = completed[completed.length - 2]!.peakPct;
    return last - prev;
  })();
  const currentInFlight = cyclePeaks.find((c) => c.isCurrent) ?? null;

  return (
    <section style={{ marginBottom: 24 }}>
      <div className="subsection-head">
        <h2>Plan utilization</h2>
        <span className="kicker">license consumption pattern</span>
      </div>

      {/* Verdict + burndown — the at-a-glance answer to "is this person
          on track right now". Status label at top, then the burndown
          chart shows the actual remaining-budget trace through the
          in-progress cycle. The chart's own header surfaces "X% remaining
          / on pace / behind / resets in Nd Nh", so we don't duplicate
          that text in the verdict block. */}
      <div
        style={{
          background: "var(--paper)",
          border: "1px solid var(--rule)",
          borderLeft: `3px solid ${advisoryColor(tone)}`,
          padding: "14px 18px",
          marginBottom: 18,
        }}
      >
        <div
          className="mono"
          style={{
            fontSize: 11,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: advisoryColor(tone),
            fontWeight: 600,
            marginBottom: 12,
          }}
        >
          {ACTION_LABEL[summary.recommendation.action]}
        </div>
        {currentCycle ? (
          <MemberBurndownChart cycle={currentCycle} />
        ) : (
          <div style={{ fontSize: 13, color: "var(--mute)" }}>
            {currentInFlight
              ? buildCurrentCycleStatus(currentInFlight)
              : summary.recommendation.rationale}
          </div>
        )}
      </div>

      {/* Per-cycle peak history — same data and visual the member sees on
          their personal /usage page. Bars are ordered oldest → newest;
          height = peak utilization, color follows danger thresholds,
          striped = predicted from JSONL (cold-start), dashed border = the
          in-progress cycle. Hover any bar for exact date + source. */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 14,
            flexWrap: "wrap",
            marginBottom: 10,
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 11,
              letterSpacing: "0.1em",
              color: "var(--mute)",
              textTransform: "uppercase",
            }}
          >
            Previous 7d cycles
          </div>
          {lastCompleted && (
            <div style={{ fontSize: 12, color: "var(--ink)" }}>
              <span style={{ color: "var(--mute)" }}>last cycle peak:</span>{" "}
              <strong style={{ color: peakColor(lastCompleted.peakPct) }}>
                {lastCompleted.peakPct.toFixed(0)}%
              </strong>
              {trendDelta !== null && Math.abs(trendDelta) >= 5 && (
                <span style={{ marginLeft: 8, color: "var(--mute)" }}>
                  · {trendDelta > 0 ? "↑" : "↓"}{" "}
                  {Math.abs(trendDelta).toFixed(0)}pp from prior
                </span>
              )}
              {trendDelta !== null && Math.abs(trendDelta) < 5 && (
                <span style={{ marginLeft: 8, color: "var(--mute)" }}>
                  · flat vs prior
                </span>
              )}
            </div>
          )}
          {currentInFlight && (
            <div
              style={{
                marginLeft: "auto",
                fontSize: 12,
                color: "var(--ink)",
              }}
            >
              <span style={{ color: "var(--mute)" }}>in progress:</span>{" "}
              <strong
                style={{
                  color: toneHex(
                    paceToneForCycle(
                      currentInFlight.peakPct,
                      currentInFlight.endsAt.getTime(),
                      SEVEN_DAYS_MS,
                    ),
                  ),
                }}
              >
                {currentInFlight.peakPct.toFixed(0)}%
              </strong>
            </div>
          )}
        </div>
        {cyclePeaks.length > 0 ? (
          // maxBars (26 ≈ six months) MUST match the CLI push cap
          // (buildCyclePeaksForPush sevenDay slice in cli/src/team/sync.ts) and
          // the server read (loadMembership7dCyclePeaks maxCyclesPerMember in
          // plan-queries.ts) — the three move together. The strip grid uses
          // minmax(0, 1fr) so 26 bars flex-shrink to fit; no fixed width.
          <CyclePeaksStrip cycles={cyclePeaks} maxBars={26} />
        ) : (
          // Fall back to the legacy mat-view sparkline when no cycle-peak
          // data has been pushed yet (daemon predates the cyclePeaks wire
          // field, or the membership is brand new).
          <div>
            <div style={{ fontSize: 11, color: "var(--mute)", marginBottom: 6 }}>
              No cycle-peak data yet · showing legacy weekly trail
            </div>
            <UtilizationSparkline values={summary.trail} width={240} height={48} />
          </div>
        )}
        <div
          style={{
            fontSize: 11,
            color: "var(--mute)",
            marginTop: 8,
            fontStyle: "italic",
          }}
        >
          Striped bars = estimated from local JSONL spend (cold-start).
          Solid bars = measured from daemon. Dashed border = in-progress cycle.
          Hover for exact date.
        </div>
      </div>

      {/* Throttling counters. "100% peak" looks alarming on its own —
          this panel turns it into "did they actually hit the wall, and
          for how many days?" Anthropic stops accepting new work once a
          rolling window hits its cap, so these days are when the user
          was *blocked* (or routed to a slower model), not just busy. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 16,
          padding: "14px 16px",
          background: "var(--paper)",
          border: "1px solid var(--rule)",
        }}
      >
        <WallStat
          label="Throttled (weekly limit)"
          count={summary.wallHits7d}
          hint="Days they exhausted the rolling 7-day budget — Claude refuses or routes to a fallback until the window rolls forward"
        />
        <WallStat
          label="Throttled (5-hour burst)"
          count={summary.wallHits5h}
          hint="Days a 5-hour burst hit 100% — bursty work, mid-session throttling that resolves on the next 5-hour reset"
        />
      </div>
    </section>
  );
}

// Same color scale used inside CyclePeaksStrip so the callout numbers
// match what the bars show.
const peakColor = utilizationHex;

// Verdict rationale — focused on the in-progress cycle, not historical
// averages. Admin glance question is "where are they NOW and how long
// until reset", not "what was the 30-day average". Format:
//   "current 42% · 4d 2h to next reset (May 3, 3 PM UTC)"
function buildCurrentCycleStatus(c: MembershipCyclePeak): string {
  const reset = c.endsAt;
  const ms = reset.getTime() - Date.now();
  if (ms <= 0) return `current ${c.peakPct.toFixed(0)}% · cycle reset due now`;
  const totalHours = Math.floor(ms / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  const ago =
    days > 0
      ? remHours > 0
        ? `${days}d ${remHours}h`
        : `${days}d`
      : `${totalHours}h`;
  const fmt = reset.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    timeZoneName: "short",
  });
  return `current ${c.peakPct.toFixed(0)}% · ${ago} to next reset (${fmt})`;
}

function WallStat({ label, count, hint }: { label: string; count: number; hint: string }) {
  const tone: AdvisoryTone = count === 0 ? "good" : count >= 3 ? "danger" : "warn";
  return (
    <div>
      <div
        className="mono"
        style={{
          fontSize: 11,
          letterSpacing: "0.1em",
          color: "var(--mute)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        className="mono"
        style={{ fontSize: 18, marginTop: 4, color: advisoryColor(tone), fontWeight: 600 }}
      >
        {count === 0
          ? "Never · 0 / 30 days"
          : `${count} / 30 day${count === 1 ? "" : "s"}`}
      </div>
      <div style={{ fontSize: 11, marginTop: 4, color: "var(--mute)", lineHeight: 1.4 }}>
        {hint}
      </div>
    </div>
  );
}
