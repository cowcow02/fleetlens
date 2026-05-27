/**
 * Fleetlens AI Fluency Framework — shared types.
 *
 * Coding-agent-native adaptation of Anthropic's 4D AI Fluency framework.
 * See `docs/ai-fluency-framework.md` for the conceptual reference.
 *
 * All observation is deterministic over the Fleetlens normalised
 * `SessionEvent[]` shape, so the same observation logic applies to
 * Claude Code, Codex CLI, Gemini CLI and any future agent source.
 */

export const FLUENCY_SCHEMA_VERSION = 1 as const;

/** Three-tier rating from Anthropic's scorecard, plus an N/A bucket. */
export type FluencyRating = "+" | "~" | "-" | "·";

/**
 * 11 axes across 3 pillars. IDs match the doc so renderers can sort
 * deterministically. The trio-of-trios shape is preserved on purpose
 * — it keeps the framework legible for users coming from Anthropic's
 * own scorecard.
 */
export type FluencyAxisId =
  | "D1" | "D2" | "D3"
  | "De1" | "De2" | "De3" | "De4"
  | "Di1" | "Di2" | "Di3" | "Di4";

export type FluencyPillar = "delegation" | "description" | "discernment";

export type FluencyAxisMeta = {
  id: FluencyAxisId;
  pillar: FluencyPillar;
  title: string;
  /** One-liner shown on hover and in the axis legend. */
  blurb: string;
  /** Plain-English description of what we look for in the JSONL. */
  observable: string;
};

export const FLUENCY_AXES: readonly FluencyAxisMeta[] = [
  // Delegation
  {
    id: "D1",
    pillar: "delegation",
    title: "Plan-gating",
    blurb: "Plan before implement",
    observable: "Plan Mode invocation, or a spec-review subagent dispatched, before any implementation tool fires.",
  },
  {
    id: "D2",
    pillar: "delegation",
    title: "Scoping clarity",
    blurb: "Names done up front",
    observable: "First-turn prompt names a definition-of-done — acceptance criteria, output shape, scope boundary.",
  },
  {
    id: "D3",
    pillar: "delegation",
    title: "Reviewer-type matching",
    blurb: "Right reviewer, right job",
    observable: "Subagent dispatches route to the right reviewer (code-quality → code-reviewer; spec-compliance → general-purpose; design → claude-code-guide).",
  },

  // Description
  {
    id: "De1",
    pillar: "description",
    title: "Context shoring",
    blurb: "Anchors the agent in real ground",
    observable: "Opening prompt references concrete files, prior PRs, design docs — not 'look around and figure it out'.",
  },
  {
    id: "De2",
    pillar: "description",
    title: "Output shape spec'd",
    blurb: "Says what 'done' looks like",
    observable: "Names the file, function signature, schema, or accepted example style up front.",
  },
  {
    id: "De3",
    pillar: "description",
    title: "Constraint surfacing",
    blurb: "Names the traps",
    observable: "First turn names known traps, invariants, or anti-patterns to avoid.",
  },
  {
    id: "De4",
    pillar: "description",
    title: "Iterative refinement",
    blurb: "Anthropic's strongest predictor",
    observable: "≥3 user turns within session; multi-round revision evidence vs ship-first-draft.",
  },

  // Discernment
  {
    id: "Di1",
    pillar: "discernment",
    title: "Skeptical review",
    blurb: "Doesn't take the agent at its word",
    observable: "User turns challenge agent claims, demand evidence, run targeted tests against assertions.",
  },
  {
    id: "Di2",
    pillar: "discernment",
    title: "Verify at boundary",
    blurb: "Tests before ship",
    observable: "Verify step (build/test/manual) exists before `gh pr create` or final merge.",
  },
  {
    id: "Di3",
    pillar: "discernment",
    title: "Rollback discipline",
    blurb: "Reverts when wrong",
    observable: "Reverts/undoes when an approach is wrong, instead of patching over a broken direction.",
  },
  {
    id: "Di4",
    pillar: "discernment",
    title: "Context correction",
    blurb: "Fixes the agent's model, not just its output",
    observable: "Proactively corrects the agent's mental model when it's off, instead of working around it.",
  },
];

