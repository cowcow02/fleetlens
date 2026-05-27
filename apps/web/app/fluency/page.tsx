import { Fluency } from "@claude-lens/entries";
import {
  FluencyFooter,
  GrowthCallout,
  RiskTriangle,
} from "@/components/fluency-report";
import {
  FluencyDetailSections,
  FluencyHeroV2,
} from "@/components/fluency-report-v2";
import { FluencyTabs } from "@/components/fluency-tabs";
import { buildScorecard30d } from "@/lib/fluency-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Personal AI Fluency Report.
 *
 * Reads the last 30 days of Entry artefacts from ~/.cclens/entries and
 * builds a deterministic 11-axis scorecard via the
 * @claude-lens/entries/fluency observer. Falls back to the realistic mock
 * when no entries exist (fresh install / never-ran-daemon path) so the
 * page is never empty.
 */
export default async function FluencyPage() {
  const real = buildScorecard30d({ id: "local", name: "you" });
  const card = real ?? Fluency.PERSONAL_SCORECARD_CHARLIE;
  const isMock = real === null;
  return (
    <div className="flu-page">
      <FluencyTabs />
      {isMock && <DemoBanner />}
      <FluencyHeroV2 card={card} />
      <FluencyDetailSections card={card} />
      <RiskTriangle position={card.risk_triangle} />
      <GrowthCallout card={card} />
      <FluencyFooter schemaVersion={card.schema_version} />
    </div>
  );
}

function DemoBanner() {
  return (
    <div
      style={{
        marginBottom: 14,
        padding: "10px 14px",
        background: "var(--af-info-subtle)",
        border: "1px solid var(--af-info)",
        borderRadius: 8,
        fontSize: 12,
        color: "var(--af-text)",
      }}
    >
      <strong>Showing the prototype mock data.</strong> No Entry artefacts exist for the last
      30 days yet — once the daemon&apos;s perception sweep has built Entries for your sessions,
      this page renders your real scorecard.
    </div>
  );
}
