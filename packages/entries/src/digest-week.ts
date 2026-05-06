import {
  CURRENT_WEEK_DIGEST_SCHEMA_VERSION,
  PROMPT_FRAME_ORIGIN,
  type DayDigest, type DayHelpfulness, type DayOutcome, type DaySignals,
  type Entry, type WeekDigest, type WeekInteractionModes,
  type WeekWorkingShapeRow, type WeekInteractionGrammar, type WorkingShape,
  type PromptFrame,
} from "./types.js";
import { detectPromptFrames, inferWorkingShape } from "./signals.js";
import { computeDaySignals } from "./digest-day.js";
import {
  DIGEST_WEEK_SYSTEM_PROMPT,
  WeekDigestResponseSchema,
  buildWeekDigestUserPrompt,
} from "./prompts/digest-week.js";
import type { CallLLM, EnrichUsage } from "./enrich.js";
import { computeCostUsd } from "./enrich.js";
import { runClaudeSubprocess, parseAndValidate } from "./llm-runner.js";

function prettyProject(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/** Mon-Sun array of dates from a Monday key. Mutates nothing. */
export function weekDates(monday: string): string[] {
  const start = new Date(`${monday}T00:00:00`);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    out.push(toLocalDateString(d));
  }
  return out;
}

function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Aggregate per-Entry interaction signals into a week-level snapshot.
 *  Treats `subagents`, `skills`, `numbers.subagent_calls/skill_calls/task_ops/
 *  exit_plan_calls/interrupts/turn_count/tools_total`, and the `long_autonomous`
 *  flag as the load-bearing inputs. Day-bucketing uses `local_day` for the
 *  "days_with_*" denominators. Also surfaces qualitative examples — actual
 *  subagent prompts, skill+first_user pairings, longest-turn detail — so
 *  downstream prose has texture to quote rather than just counts to recite. */
