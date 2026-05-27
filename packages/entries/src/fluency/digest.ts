/**
 * Per-week FluencyScorecard builder.
 *
 * Inputs: Entry[] (already enriched) for an ISO-week.
 * Output: FluencyScorecard — exactly what the personal /fluency page renders.
 *
 * Deterministic — no LLM. The summary string is templated from the
 * observed shape; the page already renders the per-axis evidence quotes,
 * which is where the qualitative content lives.
 */

import type { Entry } from "../types.js";
import {
  type AgentSourceKey,
  type FluencyAxisId,
  type FluencyAxisObservation,
  type FluencyRating,
  type FluencyScorecard,
  type RiskTrianglePosition,
  AGENT_SOURCE_LABEL,
  FLUENCY_AXES,
  FLUENCY_AXIS_BY_ID,
  FLUENCY_SCHEMA_VERSION,
} from "./types.js";
import { observeEntry, buildAxisObservation } from "./observe.js";

const RATING_VALUE: Record<FluencyRating, number> = {
  "+": 1.0,
  "~": 0.5,
  "-": 0.0,
  "·": 0.0,
};

/** ISO week Monday in local time. */
export function isoMondayOf(d: Date): string {
  const day = d.getDay() || 7;
  const monday = new Date(d);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(d.getDate() - day + 1);
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
}

/** Build a personal fluency scorecard for one ISO-week (or a 30-day window)
 *  from N entries. The data window is whatever the caller passes in via
 *  `entries`; `windowLabel` only adjusts the prose ("this week" vs
 *  "the last 30 days"). */
