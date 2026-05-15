import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../../db/pool";
import { validateSession } from "../../../../lib/auth";
import { VariantMaximal } from "../../../../components/insights-variants/v0-maximal";
import { VariantFingerprints } from "../../../../components/insights-variants/v1-fingerprints";
import { VariantTrajectories } from "../../../../components/insights-variants/v2-trajectories";
import { VariantDiffusion } from "../../../../components/insights-variants/v3-diffusion";
import { VariantArchetypes } from "../../../../components/insights-variants/v4-archetypes";
import { VariantStory } from "../../../../components/insights-variants/v5-story";
import { mockTeamInsightReport } from "./mock-data";

export const dynamic = "force-dynamic";

type VariantId = "0" | "1" | "2" | "3" | "4" | "5";

const VARIANTS: { id: VariantId; label: string; tagline: string }[] = [
  { id: "1", label: "v1 · Fingerprints", tagline: "One synthesized portrait per member" },
  { id: "2", label: "v2 · Trajectories", tagline: "Practice × member, 4-week sparklines" },
  { id: "3", label: "v3 · Diffusion grid", tagline: "Who's adopted what · who's ahead" },
  { id: "4", label: "v4 · Archetypes", tagline: "Six session shapes · per-member mix" },
  { id: "5", label: "v5 · Story", tagline: "Eight prose paragraphs · zero charts" },
  { id: "0", label: "v0 · Maximal", tagline: "Original 30-section enumeration · reference" },
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
  const raw = sp?.v ?? "1";
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
        <div className="kicker">Variant comparison · pick any tab</div>
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
      {v === "1" && <VariantFingerprints r={r} />}
      {v === "2" && <VariantTrajectories r={r} />}
      {v === "3" && <VariantDiffusion r={r} />}
      {v === "4" && <VariantArchetypes r={r} />}
      {v === "5" && <VariantStory r={r} />}

      <footer className="page-footer">
        <span>Fleetlens · Team Edition · variant {v}</span>
        <span>Generated {r.generated_at}</span>
      </footer>
    </>
  );
}