export function computeInteractionModes(entries: Entry[]): WeekInteractionModes {
  const subagentCallsByDay = new Map<string, number>();
  const skillCallsByDay = new Map<string, number>();
  const planCallsByDay = new Map<string, number>();
  const longAutonomousDays = new Set<string>();

  let subagent_calls = 0, task_ops = 0, skill_calls = 0;
  let exit_plan_calls = 0, interrupts = 0;
  let tools_total = 0, turn_count = 0;

  const subagentTypes = new Map<string, number>();
  const skillNames = new Map<string, number>();

  for (const e of entries) {
    const day = e.local_day;
    subagent_calls += e.numbers.subagent_calls;
    skill_calls += e.numbers.skill_calls;
    task_ops += e.numbers.task_ops;
    exit_plan_calls += e.numbers.exit_plan_calls;
    interrupts += e.numbers.interrupts;
    tools_total += e.numbers.tools_total;
    turn_count += e.numbers.turn_count;

    if (e.numbers.subagent_calls > 0) {
      subagentCallsByDay.set(day, (subagentCallsByDay.get(day) ?? 0) + e.numbers.subagent_calls);
    }
    if (e.numbers.skill_calls > 0) {
      skillCallsByDay.set(day, (skillCallsByDay.get(day) ?? 0) + e.numbers.skill_calls);
    }
    if (e.numbers.exit_plan_calls > 0 || e.flags.includes("plan_used")) {
      planCallsByDay.set(day, (planCallsByDay.get(day) ?? 0) + e.numbers.exit_plan_calls);
    }
    if (e.flags.includes("long_autonomous")) longAutonomousDays.add(day);

    for (const sa of e.subagents) {
      subagentTypes.set(sa.type, (subagentTypes.get(sa.type) ?? 0) + 1);
    }
    for (const [skill, count] of Object.entries(e.skills)) {
      skillNames.set(skill, (skillNames.get(skill) ?? 0) + count);
    }
  }

  const top_types = [...subagentTypes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type, count]) => ({ type, count }));
  const top_skills = [...skillNames.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([skill, count]) => ({ skill, count }));

  // ── Qualitative examples ────────────────────────────────────────────────
  // Pick up to 3 distinctive subagent dispatches: prefer one per top_type
  // (prevents one busy day from monopolizing the examples), pulling the
  // longest prompt_preview within each type since longer = more texture.
  const subagentExamples: WeekInteractionModes["orchestration"]["examples"] = [];
  const seenTypes = new Set<string>();
  const allDispatches: Array<{ entry: Entry; sa: typeof entries[0]["subagents"][0] }> = [];
  for (const e of entries) for (const sa of e.subagents) allDispatches.push({ entry: e, sa });
  // Sort by prompt_preview length desc; pick first match per type.
  allDispatches.sort((a, b) => b.sa.prompt_preview.length - a.sa.prompt_preview.length);
  for (const { entry, sa } of allDispatches) {
    if (subagentExamples.length >= 3) break;
    if (seenTypes.has(sa.type)) continue;
    seenTypes.add(sa.type);
    subagentExamples.push({
      date: entry.local_day,
      project_display: prettyProject(entry.project),
      type: sa.type,
      prompt_preview: truncate(sa.prompt_preview, 200),
    });
  }

  // Pick up to 3 distinct skills with the first_user from an entry that loaded
  // them — gives the reader a sense of *why* the skill was reached for.
  const skillExamples: WeekInteractionModes["skill_use"]["examples"] = [];
  const seenSkills = new Set<string>();
  for (const e of entries) {
    for (const skill of Object.keys(e.skills)) {
      if (skillExamples.length >= 3) break;
      if (seenSkills.has(skill)) continue;
      if (!e.first_user || e.first_user.length < 8) continue;
      seenSkills.add(skill);
      skillExamples.push({
        date: e.local_day,
        skill,
        first_user_preview: truncate(e.first_user, 200),
      });
    }
  }

  // The long-autonomous entry with the highest active_min — captures the
  // most-illustrative single push.
  let longestTurnEntry: Entry | null = null;
  for (const e of entries) {
    if (!e.flags.includes("long_autonomous")) continue;
    if (!longestTurnEntry || e.numbers.active_min > longestTurnEntry.numbers.active_min) {
      longestTurnEntry = e;
    }
  }
  const longest_turn = longestTurnEntry ? {
    date: longestTurnEntry.local_day,
    project_display: prettyProject(longestTurnEntry.project),
    active_min: longestTurnEntry.numbers.active_min,
    top_tools: longestTurnEntry.top_tools.slice(0, 5),
    first_user_preview: truncate(longestTurnEntry.first_user, 200),
  } : null;

  const tools_per_turn = turn_count > 0 ? tools_total / turn_count : 0;
  // 5 / 15 thresholds calibrated to feel right on observed dogfood weeks: a
  // 5-tool turn is a focused single task, 15+ is a clearly batched run.
  const label: WeekInteractionModes["turn_shape"]["label"] =
    tools_per_turn < 5 ? "rapid" : tools_per_turn < 15 ? "mixed" : "batch";

  return {
    orchestration: {
      subagent_calls,
      task_ops,
      days_with_subagents: subagentCallsByDay.size,
      top_types,
      examples: subagentExamples,
    },
    skill_use: {
      skill_calls,
      days_with_skills: skillCallsByDay.size,
      top_skills,
      examples: skillExamples,
    },
    plan_gating: {
      exit_plan_calls,
      days_with_plan: planCallsByDay.size,
    },
    turn_shape: {
      tools_per_turn: Math.round(tools_per_turn * 10) / 10,
      interrupts,
      long_autonomous_days: longAutonomousDays.size,
      label,
      longest_turn,
    },
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

// ─── Working-shapes week aggregator ──────────────────────────────────────

/** Resolve day_signals for a given DayDigest, falling back to on-the-fly
 *  computation from entries when a cached pre-refactor digest lacks them. */
function getOrComputeDaySignals(dd: DayDigest, entries: Entry[]): DaySignals {
  return dd.day_signals ?? computeDaySignals(entries);
}

const SHAPE_ORDER: Array<NonNullable<WorkingShape>> = [
  "spec-review-loop", "chunk-implementation", "reviewer-triad",
  "research-then-build", "background-coordinated",
  "solo-continuation", "solo-design", "solo-build",
];

/** Aggregate per-day shape classifications into a per-week shape rollup. Reads
 *  ONLY DayDigest.day_signals (with on-the-fly fallback from entriesByDay).
 *  Each (date × shape) yields one occurrence; entries of that day matching the
 *  shape contribute the representative subagent / first_user evidence. */
export function computeWorkingShapes(
  dayDigests: DayDigest[],
  entriesByDay: Map<string, Entry[]> = new Map(),
): WeekWorkingShapeRow[] {
  const dayOutcome = new Map<string, DayOutcome>();
  const dayHelp = new Map<string, DayHelpfulness>();
  for (const dd of dayDigests) {
    dayOutcome.set(dd.key, dd.outcome_day);
    dayHelp.set(dd.key, dd.helpfulness_day);
  }

  // Walk dayDigests; for each, get day_signals and emit one occurrence per
  // shape that appeared on that day.
  const byShape = new Map<NonNullable<WorkingShape>, Array<{ dd: DayDigest; entries: Entry[] }>>();
  for (const dd of dayDigests) {
    const entries = entriesByDay.get(dd.key) ?? [];
    const signals = getOrComputeDaySignals(dd, entries);
    for (const shape of Object.keys(signals.shape_distribution) as Array<NonNullable<WorkingShape>>) {
      const arr = byShape.get(shape) ?? [];
      arr.push({ dd, entries });
      byShape.set(shape, arr);
    }
  }

  const ordered: WeekWorkingShapeRow[] = [];
  for (const shape of SHAPE_ORDER) {
    const days = byShape.get(shape);
    if (!days || days.length === 0) continue;

    const occurrences = days
      .sort((a, b) => a.dd.key.localeCompare(b.dd.key))
      .map(({ dd, entries }) => {
        // Find a representative entry on this day whose shape matches.
        const matching = entries.filter(e => {
          const s = e.signals?.working_shape ?? inferWorkingShape(e);
          return s === shape;
        });
        // Prefer the entry with the longest representative subagent prompt.
        const repEntry = matching
          .sort((a, b) => {
            const aLen = (a.subagents ?? []).reduce((m, sa) => Math.max(m, sa.prompt_preview.length), 0);
            const bLen = (b.subagents ?? []).reduce((m, sa) => Math.max(m, sa.prompt_preview.length), 0);
            return bLen - aLen;
          })[0]
          ?? matching[0]
          ?? null;

        let evidence_subagent: WeekWorkingShapeRow["occurrences"][number]["evidence_subagent"] = null;
        if (repEntry?.subagents && repEntry.subagents.length > 0) {
          const sorted = [...repEntry.subagents].sort((a, b) => b.prompt_preview.length - a.prompt_preview.length);
          const sa = sorted[0]!;
          evidence_subagent = {
            type: sa.type,
            description: sa.description,
            prompt_preview: truncate(sa.prompt_preview, 200),
          };
        }
        const project_display = repEntry
          ? prettyProject(repEntry.project)
          : (dd.projects[0]?.display_name ?? "");
        return {
          date: dd.key,
          session_id: repEntry?.session_id ?? "",
          project_display,
          outcome: dayOutcome.get(dd.key) ?? null,
          helpfulness: dayHelp.get(dd.key) ?? null,
          evidence_subagent,
          evidence_first_user: repEntry?.first_user ? truncate(repEntry.first_user, 200) : null,
          day_signature: dd.day_signature ?? null,
        };
      });

    const outcome_distribution: Partial<Record<DayOutcome, number>> = {};
    for (const o of occurrences) {
      if (!o.outcome) continue;
      outcome_distribution[o.outcome] = (outcome_distribution[o.outcome] ?? 0) + 1;
    }

    ordered.push({ shape, occurrences, outcome_distribution });
  }

  return ordered;
}

// ─── Interaction grammar aggregator ──────────────────────────────────────

/** Aggregate per-day signals into a per-week interaction-grammar rollup.
 *  Per-day fields come from `day_signals` (with on-the-fly fallback from
 *  entriesByDay). `threads` (multi-day session continuity) and `total_turns`
 *  + `exit_plan_calls` (raw counters not in day_signals) come from entries
 *  when available, otherwise default to empty/zero. */
export function computeInteractionGrammar(
  dayDigests: DayDigest[],
  entriesByDay: Map<string, Entry[]> = new Map(),
): WeekInteractionGrammar {
  const brainstormDays = new Set<string>();
  const frameMap = new Map<PromptFrame, { count: number; days: Set<string> }>();
  const userSkillMap = new Map<string, { count: number; days: Set<string> }>();
  const userSubagentMap = new Map<string, { count: number; days: Set<string>; sample_description: string; sample_prompt_preview: string }>();

  const verbosity = { short: 0, medium: 0, long: 0, very_long: 0 };
  const externalRefs: WeekInteractionGrammar["communication_style"]["external_context_refs"] = [];
  let total_interrupts = 0;
  let total_frustrated = 0;
  let total_dissatisfied = 0;
  let sessions_with_mid_run_redirect = 0;

  let todo_ops_total = 0;
  const planDays = new Set<string>();

  for (const dd of dayDigests) {
    const day = dd.key;
    const entries = entriesByDay.get(day) ?? [];
    const signals = getOrComputeDaySignals(dd, entries);

    if (signals.brainstorm_warmup_session_count > 0) brainstormDays.add(day);
    todo_ops_total += signals.todo_ops_total;
    if (signals.plan_mode_used) planDays.add(day);

    for (const f of signals.prompt_frames) {
      const cur = frameMap.get(f.frame) ?? { count: 0, days: new Set<string>() };
      cur.count += f.count;
      cur.days.add(day);
      frameMap.set(f.frame, cur);
    }

    for (const s of signals.skills_loaded) {
      if (s.origin !== "user") continue;
      const cur = userSkillMap.get(s.skill) ?? { count: 0, days: new Set<string>() };
      cur.count += s.count;
      cur.days.add(day);
      userSkillMap.set(s.skill, cur);
    }

    for (const sa of signals.user_authored_subagents_used) {
      const cur = userSubagentMap.get(sa.type) ?? {
        count: 0, days: new Set<string>(),
        sample_description: sa.sample_description,
        sample_prompt_preview: sa.sample_prompt_preview,
      };
      cur.count += sa.count;
      cur.days.add(day);
      if (sa.sample_prompt_preview.length > cur.sample_prompt_preview.length) {
        cur.sample_description = sa.sample_description;
        cur.sample_prompt_preview = sa.sample_prompt_preview;
      }
      userSubagentMap.set(sa.type, cur);
    }

    const v = signals.comm_style.verbosity_distribution;
    verbosity.short += v.short;
    verbosity.medium += v.medium;
    verbosity.long += v.long;
    verbosity.very_long += v.very_long;

    for (const ref of signals.comm_style.external_refs) {
      externalRefs.push({
        date: day, session_id: ref.session_id, ref_kind: ref.kind,
        preview: truncate(ref.preview, 200),
      });
    }

    total_interrupts += signals.comm_style.steering.interrupts;
    total_frustrated += signals.comm_style.steering.frustrated;
    total_dissatisfied += signals.comm_style.steering.dissatisfied;
    sessions_with_mid_run_redirect += signals.comm_style.steering.sessions_with_mid_run_redirect;
  }

  // Threads + total_turns + exit_plan_calls — require entries when present;
  // when absent (no entries provided) fall back to empty/zero. Pre-refactor
  // cached digests reading the new path see: empty threads + zeroed counters
  // until they're re-rolled with entries available.
  const bySession = new Map<string, Entry[]>();
  let total_turns = 0;
  let exit_plan_calls = 0;
  for (const [, entries] of entriesByDay) {
    for (const e of entries) {
      total_turns += e.numbers.turn_count ?? 0;
      exit_plan_calls += e.numbers.exit_plan_calls ?? 0;
      const arr = bySession.get(e.session_id) ?? [];
      arr.push(e);
      bySession.set(e.session_id, arr);
    }
  }
  const threads: WeekInteractionGrammar["threads"] = [];
  for (const [sid, arr] of bySession.entries()) {
    const distinctDays = new Set(arr.map(e => e.local_day));
    if (distinctDays.size < 2) continue;
    arr.sort((a, b) => a.local_day.localeCompare(b.local_day));
    const total_active_min = arr.reduce((s, e) => s + e.numbers.active_min, 0);
    const lastEntry = arr[arr.length - 1]!;
    threads.push({
      thread_id: sid,
      entries: arr.map(e => ({
        date: e.local_day,
        session_id: e.session_id,
        project_display: prettyProject(e.project),
        has_handoff_frame: detectPromptFrames(e.first_user).includes("handoff-prose"),
      })),
      total_active_min,
      outcome: (lastEntry.enrichment?.outcome ?? null) as DayOutcome | null,
    });
  }
  threads.sort((a, b) => b.total_active_min - a.total_active_min);

  // Skill-family rollup: split user-authored skills on "-", group by prefix.
  const familyMap = new Map<string, { members: Set<string>; total_count: number; days: Set<string> }>();
  for (const [skill, v] of userSkillMap.entries()) {
    const family = skill.includes("-") ? skill.split("-")[0]! : skill;
    const cur = familyMap.get(family) ?? { members: new Set<string>(), total_count: 0, days: new Set<string>() };
    cur.members.add(skill);
    cur.total_count += v.count;
    for (const d of v.days) cur.days.add(d);
    familyMap.set(family, cur);
  }
  const skill_families = [...familyMap.entries()]
    .filter(([, v]) => v.members.size >= 2 || v.total_count >= 3)
    .sort((a, b) => b[1].total_count - a[1].total_count)
    .map(([family, v]) => ({
      family,
      members: [...v.members].sort(),
      total_count: v.total_count,
      days: [...v.days].sort(),
    }));

  return {
    brainstorming_warmup_days: [...brainstormDays].sort(),
    prompt_frames: [...frameMap.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([frame, v]) => ({
        frame,
        origin: PROMPT_FRAME_ORIGIN[frame],
        count: v.count,
        days: [...v.days].sort(),
      })),
    user_authored_skills: [...userSkillMap.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([skill, v]) => ({ skill, count: v.count, days: [...v.days].sort() })),
    skill_families,
    user_authored_subagents: [...userSubagentMap.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([type, v]) => ({
        type,
        count: v.count,
        days: [...v.days].sort(),
        sample_description: v.sample_description,
        sample_prompt_preview: truncate(v.sample_prompt_preview, 200),
      })),
    threads,
    communication_style: {
      verbosity_distribution: verbosity,
      external_context_refs: externalRefs,
      steering: {
        total_interrupts,
        total_frustrated,
        total_dissatisfied,
        sessions_with_mid_run_redirect,
        total_turns,
      },
    },
    todo_ops_total,
    plan_mode: { exit_plan_calls, days_with_plan: planDays.size },
  };
}

export type BuildDeterministicWeekOptions = {
  /** Entries indexed by local_day. Used for:
   *   - longest_run + hours_distribution (per-Entry start_iso + active_min)
   *   - by-the-numbers interaction_modes (per-Entry tool / skill / subagent counts)
   *   - thread detection across days (multi-day session continuity)
   *   - on-the-fly DaySignals fallback for cached pre-refactor day digests
   *  When omitted, longest_run/hours_distribution/threads stay null/empty and
   *  pre-refactor cached day digests carry zeroed shape/grammar contributions. */
  entriesByDay?: Map<string, Entry[]>;
};

export function buildDeterministicWeekDigest(
  monday: string,
  dayDigests: DayDigest[],
  opts: BuildDeterministicWeekOptions = {},
): WeekDigest {
  const dates = weekDates(monday);
  const byDate = new Map<string, DayDigest>();
  for (const d of dayDigests) byDate.set(d.key, d);

  const agent_min_total = dayDigests.reduce((sum, d) => sum + d.agent_min, 0);

  // Aggregate per-project across all day digests.
  const byProject = new Map<string, { agent_min: number; shipped_count: number }>();
  for (const dd of dayDigests) {
    for (const p of dd.projects) {
      const cur = byProject.get(p.name) ?? { agent_min: 0, shipped_count: 0 };
      cur.agent_min += (p.share_pct / 100) * dd.agent_min;
      byProject.set(p.name, cur);
    }
  }
  for (const dd of dayDigests) {
    for (const s of dd.shipped) {
      // s.project is already display_name; map back to canonical via lookup
      // by matching display_name in dd.projects. If not found, count under the
      // display_name as a synthetic key (rare — only when shipping outside
      // any tracked project).
      const match = dd.projects.find(p => p.display_name === s.project);
      const key = match ? match.name : s.project;
      const cur = byProject.get(key) ?? { agent_min: 0, shipped_count: 0 };
      cur.shipped_count += 1;
      byProject.set(key, cur);
    }
  }
  const projects = [...byProject.entries()]
    .sort((a, b) => b[1].agent_min - a[1].agent_min)
    .map(([name, v]) => ({
      name,
      display_name: prettyProject(name),
      agent_min: v.agent_min,
      share_pct: agent_min_total > 0 ? (v.agent_min / agent_min_total) * 100 : 0,
      shipped_count: v.shipped_count,
      description: null as string | null,
    }));

  const shipped: WeekDigest["shipped"] = [];
  for (const dd of dayDigests) {
    for (const s of dd.shipped) {
      shipped.push({ title: s.title, project: s.project, date: dd.key, session_id: s.session_id });
    }
  }

  const outcome_mix: Partial<Record<DayOutcome, number>> = {};
  for (const dd of dayDigests) {
    outcome_mix[dd.outcome_day] = (outcome_mix[dd.outcome_day] ?? 0) + 1;
  }

  const helpfulness_sparkline: DayHelpfulness[] = dates.map(date => {
    const dd = byDate.get(date);
    return dd ? dd.helpfulness_day : null;
  });

  const flagCounts = new Map<string, number>();
  for (const dd of dayDigests) {
    for (const f of dd.top_flags) {
      flagCounts.set(f.flag, (flagCounts.get(f.flag) ?? 0) + f.count);
    }
  }
  const top_flags = [...flagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([flag, count]) => ({ flag, count }));

  const goalMinutes = new Map<string, number>();
  for (const dd of dayDigests) {
    for (const g of dd.top_goal_categories) {
      goalMinutes.set(g.category, (goalMinutes.get(g.category) ?? 0) + g.minutes);
    }
  }
  const top_goal_categories = [...goalMinutes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, minutes]) => ({ category, minutes }));

  let concurrency_peak_day: WeekDigest["concurrency_peak_day"] = null;
  for (const dd of dayDigests) {
    if (dd.concurrency_peak > 0) {
      if (!concurrency_peak_day || dd.concurrency_peak > concurrency_peak_day.peak) {
        concurrency_peak_day = { date: dd.key, peak: dd.concurrency_peak };
      }
    }
  }

  // ── days_active strip + busiest_day ──
  const entriesByDay = opts.entriesByDay ?? new Map<string, Entry[]>();
  const days_active: WeekDigest["days_active"] = dayDigests
    .filter(d => d.agent_min > 0)
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(d => {
      const dayEntries = entriesByDay.get(d.key) ?? [];
      const signals = d.day_signals ?? (dayEntries.length > 0 ? computeDaySignals(dayEntries) : null);
      return {
        date: d.key,
        agent_min: d.agent_min,
        shipped_count: d.shipped.length,
        outcome_day: d.outcome_day,
        helpfulness_day: d.helpfulness_day,
        dominant_shape: signals?.dominant_shape ?? null,
      };
    });

  let busiest_day: WeekDigest["busiest_day"] = null;
  for (const d of days_active) {
    if (!busiest_day || d.agent_min > busiest_day.agent_min) {
      busiest_day = { date: d.date, agent_min: d.agent_min, shipped_count: d.shipped_count };
    }
  }

  // ── longest_run + hours_distribution + interaction_modes from entries ──
  const flatEntries: Entry[] = [];
  for (const arr of entriesByDay.values()) flatEntries.push(...arr);

  let longest_run: WeekDigest["longest_run"] = null;
  const hours_distribution = new Array<number>(24).fill(0);
  for (const e of flatEntries) {
    if (!longest_run || e.numbers.active_min > longest_run.active_min) {
      longest_run = {
        session_id: e.session_id,
        date: e.local_day,
        project_display: prettyProject(e.project),
        active_min: e.numbers.active_min,
      };
    }
    const startMs = Date.parse(e.start_iso);
    if (!Number.isNaN(startMs)) {
      const hour = new Date(startMs).getHours();
      hours_distribution[hour] = (hours_distribution[hour] ?? 0) + e.numbers.active_min;
    }
  }

  // Working shapes + grammar derive from dayDigests (with on-the-fly fallback
  // when day_signals is absent). Modes still aggregate from entries — the
  // by-the-numbers fold-down is inherently per-Entry.
  const working_shapes = dayDigests.length > 0 ? computeWorkingShapes(dayDigests, entriesByDay) : null;
  const interaction_grammar = dayDigests.length > 0 ? computeInteractionGrammar(dayDigests, entriesByDay) : null;
  const interaction_modes = flatEntries.length > 0 ? computeInteractionModes(flatEntries) : null;

  const sunday = dates[6]!;
  const window = { start: `${monday}T00:00:00`, end: `${sunday}T23:59:59` };

  return {
    version: CURRENT_WEEK_DIGEST_SCHEMA_VERSION,
    scope: "week",
    key: monday,
    window,
    day_refs: dayDigests.map(d => d.key).sort(),
    generated_at: new Date().toISOString(),
    is_live: false,
    model: null,
    cost_usd: null,
    agent_min_total,
    projects,
    shipped,
    outcome_mix,
    helpfulness_sparkline,
    top_flags,
    top_goal_categories,
    concurrency_peak_day,
    days_active,
    busiest_day,
    longest_run,
    hours_distribution,
    interaction_modes,
    working_shapes,
    interaction_grammar,
    headline: null,
    key_pattern: null,
    trajectory: null,
    standout_days: null,
    what_worked: null,
    what_stalled: null,
    what_surprised: null,
    where_to_lean: null,
    // Legacy fields stay null on the new code path; cached pre-refactor digests
    // may carry populated values which the renderer will hide when working_shapes
    // is present.
    recurring_themes: null,
    outcome_correlations: null,
    friction_categories: null,
    suggestions: null,
    on_the_horizon: null,
    fun_ending: null,
  };
}

