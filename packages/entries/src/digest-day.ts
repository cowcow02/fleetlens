import {
  CURRENT_DAY_DIGEST_SCHEMA_VERSION,
  PROMPT_FRAME_ORIGIN,
  type DayDigest, type DayHelpfulness, type DayOutcome, type DaySignals,
  type Entry, type PromptFrame, type SkillOrigin, type WorkingShape,
} from "./types.js";
import {
  classifySkill, computeEntrySignals, isStockSubagentType,
} from "./signals.js";
import {
  DIGEST_DAY_SYSTEM_PROMPT,
  DayDigestResponseSchema,
  buildDigestUserPrompt,
} from "./prompts/digest-day.js";
import type { CallLLM, EnrichUsage } from "./enrich.js";
import { computeCostUsd } from "./enrich.js";
import { runClaudeSubprocess, parseAndValidate } from "./llm-runner.js";

function prettyProjectName(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/** Day-level outcome: any-of priority. Prevents a day with one shipped PR from
 *  reading as "trivial" just because other sessions were warmups. */
function rollupOutcomeDay(entries: Entry[]): DayOutcome {
  if (entries.length === 0) return "idle";
  const outcomes = new Set(entries.map(e => e.enrichment.outcome).filter(Boolean));
  if (outcomes.has("shipped")) return "shipped";
  if (outcomes.has("partial")) return "partial";
  if (outcomes.has("blocked")) return "blocked";
  if (outcomes.has("exploratory")) return "exploratory";
  return "trivial";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

/** Aggregate per-Entry signals into a day-level classification. Falls back to
 *  on-the-fly computeEntrySignals when entry.signals is absent (cached
 *  pre-refactor entries). */
export function computeDaySignals(entries: Entry[]): DaySignals {
  const signalsList = entries.map(e => e.signals ?? computeEntrySignals(e));

  // ── Dominant shape (active_min-weighted) + shape distribution ──
  const totalMin = entries.reduce((s, e) => s + e.numbers.active_min, 0);
  const shapeMinutes = new Map<NonNullable<WorkingShape>, number>();
  const shape_distribution: Partial<Record<NonNullable<WorkingShape>, number>> = {};
  for (let i = 0; i < entries.length; i++) {
    const shape = signalsList[i]!.working_shape;
    if (!shape) continue;
    shapeMinutes.set(shape, (shapeMinutes.get(shape) ?? 0) + entries[i]!.numbers.active_min);
    shape_distribution[shape] = (shape_distribution[shape] ?? 0) + 1;
  }
  let dominant_shape: DaySignals["dominant_shape"] = null;
  if (shapeMinutes.size > 0 && totalMin > 0) {
    const top = [...shapeMinutes.entries()].sort((a, b) => b[1] - a[1])[0]!;
    dominant_shape = top[1] / totalMin >= 0.6 ? top[0] : "mixed";
  }

  // ── Skills loaded today (with origin) ──
  const skillCounts = new Map<string, number>();
  for (const e of entries) {
    for (const [name, c] of Object.entries(e.skills ?? {})) {
      skillCounts.set(name, (skillCounts.get(name) ?? 0) + c);
    }
  }
  const skills_loaded: DaySignals["skills_loaded"] = [...skillCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([skill, count]) => ({
      skill,
      origin: classifySkill(skill) as SkillOrigin,
      count,
    }));
  const user_authored_skills_used = skills_loaded
    .filter(s => s.origin === "user")
    .map(s => s.skill);

  // ── User-authored subagents dispatched today ──
  const userSubagentMap = new Map<string, {
    count: number; sample_description: string; sample_prompt_preview: string;
  }>();
  for (const e of entries) {
    for (const sa of e.subagents ?? []) {
      if (isStockSubagentType(sa.type)) continue;
      const cur = userSubagentMap.get(sa.type) ?? {
        count: 0, sample_description: sa.description, sample_prompt_preview: sa.prompt_preview,
      };
      cur.count += 1;
      if (sa.prompt_preview.length > cur.sample_prompt_preview.length) {
        cur.sample_description = sa.description;
        cur.sample_prompt_preview = sa.prompt_preview;
      }
      userSubagentMap.set(sa.type, cur);
    }
  }
  const user_authored_subagents_used: DaySignals["user_authored_subagents_used"] =
    [...userSubagentMap.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([type, v]) => ({
        type,
        count: v.count,
        sample_description: v.sample_description,
        sample_prompt_preview: truncate(v.sample_prompt_preview, 200),
      }));

  // ── Prompt frames detected today ──
  const frameCounts = new Map<PromptFrame, number>();
  for (const s of signalsList) {
    for (const frame of s.prompt_frames) {
      frameCounts.set(frame, (frameCounts.get(frame) ?? 0) + 1);
    }
  }
  const prompt_frames: DaySignals["prompt_frames"] = [...frameCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([frame, count]) => ({ frame, origin: PROMPT_FRAME_ORIGIN[frame], count }));

  // ── Communication style ──
  const verbosity_distribution = { short: 0, medium: 0, long: 0, very_long: 0 };
  const external_refs: DaySignals["comm_style"]["external_refs"] = [];
  let interrupts = 0, frustrated = 0, dissatisfied = 0;
  let sessions_with_mid_run_redirect = 0;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const s = signalsList[i]!;
    if ((e.first_user ?? "").length > 0) verbosity_distribution[s.verbosity] += 1;
    for (const ref of s.external_refs) {
      external_refs.push({ session_id: e.session_id, kind: ref.kind, preview: truncate(ref.preview, 200) });
    }
    const ints = e.numbers.interrupts ?? 0;
    interrupts += ints;
    frustrated += e.satisfaction_signals?.frustrated ?? 0;
    dissatisfied += e.satisfaction_signals?.dissatisfied ?? 0;
    if (ints >= 2) sessions_with_mid_run_redirect += 1;
  }

  // ── Brainstorm warmup, todo ops, plan mode ──
  const brainstorm_warmup_session_count = signalsList.filter(s => s.brainstorm_warmup).length;
  const todo_ops_total = entries.reduce((sum, e) => sum + (e.numbers.task_ops ?? 0), 0);
  const plan_mode_used = entries.some(e =>
    (e.numbers.exit_plan_calls ?? 0) > 0 || (e.flags ?? []).includes("plan_used"),
  );

  return {
    dominant_shape,
    shape_distribution,
    skills_loaded,
    user_authored_skills_used,
    user_authored_subagents_used,
    prompt_frames,
    comm_style: {
      verbosity_distribution,
      external_refs,
      steering: { interrupts, frustrated, dissatisfied, sessions_with_mid_run_redirect },
    },
    brainstorm_warmup_session_count,
    todo_ops_total,
    plan_mode_used,
  };
}

/** Day-level helpfulness: mode across enriched entries, tiebreak toward worse
 *  signal so regressions surface early in weekly aggregation. */
function rollupHelpfulnessDay(entries: Entry[]): DayHelpfulness {
  const counts = new Map<Exclude<DayHelpfulness, null>, number>();
  for (const e of entries) {
    const h = e.enrichment.claude_helpfulness;
    if (!h) continue;
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  // Worse-signal tiebreak order.
  const severity: Array<Exclude<DayHelpfulness, null>> = ["unhelpful", "neutral", "helpful", "essential"];
  let best: Exclude<DayHelpfulness, null> | null = null;
  let bestCount = 0;
  for (const level of severity) {
    const c = counts.get(level) ?? 0;
    if (c > bestCount) { best = level; bestCount = c; }
  }
  return best;
}

export function buildDeterministicDigest(
  date: string,
  entries: Entry[],
  opts: { concurrencyPeak?: number } = {},
): DayDigest {
  const agent_min = entries.reduce((sum, e) => sum + e.numbers.active_min, 0);

  const byProject = new Map<string, { minutes: number; entry_count: number }>();
  for (const e of entries) {
    const prev = byProject.get(e.project) ?? { minutes: 0, entry_count: 0 };
    prev.minutes += e.numbers.active_min;
    prev.entry_count += 1;
    byProject.set(e.project, prev);
  }
  const projects = [...byProject.entries()]
    .sort((a, b) => b[1].minutes - a[1].minutes)
    .map(([name, v]) => ({
      name,
      display_name: prettyProjectName(name),
      share_pct: agent_min > 0 ? (v.minutes / agent_min) * 100 : 0,
      entry_count: v.entry_count,
    }));

  const shipped = entries.flatMap(e =>
    e.pr_titles.map(title => ({
      title,
      project: prettyProjectName(e.project),
      session_id: e.session_id,
    })),
  );

  const flagCounts = new Map<string, number>();
  for (const e of entries) {
    for (const f of e.flags) {
      flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);
    }
  }
  const top_flags = [...flagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([flag, count]) => ({ flag, count }));

  const goalMinutes = new Map<string, number>();
  for (const e of entries) {
    if (e.enrichment.status !== "done") continue;
    for (const [g, min] of Object.entries(e.enrichment.goal_categories ?? {})) {
      goalMinutes.set(g, (goalMinutes.get(g) ?? 0) + (min ?? 0));
    }
  }
  const top_goal_categories = [...goalMinutes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, minutes]) => ({ category, minutes }));

  const window = {
    start: `${date}T00:00:00`,
    end: `${date}T23:59:59`,
  };

  // Per-source-agent breakdown — surfaces fleet shape into the day digest
  // and propagates up to week/month digests.
  const agentMap = new Map<string, { sessions: number; active_min: number; tools_total: number }>();
  for (const e of entries) {
    const k = e.agent ?? "claude-code";
    const cur = agentMap.get(k) ?? { sessions: 0, active_min: 0, tools_total: 0 };
    cur.sessions += 1;
    cur.active_min += e.numbers.active_min;
    cur.tools_total += e.numbers.tools_total;
    agentMap.set(k, cur);
  }
  const agent_breakdown =
    agentMap.size === 0
      ? undefined
      : Array.from(agentMap.entries())
          .map(([agent, v]) => ({
            agent,
            sessions: v.sessions,
            active_min: Math.round(v.active_min * 10) / 10,
            tools_total: v.tools_total,
          }))
          .sort((a, b) => b.active_min - a.active_min);

  return {
    version: CURRENT_DAY_DIGEST_SCHEMA_VERSION,
    scope: "day",
    key: date,
    window,
    entry_refs: entries.map(e => `${e.session_id}__${e.local_day}`),
    generated_at: new Date().toISOString(),
    is_live: false,
    model: null,
    cost_usd: null,
    projects,
    shipped,
    top_flags,
    top_goal_categories,
    concurrency_peak: opts.concurrencyPeak ?? 0,
    agent_min,
    agent_breakdown,
    outcome_day: rollupOutcomeDay(entries),
    helpfulness_day: rollupHelpfulnessDay(entries),
    day_signals: entries.length > 0 ? computeDaySignals(entries) : undefined,
    headline: null,
    narrative: null,
    what_went_well: null,
    what_hit_friction: null,
    suggestion: null,
    day_signature: null,
  };
}

