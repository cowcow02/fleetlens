import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getPool } from "../../../../../db/pool";
import { validateSession } from "../../../../../lib/auth";
import { loadMember, loadMemberRollups, parseRange, RANGE_DAYS } from "../../../../../lib/queries";
import {
  loadMemberPlanSummary,
  loadMembership7dCyclePeaks,
  loadMember7dCurrentCycle,
} from "../../../../../lib/plan-queries";
import { tierEntry } from "../../../../../lib/plan-tiers";
import { formatAgentTime, formatTokens } from "../../../../../lib/format";
import { MemberProfile } from "../../../../../components/member-profile";
import { MemberPlanBlock } from "../../../../../components/member-plan-block";
import { canSeeMember, loadManagedMemberIds } from "../../../../../lib/visibility";
import { RequestBackfillButton } from "./request-backfill-button";

export default async function MemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { slug, id } = await params;
  const { range: rangeParam } = await searchParams;
  // Default 30d on the member page so first-load semantics match the
  // plan-fit header above (which is always 30d / cycle-anchored).
  const range = parseRange(rangeParam, "30d");
  const chartDays = RANGE_DAYS[range];
  const pool = getPool();

  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");

  const member = await loadMember(id, pool);
  if (!member) return <div>Member not found.</div>;

  const myMembership = session.memberships.find((m) => m.team_id === member.team_id);
  if (!myMembership) redirect("/login");

  // Visibility guard: staff/admin/self/manager-of-target can view; everyone
  // else 404s (not 403) to avoid existence probing of other memberships.
  const viewer = {
    membershipId: myMembership.id,
    role: myMembership.role,
    isStaff: session.user.is_staff,
  };
  const managed = await loadManagedMemberIds(viewer.membershipId, pool);
  if (!canSeeMember(viewer, id, managed)) notFound();

  // Header card stays pinned at 30d (matches the plan-fit context above).
  // The chart/table get whatever the user has selected in the toggle.
  // When the toggle is on 30d, the loads are identical — skip the second
  // query so we don't pay for the same scan twice.
  const headerLoad = loadMemberRollups(member.team_id, id, 30, pool);
  const chartLoad =
    chartDays === 30 ? headerLoad : loadMemberRollups(member.team_id, id, chartDays, pool);

  const [headerRollups, chartRollups, planSummary, allCyclePeaks, currentCycle] = await Promise.all([
    headerLoad,
    chartLoad,
    loadMemberPlanSummary(member.team_id, id, pool),
    loadMembership7dCyclePeaks(member.team_id, pool),
    loadMember7dCurrentCycle(member.team_id, id, pool),
  ]);
  const cyclePeaks = allCyclePeaks.get(id) ?? [];
  const canSeeRoster = myMembership.role === "admin";
  // Mirrors the auth gate on POST /api/admin/members/[id]/commands —
  // staff OR an admin in the target's team can issue commands.
  const isAdminOrStaff = session.user.is_staff || myMembership.role === "admin";

  // 30-day rollup totals — surfaced inline in the header card so admins
  // don't have to scroll to find "is this seat actually being used?"
  const totalAgentMs = headerRollups.reduce((s, r) => s + Number(r.agent_time_ms), 0);
  // Unique sessions (start-day), not session-days, for the headline seat-usage
  // figure. Falls back to the session-days column for pre-split rows.
  const totalSessions = headerRollups.reduce((s, r) => s + (r.unique_sessions ?? r.sessions), 0);
  const totalTokens = headerRollups.reduce(
    (s, r) =>
      s +
      Number(r.tokens_input) +
      Number(r.tokens_output) +
      Number(r.tokens_cache_read) +
      Number(r.tokens_cache_write),
    0,
  );
  const tier = tierEntry(planSummary.planTier);

  return (
    <>
      {canSeeRoster ? (
        <a
          href={`/team/${slug}`}
          className="kicker"
          style={{ display: "inline-block", marginBottom: 18, color: "var(--mute)" }}
        >
          ← Back to roster
        </a>
      ) : (
        <div
          className="kicker"
          style={{ display: "inline-block", marginBottom: 18, color: "var(--mute)" }}
        >
          Your profile
        </div>
      )}

      {/* ─── 1. WHO + STATUS HEADER ─────────────────────────────────── */}
      {/* Identity, plan, daemon freshness, and 30-day engagement
          consolidated into one banner. Admins see everything they need
          to "place" this seat without scanning multiple sections. */}
      <header
        style={{
          padding: "20px 22px",
          background: "var(--paper)",
          border: "1px solid var(--rule)",
          marginBottom: 18,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1 className="profile-name" style={{ margin: 0 }}>
              <em>{member.display_name || member.email || "Anonymous"}</em>
            </h1>
            {member.email && (
              <div
                className="mono"
                style={{ marginTop: 6, fontSize: 12, color: "var(--mute)" }}
              >
                {member.email}
              </div>
            )}
          </div>
          {/* Identity-side metadata: role + joined date stay here, and
              Plan + Daemon freshness slot in directly below them so all
              "who is this seat" facts live together — no longer split
              between two sections. */}
          <div
            className="profile-meta"
            style={{ textAlign: "right", whiteSpace: "nowrap", lineHeight: 1.5 }}
          >
            <div>{member.role.toUpperCase()}</div>
            <div>
              JOINED{" "}
              {new Date(member.joined_at)
                .toLocaleDateString("en-US", {
                  month: "short",
                  day: "2-digit",
                  year: "numeric",
                })
                .toUpperCase()}
            </div>
            <div style={{ marginTop: 6 }}>
              {tier.monthlyPriceUsd > 0
                ? `${tier.label} · $${tier.monthlyPriceUsd}/mo`
                : tier.label}
            </div>
            <div style={{ color: daemonColor(planSummary.lastSeenAtMs) }}>
              DAEMON · {daemonFreshness(planSummary.lastSeenAtMs)}
            </div>
          </div>
        </div>

        {/* 30-day activity summary — only volume metrics now, since Plan
            and Daemon moved up next to the role/joined block. Pinned at
            30d to stay coherent with the plan-fit verdict below — the
            chart further down has its own range toggle for exploration. */}
        <div
          style={{
            borderTop: "1px solid var(--rule)",
            paddingTop: 14,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 18,
            fontSize: 12,
          }}
        >
          <HeaderField
            label="Last 30 days · engagement"
            value={`${planSummary.totalDaysObserved} active days`}
          />
          <HeaderField label="Last 30 days · agent time" value={formatAgentTime(totalAgentMs)} />
          <HeaderField label="Last 30 days · sessions" value={String(totalSessions)} />
          <HeaderField label="Last 30 days · tokens" value={formatTokens(totalTokens)} />
        </div>
      </header>

      {/* ─── 2. ADMIN ACTIONS (only for staff or team admins) ───────── */}
      {isAdminOrStaff && (
        <section
          style={{
            padding: "16px 22px",
            background: "var(--paper)",
            border: "1px solid var(--rule)",
            marginBottom: 18,
          }}
        >
          <div
            className="kicker"
            style={{ marginBottom: 10, color: "var(--mute)" }}
          >
            ADMIN ACTIONS
          </div>
          <RequestBackfillButton membershipId={id} />
        </section>
      )}

      {/* ─── 3. PLAN MATCH (verdict + cycle trend + throttling) ─────── */}
      <MemberPlanBlock
        summary={planSummary}
        cyclePeaks={cyclePeaks}
        currentCycle={currentCycle}
      />

      {/* ─── 4. DAILY ACTIVITY (per-day shape + drill-down table) ───── */}
      <MemberProfile rollups={chartRollups} range={range} />
    </>
  );
}

function HeaderField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--mute)",
        }}
      >
        {label}
      </div>
      <div className="mono" style={{ fontSize: 14, marginTop: 3, color: "var(--ink)" }}>
        {value}
      </div>
    </div>
  );
}

