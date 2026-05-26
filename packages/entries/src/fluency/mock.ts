/**
 * Realistic mock fluency data for the prototype showcase pages.
 *
 * Numbers and quotes are crafted to *look* like real Fleetlens output
 * across an 8-person team running Claude Code + Codex + a Gemini pilot.
 *
 * This file is intentionally chunky. The prototype's whole job is to show
 * what the report *looks like* when populated; mock realism is feature.
 */

import {
  type AgentSourceKey,
  type FluencyAxisDistribution,
  type FluencyAxisId,
  type FluencyAxisObservation,
  type FluencyDiffusionEdge,
  type FluencyHighlight,
  type FluencyNormsTrajectory,
  type FluencyScorecard,
  type RiskTrianglePosition,
  type TeamFluencyReport,
  FLUENCY_SCHEMA_VERSION,
} from "./types.js";

/* ------------------------------------------------------------------ */
/*  Personal scorecard — Charlie Lam, week of 2026-05-18              */
/* ------------------------------------------------------------------ */

const charlieObservations: FluencyAxisObservation[] = [
  {
    axis: "D1",
    rating: "+",
    evidence: [
      {
        quote: "Before you write code: dispatch a spec-review subagent to verify the plan in docs/redesigned-week-report-spec.md.",
        date: "2026-05-19",
        source: "claude-code",
        session_id: "e80b3554",
        project: "fleetlens",
      },
      {
        quote: "Plan first. Three review rounds. Then implement.",
        date: "2026-05-21",
        source: "claude-code",
        session_id: "4884407b",
        project: "fleetlens",
      },
    ],
    by_source: { "claude-code": "+", codex: "-" },
  },
  {
    axis: "D2",
    rating: "+",
    evidence: [
      {
        quote: "Done when: /fluency renders distribution + risk triangle, Chrome screenshot in PR, 0 console errors.",
        date: "2026-05-20",
        source: "claude-code",
        session_id: "a4211da2",
        project: "fleetlens",
      },
    ],
    by_source: { "claude-code": "+", codex: "+" },
  },
  {
    axis: "D3",
    rating: "+",
    evidence: [
      {
        quote: "Three reviewer subagents on the same diff — Code reuse review, Code quality review, Efficiency review.",
        date: "2026-05-21",
        source: "claude-code",
        session_id: "0368a77e",
        project: "fleetlens",
      },
      {
        quote: "code-quality → superpowers:code-reviewer; spec-compliance → general-purpose. Match them per concern.",
        date: "2026-05-22",
        source: "claude-code",
        session_id: "4884407b",
        project: "fleetlens",
      },
    ],
    by_source: { "claude-code": "+", codex: "~" },
  },
  {
    axis: "De1",
    rating: "+",
    evidence: [
      {
        quote: "Relevant files: packages/entries/src/digest-week.ts, apps/web/app/insights/page.tsx, docs/redesigned-week-report-spec.md.",
        date: "2026-05-19",
        source: "claude-code",
        session_id: "e80b3554",
        project: "fleetlens",
      },
    ],
    by_source: { "claude-code": "+", codex: "+", gemini: "~" },
  },
  {
    axis: "De2",
    rating: "~",
    evidence: [
      {
        quote: "Return shape: { distribution: AxisRow[], risk_triangle: Centroid, diffusion: Edge[] } — match the team-server schema.",
        date: "2026-05-20",
        source: "claude-code",
        session_id: "a4211da2",
        project: "fleetlens",
      },
      {
        quote: "Just build it and we'll see what comes out.",
        date: "2026-05-23",
        source: "codex",
        session_id: "cdx_18f2",
        project: "kipwise",
      },
    ],
    by_source: { "claude-code": "+", codex: "-" },
  },
  {
    axis: "De3",
    rating: "+",
    evidence: [
      {
        quote: "Anti-pattern: don't add backwards-compat shims. Trust framework guarantees. Verify at boundary only.",
        date: "2026-05-21",
        source: "claude-code",
        session_id: "4884407b",
        project: "fleetlens",
      },
    ],
    by_source: { "claude-code": "+", codex: "+" },
  },
  {
    axis: "De4",
    rating: "+",
    evidence: [
      {
        quote: "No, the headline needs to lead with the team distribution, not the score. Try again with the score as a sidebar.",
        date: "2026-05-22",
        source: "claude-code",
        session_id: "0368a77e",
        project: "fleetlens",
      },
      {
        quote: "Closer. Now drop the gradient and make the axis chips bigger.",
        date: "2026-05-22",
        source: "claude-code",
        session_id: "0368a77e",
        project: "fleetlens",
      },
      {
        quote: "Better. Now align all three pillars to the same baseline.",
        date: "2026-05-22",
        source: "claude-code",
        session_id: "0368a77e",
        project: "fleetlens",
      },
    ],
    by_source: { "claude-code": "+", codex: "~", gemini: "+" },
  },
  {
    axis: "Di1",
    rating: "~",
    evidence: [
      {
        quote: "Are you sure that selector exists? Show me the imports.",
        date: "2026-05-20",
        source: "claude-code",
        session_id: "a4211da2",
        project: "fleetlens",
      },
    ],
    by_source: { "claude-code": "~", codex: "-" },
  },
  {
    axis: "Di2",
    rating: "-",
    evidence: [],
    by_source: { "claude-code": "-", codex: "-" },
  },
  {
    axis: "Di3",
    rating: "+",
    evidence: [
      {
        quote: "This direction is wrong. Revert the last three commits — I'll restart from the spec-review.",
        date: "2026-05-23",
        source: "claude-code",
        session_id: "4884407b",
        project: "fleetlens",
      },
    ],
    by_source: { "claude-code": "+" },
  },
  {
    axis: "Di4",
    rating: "+",
    evidence: [
      {
        quote: "Heads up: the `entries` package doesn't depend on Node fs — that lives in `entries/node`. Don't import fs into the shared types.",
        date: "2026-05-21",
        source: "claude-code",
        session_id: "4884407b",
        project: "fleetlens",
      },
    ],
    by_source: { "claude-code": "+", codex: "+" },
  },
];