export function buildFluencyScorecard(input: {
  member_id: string;
  member_name: string;
  member_email?: string;
  week_monday: string;
  entries: Entry[];
  /** Prose framing for the summary. Defaults to "week". */
  windowLabel?: "week" | "30-day";
  /** Optional last-window scorecard for the +/- delta line. */
  prev?: FluencyScorecard | null;
}): FluencyScorecard {
  const entryObs = input.entries.map(observeEntry);

  const observations: FluencyAxisObservation[] = FLUENCY_AXES.map((a) =>
    buildAxisObservation(entryObs, a.id),
  );

  // Numerator: sum of rating-values across applicable axes.
  // Denominator: number of axes where any entry produced a non-N/A rating.
  let numerator = 0;
  let denominator = 0;
  for (const o of observations) {
    if (o.rating === "·") continue;
    denominator += 1;
    numerator += RATING_VALUE[o.rating];
  }
  // Always show /11 in headlines — keeps the framing consistent even
  // when some axes were N/A this week. The numerator already excludes them.
  const denomDisplay = 11;

  const strength_axis = pickAxis(observations, "+");
  const growth_axis = pickAxis(observations, "-", "~");
  const surface_mix = computeSurfaceMix(input.entries);
  const risk_triangle = computeRiskTriangle(entryObs);
  const summary = buildSummary({
    name: input.member_name,
    observations,
    risk_triangle,
    surface_mix,
    prev: input.prev,
    windowLabel: input.windowLabel ?? "week",
  });

  return {
    schema_version: FLUENCY_SCHEMA_VERSION,
    week_monday: input.week_monday,
    member_id: input.member_id,
    member_name: input.member_name,
    member_email: input.member_email,
    observations,
    score: { numerator, denominator: denomDisplay },
    score_prev: input.prev?.score,
    summary,
    strength_axis,
    growth_axis,
    surface_mix,
    risk_triangle,
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function pickAxis(
  observations: FluencyAxisObservation[],
  primary: FluencyRating,
  fallback?: FluencyRating,
): FluencyAxisId {
  const match = observations.find((o) => o.rating === primary);
  if (match) return match.axis;
  if (fallback) {
    const fb = observations.find((o) => o.rating === fallback);
    if (fb) return fb.axis;
  }
  return observations[0].axis;
}

function computeSurfaceMix(entries: Entry[]): Record<AgentSourceKey, number> {
  const totals: Record<AgentSourceKey, number> = {
    "claude-code": 0,
    codex: 0,
    gemini: 0,
    opencode: 0,
    other: 0,
  };
  let grand = 0;
  for (const e of entries) {
    const key: AgentSourceKey =
      e.agent === "codex" ? "codex"
        : e.agent === "gemini" ? "gemini"
          : e.agent === "claude-code" || !e.agent ? "claude-code"
            : "other";
    totals[key] += e.numbers.active_min;
    grand += e.numbers.active_min;
  }
  if (grand === 0) return totals;
  for (const k of Object.keys(totals) as AgentSourceKey[]) {
    totals[k] = totals[k] / grand;
  }
  return totals;
}

function computeRiskTriangle(
  entryObs: ReturnType<typeof observeEntry>[],
): RiskTrianglePosition {
  let polish = 0;
  let iterate = 0;
  let verify = 0;
  for (const o of entryObs) {
    if (o.risk_signals.polish) polish += 1;
    if (o.risk_signals.iterate_no_verify) iterate += 1;
    if (o.risk_signals.verify_no_iterate) verify += 1;
  }
  const total = polish + iterate + verify || 1;
  const triangle = {
    polish_without_check: polish / total,
    iterate_without_verify: iterate / total,
    verify_without_iterate: verify / total,
  };
  const dominant =
    polish > iterate && polish > verify
      ? "polish_without_check"
      : iterate > verify
        ? "iterate_without_verify"
        : verify > 0
          ? "verify_without_iterate"
          : "balanced";
  return { ...triangle, dominant_corner: dominant };
}

function buildSummary(input: {
  name: string;
  observations: FluencyAxisObservation[];
  risk_triangle: RiskTrianglePosition;
  surface_mix: Record<AgentSourceKey, number>;
  prev?: FluencyScorecard | null;
  windowLabel: "week" | "30-day";
}): string {
  const firstName = input.name.split(" ")[0];
  const wins = input.observations.filter((o) => o.rating === "+");
  const gaps = input.observations.filter((o) => o.rating === "-");
  const winList = wins
    .slice(0, 3)
    .map((o) => FLUENCY_AXIS_BY_ID[o.axis].title.toLowerCase())
    .join(", ");
  const gap = gaps[0] ? FLUENCY_AXIS_BY_ID[gaps[0].axis].title.toLowerCase() : "verify at boundary";
  const sourceLine = describeSurfaceMix(input.surface_mix, input.windowLabel);
  const windowPhrase = input.windowLabel === "30-day" ? "the last 30 days" : "this week";
  const nextPhrase = input.windowLabel === "30-day" ? "moving forward" : "next week";
  const balancedClose = input.windowLabel === "30-day"
    ? "Your three failure modes balanced across the last 30 days."
    : "Your three failure modes balanced this week.";
  const riskLine =
    input.risk_triangle.dominant_corner === "polish_without_check"
      ? "Your largest risk corner is polish-without-check — polished outputs went un-verified more than they should."
      : input.risk_triangle.dominant_corner === "iterate_without_verify"
        ? "Your largest risk corner is iterate-without-verify — refined into a comfortable answer, never tested."
        : input.risk_triangle.dominant_corner === "verify_without_iterate"
          ? "Your largest risk corner is verify-without-iterate — checked, then shipped first draft anyway."
          : balancedClose;
  return `${firstName}, over ${windowPhrase} you demonstrated ${winList || "early signs across most axes"}. ${sourceLine} ${riskLine} The single highest-leverage move ${nextPhrase} is to deliberately add a ${gap} step on one session — the report will pick it up automatically.`;
}

function describeSurfaceMix(
  mix: Record<AgentSourceKey, number>,
  windowLabel: "week" | "30-day",
): string {
  const ranked = (Object.entries(mix) as Array<[AgentSourceKey, number]>)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) {
    return windowLabel === "30-day"
      ? "No active surfaces in the last 30 days."
      : "No active surfaces this week.";
  }
  if (ranked.length === 1) {
    return `${AGENT_SOURCE_LABEL[ranked[0][0]]} carried 100% of your agent time.`;
  }
  return `${AGENT_SOURCE_LABEL[ranked[0][0]]} ${Math.round(ranked[0][1] * 100)}% + ${AGENT_SOURCE_LABEL[ranked[1][0]]} ${Math.round(ranked[1][1] * 100)}%.`;
}

/* ------------------------------------------------------------------ */
/*  Team aggregate builder                                              */
/* ------------------------------------------------------------------ */

import type {
  FluencyAxisDistribution,
  TeamFluencyReport,
} from "./types.js";

/** Build a team-wide aggregate from N member scorecards.
 *
 *  Manager-readable. Strictly contains no per-engineer rows — only
 *  distributions, the team centroid, and explicitly opt-in highlights.
 */
export function buildTeamFluencyReport(input: {
  team_slug: string;
  team_name: string;
  week_monday: string;
  members_total: number;
  scorecards: FluencyScorecard[];
  /** Optional prior-week aggregate for centroid drift. */
  prev?: TeamFluencyReport | null;
}): TeamFluencyReport {
  const cards = input.scorecards;
  const distribution: FluencyAxisDistribution[] = FLUENCY_AXES.map((axis) => {
    let d = 0, p = 0, n = 0;
    for (const c of cards) {
      const obs = c.observations.find((o) => o.axis === axis.id);
      if (!obs) continue;
      if (obs.rating === "+") d += 1;
      else if (obs.rating === "~") p += 1;
      else if (obs.rating === "-") n += 1;
    }
    const prevRow = input.prev?.distribution.find((r) => r.axis === axis.id);
    return {
      axis: axis.id,
      demonstrated: d,
      partial: p,
      not_observed: n,
      total: cards.length,
      demonstrated_prev: prevRow?.demonstrated,
    };
  });

  // Team centroid for the Risk Triangle = mean of member centroids,
  // weighted equally so one heavy-poster doesn't dominate.
  const riskTriangle: RiskTrianglePosition = (() => {
    if (cards.length === 0) {
      return { polish_without_check: 0, iterate_without_verify: 0, verify_without_iterate: 0, dominant_corner: "balanced" };
    }
    const sum = { p: 0, i: 0, v: 0 };
    for (const c of cards) {
      sum.p += c.risk_triangle.polish_without_check;
      sum.i += c.risk_triangle.iterate_without_verify;
      sum.v += c.risk_triangle.verify_without_iterate;
    }
    const n = cards.length;
    const p = sum.p / n, i = sum.i / n, v = sum.v / n;
    const total = p + i + v || 1;
    const norm = { polish_without_check: p / total, iterate_without_verify: i / total, verify_without_iterate: v / total };
    const dom =
      norm.polish_without_check >= norm.iterate_without_verify && norm.polish_without_check >= norm.verify_without_iterate
        ? "polish_without_check"
        : norm.iterate_without_verify >= norm.verify_without_iterate
          ? "iterate_without_verify"
          : "verify_without_iterate";
    return { ...norm, dominant_corner: dom };
  })();

  // Team score = mean of member /11 scores
  const teamScore = cards.length === 0
    ? 0
    : cards.reduce((s, c) => s + c.score.numerator, 0) / cards.length;

  // Surface mix across the team (weighted by per-member active_min would need
  // raw entries; here we take an unweighted mean of the per-member mixes).
  const surfaceMix: Record<AgentSourceKey, number> = {
    "claude-code": 0, codex: 0, gemini: 0, opencode: 0, other: 0,
  };
  for (const c of cards) {
    for (const k of Object.keys(surfaceMix) as AgentSourceKey[]) {
      surfaceMix[k] += (c.surface_mix[k] ?? 0) / Math.max(1, cards.length);
    }
  }

  // Norm proposal: pick the axis whose Demonstrated rate is between 20-40%
  // and whose dominant Risk Triangle corner aligns. Defaults to Di2.
  const proposalAxis = pickNormProposalAxis(distribution, riskTriangle);
  const proposal = {
    headline: `Make '${FLUENCY_AXIS_BY_ID[proposalAxis].title.toLowerCase()}' a team norm by the end of next month.`,
    axis: proposalAxis,
    rationale:
      `${FLUENCY_AXIS_BY_ID[proposalAxis].title} demonstrated by ${distribution.find((d) => d.axis === proposalAxis)?.demonstrated ?? 0} of ${cards.length} engineers this week. The team's Risk Triangle leans toward ${labelCorner(riskTriangle.dominant_corner)} — closing this axis is the most direct way to pull the centroid back to balanced.`,
  };

  return {
    schema_version: FLUENCY_SCHEMA_VERSION,
    week_monday: input.week_monday,
    team_slug: input.team_slug,
    team_name: input.team_name,
    members_active: cards.length,
    members_total: input.members_total,
    team_score: { value: teamScore, max: 11, prev_value: input.prev?.team_score.value },
    distribution,
    risk_triangle: { ...riskTriangle, prev: input.prev?.risk_triangle },
    diffusion: [], // Phase 2.5 — needs cross-member cross-day signal lookup
    norms_trajectory: [], // Phase 2.5 — needs 4 weeks of historical aggregates
    highlights: [], // Highlight reel is strictly opt-in publish, not auto
    surface_mix: surfaceMix,
    norm_proposal: proposal,
  };
}

function pickNormProposalAxis(
  distribution: FluencyAxisDistribution[],
  risk: RiskTrianglePosition,
): FluencyAxisId {
  // Map corner → axis that, if improved, would pull the centroid in.
  const cornerAxis: Record<RiskTrianglePosition["dominant_corner"], FluencyAxisId> = {
    polish_without_check: "Di2",
    iterate_without_verify: "Di2",
    verify_without_iterate: "De4",
    balanced: "D1",
  };
  return cornerAxis[risk.dominant_corner];
}

function labelCorner(c: RiskTrianglePosition["dominant_corner"]): string {
  switch (c) {
    case "polish_without_check": return "polish-without-check";
    case "iterate_without_verify": return "iterate-without-verify";
    case "verify_without_iterate": return "verify-without-iterate";
    case "balanced": return "balance";
  }
}
