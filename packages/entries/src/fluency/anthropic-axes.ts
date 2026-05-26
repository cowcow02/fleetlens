/**
 * Strict-Anthropic 11-indicator observer.
 *
 * One function per Anthropic axis, run deterministically over the
 * Fleetlens Entry shape. No LLM. Some axes — especially tone, audience,
 * and interaction-style — fire rarely on coding-agent data because
 * those concepts don't naturally appear in code-focused prompts. That's
 * the honest picture; the comparison page makes it visible.
 */

import type { Entry } from "../types.js";
import type {
  AnthropicAxisId,
  AnthropicAxisObservation,
} from "./anthropic-types.js";
import type { FluencyRating } from "./types.js";

const MAX_QUOTE = 150;

function clip(s: string): string {
  const trimmed = s.replace(/\s+/g, " ").trim();
  return trimmed.length > MAX_QUOTE ? `${trimmed.slice(0, MAX_QUOTE - 1)}…` : trimmed;
}

type EvBuilder = (e: Entry, quote: string) => AnthropicAxisObservation["evidence"][number];

function ev(): EvBuilder {
  return (entry, quote) => ({
    quote: clip(quote),
    surface: "cc",
    date: entry.local_day,
    session_id: entry.session_id,
  });
}

/* ─── Delegation ─────────────────────────────────────────────────────── */