export const PERSONAL_SCORECARD_CHARLIE: FluencyScorecard = {
  schema_version: FLUENCY_SCHEMA_VERSION,
  week_monday: "2026-05-18",
  member_id: "u_charlie",
  member_name: "Charlie Lam",
  member_email: "charlie@kipwise.com",
  observations: charlieObservations,
  // 8 demonstrated + 2 partial = 9.0 over 11 applicable axes (Di2 not observed, but the axis is applicable for this shape)
  score: { numerator: 9.0, denominator: 11 },
  score_prev: { numerator: 7.5, denominator: 11 },
  summary:
    "You shipped a remarkable week of design-mature work — every implementation push was preceded by a spec-review loop, and Wednesday's reviewer-triad on the cold-cache PR was textbook. Where you slipped: zero verify-at-boundary turns on Friday's three Codex-driven Kipwise PRs. The pattern is consistent — when you're driving Claude Code, your discernment is sharp; when you're spawning Codex jobs, you accept the polished diff and move on. The single biggest lever is to add one verify turn to your Codex sessions, the way you naturally already do for Claude.",
  strength_axis: "D1",
  growth_axis: "Di2",
  surface_mix: { "claude-code": 0.71, codex: 0.22, gemini: 0.07, opencode: 0, other: 0 },
  risk_triangle: {
    polish_without_check: 0.48,
    iterate_without_verify: 0.31,
    verify_without_iterate: 0.21,
    dominant_corner: "polish_without_check",
  },
};

/* ------------------------------------------------------------------ */
/*  Team fluency report — Kipwise Engineering, week of 2026-05-18      */
/* ------------------------------------------------------------------ */

const TEAM_MEMBERS = [
  { id: "u_charlie", name: "Charlie Lam" },
  { id: "u_alex", name: "Alex Chen" },
  { id: "u_priya", name: "Priya Subramanian" },
  { id: "u_marcus", name: "Marcus Okafor" },
  { id: "u_yuki", name: "Yuki Tanaka" },
  { id: "u_diana", name: "Diana Rosenberg" },
  { id: "u_isaac", name: "Isaac Levy" },
  { id: "u_lin", name: "Lin Hoang" },
];

