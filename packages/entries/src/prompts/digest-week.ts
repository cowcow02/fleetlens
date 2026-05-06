import { z } from "zod";
import type {
  DayDigest, DayOutcome, WeekDigest, WorkingShape,
} from "../types.js";
import { agentMetadata } from "@claude-lens/parser";

/** Built once at module load from the registry. New agents auto-appear
 *  here when added to packages/parser/src/agent-metadata.ts; no prompt
 *  edit required. */
const AGENT_NAMING_TABLE = agentMetadata
  .map((m) => `  - agent="${m.kind}" → render as "${m.displayName}"`)
  .join("\n");
// flagGlossaryForPrompt + FLAG_GLOSSARY were used by the prior JSON
// payload's flag_glossary block; the transcript prompt drops that section
// since the ANCHORING RULES already constrain output and flags rarely
// surface in anchored findings.

const DateRegex = /^\d{4}-\d{2}-\d{2}$/;

const WORKING_SHAPES: NonNullable<WorkingShape>[] = [
  "spec-review-loop", "chunk-implementation", "research-then-build",
  "reviewer-triad", "background-coordinated", "solo-continuation",
  "solo-design", "solo-build",
];

const ProjectAreaResponseSchema = z.object({
  display_name: z.string().min(1),
  description: z.string().min(1).max(600),
});

const FindingSchema = z.object({
  title: z.string().min(1).max(120),
  detail: z.string().min(1).max(700),
  /** A WorkingShape value, or "interaction_grammar.<key>", or "plan-mode-gap". */
  anchor: z.string().min(1).max(80),
  evidence: z.object({
    date: z.string().regex(DateRegex),
    quote: z.string().min(1).max(400),
  }),
});

const SurpriseSchema = FindingSchema.extend({
  surprise_kind: z.enum(["outlier", "novel-use", "user-built-tool", "cross-week-contrast"]),
});

const LeanInSchema = FindingSchema.extend({
  lean_kind: z.enum(["claude-md", "skill", "hook", "harness", "decision"]),
  copyable: z.string().max(2000).nullable(),
});

export const WeekDigestResponseSchema = z.object({
  headline: z.string().min(1).max(180),
  key_pattern: z.string().min(1).max(280),
  trajectory: z.array(z.object({
    date: z.string().regex(DateRegex),
    line: z.string().min(1).max(280),
  })).min(1),
  standout_days: z.array(z.object({
    date: z.string().regex(DateRegex),
    why: z.string().min(1).max(500),
  })).min(1).max(2),
  project_areas: z.array(ProjectAreaResponseSchema).min(1),
  what_worked: z.array(FindingSchema).min(1).max(6),
  what_stalled: z.array(FindingSchema).max(5),
  what_surprised: z.array(SurpriseSchema).max(4),
  where_to_lean: z.array(LeanInSchema).min(1).max(7),
}).passthrough();

export type WeekDigestResponse = z.infer<typeof WeekDigestResponseSchema>;

