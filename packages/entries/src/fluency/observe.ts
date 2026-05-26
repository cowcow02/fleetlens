/**
 * Deterministic AI Fluency observation — one Entry → 11 axis ratings.
 *
 * Every axis rating is grounded in observable JSONL signals already
 * captured on the Entry shape. No LLM, no fuzzy heuristics — just regex
 * + count checks against the existing typed fields.
 *
 * Per-axis rating semantics:
 *   "+" Demonstrated   — clear, repeated evidence within the entry
 *   "~" Partial        — present but inconsistent / imperfectly executed
 *   "-" Not observed   — entry's shape was one where evidence *would*
 *                         have been expected, and we didn't see any
 *   "·" Not applicable — the entry's shape doesn't admit this axis
 *                         (e.g. Di2 doesn't fire on a research-only entry)
 */

import type { Entry } from "../types.js";
import type {
  AgentSourceKey,
  FluencyAxisId,
  FluencyAxisObservation,
  FluencyEvidence,
  FluencyRating,
} from "./types.js";

const MAX_QUOTE = 150;

function clipQuote(s: string): string {
  const trimmed = s.replace(/\s+/g, " ").trim();
  return trimmed.length > MAX_QUOTE ? `${trimmed.slice(0, MAX_QUOTE - 1)}…` : trimmed;
}

function agentSource(agent: Entry["agent"]): AgentSourceKey {
  switch (agent) {
    case "claude-code":
    case undefined:
      return "claude-code";
    case "codex":
      return "codex";
    case "gemini":
      return "gemini";
    default:
      return "other";
  }
}

function evidence(entry: Entry, quote: string, extra?: string): FluencyEvidence {
  return {
    quote: clipQuote(extra ? `${quote} ${extra}` : quote),
    date: entry.local_day,
    source: agentSource(entry.agent),
    session_id: entry.session_id,
    project: entry.project.split("/").pop() ?? entry.project,
  };
}

/* ------------------------------------------------------------------ */
/*  Per-axis observers                                                  */
/* ------------------------------------------------------------------ */