export const FLUENCY_AXIS_BY_ID: Record<FluencyAxisId, FluencyAxisMeta> = Object.freeze(
  FLUENCY_AXES.reduce<Record<string, FluencyAxisMeta>>((acc, a) => {
    acc[a.id] = a;
    return acc;
  }, {})
) as Record<FluencyAxisId, FluencyAxisMeta>;

export const PILLAR_LABEL: Record<FluencyPillar, string> = {
  delegation: "Delegation",
  description: "Description",
  discernment: "Discernment",
};

export const PILLAR_BLURB: Record<FluencyPillar, string> = {
  delegation: "Set the task up well.",
  description: "Give the agent what it needs.",
  discernment: "Evaluate what comes back.",
};

/**
 * One observation = (member × axis × ISO-week) with up to 3 evidence
 * quotes harvested from their JSONL.
 */
export type FluencyEvidence = {
  /** ≤150 chars. When `kind === "verbatim"` this is text the user actually
   *  typed (truncated at a word boundary with `…` if longer). When `kind
   *  === "derived"` this is a templated signal description and SHOULD NOT
   *  be rendered as a quote — the renderer styles these differently. */
  quote: string;
  /** Distinguishes user-typed text from observer-generated commentary.
   *  Optional for backward compat with pre-refactor scorecards — readers
   *  treat undefined as "verbatim" since that was the old default. */
  kind?: "verbatim" | "derived";
  /** Local date the evidence came from. */
  date: string;
  /** Which agent surfaced it. */
  source: AgentSourceKey;
  /** Session id so the user can jump straight to the transcript. */
  session_id: string;
  /** Optional: project name for context. */
  project?: string;
  /** 0-based index of the user turn this evidence came from
   *  (0 = first_user, 1 = first user_instruction, etc.). Powers the
   *  `/sessions/<id>#turn-N` deep link. Absent when the evidence is
   *  derived from a non-user signal (subagent dispatch, tool count). */
  turn_index?: number;
};

export type AgentSourceKey = "claude-code" | "codex" | "gemini" | "opencode" | "other";

export const AGENT_SOURCE_LABEL: Record<AgentSourceKey, string> = {
  "claude-code": "Claude Code",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  other: "Other",
};

export type FluencyAxisObservation = {
  axis: FluencyAxisId;
  rating: FluencyRating;
  /** Up to 3 evidence quotes (Anthropic uses 1; we surface more for verifiability). */
  evidence: FluencyEvidence[];
  /** Per-source breakdown of where the rating's signal came from.
   *  Lets the report explain "you demonstrated this in Claude Code,
   *  but not in your Codex sessions this week" without losing the
   *  aggregate rating. */
  by_source: Partial<Record<AgentSourceKey, FluencyRating>>;
};

/** Per-user scorecard for a single ISO week. */
export type FluencyScorecard = {
  schema_version: typeof FLUENCY_SCHEMA_VERSION;
  /** ISO Monday (YYYY-MM-DD) of the scored week. */
  week_monday: string;
  member_id: string;
  /** Display name for prototype rendering; will be encrypted/redacted in real pipeline. */
  member_name: string;
  /** Email surface (own scorecard only). */
  member_email?: string;
  /** 11 entries, indexed in FLUENCY_AXES order. */
  observations: FluencyAxisObservation[];
  /** + counts as 1, ~ as 0.5, - as 0, · skipped. Computed for display. */
  score: { numerator: number; denominator: number };
  /** Last-week numerator for delta rendering. */
  score_prev?: { numerator: number; denominator: number };
  /** Anthropic-style 80-110 word narrative, second-person. */
  summary: string;
  /** Single strongest axis this week. */
  strength_axis: FluencyAxisId;
  /** Single highest-impact growth axis next. */
  growth_axis: FluencyAxisId;
  /** Where evidence came from in the window. Mirrors Anthropic "Surfaces". */
  surface_mix: Record<AgentSourceKey, number>;
  /** Risk Triangle landing — sums to 1.0, identifies the user's dominant failure mode. */
  risk_triangle: RiskTrianglePosition;
};