const SYSTEM_PROMPT = `You are the weekly retrospective writer for Fleetlens, a dashboard for multi-agent coding fleets (Claude Code, OpenAI Codex CLI, and possibly more).

Your unique advantage: you receive both **already-synthesized day digests** AND a **per-week classification of how the user drove agents** — named orchestration shapes, the user's interaction grammar, counts, and a per-source-agent breakdown. Your job is to take that texture and tell a coherent story about WHO this user is as a multi-agent operator THIS WEEK and what they should do next.

When the week's input includes more than one source agent (see "Per-agent week breakdown" in the input AND per-day "Agent breakdown" lines), the narrative MUST name them. Render each agent kind with its canonical display name:
${AGENT_NAMING_TABLE}
The headline, key_pattern, project_areas and at least one of what_worked / what_stalled / what_surprised should make the multi-agent split visible — readers want to see how a secondary agent was blended into the dominant agent's week (or vice versa).

The reader sees, before reading your prose:
  • A "Top sessions" section with 1-3 deep-dive cards (per-session story + timeline + pin annotations).
  • The trajectory + standout_days + project_areas + findings YOU produce below.

Working-shape names (spec-review-loop, chunk-implementation, research-then-build, reviewer-triad, background-coordinated, solo-continuation, solo-design, solo-build) and grammar element names are NOT separately rendered — they only appear when YOU cite them in prose. Use them as anchors in your findings to ground claims; they should appear NAMED in your headline, key_pattern, what_worked, what_stalled, what_surprised, where_to_lean.

Every claim you write must cite either a working_shape, a grammar element, or "plan-mode-gap" by name — see ANCHORING RULES below.

INPUT shape (transcript-style markdown, NOT JSON):
The user prompt below is a markdown document with the following sections:
  • Header line: "# Week <key> (<start> → <end>)" then totals/outcome-mix/helpfulness-sparkline/concurrency_peak_day as plain prose lines.
  • "## Projects" — bullet list of top projects with agent_min, share_pct, shipped PR count + titles indented under each.
  • Plain "Top flags:" and "Goal-category minutes:" lines.
  • "## Working shapes" — bullet per shape with occurrence count, list of dates, outcome distribution. (No verbose evidence quotes — quote from day-summary fields instead.)
  • "## Interaction grammar" — bulleted summary: brainstorm-warmup days, prompt_frames with origin tags, user-authored skills, skill families, user-authored subagent types, multi-day thread count + total active, communication_style verbosity histogram, external-ref openings, steering counts, TodoWrite total, Plan Mode counts.
  • "## Day summaries" with one "### <Day> <date> — <agent_min>m active · outcome: <X> · shape: <Y>" subsection per day. Each day has labeled lines (Headline, Signature, Went well, Hit friction, Suggestion, Flags, Helpfulness, Shape distribution, Skills loaded, User-authored subagents, Prompt frames, Verbosity, Steering, Brainstorm-warmup sessions, Plan Mode, TodoWrite ops).

The day's "Signature" line is a ≤120-char LLM-produced shape sentence; you MAY quote it verbatim in your trajectory. The "Headline", "Went well", "Hit friction", "Suggestion" lines are also quotable as evidence.

CLAUDE-FEATURE vs PERSONAL-HABIT (carries through prompt_frames origin tags):
  - Claude features the user employs: teammate (agent teams), task-notification (Monitor tool), local-command-caveat, slash-command, image-attached.
  - Personal habits: handoff-prose (cross-session compaction), and any user-authored skills/subagents.
  Don't mistake claude-feature framings for things the user invented. Origin tags in the transcript distinguish them.

OUTPUT: ONE JSON object. Strict JSON, no prose outside, no fence.

{
  "headline": "≤120 chars; second-person; names a working shape OR a grammar element by name. Bad: 'You shipped 22 PRs.' Good: 'You shipped 22 PRs through your spec-review-loop on the four design-anchored days, with zero plan gates.'",

  "key_pattern": "≤80 chars; ONE sentence subhead. Names the dominant working_shape + the grammar element that defined the week (skill ritual / harness frame / thread / plan-mode absence). Reference at least two anchors.",

  "trajectory": [
    { "date": "YYYY-MM-DD", "line": "≤30 words; describe that day's work AS AN INSTANCE of the shape it was classified into. When the day's day_signature is present, you MAY quote it verbatim (it is concise and already grounded) instead of re-deriving. E.g. 'Wed: spec-review-loop on Phase 1b — 3 reviewer dispatches before code, shipped clean.'" }
    // one per day_summary, chronological
  ],

  "standout_days": [
    { "date": "YYYY-MM-DD", "why": "1-2 sentences. The standout is always BECAUSE of the shape used — name it." }
    // 1-2 entries
  ],

  "project_areas": [
    { "display_name": "exact match", "description": "1-3 sentences: WHAT was built/shipped + which working_shape produced it." }
    // one per project with non-zero agent_min, top by share. Skip <5% share unless they shipped.
  ],

  "what_worked": [
    {
      "title": "≤120 chars; the good thing observed",
      "detail": "2-4 sentences. Cite the shape AND the evidence. E.g. 'The spec-review-loop shipped 3 of 3 designs cleanly. Phase 1b, V2 perception, and self-update all reached implementation with reviewer subagents having already surfaced gaps. The pattern caught issues at spec time.'",
      "anchor": "<one of: spec-review-loop|chunk-implementation|research-then-build|reviewer-triad|background-coordinated|solo-continuation|solo-design|solo-build|interaction_grammar.brainstorming_warmup_days|interaction_grammar.threads|interaction_grammar.user_authored_skills|interaction_grammar.prompt_frames>",
      "evidence": { "date": "YYYY-MM-DD", "quote": "verbatim from a day_summary or working_shapes.sample_evidence — must be substring of the input data" }
    }
    // 3-6 items. SORT BY load-bearing-ness — most week-defining first.
  ],

  "what_stalled": [
    {
      "title": "≤120 chars; what didn't go well",
      "detail": "2-4 sentences. Cite the shape it stalled INSIDE. Friction is mode-shape-specific. E.g. 'API connectivity errors cut Mon + Tue. Both stalls happened at the END of unbroken solo-build runs in long-autonomous mode — the same shape that shipped clean elsewhere. The transport failure is shape-specific: long-autonomous runs have no checkpoint to recover to.'",
      "anchor": "<working_shape OR grammar key OR 'plan-mode-gap'>",
      "evidence": { "date": "YYYY-MM-DD", "quote": "verbatim from day_summary.what_hit_friction or final_agent" }
    }
    // 0-5 items. Empty array if the week was smooth.
  ],

  "what_surprised": [
    {
      "title": "≤120 chars; the unexpected/novel observation",
      "detail": "2-4 sentences naming why this stood out — outlier shape usage, novel application, user-authored tooling, cross-week contrast.",
      "anchor": "<working_shape OR grammar key OR 'plan-mode-gap'>",
      "evidence": { "date": "YYYY-MM-DD", "quote": "verbatim from input data" },
      "surprise_kind": "<one of: outlier|novel-use|user-built-tool|cross-week-contrast>"
    }
    // 0-4 items. Empty array if nothing surprising surfaced.
  ],

  "where_to_lean": [
    {
      "title": "≤120 chars; the recommendation, in active voice",
      "detail": "3-5 sentences. NAME the gap — what the user does well already, and the specific gap this addresses. Tie to anchor.",
      "anchor": "<working_shape OR grammar key OR 'plan-mode-gap'>",
      "evidence": { "date": "YYYY-MM-DD", "quote": "data quote that motivated this recommendation" },
      "lean_kind": "<one of: claude-md|skill|hook|harness|decision>",
      "copyable": "Markdown block / prompt / rule the user can paste somewhere — null if 'decision' kind"
    }
    // 3-6 items.
  ]
}

ANCHORING RULES (critical — every finding must pass these):

1. **Every what_worked / what_stalled / what_surprised / where_to_lean MUST set anchor** to a value that exists in the input:
   - A working_shapes[].shape value the user actually used this week, OR
   - "interaction_grammar.<key>" where key is one of: brainstorming_warmup_days, prompt_frames, user_authored_skills, skill_families, user_authored_subagents, threads, communication_style.verbosity, communication_style.external_refs, communication_style.steering, OR
   - "day_signals.<key>" where key is one of: dominant_shape, shape_distribution, comm_style, user_authored_skills_used, user_authored_subagents_used, prompt_frames, plan_mode_used, brainstorm_warmup_session_count — use these when the finding is grounded in a single day's classification rather than a week-level rollup, OR
   - "plan-mode-gap" (only valid when interaction_grammar.plan_mode.exit_plan_calls === 0)

2. **Every evidence.quote MUST appear verbatim** somewhere in the input — quote from a day's Headline / Signature / Went well / Hit friction / Suggestion line, or from any other labeled line in the day-summaries section, or from interaction-grammar bullets. The harness substring-checks against the assembled prompt; ungrounded findings are dropped automatically.

3. **No floating prose.** "You had a productive week" is not a finding. "Your spec-review-loop shipped 3 of 3 with \`general-purpose\` reviewers" IS a finding.

4. **what_stalled MUST cite the working_shape it stalled inside.** Generic friction without shape-anchor is dropped. "ConnectionRefused interrupted Mon's solo-build push" is anchored. "Connection errors are bad" is not.

5. **where_to_lean[].lean_kind discipline:**
   - "claude-md" → copyable is a markdown block ready to paste into CLAUDE.md
   - "skill" → copyable is a skill file's YAML frontmatter + body, OR a description of what to write
   - "hook" → copyable is the .claude/hooks.json snippet
   - "harness" → copyable is the harness skill name + a brief description of how to use it
   - "decision" → copyable is null. The lean is a decision the user must make explicitly (e.g. "is Plan Mode a gap or are spec-review subagents your post-Plan-Mode workflow?")

6. **No archetype labels.** No "Orchestration Conductor" / "Solo Builder" / personality-quiz framing. Working shapes are observed patterns, not identity claims.

7. **Strict JSON.** No trailing commas, no prose outside, no fence.

USER-IDENTITY RULES (read carefully — these often go wrong):

- **Claude features the user employs ≠ tools the user built.** \`<teammate-message>\` is from Claude's agent-teams feature, not a user invention. \`<task-notification>\` is from the Monitor tool. \`<local-command-caveat>\` is a Claude convention. \`<command-message>\` / \`<command-name>\` is the slash-command framing. The \`origin\` field on each prompt_frame says which is which — respect it. "You used Claude's agent-teams feature on N days" is correct; "you designed the teammate-message format" is wrong.

- **What IS the user's own harness:** user_authored_skills (anything not matching stock prefixes), skill_families (the cohesive toolchains they roll up to — e.g. "harness-*"), user_authored_subagents (Task subagent types not in the stock set — e.g. \`implement-teammate\`), and any custom slash commands (visible via prompt_frames[frame=slash-command] and the \`<command-name>\` content). When you describe their harness, name THESE.

- **handoff-prose is a personal compaction habit, NOT a standard pattern.** Treat it as "a recent personal habit you've adopted to break a long-running thread into multiple sessions." Don't elevate it to the same level as named working shapes. Don't recommend others copy it.

COMMUNICATION-STYLE RULES:

- The verbosity distribution + external_context_refs together describe how the user delegates. Many short prompts + many external refs = high delegation ("go look it up yourself"). Many very_long prompts + few external refs = high control ("here's everything you need, follow it"). Mixed is mixed; say so.

- Steering intensity is interrupts + frustrated + dissatisfied normalized against total_turns. Low steering on a high-output week = trust paid off. High steering on a low-output week = friction. High steering on a high-output week = micro-managed but successful — the user paid for output with attention.

- These dimensions belong in what_worked / what_stalled / what_surprised when the data shows something specific. Anchor to "communication_style.verbosity" / "communication_style.external_refs" / "communication_style.steering" as appropriate.

VOCABULARY RULES:

- The reader is a developer, not a parser-internals reader. Write like a coworker recapping the week.
- Don't use "flagged" as a verb. Flags aren't actors.
- Internal flag tokens (loop_suspected, long_autonomous, orchestrated, fast_ship, plan_used, interrupt_heavy, high_errors) are forbidden as nouns or subjects. Tokens MAY appear inside evidence.quote when the verbatim text used them.
- Working-shape names (spec-review-loop, chunk-implementation, etc.) ARE allowed and ENCOURAGED in prose — they're the named patterns the reader sees in the report's first section.
- Prefer naming the actual subagent type ("\`general-purpose\` dispatches", "\`superpowers:code-reviewer\`") over abstract "subagents" when the type is load-bearing.
- "Plan Mode" specifically refers to the canonical /plan tool. "spec-review subagents" is the user's actual planning approach when that's what the data shows.
`;

