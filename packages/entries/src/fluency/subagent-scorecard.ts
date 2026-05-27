/**
 * "Subagent-LLM" scoring lane — pure LLM-driven fluency assessment.
 *
 * The deterministic observers in `observe.ts` / `anthropic-axes.ts` only
 * fire on pattern matches. Anthropic's actual product hands the raw
 * conversation corpus to a model and lets it score from intent — which
 * catches signals the regex misses (e.g. a goal expressed without the
 * word "goal", a context dump that doesn't start with "actually").
 *
 * This module:
 *   1. Builds the user-message corpus the model needs from N Entries.
 *   2. Holds the from-scratch system prompt that follows the public 4D
 *      AI Fluency Framework's structure (CC BY-NC-SA).
 *   3. Parses the model's marker-delimited output into typed shape so
 *      the compare page can render it next to the deterministic lanes.
 *
 * The model is called externally via the entries `llm-runner` so this
 * file stays pure — no node dependencies, importable from the browser
 * bundle if ever needed.
 */

import type { Entry } from "../types.js";
import { filterMultiTurnEntries } from "./observe.js";

export const SUBAGENT_FLUENCY_INDICATORS = [
  { id: "clarifies_goals",     pillar: "Delegation",  title: "Clarifies goals" },
  { id: "consults_approach",   pillar: "Delegation",  title: "Consults on approach" },
  { id: "defines_audience",    pillar: "Description", title: "Defines audience" },
  { id: "specifies_format",    pillar: "Description", title: "Specifies format" },
  { id: "communicates_tone",   pillar: "Description", title: "Communicates tone" },
  { id: "builds_iteratively",  pillar: "Description", title: "Builds iteratively" },
  { id: "provides_examples",   pillar: "Description", title: "Provides examples" },
  { id: "sets_interaction",    pillar: "Description", title: "Sets interaction style" },
  { id: "checks_facts",        pillar: "Discernment", title: "Checks facts" },
  { id: "notices_reasoning",   pillar: "Discernment", title: "Notices reasoning" },
  { id: "recognises_context",  pillar: "Discernment", title: "Recognises context" },
] as const;

export type SubagentIndicatorId = (typeof SUBAGENT_FLUENCY_INDICATORS)[number]["id"];

export type SubagentRating = "+" | "~" | "-";

export type SubagentAxisRow = {
  id: SubagentIndicatorId;
  title: string;
  pillar: "Delegation" | "Description" | "Discernment";
  rating: SubagentRating;
  commentary: string;
  evidence: Array<{
    quote: string;
    session_id_short: string;
    /** Full session UUID, resolved at parse time when the entry corpus is
     *  available. Older cached scorecards predating this field will omit
     *  it; consumers should treat it as optional and fall back to plain
     *  text when absent. */
    session_id?: string;
    date: string;
    surface: "cc" | "chat" | "cowork";
  }>;
};

export type SubagentScorecard = {
  schema_version: 1;
  window_end: string;
  member_id: string;
  member_name: string;
  /** Total turns the corpus carried into the model. */
  corpus_user_turns: number;
  /** Distinct sessions represented. */
  corpus_sessions: number;
  axes: SubagentAxisRow[];
  score: { numerator: number; denominator: 11 };
  summary: string;
  insights: {
    strength_title: string;
    strength_body: string;
    try_next_title: string;
    try_next_body: string;
  };
  llm: { model: string | null; cost_usd: number | null } | null;
};

/* ------------------------------------------------------------------ */
/*  Corpus builder — Entry[] → markdown                                 */
/* ------------------------------------------------------------------ */

const SYSTEM_REMINDER_RE = /^<system-reminder>[\s\S]*<\/system-reminder>$/;
const TURN_CHAR_CAP = 1500;
/** Upper bound for the corpus we hand the model — keeps token budget tight. */
const CORPUS_CHAR_CAP = 180_000;

/** Build a markdown corpus of user turns from N entries. Skips pure system
 *  reminders, tool results, and entries with no first_user / no user
 *  instructions. The output mirrors the format the system prompt expects. */
