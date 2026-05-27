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

type EvidenceOpts = {
  /** Defaults to "verbatim". Set "derived" for templated commentary the
   *  renderer must NOT style as a quote. */
  kind?: "verbatim" | "derived";
  /** 0 = first_user, 1 = first user_instruction, 2 = second, etc. */
  turn_index?: number;
};

function evidence(entry: Entry, quote: string, opts: EvidenceOpts = {}): FluencyEvidence {
  return {
    quote: clipQuote(quote),
    kind: opts.kind ?? "verbatim",
    turn_index: opts.turn_index,
    date: entry.local_day,
    source: agentSource(entry.agent),
    session_id: entry.session_id,
    project: entry.project.split("/").pop() ?? entry.project,
  };
}

/** Convenience: derived (templated) commentary. No turn_index because the
 *  evidence wasn't anchored to a specific user turn. */
function evidenceDerived(entry: Entry, signalText: string): FluencyEvidence {
  return evidence(entry, signalText, { kind: "derived" });
}

/** Return all user turns of an entry as `(text, turn_index)` pairs, with
 *  first_user as turn 0 and user_instructions[i] as turn i+1. Skips
 *  empties so callers can search the real text. */
function userTurns(entry: Entry): Array<{ text: string; turn_index: number }> {
  const out: Array<{ text: string; turn_index: number }> = [];
  if (entry.first_user && entry.first_user.trim()) {
    out.push({ text: entry.first_user, turn_index: 0 });
  }
  const insts = entry.enrichment.user_instructions ?? [];
  for (let i = 0; i < insts.length; i++) {
    const t = insts[i];
    if (t && t.trim()) out.push({ text: t, turn_index: i + 1 });
  }
  return out;
}

/** Find the first user turn whose text matches a regex; return the
 *  matched window + the turn_index. Null if no match. */
