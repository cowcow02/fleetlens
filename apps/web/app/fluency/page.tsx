import { Fluency } from "@claude-lens/entries";
import {
  FluencyAxisGrid,
  FluencyFooter,
  FluencyHeadline,
  FluencySurfaceMix,
  GrowthCallout,
  RiskTriangle,
} from "@/components/fluency-report";
import { buildScorecardForWeek } from "@/lib/fluency-data";
import { currentWeekMonday } from "@/lib/entries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Personal AI Fluency Report.
 *
 * Reads the current ISO-week's entries from ~/.cclens/entries and builds
 * a deterministic 11-axis scorecard via the @claude-lens/entries/fluency
 * observer. Falls back to the realistic mock when no entries exist (fresh
 * install / never-ran-daemon path) so the page is never empty.
 */
export default async function FluencyPage() {
  const monday = currentWeekMonday();
  const real = buildScorecardForWeek(monday, {
    id: "local",
    name: "you",
  });
  const card = real ?? Fluency.PERSONAL_SCORECARD_CHARLIE;
  const isMock = real === null;
  return (
    <div style={{ padding: "24px 32px 80px", maxWidth: 1200, margin: "0 auto" }}>
      {isMock && <DemoBanner />}
      <FluencyHeadline card={card} />
      <FluencySurfaceMix mix={card.surface_mix} />
      <FluencyAxisGrid
        observations={card.observations}
        strengthAxis={card.strength_axis}
        growthAxis={card.growth_axis}
      />
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
      <strong>Showing the prototype mock data.</strong> No Entry artefacts exist for the current
      ISO week yet — once the daemon&apos;s perception sweep has built Entries for your sessions,
      this page renders your real scorecard.
    </div>
  );
}