export type RiskTrianglePosition = {
  /** Higher = more sessions accepted polished output with zero verify. */
  polish_without_check: number;
  /** Higher = more sessions iterated but never verified. */
  iterate_without_verify: number;
  /** Higher = more sessions verified but shipped first draft. */
  verify_without_iterate: number;
  /** A short label naming the dominant corner this week, for headline use. */
  dominant_corner: "polish_without_check" | "iterate_without_verify" | "verify_without_iterate" | "balanced";
};

/* ------------------------------------------------------------------ */
/*  Team-scope aggregations                                            */
/* ------------------------------------------------------------------ */

export type FluencyAxisDistribution = {
  axis: FluencyAxisId;
  demonstrated: number;
  partial: number;
  not_observed: number;
  /** Number of engineers contributing to this row this week. */
  total: number;
  /** Last-week demonstrated count, for trend chips. */
  demonstrated_prev?: number;
};

export type FluencyDiffusionEdge = {
  /** Behavior whose adoption is being traced. */
  axis: FluencyAxisId;
  /** Member who first demonstrated this in the rolling window. */
  seeder: { id: string; name: string };
  /** Members who picked it up within the window. */
  adopters: Array<{ id: string; name: string; first_demonstrated: string }>;
  /** Free-text evidence shared across the cluster (anonymised in manager view). */
  evidence_hint: string;
};

export type FluencyNormsTrajectory = {
  axis: FluencyAxisId;
  /** Demonstrated-rate per week, oldest → newest. Values are 0..1. */
  weekly_rates: number[];
  /** Week labels for the same indexes. */
  weeks: string[];
  /** Categorical signal for the renderer. */
  status: "emerging-norm" | "established-norm" | "fading" | "pre-norm" | "stable";
};

export type FluencyHighlight = {
  member_name: string;
  axis: FluencyAxisId;
  date: string;
  quote: string;
  source: AgentSourceKey;
  session_id: string;
  /** True if the member opted in to publishing it to the team feed. */
  published: boolean;
};

/** Aggregated, manager-readable team-level report. Strictly contains
 *  no per-engineer scorecard data — only distributions and opt-in highlights. */
export type TeamFluencyReport = {
  schema_version: typeof FLUENCY_SCHEMA_VERSION;
  week_monday: string;
  team_slug: string;
  team_name: string;
  members_active: number;
  members_total: number;

  /** Team headline: aggregate score + delta. */
  team_score: { value: number; max: number; prev_value?: number };

  /** 11 rows, indexed in FLUENCY_AXES order. */
  distribution: FluencyAxisDistribution[];

  /** Risk Triangle for the whole team — centroid of all member sessions. */
  risk_triangle: RiskTrianglePosition & { prev?: RiskTrianglePosition };

  /** Diffusion graph edges across the rolling window. */
  diffusion: FluencyDiffusionEdge[];

  /** 4-week trajectory per axis. */
  norms_trajectory: FluencyNormsTrajectory[];

  /** Opt-in highlight reel — strictly user-published, never auto-surfaced. */
  highlights: FluencyHighlight[];

  /** Cross-source mix for context (helps managers see "your team is 60% Codex 40% Claude"). */
  surface_mix: Record<AgentSourceKey, number>;

  /** Recommended team norm to discuss this week, derived from the trajectory. */
  norm_proposal: {
    headline: string;
    axis: FluencyAxisId;
    rationale: string;
  };
};
