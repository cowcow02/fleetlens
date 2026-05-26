import { Fluency } from "@claude-lens/entries";
import {
  buildAnthropicScorecard30d,
  listEntriesLast30Days,
} from "@/lib/fluency-data";
import { FluencyTabs } from "@/components/fluency-tabs";
import { FluencyCompare } from "@/components/fluency-compare";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Side-by-side comparison of the two methods.
 *
 * Both methods read the SAME 30-day window of real Entries, so any
 * score difference comes purely from methodology, not data sampling.
 *
 * `?llm=0` skips the Anthropic-side LLM summary (faster, deterministic
 * fallback prose).
 */
export default async function FluencyComparePage({
  searchParams,
}: {
  searchParams: Promise<{ llm?: string }>;
}) {
  const sp = await searchParams;
  const useLlm = sp.llm !== "0";

  // Build BOTH scorecards over the same 30-day entry slice.
  const { entries, windowEnd } = listEntriesLast30Days();

  if (entries.length === 0) {
    return (
      <div className="flu-page">
        <FluencyTabs />
        <h1>AI Fluency · Side-by-side</h1>
        <p style={{ color: "var(--af-text-secondary)" }}>
          No Entries in the last 30 days yet. Run <code>fleetlens start</code> first.
        </p>
      </div>
    );
  }

  const fleetlens = Fluency.buildFluencyScorecard({
    member_id: "local",
    member_name: "you",
    // The Fleetlens variant uses ISO-week granularity in its types; for
    // the compare page we still feed it the 30-day entry slice so both
    // methods evaluate the same data. Score interpretation stays valid
    // because both numerators are over the same /11 max.
    week_monday: windowEnd,
    entries,
  });

  const anthropic = await buildAnthropicScorecard30d(
    { id: "local", name: "you" },
    { useLlm },
  );

  return (
    <div className="flu-page">
      <FluencyTabs />
      <FluencyCompare
        fleetlens={fleetlens}
        anthropic={anthropic}
        windowEnd={windowEnd}
        entryCount={entries.length}
      />
    </div>
  );
}