// ─── Generator (LLM narrative layer) ──────────────────────────────────────

export type GenerateOptions = {
  model?: string;
  callLLM?: CallLLM;
  concurrencyPeak?: number;
  /** Optional char-count progress from the claude -p synth call. */
  onProgress?: (info: { bytes: number; elapsedMs: number }) => void;
};

export type GenerateResult = {
  digest: DayDigest;
  usage: EnrichUsage | null;
};

const DEFAULT_MODEL = "sonnet";

const defaultCallLLMDigest: CallLLM = (args) =>
  runClaudeSubprocess({ ...args, systemPrompt: DIGEST_DAY_SYSTEM_PROMPT });

const validateDay = (content: string) => parseAndValidate(content, DayDigestResponseSchema);

export async function generateDayDigest(
  date: string,
  entries: Entry[],
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  const base = buildDeterministicDigest(date, entries, { concurrencyPeak: opts.concurrencyPeak });
  const enriched = entries.filter(e => e.enrichment.status === "done");
  if (enriched.length === 0) return { digest: base, usage: null };

  const model = opts.model ?? DEFAULT_MODEL;
  const callLLM = opts.callLLM ?? defaultCallLLMDigest;
  const userPrompt = buildDigestUserPrompt(base, entries);
  let inT = 0, outT = 0;
  // Initial value is the safety net for the throws-before-reassignment path,
  // even though the catch branch doesn't end up reading lastModel today.
  // eslint-disable-next-line no-useless-assignment
  let lastModel: string = model;

  try {
    const r1 = await callLLM({ model, userPrompt, onProgress: opts.onProgress });
    inT += r1.input_tokens; outT += r1.output_tokens; lastModel = r1.model;
    const v1 = validateDay(r1.content);
    if (v1.ok) {
      return {
        digest: {
          ...base, model: lastModel, cost_usd: computeCostUsd(lastModel, inT, outT),
          headline: v1.value.headline,
          narrative: v1.value.narrative,
          what_went_well: v1.value.what_went_well,
          what_hit_friction: v1.value.what_hit_friction,
          suggestion: v1.value.suggestion,
          day_signature: v1.value.day_signature ?? null,
        },
        usage: { input_tokens: inT, output_tokens: outT },
      };
    }

    const r2 = await callLLM({
      model, userPrompt,
      reminder: "Your previous response was not valid JSON or did not match the required schema. Return ONLY the JSON object with the six required fields — no prose, no code fence.",
      onProgress: opts.onProgress,
    });
    inT += r2.input_tokens; outT += r2.output_tokens; lastModel = r2.model;
    const v2 = validateDay(r2.content);
    if (v2.ok) {
      return {
        digest: {
          ...base, model: lastModel, cost_usd: computeCostUsd(lastModel, inT, outT),
          headline: v2.value.headline,
          narrative: v2.value.narrative,
          what_went_well: v2.value.what_went_well,
          what_hit_friction: v2.value.what_hit_friction,
          suggestion: v2.value.suggestion,
          day_signature: v2.value.day_signature ?? null,
        },
        usage: { input_tokens: inT, output_tokens: outT },
      };
    }

    console.warn(`[digest-day] ${date}: LLM response failed validation after retry (${v2.error})`);
    return { digest: base, usage: { input_tokens: inT, output_tokens: outT } };
  } catch (err) {
    console.warn(`[digest-day] ${date}: LLM invocation failed (${(err as Error).message})`);
    return { digest: base, usage: inT > 0 ? { input_tokens: inT, output_tokens: outT } : null };
  }
}