const GOAL_RE = /\b(i (?:want|need|am trying|would like) to|the goal is|i'm trying to|my goal|trying to (?:figure out|build|fix|ship)|outcome (?:i'?m|we'?re) after)\b/i;

const CONSULT_RE = /\b(what (?:would|do you|should i)|how (?:should|would|do you suggest)|which (?:approach|option|way)|should i|recommend|your (?:thoughts|take|opinion)|sanity[- ]check|does this make sense)\b/i;

function observeClarifyGoals(e: Entry): { rating: FluencyRating; evidence: AnthropicAxisObservation["evidence"] } {
  const head = e.first_user.slice(0, 1500);
  const goal = head.match(GOAL_RE);
  if (goal) {
    const idx = head.indexOf(goal[0]);
    return { rating: "+", evidence: [ev()(e, head.slice(Math.max(0, idx - 20), idx + 130))] };
  }
  // partial: long enough to imply goal-setting was attempted but no clear phrase
  if (head.length > 400) return { rating: "~", evidence: [] };
  if (e.numbers.prs > 0 || e.numbers.active_min > 30) return { rating: "-", evidence: [] };
  return { rating: "·", evidence: [] };
}

function observeConsultApproach(e: Entry): { rating: FluencyRating; evidence: AnthropicAxisObservation["evidence"] } {
  const head = e.first_user.slice(0, 1500);
  const consult = head.match(CONSULT_RE);
  // Has the user used Plan Mode or dispatched a spec-review subagent?
  const planGate = e.numbers.exit_plan_calls > 0 || e.flags.includes("plan_used");
  const reviewerEarly = e.subagents.some((s) => /(review|verify|audit|consult)/i.test(`${s.description} ${s.prompt_preview}`));
  if (consult && (planGate || reviewerEarly)) {
    const idx = head.indexOf(consult[0]);
    return { rating: "+", evidence: [ev()(e, head.slice(Math.max(0, idx - 20), idx + 130))] };
  }
  if (consult || planGate || reviewerEarly) {
    const quote = consult ? head.slice(Math.max(0, head.indexOf(consult[0]) - 20), head.indexOf(consult[0]) + 130) :
                  planGate ? "Plan Mode invoked before implementation." : "Reviewer dispatched early in the session.";
    return { rating: "~", evidence: [ev()(e, quote)] };
  }
  if (e.numbers.prs > 0 || e.numbers.active_min > 30) return { rating: "-", evidence: [] };
  return { rating: "·", evidence: [] };
}

/* ─── Description ────────────────────────────────────────────────────── */

const AUDIENCE_RE = /\b(for (?:the )?(?:team|reviewer|reader|onboarding|users?|customers?|stakeholders?)|audience(?:[: ])|target reader|for someone who|so that (?:they|the user|the team) (?:can|will|understands?))\b/i;

const FORMAT_RE = /\b(format(?: as)?[:]|as a (?:table|list|email|bullet|json|yaml|csv|markdown table)|return (?:a |the )?(?:json|yaml|markdown|table|list)|output (?:shape|format)|response format)\b|(?:[a-zA-Z0-9_/.-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|rb|md|sql|json|yml|yaml|toml|css|html|sh|mjs))\b/i;

const TONE_RE = /\b(tone[:]|terse|concise|brief|formal|casual|friendly|professional|match (?:the )?(?:tone|voice|style)|same (?:tone|voice|style) as|in the (?:voice|style) of|short and direct|no fluff)\b/i;

const EXAMPLE_RE = /\b(for example|e\.g\.,|like (?:this|so|the following)|here'?s an example|example[:]|reference[:]?|see (?:also )?(?:[A-Z][a-zA-Z0-9_/-]+|docs?|the (?:doc|file|spec))|match (?:this|the) (?:style|pattern|format)|sample[:]|sample output)\b/i;

const ROLE_RE = /\b(act as|you are (?:a |an )?(?:senior|expert|reviewer|architect|tutor|coach|peer)|role[:]|pretend you'?re|behave like|treat (?:this|me) as|step (?:in|into) (?:as|the role)|<teammate-message)\b/i;

function observeDefineAudience(e: Entry): { rating: FluencyRating; evidence: AnthropicAxisObservation["evidence"] } {
  const head = e.first_user.slice(0, 2000);
  const m = head.match(AUDIENCE_RE);
  if (m) {
    const idx = head.indexOf(m[0]);
    return { rating: "+", evidence: [ev()(e, head.slice(Math.max(0, idx - 20), idx + 130))] };
  }
  if (e.flags.includes("teammate") || e.subagents.some((s) => /teammate|reviewer/i.test(s.description))) {
    return { rating: "~", evidence: [ev()(e, "Implicit audience: teammate / reviewer subagent dispatched.")] };
  }
  if (head.length > 200) return { rating: "-", evidence: [] };
  return { rating: "·", evidence: [] };
}

function observeSpecifyFormat(e: Entry): { rating: FluencyRating; evidence: AnthropicAxisObservation["evidence"] } {
  const head = e.first_user.slice(0, 2000);
  const fmt = head.match(FORMAT_RE);
  if (fmt) {
    const idx = head.indexOf(fmt[0]);
    return { rating: "+", evidence: [ev()(e, head.slice(Math.max(0, idx - 20), idx + 130))] };
  }
  if (head.length > 200) return { rating: "-", evidence: [] };
  return { rating: "·", evidence: [] };
}

function observeCommunicateTone(e: Entry): { rating: FluencyRating; evidence: AnthropicAxisObservation["evidence"] } {
  const head = e.first_user.slice(0, 2000);
  const m = head.match(TONE_RE);
  if (m) {
    const idx = head.indexOf(m[0]);
    return { rating: "+", evidence: [ev()(e, head.slice(Math.max(0, idx - 20), idx + 130))] };
  }
  // For most coding sessions tone is genuinely not applicable — the
  // compiler is the only reader of code. Don't penalise its absence on
  // pure-implementation sessions.
  return { rating: "·", evidence: [] };
}

function observeBuildIteratively(e: Entry): { rating: FluencyRating; evidence: AnthropicAxisObservation["evidence"] } {
  const humanTurns = e.user_input_sources.human;
  if (humanTurns >= 4) return { rating: "+", evidence: [ev()(e, `${humanTurns} human turns; iterative refinement evident.`)] };
  if (humanTurns >= 2) return { rating: "~", evidence: [ev()(e, `${humanTurns} human turns.`)] };
  if (e.flags.includes("long_autonomous") || e.numbers.active_min > 30) return { rating: "-", evidence: [] };
  return { rating: "·", evidence: [] };
}

function observeProvideExamples(e: Entry): { rating: FluencyRating; evidence: AnthropicAxisObservation["evidence"] } {
  const head = e.first_user.slice(0, 2000);
  const m = head.match(EXAMPLE_RE);
  const hasCodeBlock = /```/.test(head);
  if (m && hasCodeBlock) {
    return { rating: "+", evidence: [ev()(e, m[0])] };
  }
  if (m || hasCodeBlock) {
    const quote = m ? m[0] : "Inline code block as reference.";
    return { rating: "~", evidence: [ev()(e, quote)] };
  }
  if (head.length > 200) return { rating: "-", evidence: [] };
  return { rating: "·", evidence: [] };
}

function observeSetInteractionStyle(e: Entry): { rating: FluencyRating; evidence: AnthropicAxisObservation["evidence"] } {
  const head = e.first_user.slice(0, 2000);
  const m = head.match(ROLE_RE);
  if (m) {
    const idx = head.indexOf(m[0]);
    return { rating: "+", evidence: [ev()(e, head.slice(Math.max(0, idx - 10), idx + 130))] };
  }
  // partial: user defines a working mode implicitly via a slash-command frame
  if ((e.user_input_sources.slash_command ?? 0) > 0) {
    return { rating: "~", evidence: [ev()(e, "Slash command framing observed.")] };
  }
  return { rating: "·", evidence: [] };
}

/* ─── Discernment ────────────────────────────────────────────────────── */

const FACTCHECK_RE = /\b(are you sure|prove (?:it|that)|show me (?:the|that|where)|cite|source|where (?:does|did) (?:that|this)|i (?:don'?t (?:think|believe)|doubt)|verify (?:this|that)|run the test|let'?s test)\b/i;

const REASONING_RE = /\b(that'?s wrong because|that doesn'?t (?:follow|work) because|incorrect reasoning|flawed (?:reasoning|argument|premise)|circular|begging the question|non[- ]sequitur|backwards|reverse|step \d+ is wrong)\b/i;

const CONTEXT_RE = /\b(heads ?up|fyi|actually,?|to be clear|important context|just so you know|the reason (?:is|behind)|hidden (?:constraint|invariant)|background[:]|context you (?:should|might|don'?t) know)\b/i;

function observeCheckFacts(e: Entry): { rating: FluencyRating; evidence: AnthropicAxisObservation["evidence"] } {
  const transcript = `${e.first_user}\n${(e.enrichment.user_instructions ?? []).join("\n")}`;
  const m = transcript.match(FACTCHECK_RE);
  if (m) {
    const idx = transcript.indexOf(m[0]);
    return { rating: "+", evidence: [ev()(e, transcript.slice(Math.max(0, idx - 20), idx + 130))] };
  }
  if (e.satisfaction_signals.dissatisfied >= 1 || e.numbers.interrupts >= 1) {
    return { rating: "~", evidence: [ev()(e, `${e.numbers.interrupts} interrupts, ${e.satisfaction_signals.dissatisfied} corrections.`)] };
  }
  if (e.numbers.turn_count > 5) return { rating: "-", evidence: [] };
  return { rating: "·", evidence: [] };
}

function observeNoticeReasoning(e: Entry): { rating: FluencyRating; evidence: AnthropicAxisObservation["evidence"] } {
  const transcript = `${e.first_user}\n${(e.enrichment.user_instructions ?? []).join("\n")}\n${e.enrichment.friction_detail ?? ""}`;
  const m = transcript.match(REASONING_RE);
  if (m) {
    const idx = transcript.indexOf(m[0]);
    return { rating: "+", evidence: [ev()(e, transcript.slice(Math.max(0, idx - 20), idx + 130))] };
  }
  if (e.satisfaction_signals.dissatisfied >= 2) {
    return { rating: "~", evidence: [ev()(e, "Repeated corrections suggest the user spotted reasoning issues.")] };
  }
  return { rating: "·", evidence: [] };
}

function observeRecognizeContext(e: Entry): { rating: FluencyRating; evidence: AnthropicAxisObservation["evidence"] } {
  const sources = e.enrichment.user_instructions ?? [];
  for (const inst of sources) {
    if (CONTEXT_RE.test(inst)) {
      const m = inst.match(CONTEXT_RE);
      if (m) {
        const idx = inst.indexOf(m[0]);
        return { rating: "+", evidence: [ev()(e, inst.slice(Math.max(0, idx - 20), idx + 130))] };
      }
    }
  }
  if (e.enrichment.friction_detail && CONTEXT_RE.test(e.enrichment.friction_detail)) {
    return { rating: "~", evidence: [ev()(e, e.enrichment.friction_detail.slice(0, 130))] };
  }
  return { rating: "·", evidence: [] };
}

/* ─── Dispatch table + bulk runner ───────────────────────────────────── */

const OBSERVERS: Record<AnthropicAxisId, (e: Entry) => { rating: FluencyRating; evidence: AnthropicAxisObservation["evidence"] }> = {
  A_clarify_goals: observeClarifyGoals,
  A_consult_approach: observeConsultApproach,
  A_define_audience: observeDefineAudience,
  A_specify_format: observeSpecifyFormat,
  A_communicate_tone: observeCommunicateTone,
  A_build_iteratively: observeBuildIteratively,
  A_provide_examples: observeProvideExamples,
  A_set_interaction_style: observeSetInteractionStyle,
  A_check_facts: observeCheckFacts,
  A_notice_reasoning: observeNoticeReasoning,
  A_recognize_context: observeRecognizeContext,
};

export type AnthropicEntryObservation = {
  axis_obs: Record<AnthropicAxisId, { rating: FluencyRating; evidence: AnthropicAxisObservation["evidence"] }>;
};

export function observeEntryAnthropic(entry: Entry): AnthropicEntryObservation {
  const out = {} as AnthropicEntryObservation["axis_obs"];
  for (const [id, fn] of Object.entries(OBSERVERS)) {
    out[id as AnthropicAxisId] = fn(entry);
  }
  return { axis_obs: out };
}

/** Aggregate per-axis ratings across N entries — same rule as the
 *  Fleetlens variant. Any "+" wins; else any "~"; else if ≥half are
 *  "-", result is "-"; else "·". Evidence capped at 2 quotes (the
 *  Anthropic scorecard's documented limit). */
export function aggregateAnthropicAxis(
  ratings: Array<{ rating: FluencyRating; evidence: AnthropicAxisObservation["evidence"] }>,
): { rating: FluencyRating; evidence: AnthropicAxisObservation["evidence"] } {
  if (ratings.length === 0) return { rating: "·", evidence: [] };
  const pos = ratings.filter((r) => r.rating === "+").flatMap((r) => r.evidence);
  const par = ratings.filter((r) => r.rating === "~").flatMap((r) => r.evidence);
  const neg = ratings.filter((r) => r.rating === "-").length;
  const na  = ratings.filter((r) => r.rating === "·").length;
  if (pos.length) return { rating: "+", evidence: pos.slice(0, 2) };
  if (par.length) return { rating: "~", evidence: par.slice(0, 2) };
  const applicable = ratings.length - na;
  if (applicable > 0 && neg / applicable >= 0.5) return { rating: "-", evidence: [] };
  return { rating: "·", evidence: [] };
}
