import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { getPool } from "../../../../db/pool";
import { validateSession } from "../../../../lib/auth";
import {
  loadOptimizerInputs,
  loadMembership7dCyclePeaks,
  loadTeam7dCurrentCycles,
} from "../../../../lib/plan-queries";
import { tierEntry } from "../../../../lib/plan-tiers";
import { CyclePeaksStrip } from "../../../../components/cycle-peaks-strip";
import { MiniBurndownChart } from "../../../../components/mini-burndown-chart";
import {
  paceToneForCycle,
  toneHex,
  utilizationTone,
  paceLabel,
  type Tone,
} from "../../../../lib/utilization-tone";

const SEVEN_DAYS_MS = 7 * 24 * 3_600_000;

// Plan utilization view — admins see "are members getting plan value"
// at a glance. One row per member with reported usage, peaks of their
// last few 7d cycles as bars, plus a one-line status derived from the
// most recent cycle. Inverted framing: high use = green (full value),
// low use = red (paying for unused headroom).
export default async function PlanPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const pool = getPool();

  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");

  const teamRes = await pool.query("SELECT id, name FROM teams WHERE slug = $1", [slug]);
  if (!teamRes.rowCount) notFound();
  const team = teamRes.rows[0];

  const myMembership = session.memberships.find((m) => m.team_id === team.id);
  if (!myMembership) redirect("/login");
  if (myMembership.role !== "admin") {
    return (
      <div className="section-head">
        <div>
          <h1>Admin <em>only</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            The Plan view is visible to admins only.
          </div>
        </div>
      </div>
    );
  }

  const [inputs, cyclePeaks, teamCurrentCycles] = await Promise.all([
    loadOptimizerInputs(team.id, pool),
    loadMembership7dCyclePeaks(team.id, pool),
    loadTeam7dCurrentCycles(team.id, pool),
  ]);

  // Only members the daemon has actually pushed cycle data for. Members
  // who paired but haven't synced yet (or revoked seats) are excluded —
  // showing them as empty rows is noise admins can't act on.
  const rows = inputs
    .map((i) => {
      const cycles = cyclePeaks.get(i.membershipId) ?? [];
      const currentCycle = teamCurrentCycles.get(i.membershipId) ?? null;
      const latest = latestCycle(cycles);
      // Pace-based tone for the in-progress cycle, peak-based for completed.
      const tone: Tone | null = latest
        ? latest.isCurrent
          ? paceToneForCycle(latest.peakPct, latest.endsAt.getTime(), SEVEN_DAYS_MS)
          : utilizationTone(latest.peakPct)
        : null;
      return {
        input: i,
        tier: tierEntry(i.tierKey),
        cycles,
        latestPct: latest?.peakPct ?? 0,
        tone,
        currentCycle,
      };
    })
    .filter((r) => r.cycles.length > 0)
    // Sort under-utilizers first — they're the actionable rows.
    .sort((a, b) => toneRank(a.tone) - toneRank(b.tone) || a.latestPct - b.latestPct);

  const underutilizing = rows.filter((r) => r.tone === "danger").length;
  const fullyUtilized = rows.filter((r) => r.tone === "success").length;

  return (
    <>
      <div className="section-head">
        <div>
          <h1>Plan <em>utilization</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            License consumption across team · {rows.length}{" "}
            {rows.length === 1 ? "member" : "members"} reporting
          </div>
        </div>
        <div className="kicker">
          {underutilizing > 0 && (
            <span style={{ color: "#a93b2c", fontWeight: 600 }}>
              {underutilizing} light use
            </span>
          )}
          {underutilizing > 0 && fullyUtilized > 0 && " · "}
          {fullyUtilized > 0 && (
            <span style={{ color: "#2c6e49" }}>
              {fullyUtilized} high use
            </span>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <p style={{ color: "var(--mute)", fontSize: 13, marginTop: 24 }}>
          No members have reported plan utilization yet — wait for the next
          daemon poll (5 min) once a teammate pairs.
        </p>
      ) : (
        <section className="settings-section">
          <table className="member-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Plan</th>
                <th>Current cycle</th>
                <th style={{ minWidth: 360 }}>Recent cycles</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ input, tier, cycles, latestPct, tone, currentCycle }) => {
                let burnColor = "var(--mute)";
                let burnLabel = "collecting data";
                let burnDeltaStr = "";
                let hasBurndown = false;

                if (currentCycle && currentCycle.snapshots.length > 0) {
                  const points = currentCycle.snapshots.map((s) => ({
                    t: s.capturedAt.getTime(),
                    remaining: 100 - s.utilization,
                  }));
                  const nowMs = Date.now();
                  const latestSnapshot = points[points.length - 1]!;
                  const expectedAtNow = (1 - (nowMs - currentCycle.startMs) / (currentCycle.endMs - currentCycle.startMs)) * 100;
                  const burnDelta = latestSnapshot.remaining - expectedAtNow;
                  const pace = paceLabel(burnDelta);
                  burnColor = toneHex(pace.tone);
                  burnLabel = pace.label;
                  burnDeltaStr = `${burnDelta >= 0 ? "+" : ""}${burnDelta.toFixed(0)}pp`;
                  hasBurndown = true;
                } else if (tone) {
                  burnColor = toneHex(tone);
                  burnLabel =
                    tone === "success"
                      ? "high use"
                      : tone === "warning"
                        ? "moderate use"
                        : "light use";
                }

                return (
                  <tr key={input.membershipId}>
                    <td>
                      <a
                        href={`/team/${slug}/members/${input.membershipId}`}
                        style={{ color: "var(--ink)", textDecoration: "none" }}
                      >
                        {input.memberName}
                      </a>
                    </td>
                    <td className="mono" style={{ fontSize: 12, color: "var(--mute)" }}>
                      {tier.label}
                      {tier.monthlyPriceUsd > 0 && ` · $${tier.monthlyPriceUsd}/mo`}
                    </td>
                    <td>
                      {hasBurndown ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <MiniBurndownChart cycle={currentCycle!} />
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                              <span
                                className="mono"
                                style={{ fontSize: 13, color: burnColor, fontWeight: 700 }}
                              >
                                {latestPct.toFixed(0)}%
                              </span>
                              <span style={{ fontSize: 9, color: "var(--mute)" }}>
                                peak
                              </span>
                            </div>
                            <div
                              className="mono"
                              style={{
                                fontSize: 10,
                                fontWeight: 600,
                                color: burnColor,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {burnLabel} {burnDeltaStr}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <div
                            style={{
                              width: 120,
                              height: 30,
                              background: "var(--rule)",
                              opacity: 0.15,
                              borderRadius: 2,
                            }}
                          />
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <span style={{ fontSize: 11, color: "var(--mute)", fontStyle: "italic" }}>
                              collecting data
                            </span>
                          </div>
                        </div>
                      )}
                    </td>
                    <td>
                      <CyclePeaksStrip cycles={cycles} maxBars={4} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p
            style={{
              fontSize: 11,
              color: "var(--mute)",
              marginTop: 10,
              fontStyle: "italic",
            }}
          >
            Bar height = peak utilization in that 7-day cycle. Striped fills =
            estimated from local JSONL spend (cold-start). Click a member name for the full breakdown.
          </p>
        </section>
      )}
    </>
  );
}

// Pick the most relevant cycle — current in-flight if it's running,
// else the most recently completed. Used to drive tone, sort, label.
function latestCycle<T extends { isCurrent: boolean }>(cycles: T[]): T | null {
  const inFlight = cycles.find((c) => c.isCurrent);
  if (inFlight) return inFlight;
  return cycles.length > 0 ? cycles[cycles.length - 1]! : null;
}

// Sort danger first, then warning, then success — under-utilizers are
// the actionable rows, fully-utilizing teams want to be celebrated last.
function toneRank(t: Tone | null): number {
  if (t === "danger") return 0;
  if (t === "warning") return 1;
  if (t === "success") return 2;
  return 3;
}