// ─── Generator (LLM narrative) ───────────────────────────────────────────

export type GenerateWeekOptions = {
  model?: string;
  callLLM?: CallLLM;
  onProgress?: (info: { bytes: number; elapsedMs: number }) => void;
  /** Entries indexed by local_day. Same shape as BuildDeterministicWeekOptions —
   *  used for longest_run / hours_distribution / interaction_modes / threads
   *  and for on-the-fly DaySignals fallback on cached pre-refactor day digests. */
  entriesByDay?: Map<string, Entry[]>;
  /** When true, run the LLM synth even with only one enriched day digest.
   *  Default behavior requires ≥2 to avoid hallucinated weekly arcs from
   *  a single data point; force=true is the user explicitly requesting a
   *  current-week narrative that may have only Monday's data so far. */
  allowSingleDay?: boolean;
};

export type GenerateWeekResult = {
  digest: WeekDigest;
  usage: EnrichUsage | null;
};

const DEFAULT_MODEL = "sonnet";

const defaultCallLLMWeek: CallLLM = (args) =>
  runClaudeSubprocess({ ...args, systemPrompt: DIGEST_WEEK_SYSTEM_PROMPT });

const validateWeek = (content: string) => parseAndValidate(content, WeekDigestResponseSchema);

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Strip findings whose evidence quote isn't a substring of the named day's
 *  text fields. The prompt asks for grounded quotes; this enforces it across
 *  what_worked / what_stalled / what_surprised. Findings with ungrounded
 *  evidence are dropped. */