// Mirrors the helper in member-plan-block.tsx; duplicated here so the
// header doesn't have to import an internal helper. Both renderers
// agree on the same buckets ("live" within 10 min of last poll, etc).
function daemonFreshness(lastSeenAtMs: number | null): string {
  if (lastSeenAtMs == null) return "—";
  const ageMs = Date.now() - lastSeenAtMs;
  if (ageMs < 0) return "just now";
  if (ageMs < 10 * 60 * 1000) return "live";
  if (ageMs < 60 * 60 * 1000) return `${Math.round(ageMs / 60_000)}m ago`;
  if (ageMs < 24 * 60 * 60 * 1000) return `${Math.round(ageMs / 3_600_000)}h ago`;
  if (ageMs < 7 * 86_400_000) return `${Math.round(ageMs / 86_400_000)}d ago — stalled?`;
  return `${Math.round(ageMs / 86_400_000)}d ago — down`;
}

// Color the DAEMON line: green when live, amber when 1h-1d ago, red for
// >1d (suggests the daemon is stalled or the seat is genuinely idle).
function daemonColor(lastSeenAtMs: number | null): string {
  if (lastSeenAtMs == null) return "var(--mute)";
  const ageMs = Date.now() - lastSeenAtMs;
  if (ageMs < 60 * 60 * 1000) return "#2c6e49";
  if (ageMs < 24 * 60 * 60 * 1000) return "#b58400";
  return "#a93b2c";
}