const REVIEW_RE = /\b(review|verify|audit|spec-?compliance|code-?quality|fact-?check)\b/i;
const SPEC_RE = /\b(spec|plan|design[- ]doc|chunk|task\s+\d)\b/i;
const IMPLEMENTER_RE = /\b(implement|build|ship|fix|refactor)\b/i;
const DONE_CRITERIA_RE = /\b(done\s+(when|criteria)|acceptance criteria|definition of done|success(?:ful)? when|return shape|output (?:shape|format)|MUST (?:return|emit|produce))\b/i;
const CONSTRAINT_RE = /\b(do not|don'?t|never|avoid|invariant|MUST NOT|anti[- ]pattern|trap|gotcha|caveat|warning)\b/i;
const EXAMPLE_RE = /\b(example|like this|here'?s how|reference implementation|match (?:this|the) style|sample)\b/i;
const VERIFY_TOOL_RE = /\b(npm\s+(?:run\s+)?test|pnpm\s+(?:run\s+)?test|pytest|jest|vitest|cargo test|go test|playwright|smoke|tsc|typecheck|lint|build)\b/i;
const SKEPTICAL_RE = /\b(are you sure|wait[,.]?|is that (?:right|correct)|show me (?:the|that)|prove|reference|where (?:does|did) (?:that|this)|that doesn'?t look|i don'?t (?:think|believe))\b/i;
const ROLLBACK_RE = /\b(revert|undo|roll ?back|scrap (?:that|this)|let'?s restart|start over|throw (?:that|this) away|git (?:reset|revert|restore))\b/i;
const CONTEXT_CORRECTION_RE = /\b(no,? (?:that|this)|actually,?|heads ?up|FYI|important context|to clarify|just so you know)\b/i;
const FILE_REF_RE = /(?:[a-zA-Z0-9_/.-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|rb|md|sql|json|yml|yaml|toml|css|scss|html|sh|mjs))\b|#\d{2,}\b|kip-\d+/i;
const OUTPUT_SHAPE_RE = /\b(function\s+\w+\s*\(|interface\s+\w+|type\s+\w+\s*=|schema\s*:\s*\{|return\s+\{|signature\s*:|kind\s*:\s*"|fields?\s*:)\b/i;

const STOCK_SUBAGENT_PREFIXES = /^(general-purpose|Explore|Plan|claude-code-guide|playwright-qa-verifier|statusline-setup|frontend-design:|code-review:|code-simplifier:|codex:|superpowers:)/;

function isReviewerDispatch(sub: { type: string; description: string; prompt_preview: string }): boolean {
  const all = `${sub.description} ${sub.prompt_preview}`;
  return REVIEW_RE.test(all);
}

function isSpecTarget(text: string): boolean {
  return SPEC_RE.test(text);
}

/** D1: Plan-gating — plan before implementation. */
function observeD1(entry: Entry): { rating: FluencyRating; evidence: FluencyEvidence[] } {
  const planTool = entry.numbers.exit_plan_calls > 0 || entry.flags.includes("plan_used");
  const reviewerSubagents = entry.subagents.filter(isReviewerDispatch);
  const specReviewSubagents = reviewerSubagents.filter((s) => isSpecTarget(`${s.description} ${s.prompt_preview}`));
  if (planTool) {
    return {
      rating: "+",
      evidence: [evidence(entry, "Plan Mode used before implementation.")],
    };
  }
  if (specReviewSubagents.length >= 2) {
    return {
      rating: "+",
      evidence: specReviewSubagents.slice(0, 2).map((s) => evidence(entry, s.description, s.prompt_preview)),
    };
  }
  if (specReviewSubagents.length === 1 || reviewerSubagents.length >= 2) {
    return {
      rating: "~",
      evidence: [evidence(entry, (specReviewSubagents[0] ?? reviewerSubagents[0]).description)],
    };
  }
  // Was implementation present? If yes and no plan-gating, that's "-".
  // Pure research / chat / micro tasks → N/A.
  const shipped = entry.numbers.prs > 0 || entry.numbers.commits > 0 || entry.numbers.pushes > 0;
  if (shipped) {
    return { rating: "-", evidence: [] };
  }
  return { rating: "·", evidence: [] };
}

/** D2: Scoping clarity — first turn names a definition-of-done. */
function observeD2(entry: Entry): { rating: FluencyRating; evidence: FluencyEvidence[] } {
  const head = entry.first_user.slice(0, 1500);
  const hits = head.match(DONE_CRITERIA_RE);
  if (hits) {
    const idx = head.indexOf(hits[0]);
    const ctx = head.slice(Math.max(0, idx - 40), idx + 110);
    return { rating: "+", evidence: [evidence(entry, ctx)] };
  }
  // Partial credit: very long first_user implies scoping was *attempted*,
  // but no explicit "done when" appears.
  if (head.length > 600) return { rating: "~", evidence: [] };
  // If shipped without explicit done criteria, count it as "-"; trivial entries N/A.
  if (entry.numbers.prs > 0 || entry.numbers.commits > 0) return { rating: "-", evidence: [] };
  return { rating: "·", evidence: [] };
}

/** D3: Reviewer-type matching — dispatches route to the right reviewer. */
function observeD3(entry: Entry): { rating: FluencyRating; evidence: FluencyEvidence[] } {
  const reviewers = entry.subagents.filter(isReviewerDispatch);
  if (reviewers.length === 0) return { rating: "·", evidence: [] };

  // A team running multiple distinct lenses on the same target = "+"
  // (the canonical reviewer-triad pattern). Three+ reviewer dispatches
  // with distinct descriptions counts as Demonstrated.
  const distinctDescriptions = new Set(reviewers.map((r) => r.description.toLowerCase()));
  if (reviewers.length >= 3 && distinctDescriptions.size >= 3) {
    return {
      rating: "+",
      evidence: reviewers.slice(0, 3).map((r) => evidence(entry, r.description)),
    };
  }

  // Mixing stock superpowers:code-reviewer with general-purpose reviewer-style
  // dispatches in the same session also counts as +.
  const hasStockCodeReviewer = reviewers.some((r) => /superpowers:code-reviewer/.test(r.type));
  const hasGenericReviewer = reviewers.some((r) => /^general-purpose$/.test(r.type));
  if (hasStockCodeReviewer && hasGenericReviewer) {
    return {
      rating: "+",
      evidence: [
        evidence(entry, reviewers.find((r) => /superpowers:code-reviewer/.test(r.type))!.description),
        evidence(entry, reviewers.find((r) => /^general-purpose$/.test(r.type))!.description),
      ].slice(0, 2),
    };
  }
  if (reviewers.length >= 1) {
    return { rating: "~", evidence: [evidence(entry, reviewers[0].description)] };
  }
  return { rating: "-", evidence: [] };
}

/** De1: Context shoring — first turn references concrete files / refs. */
function observeDe1(entry: Entry): { rating: FluencyRating; evidence: FluencyEvidence[] } {
  const head = entry.first_user.slice(0, 2000);
  const refs = head.match(/(?:[a-zA-Z0-9_/.-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|rb|md|sql|json|yml|yaml|toml|css|scss|html|sh|mjs))\b|#\d{2,}\b|kip-\d+/gi) ?? [];
  const uniq = new Set(refs.map((r) => r.toLowerCase()));
  if (uniq.size >= 2) {
    return {
      rating: "+",
      evidence: [evidence(entry, `References: ${Array.from(uniq).slice(0, 5).join(", ")}`)],
    };
  }
  if (uniq.size === 1) {
    return { rating: "~", evidence: [evidence(entry, `Reference: ${Array.from(uniq)[0]}`)] };
  }
  if (head.length > 200) return { rating: "-", evidence: [] };
  return { rating: "·", evidence: [] };
}

/** De2: Output shape specification. */
function observeDe2(entry: Entry): { rating: FluencyRating; evidence: FluencyEvidence[] } {
  const head = entry.first_user.slice(0, 2000);
  const m = head.match(OUTPUT_SHAPE_RE);
  if (m) {
    const idx = head.indexOf(m[0]);
    const ctx = head.slice(Math.max(0, idx - 30), idx + 130);
    return { rating: "+", evidence: [evidence(entry, ctx)] };
  }
  // "match this style" / "like X" example references = partial
  if (EXAMPLE_RE.test(head)) {
    const idx = head.match(EXAMPLE_RE);
    return { rating: "~", evidence: [evidence(entry, idx ? idx[0] : "example reference")] };
  }
  if (head.length > 200 && (entry.numbers.prs > 0 || entry.numbers.commits > 0)) {
    return { rating: "-", evidence: [] };
  }
  return { rating: "·", evidence: [] };
}

/** De3: Constraint surfacing — first turn names traps. */
function observeDe3(entry: Entry): { rating: FluencyRating; evidence: FluencyEvidence[] } {
  const head = entry.first_user.slice(0, 2000);
  const matches = head.match(CONSTRAINT_RE);
  if (!matches) {
    if (head.length > 200) return { rating: "-", evidence: [] };
    return { rating: "·", evidence: [] };
  }
  // Count distinct constraint expressions; 2+ = "+"
  const all = head.match(/\b(do not|don'?t|never|avoid|invariant|MUST NOT|anti[- ]pattern|trap|gotcha|caveat|warning)\b/gi) ?? [];
  if (all.length >= 2) {
    const idx = head.indexOf(matches[0]);
    return { rating: "+", evidence: [evidence(entry, head.slice(Math.max(0, idx - 20), idx + 130))] };
  }
  return { rating: "~", evidence: [evidence(entry, head.slice(Math.max(0, head.indexOf(matches[0]) - 20), head.indexOf(matches[0]) + 130))] };
}

/** De4: Iterative refinement — Anthropic's strongest predictor. */
function observeDe4(entry: Entry): { rating: FluencyRating; evidence: FluencyEvidence[] } {
  const humanTurns = entry.user_input_sources.human;
  // Refinement requires ≥3 human turns AND active iteration signals
  // (dissatisfied corrections or simply more turns than tokens-per-turn implies a one-shot).
  if (humanTurns >= 4) {
    return {
      rating: "+",
      evidence: [evidence(entry, `${humanTurns} user turns; iterative refinement.`)],
    };
  }
  if (humanTurns >= 2) {
    return { rating: "~", evidence: [evidence(entry, `${humanTurns} user turns.`)] };
  }
  // One-turn sessions on long autonomous work = first-draft acceptance = "-"
  if (entry.flags.includes("long_autonomous") || entry.numbers.active_min > 30) {
    return { rating: "-", evidence: [] };
  }
  return { rating: "·", evidence: [] };
}

/** Di1: Skeptical review — user challenges agent claims. */
function observeDi1(entry: Entry): { rating: FluencyRating; evidence: FluencyEvidence[] } {
  // We don't have the full conversation here — best proxy is satisfaction
  // signals + interrupts + flag patterns.
  const interrupts = entry.numbers.interrupts;
  const dissatisfied = entry.satisfaction_signals.dissatisfied;
  if (interrupts >= 2 && dissatisfied >= 1) {
    return {
      rating: "+",
      evidence: [evidence(entry, `${interrupts} interrupts, ${dissatisfied} corrections — active skeptical engagement.`)],
    };
  }
  if (interrupts >= 1 || dissatisfied >= 1) {
    return { rating: "~", evidence: [evidence(entry, `${interrupts} interrupts, ${dissatisfied} corrections.`)] };
  }
  if (entry.numbers.turn_count > 5) return { rating: "-", evidence: [] };
  return { rating: "·", evidence: [] };
}

/** Di2: Verify at boundary — tests/builds run before merge. */
function observeDi2(entry: Entry): { rating: FluencyRating; evidence: FluencyEvidence[] } {
  const shipped = entry.numbers.prs > 0 || entry.numbers.pushes > 0;
  if (!shipped) return { rating: "·", evidence: [] };

  // Did any tool call match a verify pattern within this entry?
  const hasVerifyTool = entry.top_tools.some((t) => VERIFY_TOOL_RE.test(t));
  const hasVerifyFlag = entry.flags.some((f) => /verif|test|build/i.test(f));
  if (hasVerifyTool || hasVerifyFlag) {
    return {
      rating: "+",
      evidence: [evidence(entry, `Verify step present before ship (tools: ${entry.top_tools.slice(0, 3).join(", ")}).`)],
    };
  }
  return { rating: "-", evidence: [] };
}

/** Di3: Rollback discipline. */
function observeDi3(entry: Entry): { rating: FluencyRating; evidence: FluencyEvidence[] } {
  const allText = `${entry.first_user}\n${entry.final_agent}\n${(entry.enrichment.user_instructions ?? []).join("\n")}`;
  if (ROLLBACK_RE.test(allText)) {
    const m = allText.match(ROLLBACK_RE);
    return { rating: "+", evidence: [evidence(entry, m![0])] };
  }
  if (entry.flags.some((f) => /retry|loop|restart/i.test(f))) {
    return { rating: "~", evidence: [evidence(entry, "retry / loop signal present")] };
  }
  return { rating: "·", evidence: [] };
}

/** Di4: Context correction. */
function observeDi4(entry: Entry): { rating: FluencyRating; evidence: FluencyEvidence[] } {
  const instructions = entry.enrichment.user_instructions ?? [];
  for (const inst of instructions) {
    if (CONTEXT_CORRECTION_RE.test(inst)) {
      const m = inst.match(CONTEXT_CORRECTION_RE);
      if (m) {
        const idx = inst.indexOf(m[0]);
        return {
          rating: "+",
          evidence: [evidence(entry, inst.slice(Math.max(0, idx - 30), idx + 130))],
        };
      }
    }
  }
  // Partial: at least the friction_detail indicates correction surfaced after the fact
  if (entry.enrichment.friction_detail && CONTEXT_CORRECTION_RE.test(entry.enrichment.friction_detail)) {
    return {
      rating: "~",
      evidence: [evidence(entry, entry.enrichment.friction_detail.slice(0, 130))],
    };
  }
  return { rating: "·", evidence: [] };
}

/* ------------------------------------------------------------------ */

const OBSERVERS: Record<FluencyAxisId, (e: Entry) => { rating: FluencyRating; evidence: FluencyEvidence[] }> = {
  D1: observeD1,
  D2: observeD2,
  D3: observeD3,
  De1: observeDe1,
  De2: observeDe2,
  De3: observeDe3,
  De4: observeDe4,
  Di1: observeDi1,
  Di2: observeDi2,
  Di3: observeDi3,
  Di4: observeDi4,
};

/** Per-Entry observation. Returns 11 per-axis ratings + evidence, plus the
 *  agent source so downstream digests can split by surface. */
export function observeEntry(entry: Entry): {
  source: AgentSourceKey;
  axis_obs: Record<FluencyAxisId, { rating: FluencyRating; evidence: FluencyEvidence[] }>;
  risk_signals: { polish: boolean; iterate_no_verify: boolean; verify_no_iterate: boolean };
} {
  const axis_obs = {} as Record<FluencyAxisId, { rating: FluencyRating; evidence: FluencyEvidence[] }>;
  for (const [id, fn] of Object.entries(OBSERVERS)) {
    axis_obs[id as FluencyAxisId] = fn(entry);
  }
  const verified = axis_obs.Di2.rating === "+";
  const iterated = axis_obs.De4.rating === "+";
  const polished = entry.numbers.prs > 0 || entry.flags.includes("artifact");
  return {
    source: agentSource(entry.agent),
    axis_obs,
    risk_signals: {
      polish: polished && !verified,
      iterate_no_verify: iterated && !verified,
      verify_no_iterate: verified && !iterated,
    },
  };
}

/** Aggregate per-axis ratings across N entries → single rating + best evidence.
 *  Rule:
 *    - any "+" in the set wins to "+"
 *    - else any "~" wins to "~"
 *    - else if at least half are "-", result is "-"
 *    - else "·"
 *  Evidence is collected from the strongest entries first (max 3 quotes). */
export function aggregateAxis(
  obs: Array<{ rating: FluencyRating; evidence: FluencyEvidence[] }>,
): { rating: FluencyRating; evidence: FluencyEvidence[] } {
  if (obs.length === 0) return { rating: "·", evidence: [] };
  const buckets = { "+": [] as FluencyEvidence[], "~": [] as FluencyEvidence[], "-": 0, "·": 0 };
  for (const o of obs) {
    if (o.rating === "+") buckets["+"].push(...o.evidence);
    else if (o.rating === "~") buckets["~"].push(...o.evidence);
    else if (o.rating === "-") buckets["-"] += 1;
    else buckets["·"] += 1;
  }
  if (buckets["+"].length > 0) return { rating: "+", evidence: buckets["+"].slice(0, 3) };
  if (buckets["~"].length > 0) return { rating: "~", evidence: buckets["~"].slice(0, 3) };
  const applicable = obs.length - buckets["·"];
  if (applicable > 0 && buckets["-"] / applicable >= 0.5) return { rating: "-", evidence: [] };
  return { rating: "·", evidence: [] };
}

/** Aggregate per-source for a single axis (Claude Code / Codex / Gemini). */
export function aggregateAxisBySource(
  entryObs: Array<{ source: AgentSourceKey; axis_obs: Record<FluencyAxisId, { rating: FluencyRating; evidence: FluencyEvidence[] }> }>,
  axis: FluencyAxisId,
): Partial<Record<AgentSourceKey, FluencyRating>> {
  const bySource = new Map<AgentSourceKey, Array<{ rating: FluencyRating; evidence: FluencyEvidence[] }>>();
  for (const e of entryObs) {
    const arr = bySource.get(e.source) ?? [];
    arr.push(e.axis_obs[axis]);
    bySource.set(e.source, arr);
  }
  const out: Partial<Record<AgentSourceKey, FluencyRating>> = {};
  for (const [src, arr] of bySource) {
    out[src] = aggregateAxis(arr).rating;
  }
  return out;
}

/** Build a single axis observation row for the week, ready for the scorecard. */
export function buildAxisObservation(
  entryObs: Array<{ source: AgentSourceKey; axis_obs: Record<FluencyAxisId, { rating: FluencyRating; evidence: FluencyEvidence[] }> }>,
  axis: FluencyAxisId,
): FluencyAxisObservation {
  const flat = entryObs.map((e) => e.axis_obs[axis]);
  const agg = aggregateAxis(flat);
  return {
    axis,
    rating: agg.rating,
    evidence: agg.evidence,
    by_source: aggregateAxisBySource(entryObs, axis),
  };
}