const distribution: FluencyAxisDistribution[] = [
  { axis: "D1",  demonstrated: 5, partial: 2, not_observed: 1, total: 8, demonstrated_prev: 3 },
  { axis: "D2",  demonstrated: 6, partial: 1, not_observed: 1, total: 8, demonstrated_prev: 6 },
  { axis: "D3",  demonstrated: 4, partial: 3, not_observed: 1, total: 8, demonstrated_prev: 2 },
  { axis: "De1", demonstrated: 7, partial: 1, not_observed: 0, total: 8, demonstrated_prev: 6 },
  { axis: "De2", demonstrated: 4, partial: 3, not_observed: 1, total: 8, demonstrated_prev: 5 },
  { axis: "De3", demonstrated: 3, partial: 4, not_observed: 1, total: 8, demonstrated_prev: 3 },
  { axis: "De4", demonstrated: 6, partial: 2, not_observed: 0, total: 8, demonstrated_prev: 4 },
  { axis: "Di1", demonstrated: 4, partial: 3, not_observed: 1, total: 8, demonstrated_prev: 4 },
  { axis: "Di2", demonstrated: 2, partial: 2, not_observed: 4, total: 8, demonstrated_prev: 1 },
  { axis: "Di3", demonstrated: 5, partial: 2, not_observed: 1, total: 8, demonstrated_prev: 4 },
  { axis: "Di4", demonstrated: 6, partial: 1, not_observed: 1, total: 8, demonstrated_prev: 5 },
];

const diffusion: FluencyDiffusionEdge[] = [
  {
    axis: "D1",
    seeder: { id: "u_charlie", name: "Charlie Lam" },
    adopters: [
      { id: "u_alex", name: "Alex Chen", first_demonstrated: "2026-05-19" },
      { id: "u_priya", name: "Priya Subramanian", first_demonstrated: "2026-05-20" },
      { id: "u_yuki", name: "Yuki Tanaka", first_demonstrated: "2026-05-22" },
    ],
    evidence_hint: "Spec-review subagent pattern propagated after Charlie's PR #58 description called it out by name.",
  },
  {
    axis: "D3",
    seeder: { id: "u_priya", name: "Priya Subramanian" },
    adopters: [
      { id: "u_marcus", name: "Marcus Okafor", first_demonstrated: "2026-05-21" },
      { id: "u_diana", name: "Diana Rosenberg", first_demonstrated: "2026-05-22" },
    ],
    evidence_hint: "Reviewer-type matching rule landed in CLAUDE.md on Mon; two teammates picked it up within 48h.",
  },
  {
    axis: "De4",
    seeder: { id: "u_alex", name: "Alex Chen" },
    adopters: [
      { id: "u_isaac", name: "Isaac Levy", first_demonstrated: "2026-05-22" },
      { id: "u_lin", name: "Lin Hoang", first_demonstrated: "2026-05-23" },
    ],
    evidence_hint: "Three-round refinement pattern on the Codex prompts propagated through #eng-claude Slack thread.",
  },
  {
    axis: "Di2",
    seeder: { id: "u_yuki", name: "Yuki Tanaka" },
    adopters: [
      { id: "u_charlie", name: "Charlie Lam", first_demonstrated: "2026-05-23" },
    ],
    evidence_hint: "Verify-before-PR hook script shared in #eng-tooling — early adoption but not yet a norm.",
  },
];

