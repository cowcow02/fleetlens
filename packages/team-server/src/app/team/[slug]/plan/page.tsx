import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { getPool } from "../../../../db/pool";
import { validateSession } from "../../../../lib/auth";
import {
  loadOptimizerInputs,
  loadMembership7dCyclePeaks,
} from "../../../../lib/plan-queries";
import { tierEntry } from "../../../../lib/plan-tiers";
import { CyclePeaksStrip } from "../../../../components/cycle-peaks-strip";
import {
  utilizationHex,
  utilizationTone,
  UTILIZATION_THRESHOLDS,
} from "../../../../lib/utilization-tone";

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

  const [inputs, cyclePeaks] = await Promise.all([
    loadOptimizerInputs(team.id, pool),
    loadMembership7dCyclePeaks(team.id, pool),
  ]);

  // Only members the daemon has actually pushed cycle data for. Members
  // who paired but haven't synced yet (or revoked seats) are excluded —
  // showing them as empty rows is noise admins can't act on.
  const rows = inputs
    .map((i) => ({
      input: i,
      tier: tierEntry(i.tierKey),
      cycles: cyclePeaks.get(i.membershipId) ?? [],
    }))
    .filter((r) => r.cycles.length > 0)
    // Sort lowest peak first — under-utilizers are the actionable rows.
    .sort((a, b) => latestPeak(a.cycles) - latestPeak(b.cycles));

  const underutilizing = rows.filter(
    (r) => latestPeak(r.cycles) < UTILIZATION_THRESHOLDS.low,
  ).length;
  const fullyUtilized = rows.filter(
    (r) => latestPeak(r.cycles) >= UTILIZATION_THRESHOLDS.good,
  ).length;

  return (
    <>
      <div className="section-head">
        <div>
          <h1>Plan <em>utilization</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            Are members getting plan value · {rows.length}{" "}
            {rows.length === 1 ? "member" : "members"} reporting
          </div>
        </div>
        <div className="kicker">
          {underutilizing > 0 && (
            <span style={{ color: "#a93b2c", fontWeight: 600 }}>
              {underutilizing} underutilizing
            </span>
          )}
          {underutilizing > 0 && fullyUtilized > 0 && " · "}
          {fullyUtilized > 0 && (
            <span style={{ color: "#2c6e49" }}>
              {fullyUtilized} fully utilizing
            </span>
          )}
          {underutilizing === 0 && fullyUtilized === rows.length && rows.length > 0 && (
            <span style={{ color: "#2c6e49" }}>everyone fully utilizing</span>
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
                <th>Latest cycle</th>
                <th style={{ minWidth: 360 }}>Recent cycles</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ input, tier, cycles }) => {
                const latest = latestPeak(cycles);
                const tone = utilizationTone(latest);
                const statusColor = utilizationHex(latest);
                const statusLabel =
                  tone === "success"
                    ? "fully utilizing"
                    : tone === "warning"
                      ? "moderate use"
                      : "underutilizing";
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
                      <span
                        className="mono"
                        style={{ fontSize: 14, color: statusColor, fontWeight: 600 }}
                      >
                        {latest.toFixed(0)}%
                      </span>{" "}
                      <span style={{ fontSize: 11, color: "var(--mute)" }}>· {statusLabel}</span>
                    </td>
                    <td>
                      <CyclePeaksStrip cycles={cycles} maxBars={8} />
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
            estimated from local JSONL spend (cold-start). Dashed border = the
            in-progress cycle. Click a member name for the full breakdown.
          </p>
        </section>
      )}
    </>
  );
}

// Pick the most relevant peak — current in-flight cycle if it's running,
// else the most recently completed cycle. Used to color rows + sort.
function latestPeak(cycles: { peakPct: number; isCurrent: boolean }[]): number {
  const inFlight = cycles.find((c) => c.isCurrent);
  if (inFlight) return inFlight.peakPct;
  return cycles.length > 0 ? cycles[cycles.length - 1]!.peakPct : 0;
}
