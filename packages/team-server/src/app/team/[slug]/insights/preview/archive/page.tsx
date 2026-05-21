import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../../../../db/pool";
import { validateSession } from "../../../../../../lib/auth";
import { VariantMaximal } from "../../../../../../components/insights-variants/v0-maximal";
import { VariantCombined } from "../../../../../../components/insights-variants/v1-combined";
import { VariantCaseStudies } from "../../../../../../components/insights-variants/v2-case-studies";
import { VariantGrounded } from "../../../../../../components/insights-variants/v3-grounded";
import { VariantFinalized } from "../../../../../../components/insights-variants/v4-finalized";
import { VariantConnected } from "../../../../../../components/insights-variants/v5-connected";
import { VariantTicketFlow } from "../../../../../../components/insights-variants/v6-ticket-flow";
import { VariantBuilder } from "../../../../../../components/insights-variants/v7-builder";
import { mockTeamInsightReport } from "../../../../../../lib/insights-mock-data";

export const dynamic = "force-dynamic";

// Archive: v0–v6 are kept as design references that catalogue every metric
// and widget shape explored during the v7 design exploration. v7 is the prime
// version (see /team/[slug]/insights/preview) and is included here for
// completeness, but most reviewers will land on the prime preview directly.
type VariantId = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7";
const VARIANTS: { id: VariantId; label: string; tagline: string }[] = [
  { id: "0", label: "v0 · Maximal", tagline: "30-section enumeration · everything possible · reference" },
  { id: "1", label: "v1 · Combined", tagline: "Agent-collaboration narrative · per-member fingerprints · five lenses" },
  { id: "2", label: "v2 · Case studies", tagline: "WoW aggregates on top · deep session walkthroughs as the spine" },
  { id: "3", label: "v3 · Grounded", tagline: "Q1–Q2 2026 references · DX AI Measurement Framework backbone" },
  { id: "4", label: "v4 · Finalized", tagline: "Best of v1–v3 · capturability-tagged · honest placeholders for integrations" },
  { id: "5", label: "v5 · Connected", tagline: "Hypothetical · all 4 external integrations enabled · the whole-picture view" },
  { id: "6", label: "v6 · Ticket flow", tagline: "Ticket lifecycle spine · phase bottlenecks · Codex telemetry overlay" },
  { id: "7", label: "v7 · Builder", tagline: "Prime version — Lego-style block catalog (now at /preview)" },
];

function isVariantId(v: string): v is VariantId {
  return /^[0-7]$/.test(v);
}

export default async function InsightsPreviewArchive({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ v?: string; blocks?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const variant: VariantId = sp?.v && isVariantId(sp.v) ? sp.v : "0";

  const pool = getPool();
  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");

  const teamRes = await pool.query("SELECT id, name FROM teams WHERE slug = $1", [slug]);
  if (!teamRes.rowCount) return <div>Team not found.</div>;
  const teamId = teamRes.rows[0].id;
  const myMembership = session.memberships.find((m) => m.team_id === teamId);
  if (!myMembership) redirect("/login");

  const r = mockTeamInsightReport;
  const v = variant;

  return (
    <>
      <div className="preview-banner">
        <span className="preview-banner-tag">Archive · mock data</span>
        <span className="preview-banner-text">
          Earlier iterations kept as a reference catalog of every metric + widget shape we explored. The prime version is{" "}
          <a className="preview-banner-link" href={`/team/${slug}/insights/preview`}>v7 · Builder</a>.
        </span>
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
    </>
  );
}
