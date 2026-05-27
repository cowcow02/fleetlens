import "server-only";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

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

/* ------------------------------------------------------------------ */
/*  Subagent-LLM scorecard — hands raw turns to claude -p directly     */
/* ------------------------------------------------------------------ */

/** On-disk cache for subagent scorecards. Keyed by (member, window_end,
 *  corpus-hash) so changes to entries invalidate naturally and we don't
 *  re-fire the ~$0.01 LLM call on every page render. */
const SUBAGENT_CACHE_DIR = join(homedir(), ".cclens", "fluency-subagent");

function subagentCachePath(memberId: string, windowEnd: string, corpusHash: string): string {
  if (!existsSync(SUBAGENT_CACHE_DIR)) {
    try { mkdirSync(SUBAGENT_CACHE_DIR, { recursive: true }); } catch { /* race ok */ }
  }
  return join(SUBAGENT_CACHE_DIR, `${memberId}__${windowEnd}__${corpusHash}.json`);
}

function readSubagentCache(path: string): Fluency.SubagentScorecard | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as Fluency.SubagentScorecard;
  } catch {
    return null;
  }
}

function writeSubagentCache(path: string, sc: Fluency.SubagentScorecard): void {
  try { writeFileSync(path, JSON.stringify(sc, null, 2)); } catch { /* non-fatal */ }
}

/** Build the SubagentScorecard by handing the raw user-message corpus to
 *  `claude -p` with the from-scratch fluency-scorecard system prompt.
 *  Returns null if there are no entries, the LLM call fails, or the
 *  model's output can't be parsed back into the typed shape.
 *
 *  Disk-cached by `(member_id × window_end × corpus_sha16)` so re-renders
 *  return instantly. Pass `forceRefresh: true` to bypass the cache. */
export async function buildSubagentScorecard30d(
  member: { id: string; name: string },
  opts: { forceRefresh?: boolean } = {},
): Promise<Fluency.SubagentScorecard | null> {
  const { entries, windowEnd } = listEntriesLast30Days();
  if (entries.length === 0) return null;

  const corpus = Fluency.buildUserCorpus({
    member_name: member.name,
    window_end: windowEnd,
    entries,
  });
  if (corpus.user_turns === 0) return null;

  const corpusHash = createHash("sha256").update(corpus.markdown).digest("hex").slice(0, 16);
  const cachePath = subagentCachePath(member.id, windowEnd, corpusHash);
  if (!opts.forceRefresh) {
    const cached = readSubagentCache(cachePath);
    if (cached) return cached;
  }

  let res;
  try {
    res = await runClaudeSubprocess({
      systemPrompt: Fluency.SUBAGENT_FLUENCY_SYSTEM_PROMPT,
      model: "sonnet",
      userPrompt: corpus.markdown,
    });
  } catch {
    return null;
  }

  const cost =
    res.model.toLowerCase().includes("opus")  ? ((res.input_tokens * 15 + res.output_tokens * 75) / 1_000_000) :
    res.model.toLowerCase().includes("sonnet") ? ((res.input_tokens *  3 + res.output_tokens * 15) / 1_000_000) :
    res.model.toLowerCase().includes("haiku")  ? ((res.input_tokens *  1 + res.output_tokens *  5) / 1_000_000) :
    null;

  const parsed = Fluency.parseSubagentScorecardOutput(res.content, {
    member_id: member.id,
    member_name: member.name,
    window_end: windowEnd,
    corpus_user_turns: corpus.user_turns,
    corpus_sessions: corpus.sessions,
    llm: { model: res.model, cost_usd: cost },
  });

  if (parsed) writeSubagentCache(cachePath, parsed);
  return parsed;
}
