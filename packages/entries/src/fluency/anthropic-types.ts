/**
 * Strict-Anthropic AI Fluency variant — types.
 *
 * Follows the Anthropic AI Fluency Framework's literal 11-indicator
 * taxonomy (Delegation 2, Description 6, Discernment 3) and the
 * scorecard's surface conventions ([chat], [cowork], [cc]). On a
 * Fleetlens deployment with only Claude Code data, every quote tags
 * as [cc]; surface diversity is not-applicable on this instance.
 *
 * Reference: AI Fluency Framework (CC BY-NC-SA, aifluencyframework.org).
 * Indicator wording is paraphrased in our own terms.
 */

import type { AgentSourceKey, FluencyRating } from "./types.js";

export const ANTHROPIC_SCHEMA_VERSION = 1 as const;

export type AnthropicAxisId =
  | "A_clarify_goals"
  | "A_consult_approach"
  | "A_define_audience"
  | "A_specify_format"
  | "A_communicate_tone"
  | "A_build_iteratively"
  | "A_provide_examples"
  | "A_set_interaction_style"
  | "A_check_facts"
  | "A_notice_reasoning"
  | "A_recognize_context";

export type AnthropicPillar = "delegation" | "description" | "discernment";

export type AnthropicAxisMeta = {
  id: AnthropicAxisId;
  pillar: AnthropicPillar;
  title: string;
  /** One-line behavior description (our own wording). */
  blurb: string;
};

export const ANTHROPIC_AXES: readonly AnthropicAxisMeta[] = [
  // Delegation — 2
  { id: "A_clarify_goals",      pillar: "delegation",  title: "Clarifies goals",         blurb: "Names what they're trying to accomplish before asking for code." },
  { id: "A_consult_approach",   pillar: "delegation",  title: "Consults on approach",    blurb: "Asks for the model's recommendation on a path before committing to one." },

  // Description — 6
  { id: "A_define_audience",    pillar: "description", title: "Defines audience",        blurb: "Names who the output is for (a teammate, a reviewer, a docs reader)." },
  { id: "A_specify_format",     pillar: "description", title: "Specifies format",        blurb: "Names the desired output shape — file path, function signature, table, etc." },
  { id: "A_communicate_tone",   pillar: "description", title: "Communicates tone",       blurb: "Names tone / style expectations (terse, formal, match-this-voice)." },
  { id: "A_build_iteratively",  pillar: "description", title: "Builds iteratively",      blurb: "Refines through multiple turns rather than accepting the first draft." },
  { id: "A_provide_examples",   pillar: "description", title: "Provides examples",       blurb: "Pastes a sample, points at a reference implementation, or says 'like X'." },
  { id: "A_set_interaction_style", pillar: "description", title: "Sets interaction style", blurb: "Frames the model's role or working mode (act as X, you are Y, role-play, scaffold)." },

  // Discernment — 3
  { id: "A_check_facts",        pillar: "discernment", title: "Checks facts",            blurb: "Questions agent assertions, asks for evidence or verification." },
  { id: "A_notice_reasoning",   pillar: "discernment", title: "Notices reasoning",       blurb: "Names specific reasoning errors with a concrete critique." },
  { id: "A_recognize_context",  pillar: "discernment", title: "Recognises context",      blurb: "Proactively shares context the agent can't infer (project history, hidden constraints)." },
];

export const ANTHROPIC_AXIS_BY_ID: Record<AnthropicAxisId, AnthropicAxisMeta> =
  Object.freeze(
    ANTHROPIC_AXES.reduce<Record<string, AnthropicAxisMeta>>((acc, a) => { acc[a.id] = a; return acc; }, {}),
  ) as Record<AnthropicAxisId, AnthropicAxisMeta>;

export const ANTHROPIC_PILLAR_LABEL: Record<AnthropicPillar, string> = {
  delegation: "Delegation",
  description: "Description",
  discernment: "Discernment",
};

/** Per-axis observation. Mirrors the Fleetlens observation shape but
 *  caps evidence at 2 verbatim quotes per Anthropic's documented rule. */
export type AnthropicAxisObservation = {
  axis: AnthropicAxisId;
  rating: FluencyRating;
  /** Up to 2 verbatim quotes, each ≤150 chars. */
  evidence: Array<{
    quote: string;
    /** Surface tag — always "cc" on Fleetlens deployments (no Chat/Cowork ingest). */
    surface: "cc" | "chat" | "cowork";
    date: string;
    session_id: string;
  }>;
};

/** Anthropic-style product-feature usage. Adapted to Claude Code feature
 *  surface since that's what we observe. */
export type AnthropicFeatureUsage = {
  feature: string;
  count_30d: number;
  bucket: "frequent" | "sometimes" | "never";
};

export type AnthropicScorecard = {
  schema_version: typeof ANTHROPIC_SCHEMA_VERSION;
  /** 30-day window end date (YYYY-MM-DD). */
  window_end: string;
  member_id: string;
  member_name: string;

  /** Counts driving the window: total sessions, breakdown by surface. */
  window_summary: {
    sessions_total: number;
    by_surface: Record<"cc" | "chat" | "cowork", number>;
  };

  observations: AnthropicAxisObservation[];

  /** Same /11 fractional score as the original. */
  score: { numerator: number; denominator: number };

  /** LLM-generated 80–110 word summary, second-person. Null when AI is off
   *  or the call failed; the page renders a fallback paragraph then. */
  summary: string | null;

  /** Anthropic-style "Insights" — one strength + one growth area, with
   *  short titles and ≤110-char bodies. Both LLM-generated. */
  insights: {
    strength_title: string;
    strength_body: string;
    try_next_title: string;
    try_next_body: string;
  } | null;

  /** Per-axis recommended growth on this surface — derived deterministically
   *  from the observation set (first "-" axis after "+"-sorted scan). */
  growth_axis: AnthropicAxisId;

  /** Feature-usage rollup (Claude Code feature surface). */
  features: AnthropicFeatureUsage[];

  /** Source-mix line equivalent to the original "Surfaces" attribution. */
  surfaces: { cc: number; chat: number; cowork: number };

  /** Optional: which agents contributed to the cc surface, since we
   *  bundle Claude Code + Codex + Gemini under [cc] for this report. */
  agent_breakdown?: Record<AgentSourceKey, number>;

  /** LLM call metadata. */
  llm: { model: string | null; cost_usd: number | null } | null;
};