function pruneUngroundedFindings(
  value: import("./prompts/digest-week.js").WeekDigestResponse,
  dayDigests: DayDigest[],
  entries: Entry[],
  promptText: string,
): import("./prompts/digest-week.js").WeekDigestResponse {
  // The substring grounding check now runs against the SAME prompt text the
  // LLM saw. This keeps the validator in sync with the prompt builder
  // forever: if the prompt adds a new quotable section (day_signature,
  // suggestion lines, day-signal bullets, interaction-grammar bullets),
  // the corpus picks them up automatically with no parallel update.
  //
  // Per-day fallback corpora supplement the prompt text — they cover
  // entry-level fields (first_user, final_agent, subagent previews) that
  // aren't in the week prompt but ARE legitimate evidence sources for
  // anchored findings.
  const promptCorpus = normalizeForMatch(promptText);
  const dayFallback = new Map<string, string>();
  for (const d of dayDigests) {
    const parts = [d.headline, d.what_went_well, d.what_hit_friction]
      .filter((s): s is string => !!s);
    dayFallback.set(d.key, normalizeForMatch(parts.join(" \n ")));
  }
  for (const e of entries) {
    const day = e.local_day;
    const prior = dayFallback.get(day) ?? "";
    const extra = [e.first_user, e.final_agent, ...(e.subagents ?? []).flatMap(sa => [sa.description, sa.prompt_preview])]
      .filter((s): s is string => !!s)
      .join(" \n ");
    dayFallback.set(day, normalizeForMatch(prior + " \n " + extra));
  }

  const groundedFinding = (f: import("./prompts/digest-week.js").WeekDigestResponse["what_worked"][number]) => {
    const quote = normalizeForMatch(f.evidence.quote);
    if (promptCorpus.includes(quote)) return true;
    const fallback = dayFallback.get(f.evidence.date);
    return fallback ? fallback.includes(quote) : false;
  };

  return {
    ...value,
    what_worked: (value.what_worked ?? []).filter(groundedFinding),
    what_stalled: (value.what_stalled ?? []).filter(groundedFinding),
    what_surprised: (value.what_surprised ?? []).filter(groundedFinding),
    // where_to_lean evidence is a quote the user can act on, not always
    // substring-grounded — keep all.
  };
}

