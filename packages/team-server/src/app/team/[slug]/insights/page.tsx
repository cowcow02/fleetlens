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
import { mockTeamInsightReport } from "./mock-data";

export const dynamic = "force-dynamic";

type VariantId = "0" | "1" | "2" | "3" | "4" | "5";

const VARIANTS: { id: VariantId; label: string; tagline: string }[] = [
  { id: "0", label: "v0 · Maximal", tagline: "30-section enumeration · everything possible · reference" },
  { id: "1", label: "v1 · Combined", tagline: "Agent-collaboration narrative · per-member fingerprints · five lenses" },
  { id: "2", label: "v2 · Case studies", tagline: "WoW aggregates on top · deep session walkthroughs as the spine" },
  { id: "3", label: "v3 · Grounded", tagline: "Q1–Q2 2026 references · DX AI Measurement Framework backbone" },
  { id: "4", label: "v4 · Finalized", tagline: "Best of v1–v3 · capturability-tagged · honest placeholders for integrations" },
  { id: "5", label: "v5 · Connected", tagline: "Hypothetical · all 4 external integrations enabled · the whole-picture view" },
];

function isVariantId(v: string): v is VariantId {
  return v === "0" || v === "1" || v === "2" || v === "3" || v === "4" || v === "5";
}

export default async function TeamInsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const raw = sp?.v ?? "5";
  const v: VariantId = isVariantId(raw) ? raw : "1";

  const pool = getPool();
  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");

  const teamRes = await pool.query("SELECT id FROM teams WHERE slug = $1", [slug]);
  if (!teamRes.rowCount) return <div>Team not found.</div>;
  const teamId = teamRes.rows[0].id;
  const myMembership = session.memberships.find((m) => m.team_id === teamId);
  if (!myMembership) redirect("/login");

  const r = mockTeamInsightReport;
  const weekDate = new Date(`${r.week_monday}T12:00:00`);
  const weekEnd = new Date(weekDate);
  weekEnd.setDate(weekDate.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric" });

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
        <div className="kicker">Iterations · pick a tab</div>
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

      <footer className="page-footer">
        <span>Fleetlens · Team Edition · iteration {v}</span>
        <span>Generated {r.generated_at}</span>
      </footer>
    </>
  );
}