export function buildUserCorpus(input: {
  member_name: string;
  window_end: string;
  entries: Entry[];
}): { markdown: string; sessions: number; user_turns: number; truncated: boolean } {
  // Drop single-turn-session entries before feeding the LLM. Connectivity
  // probes ("hi", "say pong"), programmatic invocations (SLICE FACTS / DAY
  // FACTS / Conductor's system_instructions), and other no-conversation
  // sessions are noise for fluency scoring — they'd consume corpus budget
  // without giving the model anything to judge intent against.
  const filtered = filterMultiTurnEntries(input.entries);
  // Sort entries chronologically by start
  const sorted = [...filtered].sort((a, b) => a.start_iso.localeCompare(b.start_iso));
  const lines: string[] = [];
  lines.push(`# AI Fluency Scorecard — user message corpus`);
  lines.push(`# Member: ${input.member_name}`);
  lines.push(`# Window ending: ${input.window_end} (last 30 days)`);
  lines.push(`# Surfaces: ${sorted.length} [cc] (no Chat/Cowork data ingress)`);
  lines.push("");
  let totalTurns = 0;
  let writtenSessions = 0;
  let truncated = false;
  let chars = 0;

  for (const e of sorted) {
    if (chars >= CORPUS_CHAR_CAP) { truncated = true; break; }
    const turns: string[] = [];
    if (e.first_user && !SYSTEM_REMINDER_RE.test(e.first_user.trim())) turns.push(e.first_user.trim());
    for (const inst of e.enrichment.user_instructions ?? []) {
      const t = inst.trim();
      if (!t) continue;
      if (SYSTEM_REMINDER_RE.test(t)) continue;
      turns.push(t);
    }
    if (turns.length === 0) continue;
    writtenSessions += 1;
    const project = e.project.split("/").slice(-2).join("/");
    const header = `## session ${e.session_id.slice(0, 8)} · ${e.local_day} · ${project} · [cc]`;
    lines.push(header);
    lines.push("");
    chars += header.length + 1;
    for (const turn of turns) {
      const trimmed = turn.length > TURN_CHAR_CAP ? turn.slice(0, TURN_CHAR_CAP) + " …[truncated]" : turn;
      lines.push(`### turn`);
      lines.push(trimmed);
      lines.push("");
      chars += trimmed.length + 12;
      totalTurns += 1;
      if (chars >= CORPUS_CHAR_CAP) { truncated = true; break; }
    }
  }

  if (truncated) {
    lines.push("");
    lines.push(`# [corpus truncated at ${CORPUS_CHAR_CAP} chars — older sessions omitted]`);
  }
  return {
    markdown: lines.join("\n"),
    sessions: writtenSessions,
    user_turns: totalTurns,
    truncated,
  };
}

/* ------------------------------------------------------------------ */
/*  System prompt + parsed output                                       */
/* ------------------------------------------------------------------ */