export async function generateWeekDigest(
  monday: string,
  dayDigests: DayDigest[],
  opts: GenerateWeekOptions = {},
): Promise<GenerateWeekResult> {
  const base = buildDeterministicWeekDigest(monday, dayDigests, { entriesByDay: opts.entriesByDay });
  // Need at least 2 LLM-enriched day digests (headline populated) to produce a
  // grounded weekly narrative. A deterministic-only day digest has null prose
  // fields, so synth would run on empty `day_summaries` and hallucinate.
  // Override via allowSingleDay (force=true on the current week) — a single
  // day with rich enrichment is enough to produce a meaningful Monday-only
  // narrative that calls out which agents drove which work.
  const enrichedDays = dayDigests.filter(d => d.headline !== null);
  const minDays = opts.allowSingleDay ? 1 : 2;
  if (enrichedDays.length < minDays) return { digest: base, usage: null };

  const model = opts.model ?? DEFAULT_MODEL;
  const callLLM = opts.callLLM ?? defaultCallLLMWeek;
  const userPrompt = buildWeekDigestUserPrompt(base, dayDigests);
  let inT = 0, outT = 0;
  let lastModel = model;

  const entriesArr: Entry[] = [];
  for (const arr of (opts.entriesByDay ?? new Map<string, Entry[]>()).values()) entriesArr.push(...arr);

  function mergeNarrative(value: import("./prompts/digest-week.js").WeekDigestResponse): WeekDigest {
    const enrichedProjects = base.projects.map(p => {
      const match = value.project_areas.find(pa => pa.display_name === p.display_name);
      return match ? { ...p, description: match.description } : p;
    });
    return {
      ...base,
      projects: enrichedProjects,
      model: lastModel,
      cost_usd: computeCostUsd(lastModel, inT, outT),
      headline: value.headline,
      key_pattern: value.key_pattern,
      trajectory: value.trajectory,
      standout_days: value.standout_days,
      what_worked: value.what_worked,
      what_stalled: value.what_stalled,
      what_surprised: value.what_surprised,
      where_to_lean: value.where_to_lean,
      // Legacy fields stay null on the new path; renderer prefers new fields.
      recurring_themes: null,
      outcome_correlations: null,
      friction_categories: null,
      suggestions: null,
      on_the_horizon: null,
      fun_ending: null,
    };
  }

  try {
    const r1 = await callLLM({ model, userPrompt, onProgress: opts.onProgress });
    inT += r1.input_tokens; outT += r1.output_tokens; lastModel = r1.model;
    const v1 = validateWeek(r1.content);
    if (v1.ok) {
      return { digest: mergeNarrative(pruneUngroundedFindings(v1.value, dayDigests, entriesArr, userPrompt)), usage: { input_tokens: inT, output_tokens: outT } };
    }

    const r2 = await callLLM({
      model, userPrompt,
      reminder: "Your previous response was not valid JSON or did not match the required schema. Return ONLY the JSON object with all required fields — no prose, no code fence.",
      onProgress: opts.onProgress,
    });
    inT += r2.input_tokens; outT += r2.output_tokens; lastModel = r2.model;
    const v2 = validateWeek(r2.content);
    if (v2.ok) {
      return { digest: mergeNarrative(pruneUngroundedFindings(v2.value, dayDigests, entriesArr, userPrompt)), usage: { input_tokens: inT, output_tokens: outT } };
    }

    console.warn(`[digest-week] ${monday}: LLM response failed validation after retry (${v2.error})`);
    return { digest: base, usage: { input_tokens: inT, output_tokens: outT } };
  } catch (err) {
    console.warn(`[digest-week] ${monday}: LLM invocation failed (${(err as Error).message})`);
    return { digest: base, usage: inT > 0 ? { input_tokens: inT, output_tokens: outT } : null };
  }
}