const normsTrajectory: FluencyNormsTrajectory[] = [
  {
    axis: "D1",
    weeks: ["W17", "W18", "W19", "W20", "W21"],
    weekly_rates: [0.25, 0.25, 0.38, 0.50, 0.63],
    status: "emerging-norm",
  },
  {
    axis: "De4",
    weeks: ["W17", "W18", "W19", "W20", "W21"],
    weekly_rates: [0.38, 0.50, 0.50, 0.63, 0.75],
    status: "established-norm",
  },
  {
    axis: "Di2",
    weeks: ["W17", "W18", "W19", "W20", "W21"],
    weekly_rates: [0.13, 0.13, 0.13, 0.13, 0.25],
    status: "pre-norm",
  },
  {
    axis: "De3",
    weeks: ["W17", "W18", "W19", "W20", "W21"],
    weekly_rates: [0.50, 0.50, 0.38, 0.38, 0.38],
    status: "fading",
  },
  {
    axis: "De1",
    weeks: ["W17", "W18", "W19", "W20", "W21"],
    weekly_rates: [0.75, 0.75, 0.88, 0.88, 0.88],
    status: "established-norm",
  },
  {
    axis: "Di4",
    weeks: ["W17", "W18", "W19", "W20", "W21"],
    weekly_rates: [0.50, 0.63, 0.63, 0.75, 0.75],
    status: "stable",
  },
];

const highlights: FluencyHighlight[] = [
  {
    member_name: "Yuki Tanaka",
    axis: "Di2",
    date: "2026-05-22",
    quote: "Wait — run the team-server tests against this migration before we open the PR. I want to see green.",
    source: "claude-code",
    session_id: "y_4e7a",
    published: true,
  },
  {
    member_name: "Charlie Lam",
    axis: "D3",
    date: "2026-05-21",
    quote: "Three reviewer subagents on the same diff — Code reuse review, Code quality review, Efficiency review.",
    source: "claude-code",
    session_id: "0368a77e",
    published: true,
  },
  {
    member_name: "Alex Chen",
    axis: "De4",
    date: "2026-05-23",
    quote: "Better. Now drop the gradient and bump axis chip size. Also align all three pillars to one baseline.",
    source: "codex",
    session_id: "cdx_aa10",
    published: true,
  },
  {
    member_name: "Priya Subramanian",
    axis: "Di4",
    date: "2026-05-20",
    quote: "Actually we don't use Drizzle migrations in team-server — the schema is hand-rolled SQL. Don't lean on drizzle-kit.",
    source: "claude-code",
    session_id: "p_88ec",
    published: true,
  },
];

const teamRiskTriangle: RiskTrianglePosition = {
  polish_without_check: 0.41,
  iterate_without_verify: 0.34,
  verify_without_iterate: 0.25,
  dominant_corner: "polish_without_check",
};

export const TEAM_FLUENCY_REPORT: TeamFluencyReport = {
  schema_version: FLUENCY_SCHEMA_VERSION,
  week_monday: "2026-05-18",
  team_slug: "kipwise",
  team_name: "Kipwise Engineering",
  members_active: 8,
  members_total: 9,
  team_score: { value: 7.4, max: 11, prev_value: 6.6 },
  distribution,
  risk_triangle: {
    ...teamRiskTriangle,
    prev: {
      polish_without_check: 0.51,
      iterate_without_verify: 0.30,
      verify_without_iterate: 0.19,
      dominant_corner: "polish_without_check",
    },
  },
  diffusion,
  norms_trajectory: normsTrajectory,
  highlights,
  surface_mix: { "claude-code": 0.62, codex: 0.27, gemini: 0.09, opencode: 0, other: 0.02 },
  norm_proposal: {
    headline: "Make 'verify before gh pr create' a team norm by W23.",
    axis: "Di2",
    rationale:
      "Verify-at-boundary is your team's flattest axis (25% demonstrated, only Yuki + Charlie consistently). Diffusion just started — one adopter in seven days — and the Risk Triangle's largest corner is still Polish-without-check. A 'verify before PR' commit hook + 2-week practice review would close the gap before W23.",
  },
};

/* ------------------------------------------------------------------ */
/*  Roster of per-member scorecards (used in team-view-as-self drill)  */
/* ------------------------------------------------------------------ */

/** Each member gets a thumbnail card on the team page — score + dominant
 *  pillar. The page does NOT link through to per-member scorecards from
 *  manager view; that's the privacy line. The roster of names is here
 *  purely so the diffusion graph can render adopter labels. */
export const TEAM_MEMBER_ROSTER = TEAM_MEMBERS;
