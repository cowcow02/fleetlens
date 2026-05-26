import { Fluency } from "@claude-lens/entries";
import {
  FluencyAxisGrid,
  FluencyFooter,
  FluencyHeadline,
  FluencySurfaceMix,
  GrowthCallout,
  RiskTriangle,
} from "@/components/fluency-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Personal AI Fluency Report.
 *
 * Phase 1 (this PR): renders the prototype against the realistic mock
 * scorecard in `@claude-lens/entries/fluency`. Phase 2 swaps the mock
 * import for a real `readWeekFluency(memberId, weekMonday)` reader
 * produced by the daemon's perception sweep.
 */
export default async function FluencyPage() {
  const card = Fluency.PERSONAL_SCORECARD_CHARLIE;
  return (
    <div style={{ padding: "24px 32px 80px", maxWidth: 1200, margin: "0 auto" }}>
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
