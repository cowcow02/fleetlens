import { buildAnthropicScorecard30d } from "@/lib/fluency-data";
import { FluencyTabs } from "@/components/fluency-tabs";
import {
  AnthropicFeatureUsage,
  AnthropicFooter,
  AnthropicHeadline,
  AnthropicInsights,
  AnthropicScorecardGrid,
} from "@/components/fluency-anthropic-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Strict-Anthropic AI Fluency scorecard.
 *
 * Runs the literal 11-indicator taxonomy (Delegation 2 / Description 6 /
 * Discernment 3) over a 30-day window of real Entries. Per-axis ratings
 * are deterministic; the Summary + Insights prose is LLM-generated via
 * `claude -p` when the runtime can find the `claude` binary, otherwise
 * falls back to a deterministic template.
 *
 * `?llm=0` query param skips the LLM call (useful for QA / cost control).
 */
export default async function FluencyAnthropicPage({
  searchParams,
}: {
  searchParams: Promise<{ llm?: string }>;
}) {
  const sp = await searchParams;
  const useLlm = sp.llm !== "0";

  const card = await buildAnthropicScorecard30d({ id: "local", name: "you" }, { useLlm });

  if (!card) {
    return (
      <div className="flu-page">
        <FluencyTabs />
        <h1>AI Fluency · Anthropic-style</h1>
        <p style={{ color: "var(--af-text-secondary)" }}>
          No Entries in the last 30 days yet. Run <code>fleetlens start</code> so the daemon&apos;s
          perception sweep can build Entries from <code>~/.claude/projects/*.jsonl</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="flu-page">
      <FluencyTabs />
      <AnthropicHeadline card={card} />
      <AnthropicScorecardGrid card={card} />
      <AnthropicInsights card={card} />
      <AnthropicFeatureUsage card={card} />
      <AnthropicFooter card={card} />
    </div>
  );
}
