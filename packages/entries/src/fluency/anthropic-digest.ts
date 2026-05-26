/**
 * Build a strict-Anthropic AnthropicScorecard for a rolling 30-day window
 * over N entries.
 *
 * Deterministic where it can be (per-axis ratings, evidence, feature
 * counts, surface mix); LLM-generated for the prose Summary + Insights,
 * matching the documented Anthropic scorecard shape.
 */

import type { Entry } from "../types.js";
import {
  ANTHROPIC_AXES,
  ANTHROPIC_AXIS_BY_ID,
  ANTHROPIC_SCHEMA_VERSION,
  type AnthropicAxisId,
  type AnthropicAxisObservation,
  type AnthropicFeatureUsage,
  type AnthropicScorecard,
} from "./anthropic-types.js";
import {
  aggregateAnthropicAxis,
  observeEntryAnthropic,
} from "./anthropic-axes.js";
import {
  buildAnthropicUserPrompt,
  ANTHROPIC_SUMMARY_SYSTEM_PROMPT,
  parseAnthropicSummaryOutput,
  fallbackAnthropicProse,
  type AnthropicPromptInputs,
} from "./anthropic-prompt.js";
import type { AgentSourceKey, FluencyRating } from "./types.js";

const RATING_VALUE: Record<FluencyRating, number> = { "+": 1.0, "~": 0.5, "-": 0.0, "·": 0.0 };

const CLAUDE_CODE_FEATURES = [
  "plan-mode",
  "subagents",
  "skills",
  "memory",
  "mcp-tools",
  "slash-commands",
  "hooks",
  "todowrite",
  "background-tasks",
  "image-input",
] as const;

export type BuildAnthropicScorecardInput = {
  member_id: string;
  member_name: string;
  window_end: string;
  /** Last-30-day entry slice. Caller filters by date. */
  entries: Entry[];
  /** Optional injection for tests / pipelines that don't want to call the
   *  LLM. When omitted, `fallbackAnthropicProse` runs and the prose is
   *  templated rather than model-written. Signature mirrors `enrich.CallLLM`. */
  callLLM?: (args: {
    systemPrompt: string;
    userPrompt: string;
    model?: string;
  }) => Promise<{ content: string; model: string; input_tokens: number; output_tokens: number }>;
};

export async function buildAnthropicScorecard(
  input: BuildAnthropicScorecardInput,
): Promise<AnthropicScorecard> {
  // 1. Per-entry observations
  const entryObs = input.entries.map((e) => observeEntryAnthropic(e));

  // 2. Aggregate to one observation per axis
  const observations: AnthropicAxisObservation[] = ANTHROPIC_AXES.map((axis) => {
    const flat = entryObs.map((eo) => eo.axis_obs[axis.id]);
    const agg = aggregateAnthropicAxis(flat);
    return { axis: axis.id, rating: agg.rating, evidence: agg.evidence };
  });

  // 3. Score (numerator over 11)
  let numerator = 0;
  for (const o of observations) numerator += RATING_VALUE[o.rating];

  // 4. Growth axis = first "-" then first "~" then last axis
  const growth_axis: AnthropicAxisId =
    observations.find((o) => o.rating === "-")?.axis ??
    observations.find((o) => o.rating === "~")?.axis ??
    observations[observations.length - 1].axis;

  // 5. Feature usage (Claude Code surface)
  const features = computeFeatureUsage(input.entries);

  // 6. Surface mix (always [cc] on Fleetlens; agent breakdown inside)
  const surfaces = { cc: input.entries.length, chat: 0, cowork: 0 };
  const agent_breakdown = computeAgentBreakdown(input.entries);

  // 7. Window summary
  const window_summary = {
    sessions_total: input.entries.length,
    by_surface: surfaces,
  };

  // 8. LLM-generated prose (or fallback)
  const promptInputs: AnthropicPromptInputs = {
    member_name: input.member_name,
    window_label: `last 30 days (ending ${input.window_end})`,
    surfaces,
    axis_rows: observations.map((o) => ({
      axis_title: ANTHROPIC_AXIS_BY_ID[o.axis].title,
      rating: o.rating,
      evidence_quotes: o.evidence.slice(0, 2).map((e) => e.quote),
    })),
    features_frequent: features.filter((f) => f.bucket === "frequent").map((f) => f.feature),
    features_never: features.filter((f) => f.bucket === "never").map((f) => f.feature),
  };

  let summary: string | null = null;
  let insights: AnthropicScorecard["insights"] = null;
  let llmMeta: AnthropicScorecard["llm"] = null;

  if (input.callLLM) {
    try {
      const out = await input.callLLM({
        systemPrompt: ANTHROPIC_SUMMARY_SYSTEM_PROMPT,
        userPrompt: buildAnthropicUserPrompt(promptInputs),
      });
      const parsed = parseAnthropicSummaryOutput(out.content);
      if (parsed) {
        summary = parsed.summary;
        insights = {
          strength_title: parsed.strength_title,
          strength_body: parsed.strength_body,
          try_next_title: parsed.try_next_title,
          try_next_body: parsed.try_next_body,
        };
      }
      llmMeta = {
        model: out.model,
        cost_usd: estimateCostUsd(out.model, out.input_tokens, out.output_tokens),
      };
    } catch {
      // Swallow — we'll fall through to the fallback below.
    }
  }
  if (!summary || !insights) {
    const fb = fallbackAnthropicProse(promptInputs);
    summary = fb.summary;
    insights = {
      strength_title: fb.strength_title,
      strength_body: fb.strength_body,
      try_next_title: fb.try_next_title,
      try_next_body: fb.try_next_body,
    };
  }

  return {
    schema_version: ANTHROPIC_SCHEMA_VERSION,
    window_end: input.window_end,
    member_id: input.member_id,
    member_name: input.member_name,
    window_summary,
    observations,
    score: { numerator, denominator: 11 },
    summary,
    insights,
    growth_axis,
    features,
    surfaces,
    agent_breakdown,
    llm: llmMeta,
  };
}