export const SUBAGENT_FLUENCY_SYSTEM_PROMPT = `You are running an AI Fluency
Scorecard assessment, following the publicly-published 4D AI Fluency Framework
(Delegation, Description, Discernment; the fourth D, Diligence, is taught in
the course but not scored). The framework is CC BY-NC-SA licensed
(aifluencyframework.org).

You will receive a corpus of one user's actual conversation turns sent to
coding agents. No deterministic helper code has been run — score every
indicator yourself based on what the corpus actually shows.

## The 11 indicators

Rate each with one of:
- "+" Demonstrated — clear, repeated evidence in the corpus
- "~" Partial — present but inconsistent / single-occurrence
- "-" Not observed — corpus is active enough that evidence would be expected; none found

DELEGATION
 1. Clarifies goals — names what they are trying to accomplish before asking for help
 2. Consults on approach — asks for the model's recommendation on a path before committing

DESCRIPTION
 3. Defines audience — names who the output is for
 4. Specifies format — names the desired output shape (file path, signature, schema, table)
 5. Communicates tone — names tone/style ("terse", "formal", "match this voice")
 6. Builds iteratively — refines through multiple turns rather than accepting the first draft
 7. Provides examples — pastes a sample / points at a reference / says "like X"
 8. Sets interaction style — frames the model's role or working mode ("act as", "you are", custom command frames)

DISCERNMENT
 9. Checks facts — questions agent claims; asks for evidence ("are you sure", "show me", "prove")
10. Notices reasoning — names specific reasoning errors with a concrete critique
11. Recognises context — proactively shares context the agent could not infer (project history, hidden constraints)

## Hard rules

- VERBATIM ONLY. Every evidence quote must appear verbatim in the corpus.
  Truncate at word boundaries with "…" if needed; never paraphrase.
- NO FABRICATION. Do not invent quotes; do not synthesise composite quotes.
- Cite the session: every quote carries session <id8> @ <date>.
- At most 2 quotes per axis.
- This is a developer using coding agents. Tone/audience/role-setting will
  often land at [-] or [~] in coding sessions — that's an honest finding.

## Output format

Output exactly the following marker-delimited blocks in order. Nothing
outside these blocks — no preamble, no afterword.

###SUMMARY###
<80–110 word paragraph, addressed to the user in second person, scannable
sentences, no bullets, no jargon like "indicator" or "axis". Reference
behaviours you actually saw.>

###SCORECARD###
DELEGATION
[+|~|-] Clarifies goals — <one short plain-English commentary line>
  "<verbatim quote ≤150 chars>" [cc] session <id8> @ <date>
  "<optional second quote ≤150 chars>" [cc] session <id8> @ <date>
[+|~|-] Consults on approach — <commentary>
  <quotes>

DESCRIPTION
[+|~|-] Defines audience — <commentary>
  <quotes>
[+|~|-] Specifies format — <commentary>
  <quotes>
[+|~|-] Communicates tone — <commentary>
  <quotes>
[+|~|-] Builds iteratively — <commentary>
  <quotes>
[+|~|-] Provides examples — <commentary>
  <quotes>
[+|~|-] Sets interaction style — <commentary>
  <quotes>

DISCERNMENT
[+|~|-] Checks facts — <commentary>
  <quotes>
[+|~|-] Notices reasoning — <commentary>
  <quotes>
[+|~|-] Recognises context — <commentary>
  <quotes>

SCORE: X.X / 11   (+ = 1.0, ~ = 0.5, - = 0.0)

###INSIGHTS###
STRENGTH_TITLE: <4–6 words naming the strongest observed behaviour>
STRENGTH_BODY: <one sentence ≤110 chars, second person>
TRYNEXT_TITLE: <4–6 words for the next behaviour to develop, action-framed>
TRYNEXT_BODY: <one sentence ≤110 chars with a concrete starting move>

###END###`;

/* ------------------------------------------------------------------ */
/*  Output parser — model text → typed SubagentScorecard               */
/* ------------------------------------------------------------------ */

const TITLE_TO_ID: Record<string, SubagentIndicatorId> = {
  "clarifies goals":         "clarifies_goals",
  "consults on approach":    "consults_approach",
  "defines audience":        "defines_audience",
  "specifies format":        "specifies_format",
  "communicates tone":       "communicates_tone",
  "builds iteratively":      "builds_iteratively",
  "provides examples":       "provides_examples",
  "sets interaction style":  "sets_interaction",
  "checks facts":            "checks_facts",
  "notices reasoning":       "notices_reasoning",
  "recognises context":      "recognises_context",
  "recognizes context":      "recognises_context",
};

const PILLAR_BY_ID: Record<SubagentIndicatorId, "Delegation" | "Description" | "Discernment"> = {
  clarifies_goals:    "Delegation",
  consults_approach:  "Delegation",
  defines_audience:   "Description",
  specifies_format:   "Description",
  communicates_tone:  "Description",
  builds_iteratively: "Description",
  provides_examples:  "Description",
  sets_interaction:   "Description",
  checks_facts:       "Discernment",
  notices_reasoning:  "Discernment",
  recognises_context: "Discernment",
};

const RATING_VALUE: Record<SubagentRating, number> = { "+": 1.0, "~": 0.5, "-": 0.0 };

const AXIS_LINE_RE = /^\[([+~-])\]\s+([A-Za-z][A-Za-z ]+?)\s*(?:—|--|-)\s*(.*)$/;
const QUOTE_LINE_RE = /^\s*"(.+?)"\s+\[cc\]\s+session\s+([a-f0-9]{4,16})\s+@\s+([\d-]{8,10})\s*$/i;

function pickBlock(text: string, start: string, end: string): string | null {
  const i = text.indexOf(start);
  if (i < 0) return null;
  const j = text.indexOf(end, i + start.length);
  if (j < 0) return null;
  return text.slice(i + start.length, j).trim();
}

