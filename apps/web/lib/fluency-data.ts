import "server-only";

import { Fluency } from "@claude-lens/entries";
import { runClaudeSubprocess } from "@claude-lens/entries/node";
import { listEntriesForDay } from "@claude-lens/entries/fs";
import type { Entry } from "@claude-lens/entries";

type AnthropicScorecard = Fluency.AnthropicScorecard;
const buildAnthropicScorecard = Fluency.buildAnthropicScorecard;

/** Inclusive Monday → Sunday range for an ISO week monday. */
function weekDays(monday: string): string[] {
  const out: string[] = [];
  const d = new Date(`${monday}T00:00:00`);
  for (let i = 0; i < 7; i++) {
    const cur = new Date(d);
    cur.setDate(d.getDate() + i);
    out.push(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`,
    );
  }
  return out;
}

export function listEntriesForWeek(monday: string): Entry[] {
  const out: Entry[] = [];
  for (const day of weekDays(monday)) {
    for (const e of listEntriesForDay(day)) out.push(e);
  }
  return out;
}

/** Build a real scorecard from local entries, OR return null if zero entries
 *  for the week. Caller falls back to the mock when null. */
export function buildScorecardForWeek(
  monday: string,
  member: { id: string; name: string; email?: string },
): Fluency.FluencyScorecard | null {
  const entries = listEntriesForWeek(monday);
  if (entries.length === 0) return null;
  return Fluency.buildFluencyScorecard({
    member_id: member.id,
    member_name: member.name,
    member_email: member.email,
    week_monday: monday,
    entries,
  });
}

/* ------------------------------------------------------------------ */
/*  30-day window helpers + Anthropic-variant builder                  */
/* ------------------------------------------------------------------ */

function last30Dates(): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
  }
  return out;
}

export function listEntriesLast30Days(): { entries: Entry[]; windowEnd: string } {
  const dates = last30Dates();
  const out: Entry[] = [];
  for (const day of dates) {
    for (const e of listEntriesForDay(day)) out.push(e);
  }
  return { entries: out, windowEnd: dates[dates.length - 1] };
}

/** Build the strict-Anthropic 30-day scorecard, calling the LLM for the
 *  prose Summary + Insights. If the LLM call fails or `useLlm` is false,
 *  the templated fallback runs and the page is still renderable. */
export async function buildAnthropicScorecard30d(
  member: { id: string; name: string },
  opts: { useLlm?: boolean } = { useLlm: true },
): Promise<AnthropicScorecard | null> {
  const { entries, windowEnd } = listEntriesLast30Days();
  if (entries.length === 0) return null;

  const callLLM = opts.useLlm
    ? async (args: { systemPrompt: string; userPrompt: string; model?: string }) => {
        const res = await runClaudeSubprocess({
          systemPrompt: args.systemPrompt,
          model: args.model ?? "sonnet",
          userPrompt: args.userPrompt,
        });
        return {
          content: res.content,
          model: res.model,
          input_tokens: res.input_tokens,
          output_tokens: res.output_tokens,
        };
      }
    : undefined;

  return buildAnthropicScorecard({
    member_id: member.id,
    member_name: member.name,
    window_end: windowEnd,
    entries,
    callLLM,
  });
}