/* ─── Helpers ─────────────────────────────────────────────────────────── */

function computeFeatureUsage(entries: Entry[]): AnthropicFeatureUsage[] {
  const counts: Record<string, number> = {};
  for (const f of CLAUDE_CODE_FEATURES) counts[f] = 0;
  for (const e of entries) {
    if (e.numbers.exit_plan_calls > 0 || e.flags.includes("plan_used")) counts["plan-mode"] += 1;
    if (e.numbers.subagent_calls > 0) counts["subagents"] += e.numbers.subagent_calls;
    if (e.numbers.skill_calls > 0) counts["skills"] += e.numbers.skill_calls;
    if ((e.user_input_sources.slash_command ?? 0) > 0) counts["slash-commands"] += e.user_input_sources.slash_command ?? 0;
    if (e.numbers.task_ops > 0) counts["todowrite"] += e.numbers.task_ops;
    if (e.flags.includes("image-attached") || /\[Image #/.test(e.first_user)) counts["image-input"] += 1;
    if (e.flags.includes("memory")) counts["memory"] += 1;
    if (e.subagents.some((s) => s.background)) counts["background-tasks"] += 1;
    if (e.top_tools.some((t) => /^mcp__/i.test(t))) counts["mcp-tools"] += 1;
    if (e.flags.includes("hooks")) counts["hooks"] += 1;
  }
  const totalSessions = Math.max(1, entries.length);
  return CLAUDE_CODE_FEATURES.map((feature) => {
    const count = counts[feature];
    const rate = count / totalSessions;
    const bucket: AnthropicFeatureUsage["bucket"] =
      rate >= 0.4 || count >= 8 ? "frequent" : count > 0 ? "sometimes" : "never";
    return { feature, count_30d: count, bucket };
  });
}

function computeAgentBreakdown(entries: Entry[]): Record<AgentSourceKey, number> {
  const out: Record<AgentSourceKey, number> = { "claude-code": 0, codex: 0, gemini: 0, opencode: 0, other: 0 };
  for (const e of entries) {
    const key: AgentSourceKey =
      e.agent === "codex" ? "codex" :
      e.agent === "gemini" ? "gemini" :
      e.agent === "claude-code" || !e.agent ? "claude-code" :
      "other";
    out[key] += 1;
  }
  return out;
}

function estimateCostUsd(model: string, inT: number, outT: number): number | null {
  const m = model.toLowerCase();
  let p: { input: number; output: number } | undefined;
  if (m.includes("opus")) p = { input: 15, output: 75 };
  else if (m.includes("sonnet")) p = { input: 3, output: 15 };
  else if (m.includes("haiku")) p = { input: 1, output: 5 };
  if (!p) return null;
  return (inT * p.input + outT * p.output) / 1_000_000;
}
