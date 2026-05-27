import { Fluency } from "@claude-lens/entries";
import Link from "next/link";
import {
  buildAnthropicScorecard30d,
  buildSubagentScorecard30d,
  listEntriesLast30Days,
} from "@/lib/fluency-data";
import { FluencyTabs } from "@/components/fluency-tabs";
import { FluencyCompare } from "@/components/fluency-compare";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Side-by-side comparison of the three scoring methods.
 *
 * All three methods read the SAME 30-day window of real Entries, so any
 * score difference comes purely from methodology, not data sampling.
 *
 * Query params:
 *   ?llm=0      — skip the Anthropic-side LLM summary (faster, fallback prose)
 *   ?subagent=1 — also run the third lane: hand the raw user-message corpus
 *                 to `claude -p` and let it score from intent. Opt-in
 *                 because it costs a Claude call (~$0.01 per refresh).
 */
export default async function FluencyComparePage({
  searchParams,
}: {
  searchParams: Promise<{ llm?: string; subagent?: string; refresh?: string }>;
}) {
  const sp = await searchParams;
  const useLlm = sp.llm !== "0";
  const useSubagent = sp.subagent === "1";
  const forceRefresh = sp.refresh === "1";

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
    week_monday: windowEnd,
    entries,
  });

  // Run the two LLM-touching scorecards in parallel when both are requested.
  const [anthropic, subagent] = await Promise.all([
    buildAnthropicScorecard30d({ id: "local", name: "you" }, { useLlm }),
    useSubagent ? buildSubagentScorecard30d({ id: "local", name: "you" }, { forceRefresh }) : Promise.resolve(null),
  ]);

  return (
    <div className="flu-page">
      <FluencyTabs />
      <SubagentLaneBanner enabled={useSubagent} succeeded={!!subagent} entryCount={entries.length} />
      <FluencyCompare
        fleetlens={fleetlens}
        anthropic={anthropic}
        subagent={subagent}
        windowEnd={windowEnd}
        entryCount={entries.length}
      />
    </div>
  );
}

function SubagentLaneBanner({ enabled, succeeded, entryCount }: { enabled: boolean; succeeded: boolean; entryCount: number }) {
  if (!enabled) {
    return (
      <div
        style={{
          marginBottom: 14,
          padding: "10px 14px",
          background: "var(--af-info-subtle)",
          border: "1px solid var(--af-info)",
          borderRadius: 8,
          fontSize: 12.5,
          color: "var(--af-text)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span>
          <strong>Two-lane view.</strong> Add the third &ldquo;Subagent-LLM&rdquo; lane to see
          how a Claude run scoring from raw turns ({entryCount} sessions) compares — costs ~$0.01.
        </span>
        <Link
          href="?subagent=1"
          style={{
            padding: "4px 10px",
            background: "var(--af-info)",
            color: "white",
            borderRadius: 6,
            fontWeight: 600,
            fontSize: 12,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          Run subagent →
        </Link>
      </div>
    );
  }
  if (!succeeded) {
    return (
      <div
        style={{
          marginBottom: 14,
          padding: "10px 14px",
          background: "var(--af-warning-subtle)",
          border: "1px solid var(--af-warning)",
          borderRadius: 8,
          fontSize: 12.5,
        }}
      >
        <strong>Subagent lane failed.</strong> The <code>claude</code> CLI may not be
        on PATH, or the model returned output that didn&apos;t match the marker schema.
        Falling back to two-lane view.
      </div>
    );
  }
  return null;
}
