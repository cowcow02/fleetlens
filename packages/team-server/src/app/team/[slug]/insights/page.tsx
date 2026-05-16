import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../../db/pool";
import { validateSession } from "../../../../lib/auth";
import { VariantMaximal } from "../../../../components/insights-variants/v0-maximal";
import { VariantCombined } from "../../../../components/insights-variants/v1-combined";
import { VariantCaseStudies } from "../../../../components/insights-variants/v2-case-studies";
import { VariantGrounded } from "../../../../components/insights-variants/v3-grounded";
import { VariantFinalized } from "../../../../components/insights-variants/v4-finalized";
import { VariantConnected } from "../../../../components/insights-variants/v5-connected";
import { VariantBuilder } from "../../../../components/insights-variants/v7-builder";
import { VariantTicketFlow } from "../../../../components/insights-variants/v6-ticket-flow";
import { mockTeamInsightReport } from "./mock-data";
import {
  isoMondayOf,
  perProjectTimeWoW,
  skillUsageWeek,
  teamPulseWeek,
  workingShapeDistribution,
} from "../../../../lib/insights-aggregate";
import { LiveInsights, type LiveInsightsData } from "../../../../components/live-insights";

export const dynamic = "force-dynamic";

type VariantId = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7";

const VARIANTS: { id: VariantId; label: string; tagline: string }[] = [
  { id: "0", label: "v0 · Maximal", tagline: "30-section enumeration · everything possible · reference" },
  { id: "1", label: "v1 · Combined", tagline: "Agent-collaboration narrative · per-member fingerprints · five lenses" },
  { id: "2", label: "v2 · Case studies", tagline: "WoW aggregates on top · deep session walkthroughs as the spine" },
  { id: "3", label: "v3 · Grounded", tagline: "Q1–Q2 2026 references · DX AI Measurement Framework backbone" },
  { id: "4", label: "v4 · Finalized", tagline: "Best of v1–v3 · capturability-tagged · honest placeholders for integrations" },
  { id: "5", label: "v5 · Connected", tagline: "Hypothetical · all 4 external integrations enabled · the whole-picture view" },
  { id: "6", label: "v6 · Ticket flow", tagline: "Ticket lifecycle spine · phase bottlenecks · Codex telemetry overlay" },
  { id: "7", label: "v7 · Builder", tagline: "Lego-style · pick blocks from the catalog · URL-encoded selection" },
];

function isVariantId(v: string): v is VariantId {
  return v === "0" || v === "1" || v === "2" || v === "3" || v === "4" || v === "5" || v === "6" || v === "7";
}

export default async function TeamInsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ v?: string; blocks?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const raw = sp?.v;
  const variant: VariantId | null = raw && isVariantId(raw) ? raw : null;

  const pool = getPool();
  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");

  const teamRes = await pool.query("SELECT id, name FROM teams WHERE slug = $1", [slug]);
  if (!teamRes.rowCount) return <div>Team not found.</div>;
  const teamId = teamRes.rows[0].id;
  const teamName = teamRes.rows[0].name;
  const myMembership = session.memberships.find((m) => m.team_id === teamId);
  if (!myMembership) redirect("/login");

  // Live (default): real data from rich_daily_rollups. The variant tabs stay
  // accessible via ?v=N so the mock-driven prototypes remain available as
  // reference for blocks Phase 1 doesn't cover yet.
  if (!variant) {
    const weekMonday = isoMondayOf(new Date());
    const scope = { kind: "team-wide" as const };
    const [pulse, projects, skills, shapes] = await Promise.all([
      teamPulseWeek(teamId, scope, weekMonday, pool),
      perProjectTimeWoW(teamId, scope, weekMonday, pool, { limit: 12 }),
      skillUsageWeek(teamId, scope, weekMonday, pool, { limit: 20 }),
      workingShapeDistribution(teamId, scope, weekMonday, pool),
    ]);
    const data: LiveInsightsData = {
      scopeLabel: `All of ${teamName}`,
      weekMonday,
      pulse,
      projects,
      skills,
      shapes,
    };
    return <LiveInsights data={data} />;
  }

  const r = mockTeamInsightReport;
  const weekDate = new Date(`${r.week_monday}T12:00:00`);
  const weekEnd = new Date(weekDate);
  weekEnd.setDate(weekDate.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  const v = variant;

  return (
    <>
      <div className="section-head">
        <div>
          <h1>The <em>Insight Report</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            Week of {fmt(weekDate).toUpperCase()} — {fmt(weekEnd).toUpperCase()}
            {" · "}
            {r.cross_edition.roster.length} of {r.members_total} members active
            {" · "}
            {r.volume.agent_hours_total.toFixed(1)}h combined agent time
          </div>
        </div>
        <div className="kicker"><a href="?">← live data</a> · iterations</div>
      </div>

      <nav className="variant-tabstrip">
        {VARIANTS.map((vDef) => (
          <a
            key={vDef.id}
            href={`?v=${vDef.id}`}
            className={`variant-tab ${vDef.id === v ? "active" : ""}`}
          >
            <div className="variant-tab-label">{vDef.label}</div>
            <div className="variant-tab-tagline">{vDef.tagline}</div>
          </a>
        ))}
      </nav>

      {v === "0" && <VariantMaximal r={r} slug={slug} />}
      {v === "1" && <VariantCombined r={r} />}
      {v === "2" && <VariantCaseStudies r={r} />}
      {v === "3" && <VariantGrounded r={r} />}
      {v === "4" && <VariantFinalized r={r} />}
      {v === "5" && <VariantConnected r={r} />}
      {v === "6" && <VariantTicketFlow r={r} />}
      {v === "7" && <VariantBuilder r={r} slug={slug} blocksParam={sp?.blocks} />}

      <footer className="page-footer">
        <span>Fleetlens · Team Edition · iteration {v}</span>
        <span>Generated {r.generated_at}</span>
      </footer>
    </>
  );
}