function findTurnMatch(
  entry: Entry,
  re: RegExp,
  windowBefore = 20,
  windowAfter = 130,
): { snippet: string; turn_index: number; full: string } | null {
  for (const t of userTurns(entry)) {
    const m = t.text.match(re);
    if (!m) continue;
    const idx = t.text.indexOf(m[0]);
    const snippet = t.text.slice(Math.max(0, idx - windowBefore), idx + windowAfter);
    return { snippet, turn_index: t.turn_index, full: t.text };
  }
  return null;
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

/** D1: Plan-gating — plan before implementation. Subagent dispatches and
 *  Plan-Mode invocations are agent-side signals (no user-turn anchor), so
 *  they ship as `derived`. */
function observeD1(entry: Entry): { rating: FluencyRating; evidence: FluencyEvidence[] } {
  const planTool = entry.numbers.exit_plan_calls > 0 || entry.flags.includes("plan_used");
  const reviewerSubagents = entry.subagents.filter(isReviewerDispatch);
  const specReviewSubagents = reviewerSubagents.filter((s) => isSpecTarget(`${s.description} ${s.prompt_preview}`));
  if (planTool) {
    return {
      rating: "+",
      evidence: [evidenceDerived(entry, "Plan Mode invoked before any implementation tool fired.")],
    };
  }
  if (specReviewSubagents.length >= 2) {
    return {
      rating: "+",
      evidence: specReviewSubagents.slice(0, 2).map((s) =>
        evidenceDerived(entry, `Spec-review subagent dispatched: ${s.description}`),
      ),
    };
  }
  if (specReviewSubagents.length === 1 || reviewerSubagents.length >= 2) {
    const target = specReviewSubagents[0] ?? reviewerSubagents[0];
    return {
      rating: "~",
      evidence: [evidenceDerived(entry, `Reviewer subagent dispatched: ${target.description}`)],
    };
  }
  const shipped = entry.numbers.prs > 0 || entry.numbers.commits > 0 || entry.numbers.pushes > 0;
  if (shipped) return { rating: "-", evidence: [] };
  return { rating: "·", evidence: [] };
}

/** D2: Scoping clarity — first turn names a definition-of-done. */
function observeD2(entry: Entry): { rating: FluencyRating; evidence: FluencyEvidence[] } {
  const m = findTurnMatch(entry, DONE_CRITERIA_RE, 40, 110);
  if (m) {
    return { rating: "+", evidence: [evidence(entry, m.snippet, { turn_index: m.turn_index })] };
  }
  if ((entry.first_user?.length ?? 0) > 600) return { rating: "~", evidence: [] };
  if (entry.numbers.prs > 0 || entry.numbers.commits > 0) return { rating: "-", evidence: [] };
  return { rating: "·", evidence: [] };
}

/** D3: Reviewer-type matching — subagent dispatches route to the right
 *  reviewer. Subagent descriptions are agent-side signals → `derived`. */
function observeD3(entry: Entry): { rating: FluencyRating; evidence: FluencyEvidence[] } {
  const reviewers = entry.subagents.filter(isReviewerDispatch);
  if (reviewers.length === 0) return { rating: "·", evidence: [] };

  const distinctDescriptions = new Set(reviewers.map((r) => r.description.toLowerCase()));
  if (reviewers.length >= 3 && distinctDescriptions.size >= 3) {
    return {
      rating: "+",
      evidence: reviewers.slice(0, 3).map((r) => evidenceDerived(entry, `Subagent dispatched: ${r.description}`)),
    };
  }

  const hasStockCodeReviewer = reviewers.some((r) => /superpowers:code-reviewer/.test(r.type));
  const hasGenericReviewer = reviewers.some((r) => /^general-purpose$/.test(r.type));
  if (hasStockCodeReviewer && hasGenericReviewer) {
    return {
      rating: "+",
      evidence: [
        evidenceDerived(entry, `Subagent dispatched: ${reviewers.find((r) => /superpowers:code-reviewer/.test(r.type))!.description}`),
        evidenceDerived(entry, `Subagent dispatched: ${reviewers.find((r) => /^general-purpose$/.test(r.type))!.description}`),
      ],
    };
  }
  if (reviewers.length >= 1) {
    return { rating: "~", evidence: [evidenceDerived(entry, `Subagent dispatched: ${reviewers[0].description}`)] };
  }
  return { rating: "-", evidence: [] };
}

/** De1: Context shoring — first turn references concrete files / refs.
 *  Returns the actual text containing the first reference as the verbatim
 *  quote, so the user sees their own words. */
function observeDe1(entry: Entry): { rating: FluencyRating; evidence: FluencyEvidence[] } {
  const REF_RE = /(?:[a-zA-Z0-9_/.-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|rb|md|sql|json|yml|yaml|toml|css|scss|html|sh|mjs))\b|#\d{2,}\b|kip-\d+/gi;
  for (const t of userTurns(entry)) {
    const refs = t.text.match(REF_RE) ?? [];
    const uniq = new Set(refs.map((r) => r.toLowerCase()));
    if (uniq.size === 0) continue;
    // Window around the first reference so the user sees their own context.
    const first = refs[0]!;
    const idx = t.text.indexOf(first);
    const snippet = t.text.slice(Math.max(0, idx - 30), idx + 130);
    if (uniq.size >= 2) {
      return { rating: "+", evidence: [evidence(entry, snippet, { turn_index: t.turn_index })] };
    }
    return { rating: "~", evidence: [evidence(entry, snippet, { turn_index: t.turn_index })] };
  }
  if ((entry.first_user?.length ?? 0) > 200) return { rating: "-", evidence: [] };
  return { rating: "·", evidence: [] };
}

/** De2: Output shape specification. */
function observeDe2(entry: Entry): { rating: FluencyRating; evidence: FluencyEvidence[] } {
  const shapeMatch = findTurnMatch(entry, OUTPUT_SHAPE_RE, 30, 130);
  if (shapeMatch) {
    return { rating: "+", evidence: [evidence(entry, shapeMatch.snippet, { turn_index: shapeMatch.turn_index })] };
  }
  const exampleMatch = findTurnMatch(entry, EXAMPLE_RE, 20, 130);
  if (exampleMatch) {
    return { rating: "~", evidence: [evidence(entry, exampleMatch.snippet, { turn_index: exampleMatch.turn_index })] };
  }
  if ((entry.first_user?.length ?? 0) > 200 && (entry.numbers.prs > 0 || entry.numbers.commits > 0)) {
    return { rating: "-", evidence: [] };
  }
  return { rating: "·", evidence: [] };
}

/** De3: Constraint surfacing — first turn names traps. */
function observeDe3(entry: Entry): { rating: FluencyRating; evidence: FluencyEvidence[] } {
  const hit = findTurnMatch(entry, CONSTRAINT_RE, 20, 130);
  if (!hit) {
    if ((entry.first_user?.length ?? 0) > 200) return { rating: "-", evidence: [] };
    return { rating: "·", evidence: [] };
  }
  // Promote to "+" only if the matched turn contains TWO or more constraint
  // expressions — single occurrences stay "~".
  const allInTurn = hit.full.match(/\b(do not|don'?t|never|avoid|invariant|MUST NOT|anti[- ]pattern|trap|gotcha|caveat|warning)\b/gi) ?? [];
  const rating: FluencyRating = allInTurn.length >= 2 ? "+" : "~";
  return { rating, evidence: [evidence(entry, hit.snippet, { turn_index: hit.turn_index })] };
}

/** De4: Iterative refinement — Anthropic's strongest predictor. Surfaces
 *  REAL refinement turns (a representative middle/late user_instruction)
 *  as verbatim evidence so the reader sees the user's actual mid-session
 *  steering rather than a count. */
function observeDe4(entry: Entry): { rating: FluencyRating; evidence: FluencyEvidence[] } {
  const humanTurns = entry.user_input_sources.human;
  const insts = entry.enrichment.user_instructions ?? [];

  function representativeRefinement(): FluencyEvidence | null {
    // Pick the first user_instruction (turn 1) — it's by definition a
    // refinement of whatever first_user (turn 0) started. Fall back to a
    // longer downstream instruction if available.
    if (insts.length === 0) return null;
    let best = insts[0];
    let bestIdx = 0;
    for (let i = 1; i < insts.length; i++) {
      if ((insts[i]?.length ?? 0) > best.length) { best = insts[i]; bestIdx = i; }
    }
    return evidence(entry, best, { turn_index: bestIdx + 1 });
  }

  if (humanTurns >= 4) {
    const real = representativeRefinement();
    const evs: FluencyEvidence[] = [evidenceDerived(entry, `${humanTurns} human turns; multi-round refinement.`)];
    if (real) evs.push(real);
    return { rating: "+", evidence: evs };
  }
  if (humanTurns >= 2) {
    const real = representativeRefinement();
    const evs: FluencyEvidence[] = [evidenceDerived(entry, `${humanTurns} human turns.`)];
    if (real) evs.push(real);
    return { rating: "~", evidence: evs };
  }
  if (entry.flags.includes("long_autonomous") || entry.numbers.active_min > 30) {
    return { rating: "-", evidence: [] };
  }
  return { rating: "·", evidence: [] };
}

/** Di1: Skeptical review — user challenges agent claims. Surfaces the
 *  actual challenging turn as verbatim evidence when one is present;
 *  otherwise falls back to a derived signal showing the interrupt count. */
function observeDi1(entry: Entry): { rating: FluencyRating; evidence: FluencyEvidence[] } {
  const interrupts = entry.numbers.interrupts;
  const dissatisfied = entry.satisfaction_signals.dissatisfied;

  // Try to find a real user turn that matches a skeptical pattern.
  const realChallenge = findTurnMatch(entry, SKEPTICAL_RE, 30, 140);

  if (interrupts >= 2 && dissatisfied >= 1) {
    const evs: FluencyEvidence[] = [
      evidenceDerived(entry, `${interrupts} interrupts and ${dissatisfied} dissatisfied corrections in this session.`),
    ];
    if (realChallenge) {
      evs.unshift(evidence(entry, realChallenge.snippet, { turn_index: realChallenge.turn_index }));
    }
    return { rating: "+", evidence: evs.slice(0, 2) };
  }
  if (realChallenge) {
    return { rating: "~", evidence: [evidence(entry, realChallenge.snippet, { turn_index: realChallenge.turn_index })] };
  }
  if (interrupts >= 1 || dissatisfied >= 1) {
    return {
      rating: "~",
      evidence: [evidenceDerived(entry, `${interrupts} interrupts, ${dissatisfied} dissatisfied corrections.`)],
    };
  }
  if (entry.numbers.turn_count > 5) return { rating: "-", evidence: [] };
  return { rating: "·", evidence: [] };
}

/** Di2: Verify at boundary — tests/builds run before merge. Always derived
 *  because the evidence is tool-call observation, not user-typed text. */
function observeDi2(entry: Entry): { rating: FluencyRating; evidence: FluencyEvidence[] } {
  const shipped = entry.numbers.prs > 0 || entry.numbers.pushes > 0;
  if (!shipped) return { rating: "·", evidence: [] };

  const verifyTools = entry.top_tools.filter((t) => VERIFY_TOOL_RE.test(t));
  const hasVerifyFlag = entry.flags.some((f) => /verif|test|build/i.test(f));
  if (verifyTools.length > 0 || hasVerifyFlag) {
    const detail = verifyTools.length > 0
      ? `Verify tool calls observed: ${verifyTools.slice(0, 3).join(" · ")}`
      : `Verify flag fired: ${entry.flags.filter((f) => /verif|test|build/i.test(f)).join(", ")}`;
    return { rating: "+", evidence: [evidenceDerived(entry, detail)] };
  }
  return { rating: "-", evidence: [] };
}

/** Di3: Rollback discipline. */
function observeDi3(entry: Entry): { rating: FluencyRating; evidence: FluencyEvidence[] } {
  const hit = findTurnMatch(entry, ROLLBACK_RE, 30, 130);
  if (hit) {
    return { rating: "+", evidence: [evidence(entry, hit.snippet, { turn_index: hit.turn_index })] };
  }
  const retryFlags = entry.flags.filter((f) => /retry|loop|restart/i.test(f));
  if (retryFlags.length > 0) {
    return {
      rating: "~",
      evidence: [evidenceDerived(entry, `Retry / loop signal fired: ${retryFlags.join(", ")}`)],
    };
  }
  return { rating: "·", evidence: [] };
}

/** Di4: Context correction — proactively shares context the agent can't infer. */
function observeDi4(entry: Entry): { rating: FluencyRating; evidence: FluencyEvidence[] } {
  const instructions = entry.enrichment.user_instructions ?? [];
  for (let i = 0; i < instructions.length; i++) {
    const inst = instructions[i];
    const m = inst?.match(CONTEXT_CORRECTION_RE);
    if (m) {
      const idx = inst.indexOf(m[0]);
      return {
        rating: "+",
        evidence: [evidence(entry, inst.slice(Math.max(0, idx - 30), idx + 130), { turn_index: i + 1 })],
      };
    }
  }
  if (entry.enrichment.friction_detail && CONTEXT_CORRECTION_RE.test(entry.enrichment.friction_detail)) {
    return {
      rating: "~",
      evidence: [evidenceDerived(entry, `friction_detail: ${entry.enrichment.friction_detail.slice(0, 130)}`)],
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
