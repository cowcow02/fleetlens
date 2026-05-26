/**
 * System + user prompt for the strict-Anthropic scorecard's LLM-generated
 * Summary and Insights sections.
 *
 * Written from scratch following the public 4D AI Fluency Framework's
 * structure (CC BY-NC-SA, aifluencyframework.org). The prompt deliberately
 * mirrors the documented output shape — 80-110 word summary, Strength /
 * TryNext insights with short title + ≤110-char body — so the result is
 * comparable to Anthropic's own scorecard, while the prompt text itself
 * is our own composition.
 *
 * Output is parsed by `parseAnthropicSummaryOutput` below. The model is
 * asked to return strict marker-delimited blocks rather than JSON so we
 * sidestep escaping issues with quoted evidence.
 */

export const ANTHROPIC_SUMMARY_SYSTEM_PROMPT = `You are writing the prose
sections of an AI Fluency scorecard for one user, following the 4D AI Fluency
Framework's documented shape (Delegation / Description / Discernment). The
deterministic per-axis ratings and evidence have already been computed; you
do NOT re-rate. Your job is to write three short prose pieces that turn the
ratings into a useful self-coaching artefact.

Constraints:
- Address the user directly in the second person ("you").
- Be specific to the evidence supplied. Refer to actual patterns the user
  exhibited; do NOT invent behaviours not present in the data.
- Encouraging, but honest. Do not paper over weak axes.
- No bullets in the summary paragraph. Short, scannable sentences.
- Do not name the framework or use jargon like "fluency indicator" in
  user-facing prose — write naturally.

Output exactly the following marker-delimited blocks, in order, with the
markers on their own lines. Do not include anything outside these blocks:

###SUMMARY###
<80 to 110 words, one paragraph, second person>
###STRENGTH_TITLE###
<4 to 6 words naming the user's strongest observed behaviour>
###STRENGTH_BODY###
<one sentence, at most 110 characters, second person>
###TRYNEXT_TITLE###
<4 to 6 words naming the next behaviour to develop, action-framed>
###TRYNEXT_BODY###
<one sentence, at most 110 characters, with a concrete starting move>
###END###`;

export type AnthropicPromptInputs = {
  member_name: string;
  window_label: string;
  surfaces: { cc: number; chat: number; cowork: number };
  axis_rows: Array<{
    axis_title: string;
    rating: "+" | "~" | "-" | "·";
    evidence_quotes: string[]; // ≤2, verbatim, ≤150 chars each, pre-attributed
  }>;
  features_frequent: string[];
  features_never: string[];
};

export function buildAnthropicUserPrompt(input: AnthropicPromptInputs): string {
  const ratingWord = (r: "+" | "~" | "-" | "·") =>
    r === "+" ? "demonstrated" : r === "~" ? "partial" : r === "-" ? "not-observed" : "n/a";

  const lines: string[] = [];
  lines.push(`User: ${input.member_name}`);
  lines.push(`Window: ${input.window_label}`);
  lines.push(`Surfaces (counts): cc=${input.surfaces.cc} chat=${input.surfaces.chat} cowork=${input.surfaces.cowork}`);
  if (input.surfaces.chat === 0 && input.surfaces.cowork === 0) {
    lines.push(`Note: all data is from Claude Code [cc] on this instance.`);
  }
  lines.push("");
  lines.push("Per-axis ratings and evidence:");
  for (const row of input.axis_rows) {
    lines.push(`- ${row.axis_title}: ${ratingWord(row.rating)}`);
    for (const q of row.evidence_quotes) {
      lines.push(`    "${q}"`);
    }
  }
  lines.push("");
  if (input.features_frequent.length > 0) {
    lines.push(`Frequently used Claude Code features: ${input.features_frequent.join(", ")}.`);
  }
  if (input.features_never.length > 0) {
    lines.push(`Never used: ${input.features_never.slice(0, 6).join(", ")}.`);
  }
  lines.push("");
  lines.push(`Write the SUMMARY, STRENGTH, and TRYNEXT blocks per the system prompt's output schema. No preamble, no explanation, no extra sections.`);
  return lines.join("\n");
}

/** Parse the model's marker-delimited output. Returns null on shape mismatch. */
export function parseAnthropicSummaryOutput(text: string): {
  summary: string;
  strength_title: string;
  strength_body: string;
  try_next_title: string;
  try_next_body: string;
} | null {
  const pick = (start: string, end: string) => {
    const i = text.indexOf(start);
    if (i < 0) return null;
    const j = text.indexOf(end, i + start.length);
    if (j < 0) return null;
    return text.slice(i + start.length, j).trim();
  };
  const summary = pick("###SUMMARY###", "###STRENGTH_TITLE###");
  const strength_title = pick("###STRENGTH_TITLE###", "###STRENGTH_BODY###");
  const strength_body = pick("###STRENGTH_BODY###", "###TRYNEXT_TITLE###");
  const try_next_title = pick("###TRYNEXT_TITLE###", "###TRYNEXT_BODY###");
  const try_next_body = pick("###TRYNEXT_BODY###", "###END###");
  if (!summary || !strength_title || !strength_body || !try_next_title || !try_next_body) return null;
  return { summary, strength_title, strength_body, try_next_title, try_next_body };
}

/** Deterministic fallback when the LLM is unavailable or returns malformed
 *  output. Keeps the page renderable without an API call. */
export function fallbackAnthropicProse(
  input: AnthropicPromptInputs,
): { summary: string; strength_title: string; strength_body: string; try_next_title: string; try_next_body: string } {
  const wins = input.axis_rows.filter((r) => r.rating === "+");
  const gaps = input.axis_rows.filter((r) => r.rating === "-");
  const winList = wins.slice(0, 2).map((r) => r.axis_title.toLowerCase()).join(" and ");
  const gap = gaps[0]?.axis_title ?? "consulting on approach";
  const winSummary = wins.length
    ? `you consistently demonstrate ${winList}`
    : `early signs across most behaviours but not yet a strong pattern`;
  return {
    summary:
      `Over the ${input.window_label}, ${winSummary}. The dominant pattern is iterative work on Claude Code, with limited evidence of explicit goal-framing or audience-naming up front. To grow next, lean into ${gap.toLowerCase()} — a small change in how a session opens often unlocks the rest of the axes downstream.`,
    strength_title: wins[0]?.axis_title ?? "Consistent engagement",
    strength_body: wins[0] ? `You repeatedly demonstrate ${wins[0].axis_title.toLowerCase()} across sessions.` : `You stay engaged across multiple turns.`,
    try_next_title: `Lean into ${gap.toLowerCase()}`,
    try_next_body: `Add one explicit ${gap.toLowerCase()} step on your next session; the report will reflect it.`,
  };
}