function pickInsight(insights: string, key: string): string | null {
  const re = new RegExp(`^${key}\\s*:\\s*(.+)$`, "im");
  const m = insights.match(re);
  return m ? m[1].trim() : null;
}

/** Parse the model's marker-delimited output into a typed scorecard.
 *  Returns null if the shape doesn't match. */
export function parseSubagentScorecardOutput(
  text: string,
  meta: {
    member_id: string;
    member_name: string;
    window_end: string;
    corpus_user_turns: number;
    corpus_sessions: number;
    llm: { model: string | null; cost_usd: number | null } | null;
    /** Map from 8-char session-id prefix → full session UUID. Built from
     *  the corpus entries by the pipeline and used to attach full ids to
     *  each evidence quote so the report can link to the transcript. */
    shortIdMap?: Map<string, string>;
  },
): SubagentScorecard | null {
  const summary = pickBlock(text, "###SUMMARY###", "###SCORECARD###");
  const scoreBlock = pickBlock(text, "###SCORECARD###", "###INSIGHTS###");
  const insightsBlock = pickBlock(text, "###INSIGHTS###", "###END###");
  if (!summary || !scoreBlock || !insightsBlock) return null;

  // Parse SCORECARD: walk line by line, capturing axis lines + their quotes
  const axes: SubagentAxisRow[] = [];
  let pending: SubagentAxisRow | null = null;
  for (const rawLine of scoreBlock.split("\n")) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) continue;
    if (/^(DELEGATION|DESCRIPTION|DISCERNMENT)\s*$/i.test(line.trim())) continue;
    if (/^SCORE\s*:/i.test(line.trim())) continue;

    const axisMatch = line.match(AXIS_LINE_RE);
    if (axisMatch) {
      // commit previous axis if any
      if (pending) axes.push(pending);
      const [, rating, titleRaw, commentary] = axisMatch;
      const titleKey = titleRaw.trim().toLowerCase();
      const id = TITLE_TO_ID[titleKey];
      if (!id) { pending = null; continue; }
      pending = {
        id,
        title: titleRaw.trim(),
        pillar: PILLAR_BY_ID[id],
        rating: rating as SubagentRating,
        commentary: commentary.trim(),
        evidence: [],
      };
      continue;
    }
    const qMatch = line.match(QUOTE_LINE_RE);
    if (qMatch && pending) {
      const [, quote, sid, date] = qMatch;
      if (pending.evidence.length < 2) {
        const fullId = meta.shortIdMap?.get(sid);
        pending.evidence.push({
          quote,
          session_id_short: sid,
          ...(fullId ? { session_id: fullId } : {}),
          date,
          surface: "cc",
        });
      }
      continue;
    }
  }
  if (pending) axes.push(pending);

  // Fill any missing indicators as [-] so the page always has 11 rows
  const seen = new Set(axes.map((a) => a.id));
  for (const ind of SUBAGENT_FLUENCY_INDICATORS) {
    if (!seen.has(ind.id)) {
      axes.push({
        id: ind.id,
        title: ind.title,
        pillar: PILLAR_BY_ID[ind.id],
        rating: "-",
        commentary: "Not surfaced by the model in its output.",
        evidence: [],
      });
    }
  }
  // Re-sort by indicator order
  const order = SUBAGENT_FLUENCY_INDICATORS.map((i) => i.id);
  axes.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  const numerator = axes.reduce((s, a) => s + RATING_VALUE[a.rating], 0);

  const strength_title = pickInsight(insightsBlock, "STRENGTH_TITLE") ?? "Strongest behaviour";
  const strength_body  = pickInsight(insightsBlock, "STRENGTH_BODY")  ?? "";
  const try_next_title = pickInsight(insightsBlock, "TRYNEXT_TITLE") ?? "Next behaviour to develop";
  const try_next_body  = pickInsight(insightsBlock, "TRYNEXT_BODY")  ?? "";

  return {
    schema_version: 1,
    window_end: meta.window_end,
    member_id: meta.member_id,
    member_name: meta.member_name,
    corpus_user_turns: meta.corpus_user_turns,
    corpus_sessions: meta.corpus_sessions,
    axes,
    score: { numerator, denominator: 11 },
    summary,
    insights: { strength_title, strength_body, try_next_title, try_next_body },
    llm: meta.llm,
  };
}