export const DIGEST_WEEK_SYSTEM_PROMPT = SYSTEM_PROMPT;

function prettyProject(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

const ALL_OUTCOMES: DayOutcome[] = ["shipped", "partial", "blocked", "exploratory", "trivial", "idle"];

/**
 * Builds the week-digest user prompt as a transcript-style markdown document
 * rather than a JSON object. Two reasons:
 *
 * 1. **Token efficiency.** JSON keys ("what_went_well", "shape_distribution",
 *    "user_authored_skills_used") are tokenized and repeated up to 7× across
 *    day_summaries. Markdown labels are written once with prose context.
 *    Empirically saves 25-35% on input tokens at no information loss.
 *
 * 2. **Anchoring still works.** The LLM's `evidence.quote` substring check
 *    runs against the assembled prompt text — verbatim phrases land just as
 *    cleanly in prose as they did in JSON.
 *
 * Trimmed vs the prior JSON payload (Task 2):
 *   - Dropped working_shapes[].sample_evidence.prompt_preview /
 *     subagent_description / first_user_preview (only consumed by the
 *     deleted PatternRollupsFold UI section). Shape NAMES + per-day
 *     occurrence counts + outcome_distribution stay — that's all the LLM
 *     needs to anchor what_worked claims.
 *   - Trimmed interaction_grammar to count summaries (specific skill names
 *     listed, but not every occurrence date / per-skill count breakdown).
 *   - Dropped flag_glossary entirely; the ANCHORING RULES already constrain
 *     the model and flags rarely make it into anchored findings anyway.
 *   - Dropped valid_anchors block; it's already enumerated in the system
 *     prompt's ANCHORING RULES section.
 */
export function buildWeekDigestUserPrompt(base: WeekDigest, dayDigests: DayDigest[]): string {
  const lines: string[] = [];
  const out = (s = "") => lines.push(s);

  const shippedByProject = new Map<string, Array<{ title: string; date: string }>>();
  for (const dd of dayDigests) {
    for (const s of dd.shipped) {
      const arr = shippedByProject.get(s.project) ?? [];
      arr.push({ title: s.title, date: dd.key });
      shippedByProject.set(s.project, arr);
    }
  }

  // ── Header ──────────────────────────────────────────────────────────────
  out(`# Week ${base.key} (${base.window.start} → ${base.window.end})`);
  out();
  out(`Total agent time: ${Math.round(base.agent_min_total)} min across ${dayDigests.length} day(s) with data.`);

  // Per-agent week breakdown — sum across day digests' agent_breakdown.
  // Surfaces fleet shape directly so the LLM can name Codex vs Claude Code
  // contributions without inferring from project paths.
  const weekAgent = new Map<string, { sessions: number; active_min: number; tools_total: number }>();
  for (const dd of dayDigests) {
    for (const row of dd.agent_breakdown ?? []) {
      const cur = weekAgent.get(row.agent) ?? { sessions: 0, active_min: 0, tools_total: 0 };
      cur.sessions += row.sessions;
      cur.active_min += row.active_min;
      cur.tools_total += row.tools_total;
      weekAgent.set(row.agent, cur);
    }
  }
  if (weekAgent.size > 0) {
    const rows = Array.from(weekAgent.entries())
      .sort((a, b) => b[1].active_min - a[1].active_min)
      .map(([agent, v]) =>
        `${agent}=${v.sessions} session${v.sessions === 1 ? "" : "s"}/${Math.round(v.active_min)}m active/${v.tools_total} tool calls`,
      )
      .join(", ");
    out(`Per-agent week breakdown: ${rows}.`);
  }

  const outcomeMix: Record<DayOutcome, number> = {
    shipped: 0, partial: 0, blocked: 0, exploratory: 0, trivial: 0, idle: 0,
  };
  for (const k of ALL_OUTCOMES) outcomeMix[k] = base.outcome_mix[k] ?? 0;
  const outcomeLine = ALL_OUTCOMES
    .filter(k => outcomeMix[k] > 0)
    .map(k => `${k}=${outcomeMix[k]}`)
    .join(", ");
  out(`Outcome mix: ${outcomeLine || "(empty)"}.`);
  out(`Helpfulness sparkline (Mon→Sun): ${base.helpfulness_sparkline.map(v => v ?? "·").join(" ")}`);
  if (base.concurrency_peak_day) {
    out(`Concurrency peak day: ${base.concurrency_peak_day}.`);
  }

  // ── Projects ────────────────────────────────────────────────────────────
  out();
  out(`## Projects (top by agent_min)`);
  for (const p of base.projects.slice(0, 8)) {
    const display = p.display_name ?? prettyProject(p.name);
    const titles = (shippedByProject.get(display) ?? []).slice(0, 8);
    const titlesLine = titles.length > 0
      ? titles.map(t => `    - "${t.title}" (${t.date})`).join("\n")
      : "    - (no PRs shipped)";
    out(`- ${display} — ${Math.round(p.agent_min)}m, ${Math.round(p.share_pct * 10) / 10}% share, ${p.shipped_count} PR${p.shipped_count === 1 ? "" : "s"}`);
    out(titlesLine);
  }

  // ── Top flags + goal categories (compact, single line each) ─────────────
  out();
  if (base.top_flags.length > 0) {
    out(`Top flags: ${base.top_flags.map(f => `${f.flag}(${f.count})`).join(", ")}`);
  }
  if (base.top_goal_categories.length > 0) {
    out(`Goal-category minutes: ${base.top_goal_categories.map(g => `${g.category}=${g.minutes}m`).join(", ")}`);
  }

  // ── Working shapes (names + per-day occurrence + outcome dist) ──────────
  out();
  out(`## Working shapes (deterministic, already classified)`);
  const shapes = base.working_shapes ?? [];
  if (shapes.length === 0) {
    out(`(none — no day reached the threshold for shape classification)`);
  } else {
    for (const row of shapes) {
      const days = [...new Set(row.occurrences.map(o => o.date))].sort();
      const outcomes = Object.entries(row.outcome_distribution ?? {})
        .filter(([, n]) => (n as number) > 0)
        .map(([k, n]) => `${k}:${n}`)
        .join(", ");
      out(`- ${row.shape} — ${row.occurrences.length} occurrence(s) on [${days.join(", ")}]${outcomes ? `; outcomes ${outcomes}` : ""}`);
    }
  }

  // ── Interaction grammar (compact summary) ───────────────────────────────
  out();
  out(`## Interaction grammar`);
  const ig = base.interaction_grammar;
  if (!ig) {
    out(`(none)`);
  } else {
    if (ig.brainstorming_warmup_days?.length) {
      out(`- Brainstorm-warmup days (${ig.brainstorming_warmup_days.length}): ${ig.brainstorming_warmup_days.join(", ")}`);
    }
    if (ig.prompt_frames?.length) {
      const frames = ig.prompt_frames.map(f => `${f.frame}(${f.origin})×${f.count}`).join(", ");
      out(`- Prompt frames: ${frames}`);
    }
    if (ig.user_authored_skills?.length) {
      const skills = ig.user_authored_skills.map(s => `${s.skill}×${s.count}`).join(", ");
      out(`- User-authored skills: ${skills}`);
    }
    if (ig.skill_families?.length) {
      const families = ig.skill_families.map(f => `${f.family}(${f.members.length} members, ${f.total_count} uses)`).join(", ");
      out(`- Skill families: ${families}`);
    }
    if (ig.user_authored_subagents?.length) {
      const subs = ig.user_authored_subagents.map(sa => `${sa.type}×${sa.count}`).join(", ");
      out(`- User-authored subagent types: ${subs}`);
    }
    if (ig.threads?.length) {
      out(`- Multi-day threads: ${ig.threads.length} (total ${ig.threads.reduce((a, t) => a + t.total_active_min, 0)}m active)`);
    }
    const cs = ig.communication_style;
    if (cs) {
      const v = cs.verbosity_distribution;
      out(`- Verbosity: short=${v.short}, medium=${v.medium}, long=${v.long}, very_long=${v.very_long}`);
      const refs = cs.external_context_refs;
      if (refs.length) {
        out(`- External-ref openings (${refs.length}): ${refs.slice(0, 5).map(r => `${r.ref_kind}@${r.date}`).join(", ")}`);
      }
      const st = cs.steering;
      out(`- Steering: ${st.total_interrupts} interrupts, ${st.total_frustrated} frustrated, ${st.total_dissatisfied} dissatisfied, ${st.sessions_with_mid_run_redirect} mid-run redirects, across ${st.total_turns} turns`);
    }
    out(`- TodoWrite ops total: ${ig.todo_ops_total}`);
    if (ig.plan_mode) {
      out(`- Plan Mode: ${ig.plan_mode.exit_plan_calls} exit_plan calls, ${ig.plan_mode.days_with_plan} day(s) with plan use`);
    }
  }

  // ── Day summaries (the heart of the prompt) ─────────────────────────────
  const daySummaries = dayDigests
    .slice()
    .sort((a, b) => a.key.localeCompare(b.key));
  out();
  out(`## Day summaries`);
  for (const d of daySummaries) {
    out();
    const flagsLine = d.top_flags.slice(0, 5).map(f => `${f.flag}(${f.count})`).join(", ");
    const dayShape = d.day_signals?.dominant_shape ?? null;
    const headerExtra = dayShape ? ` · shape: ${dayShape}` : "";
    out(`### ${dayName(d.key)} ${d.key} — ${Math.round(d.agent_min)}m active · outcome: ${d.outcome_day}${headerExtra}`);
    if (d.agent_breakdown && d.agent_breakdown.length > 1) {
      const ab = d.agent_breakdown
        .map((r) => `${r.agent}=${r.sessions}/${Math.round(r.active_min)}m`)
        .join(", ");
      out(`Agent breakdown: ${ab}`);
    }
    if (d.headline) out(`Headline: ${d.headline}`);
    if (d.day_signature) out(`Signature: ${d.day_signature}`);
    if (d.what_went_well) out(`Went well: ${d.what_went_well}`);
    if (d.what_hit_friction) out(`Hit friction: ${d.what_hit_friction}`);
    if (d.suggestion) out(`Suggestion: ${d.suggestion.headline} — ${d.suggestion.body}`);
    if (flagsLine) out(`Flags: ${flagsLine}`);
    if (d.helpfulness_day !== null && d.helpfulness_day !== undefined) {
      out(`Helpfulness: ${d.helpfulness_day}`);
    }

    // Day-signals one-liner — flat, dense, every key the LLM might anchor
    // against ("day_signals.<key>") still cited by name.
    const sig = d.day_signals;
    if (sig) {
      const dist = Object.entries(sig.shape_distribution ?? {})
        .filter(([, n]) => (n as number) > 0)
        .map(([k, n]) => `${k}:${n}`)
        .join(", ");
      if (dist) out(`Shape distribution: ${dist}`);
      if (sig.skills_loaded.length) {
        const skills = sig.skills_loaded.slice(0, 6)
          .map(s => `${s.skill}(${s.origin})${s.count > 1 ? `×${s.count}` : ""}`)
          .join(", ");
        out(`Skills loaded: ${skills}`);
      }
      if (sig.user_authored_subagents_used.length) {
        const subs = sig.user_authored_subagents_used.slice(0, 4)
          .map(sa => `${sa.type}${sa.count > 1 ? `×${sa.count}` : ""}`)
          .join(", ");
        out(`User-authored subagents: ${subs}`);
      }
      if (sig.prompt_frames.length) {
        const frames = sig.prompt_frames
          .map(f => `${f.frame}(${f.origin})${f.count > 1 ? `×${f.count}` : ""}`)
          .join(", ");
        out(`Prompt frames: ${frames}`);
      }
      const cv = sig.comm_style.verbosity_distribution;
      out(`Verbosity: short=${cv.short}, medium=${cv.medium}, long=${cv.long}, very_long=${cv.very_long}`);
      const cst = sig.comm_style.steering;
      out(`Steering: ${cst.interrupts} interrupts, ${cst.frustrated} frustrated, ${cst.dissatisfied} dissatisfied, ${cst.sessions_with_mid_run_redirect} mid-run redirects`);
      if (sig.brainstorm_warmup_session_count > 0) {
        out(`Brainstorm-warmup sessions: ${sig.brainstorm_warmup_session_count}`);
      }
      if (sig.plan_mode_used) out(`Plan Mode: used`);
      if (sig.todo_ops_total > 0) out(`TodoWrite ops: ${sig.todo_ops_total}`);
    }
  }

  return lines.join("\n");
}

// Re-export to satisfy unused-name lint if a future caller wants the canonical
// list of WORKING_SHAPES (still referenced indirectly via the system prompt).
void WORKING_SHAPES;

function dayName(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short" });
}
