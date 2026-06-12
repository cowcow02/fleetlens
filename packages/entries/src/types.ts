import type { AgentKind } from "@claude-lens/parser";

/** Schema version. Bump to trigger background regeneration. */
export const CURRENT_ENTRY_SCHEMA_VERSION = 2 as const;

/** Fixed goal-category taxonomy. */
export const GOAL_CATEGORIES = [
  "build", "plan", "debug", "review", "steer", "meta",
  "research", "refactor", "test", "release", "warmup_minimal",
] as const;
export type GoalCategory = typeof GOAL_CATEGORIES[number];

export type EntryEnrichmentStatus = "pending" | "skipped_trivial" | "done" | "error";

export type EntryEnrichment = {
  status: EntryEnrichmentStatus;
  generated_at: string | null;
  model: string | null;
  cost_usd: number | null;
  error: string | null;
  brief_summary: string | null;
  underlying_goal: string | null;
  friction_detail: string | null;
  user_instructions: string[];
  outcome: "shipped" | "partial" | "exploratory" | "blocked" | "trivial" | null;
  claude_helpfulness: "essential" | "helpful" | "neutral" | "unhelpful" | null;
  /** VALUES ARE MINUTES spent on the goal within this (session × day) slice.
   *  Sum across goals MUST be ≤ numbers.active_min. Unclassified time stays implicit. */
  goal_categories: Partial<Record<GoalCategory, number>>;
  /** Bounded retry counter — prevents a permanently-failing Entry from looping
   *  forever across daemon restarts. Frozen at status="error" + retry_count>=3;
   *  only `fleetlens entries regenerate --force` resets it. Starts at 0. */
  retry_count: number;
};

export type EntrySubagent = {
  type: string;
  description: string;
  background: boolean;
  prompt_preview: string;
};

/** External-system reference kinds detected in first_user. */
export type ExternalRefKind = "linear-kip" | "github-issue-pr" | "branch-ref" | "url";

/** Deterministic per-Entry classification — computed at Entry-build time. */
export type EntrySignals = {
  /** Session shape inferred from subagent dispatches + first_user + skills.
   *  Null when too small to characterize. */
  working_shape: WorkingShape;
  /** Prompt frames detected on first_user. */
  prompt_frames: PromptFrame[];
  /** Role per dispatched subagent, parallel index to entry.subagents[]. */
  subagent_roles: SubagentRole[];
  /** Length bucket of first_user. */
  verbosity: "short" | "medium" | "long" | "very_long";
  /** External-system references parsed out of first_user. */
  external_refs: Array<{ kind: ExternalRefKind; preview: string }>;
  /** Did this session open with a brainstorming/writing-plans skill load? */
  brainstorm_warmup: boolean;
  /** Was this session a continuation? */
  continuation_kind: "none" | "literal-continue" | "handoff-prose";
};

export type Entry = {
  version: typeof CURRENT_ENTRY_SCHEMA_VERSION;
  /** Source coding-agent that produced this session. Absent on entries
   *  written before multi-agent support — readers MUST treat undefined
   *  as "claude-code". Used by digest prompts to surface per-agent
   *  contributions in the synthesized narrative. */
  agent?: AgentKind;
  session_id: string;
  /** "YYYY-MM-DD" in reader's TZ */
  local_day: string;
  /** canonical (worktrees rolled up) */
  project: string;
  start_iso: string;
  end_iso: string;
  numbers: {
    active_min: number;
    turn_count: number;
    tools_total: number;
    subagent_calls: number;
    skill_calls: number;
    task_ops: number;
    interrupts: number;
    tool_errors: number;
    consec_same_tool_max: number;
    exit_plan_calls: number;
    prs: number;
    commits: number;
    pushes: number;
    tokens_total: number;
  };
  flags: string[];
  primary_model: string | null;
  model_mix: Record<string, number>;
  first_user: string;
  final_agent: string;
  pr_titles: string[];
  /** owner/name identities harvested from git-push / gh-pr tool output —
   *  which GitHub repos this day's work actually touched. Absent on entries
   *  built before this field existed and on days with no push/PR. */
  github_repos?: string[];
  top_tools: string[];
  skills: Record<string, number>;
  subagents: EntrySubagent[];
  satisfaction_signals: {
    happy: number;
    satisfied: number;
    dissatisfied: number;
    frustrated: number;
  };
  user_input_sources: {
    human: number;
    teammate: number;
    skill_load: number;
    slash_command: number;
    /** Optional for backward compat with cached pre-fix entries. */
    system_instruction?: number;
  };
  /** Always an object, never null. */
  enrichment: EntryEnrichment;
  /** Deterministic classification — populated at build time. Optional for
   *  backward compat with cached pre-refactor entries; consumers fall back
   *  to on-the-fly computeEntrySignals when absent. */
  signals?: EntrySignals;
  generated_at: string;
  source_jsonl: string;
  /** Provenance-only — not used for rendering. */
  source_checkpoint: {
    byte_offset: number;
    last_event_ts: string | null;
  };
};

/** Initial enrichment value — always an object, never null. */
export function pendingEnrichment(): EntryEnrichment {
  return {
    status: "pending",
    generated_at: null,
    model: null,
    cost_usd: null,
    error: null,
    brief_summary: null,
    underlying_goal: null,
    friction_detail: null,
    user_instructions: [],
    outcome: null,
    claude_helpfulness: null,
    goal_categories: {},
    retry_count: 0,
  };
}

/** Skipped-trivial enrichment value. */
export function skippedTrivialEnrichment(generatedAt: string): EntryEnrichment {
  return {
    status: "skipped_trivial",
    generated_at: generatedAt,
    model: null,
    cost_usd: null,
    error: null,
    brief_summary: null,
    underlying_goal: null,
    friction_detail: null,
    user_instructions: [],
    outcome: "trivial",
    claude_helpfulness: null,
    goal_categories: {},
    retry_count: 0,
  };
}

/** Compose the storage filename key for an Entry. */
export function entryKey(sessionId: string, localDay: string): string {
  return `${sessionId}__${localDay}`;
}

/** Parse a storage filename back to (session_id, local_day). */
export function parseEntryKey(key: string): { session_id: string; local_day: string } | null {
  const m = /^([^_]+(?:_[^_]+)*)__(\d{4}-\d{2}-\d{2})$/.exec(key);
  if (!m) return null;
  return { session_id: m[1]!, local_day: m[2]! };
}

// ─────────────────────────────────────────────────────────────────────────
// Digest types (Phase 2: day; Phase 4: week + month)
// ─────────────────────────────────────────────────────────────────────────

/** Schema version for day digests. */
export const CURRENT_DAY_DIGEST_SCHEMA_VERSION = 2 as const;
/** Schema version for week digests (Phase 4). */
export const CURRENT_WEEK_DIGEST_SCHEMA_VERSION = 2 as const;
/** Schema version for month digests (Phase 4). */
export const CURRENT_MONTH_DIGEST_SCHEMA_VERSION = 2 as const;

/** Scope-agnostic envelope. Each scope-specific type owns its leaf-reference array
 *  (DayDigest.entry_refs, WeekDigest.day_refs, MonthDigest.week_refs). */
export type DigestEnvelope = {
  version: 2;
  scope: "day" | "week" | "month" | "project" | "session";
  /** Scope-specific identifier. day: YYYY-MM-DD; week: ISO Monday YYYY-MM-DD; month: YYYY-MM. */
  key: string;
  window: { start: string; end: string };
  generated_at: string;
  is_live: boolean;
  model: string | null;
  cost_usd: number | null;
};

/** Day-level outcome rollup (derived deterministically from per-entry outcomes).
 *  Priority order: shipped > partial > blocked > exploratory > trivial > idle.
 *  `idle` only if zero entries (shouldn't happen in a rendered digest). */
export type DayOutcome = "shipped" | "partial" | "blocked" | "exploratory" | "trivial" | "idle";

/** Day-level helpfulness rollup (mode of entry claude_helpfulness).
 *  Tie-broken toward the worse signal (unhelpful beats neutral beats helpful beats essential)
 *  so a weekly digest can spot regressions early. `null` if no entries are enriched. */
export type DayHelpfulness = "essential" | "helpful" | "neutral" | "unhelpful" | null;

/** Deterministic per-day classification — aggregated from Entry.signals. */
export type DaySignals = {
  /** Dominant shape across the day, weighted by active_min. "mixed" when no
   *  single shape exceeds 60% of the day's active_min. null on trivial days. */
  dominant_shape: NonNullable<WorkingShape> | "mixed" | null;
  /** Per-shape session count for the day. */
  shape_distribution: Partial<Record<NonNullable<WorkingShape>, number>>;

  /** Skills loaded today, with origin classification. */
  skills_loaded: Array<{ skill: string; origin: SkillOrigin; count: number }>;
  /** User-authored skill names (bare); the week aggregates families. */
  user_authored_skills_used: string[];
  /** User-authored Task subagent types dispatched today, with sample evidence. */
  user_authored_subagents_used: Array<{
    type: string;
    count: number;
    sample_description: string;
    sample_prompt_preview: string;
  }>;

  /** Prompt frames detected today, with origin labels. */
  prompt_frames: Array<{
    frame: PromptFrame;
    origin: "claude-feature" | "personal-habit";
    count: number;
  }>;

  /** Communication style for the day. */
  comm_style: {
    verbosity_distribution: { short: number; medium: number; long: number; very_long: number };
    external_refs: Array<{ session_id: string; kind: ExternalRefKind; preview: string }>;
    steering: {
      interrupts: number;
      frustrated: number;
      dissatisfied: number;
      sessions_with_mid_run_redirect: number;
    };
  };

  /** Number of sessions that opened with a brainstorming/writing-plans skill. */
  brainstorm_warmup_session_count: number;
  todo_ops_total: number;
  /** Any entry today had exit_plan_calls > 0 or plan_used flag. */
  plan_mode_used: boolean;
};

export type DayDigest = DigestEnvelope & {
  scope: "day";
  /** "{session_id}__{YYYY-MM-DD}" keys of contributing entries. */
  entry_refs: string[];

  // Deterministic aggregations (computed from Entries, not LLM output)
  projects: Array<{ name: string; display_name: string; share_pct: number; entry_count: number }>;
  shipped: Array<{ title: string; project: string; session_id: string }>;
  top_flags: Array<{ flag: string; count: number }>;
  /** Top 5 goal categories, values in MINUTES (matches Entry enrichment.goal_categories). */
  top_goal_categories: Array<{ category: string; minutes: number }>;
  concurrency_peak: number;
  agent_min: number;
  /** Per-source-agent (claude-code, codex, …) breakdown of today's work.
   *  Optional for backward-compat with pre-multi-agent cached digests;
   *  absent === single-agent ("claude-code"). Used by the week digest
   *  to surface fleet-shape signals in the synthesized narrative. */
  agent_breakdown?: Array<{
    agent: string;
    sessions: number;
    active_min: number;
    tools_total: number;
  }>;
  /** Day-level outcome derived from per-entry outcomes. Phase 2.1 — feeds weekly aggregation. */
  outcome_day: DayOutcome;
  /** Day-level helpfulness signal — mode across enriched entries. Phase 2.1 — feeds weekly trajectory. */
  helpfulness_day: DayHelpfulness;
  /** Deterministic per-day classification. Optional for backward compat with
   *  cached pre-refactor digests; week aggregation falls back to on-the-fly
   *  computation from entries when absent. */
  day_signals?: DaySignals;

  // LLM narrative (null when ai_features.enabled === false or synth failed)
  headline: string | null;
  narrative: string | null;
  what_went_well: string | null;
  what_hit_friction: string | null;
  suggestion: { headline: string; body: string } | null;
  /** One LLM-produced sentence (≤120 chars) characterizing today's shape —
   *  quotable verbatim by the week digest. Optional for backward compat;
   *  null when ai_features.enabled === false, synth declined, or
   *  day_signals.dominant_shape is null (trivial day). */
  day_signature?: string | null;
};

// ─────────────────────────────────────────────────────────────────────────
// Week digest (Phase 4) — synthesizes 7 day digests into a weekly story.
// ─────────────────────────────────────────────────────────────────────────

/** Project-area entry with optional LLM-written description of what was built. */
export type WeekProjectArea = {
  name: string;
  display_name: string;
  agent_min: number;
  share_pct: number;
  shipped_count: number;
  /** 1–2 sentence summary of what was built in this project this week. LLM-generated. */
  description: string | null;
};

/** A single friction example, anchored to a specific day so the renderer can
 *  link to /digest/[date] and show the verbatim quote that motivated it. */
export type WeekFrictionExample = {
  date: string;
  /** Verbatim from that day's `what_hit_friction` (or first-user / final-agent). */
  quote: string;
};

/** Categorized friction with grounded, dated examples (1–3 each). */
export type WeekFrictionCategory = {
  category: string;
  description: string;
  examples: WeekFrictionExample[];
};

/** Add to CLAUDE.md to encode a recurring guardrail. */
export type WeekClaudeMdAddition = {
  addition: string;
  why: string;
  /** Where in CLAUDE.md to put it. */
  prompt_scaffold: string;
};

/** Surface a Claude Code feature the user isn't yet leaning on. */
export type WeekFeatureToTry = {
  feature: string;
  one_liner: string;
  why_for_you: string;
  example_code: string;
};

/** A reusable usage pattern with a copyable prompt. */
export type WeekUsagePattern = {
  title: string;
  suggestion: string;
  detail: string;
  copyable_prompt: string;
};

/** A forward-looking opportunity grounded in THIS week's data. Must name the
 *  friction_category it would eliminate, so the suggestion is provably tied
 *  to the week's actual pattern rather than a generic essay. */
export type WeekHorizonOpportunity = {
  title: string;
  whats_possible: string;
  how_to_try: string;
  copyable_prompt: string;
  /** Exact `category` string from one of `friction_categories[].category`. */
  friction_category_addressed: string;
};

/** Named orchestration patterns — the primary unit of how the user drove
 *  agents this week. Each entry's session is classified into one shape based
 *  on subagent dispatches, skills, and first_user. */
export type WorkingShape =
  | "spec-review-loop"
  | "chunk-implementation"
  | "research-then-build"
  | "reviewer-triad"
  | "background-coordinated"
  | "solo-continuation"
  | "solo-design"
  | "solo-build"
  | null;

/** Role inferred from a subagent's description + prompt_preview. */
export type SubagentRole =
  | "reviewer"
  | "implementer"
  | "explorer"
  | "researcher"
  | "env-setup"
  | "polish"
  | "other";

/** Prompt-framing patterns observed in first_user. Two origins:
 *  - "claude-feature": framings emitted by Claude Code itself (teammate from
 *    agent teams, task-notification from the Monitor tool, local-command-caveat
 *    from local command output, image-attached from screenshot input,
 *    slash-command from a custom or stock /command).
 *  - "personal-habit": framings the user himself adopts as a working
 *    convention (handoff-prose for cross-session compaction). These aren't
 *    standard patterns — just observed habits worth surfacing. */
export type PromptFrame =
  | "teammate"
  | "task-notification"
  | "local-command-caveat"
  | "image-attached"
  | "slash-command"
  | "handoff-prose";

export const PROMPT_FRAME_ORIGIN: Record<PromptFrame, "claude-feature" | "personal-habit"> = {
  teammate: "claude-feature",
  "task-notification": "claude-feature",
  "local-command-caveat": "claude-feature",
  "image-attached": "claude-feature",
  "slash-command": "claude-feature",
  "handoff-prose": "personal-habit",
};

/** Skill origin — distinguishes user-authored skills (project-local) from
 *  stock superpowers / mcp tooling. */
export type SkillOrigin = "stock" | "user" | "infra";

/** Per-shape rollup with named occurrences and outcome distribution. */
export type WeekWorkingShapeRow = {
  shape: NonNullable<WorkingShape>;
  occurrences: Array<{
    date: string;
    session_id: string;
    project_display: string;
    outcome: DayOutcome | null;
    helpfulness: DayHelpfulness;
    /** A representative subagent dispatch for this shape's evidence. null
     *  for solo shapes or when day-level data is the only source. */
    evidence_subagent: { type: string; description: string; prompt_preview: string } | null;
    /** Truncated first_user for solo shapes or as supporting context. */
    evidence_first_user: string | null;
    /** Day-level signature line (LLM-produced) — replaces subagent prompt as
     *  the primary evidence in the new day-first pattern detection.
     *  Optional for backward compat with cached pre-refactor week digests. */
    day_signature?: string | null;
  }>;
  outcome_distribution: Partial<Record<DayOutcome, number>>;
};

export type WeekInteractionGrammar = {
  /** Days where superpowers:brainstorming or other planning skills loaded
   *  before any tool use — pattern-matching for "warmup ritual". */
  brainstorming_warmup_days: string[];
  /** Prompt-frames detected across the week's first_user fields. Carries
   *  origin so the report distinguishes Claude features the user employs
   *  from personal habits the user has adopted. */
  prompt_frames: Array<{
    frame: PromptFrame;
    origin: "claude-feature" | "personal-habit";
    count: number;
    days: string[];
  }>;
  /** Skills not matching stock prefixes — likely user-authored project skills. */
  user_authored_skills: Array<{ skill: string; count: number; days: string[] }>;
  /** User-authored skills rolled up by their prefix-before-`-`. Surfaces
   *  cohesive toolchains (e.g. "harness" family covering harness-build,
   *  harness-build-pickup, harness-orchestrate-analyze, etc.) rather than
   *  individual skills. */
  skill_families: Array<{
    family: string;
    members: string[];
    total_count: number;
    days: string[];
  }>;
  /** Subagent types not in the stock list — e.g. user-built `implement-teammate`.
   *  Highlights the user's own subagent layer separately from stock dispatches. */
  user_authored_subagents: Array<{
    type: string;
    count: number;
    days: string[];
    sample_description: string;
    sample_prompt_preview: string;
  }>;
  /** Multi-day session continuity — session_ids whose entries span > 1 day,
   *  or sequential entries linked by handoff-prose continuation. */
  threads: Array<{
    thread_id: string;
    entries: Array<{ date: string; session_id: string; project_display: string; has_handoff_frame: boolean }>;
    total_active_min: number;
    outcome: DayOutcome | null;
  }>;
  /** Communication-style indicators — how the user provides context per
   *  directive (verbosity, reliance on external refs) and how much steering
   *  happens during execution (interrupts, dissatisfied/frustrated signals,
   *  mid-run redirects). The narrative LLM uses these as anchors to tell
   *  the reader whether they're delegating, micro-managing, or somewhere
   *  in between. */
  communication_style: {
    /** Histogram of first_user prompt lengths in chars. */
    verbosity_distribution: {
      short: number;        // < 100 chars
      medium: number;       // 100–500
      long: number;         // 500–2000
      very_long: number;    // > 2000
    };
    /** Sessions whose first_user references an external system rather than
     *  spelling out the work — Linear KIP-N, GitHub #N, branch refs, URLs.
     *  High count = high delegation ("go look it up yourself"). */
    external_context_refs: Array<{
      date: string;
      session_id: string;
      ref_kind: "linear-kip" | "github-issue-pr" | "branch-ref" | "url";
      preview: string;
    }>;
    /** Steering intensity — corrections during execution. */
    steering: {
      total_interrupts: number;
      total_frustrated: number;
      total_dissatisfied: number;
      sessions_with_mid_run_redirect: number;   // entries with interrupts >= 2
      total_turns: number;                       // for normalization
    };
  };
  todo_ops_total: number;
  plan_mode: { exit_plan_calls: number; days_with_plan: number };
};

/** Each narrative finding cites the working_shape (or grammar element) it
 *  came from. The prompt's spine: no shape-anchor, no card. */
export type WeekFinding = {
  title: string;
  detail: string;
  /** Either a WorkingShape ("spec-review-loop"), a grammar key
   *  ("interaction_grammar.brainstorming_warmup_days"), or "plan-mode-gap". */
  anchor: string;
  evidence: { date: string; quote: string };
};

export type WeekSurprise = WeekFinding & {
  surprise_kind: "outlier" | "novel-use" | "user-built-tool" | "cross-week-contrast";
};

export type WeekLeanIn = WeekFinding & {
  lean_kind: "claude-md" | "skill" | "hook" | "harness" | "decision";
  /** A copyable prompt or rule block when applicable. */
  copyable: string | null;
};

/** LEGACY — kept on the type for backward compat with cached v2 digests
 *  generated before the working_shapes refactor. New digests don't populate
 *  these; the renderer hides them when working_shapes is present. */
export type WeekRecurringThemeLegacy = {
  theme: string;
  days: string[];
  evidence: string;
  source: "suggestion" | "friction" | "helpfulness_dip" | "flag_pattern";
};

/** Deterministic snapshot of how the user drove agents this week. Kept
 *  alongside working_shapes as the "by the numbers" fold-down — counts and
 *  bands without the qualitative texture.
 *
 *  Fully computed from per-Entry data (subagents/skills/numbers/flags). Null
 *  on the deterministic-only path when entries weren't loaded. */
export type WeekInteractionModes = {
  /** Subagent dispatching + TodoWrite usage. Captures whether the user
   *  orchestrates Claude or drives single-agent. */
  orchestration: {
    subagent_calls: number;
    task_ops: number;
    /** Days with at least one subagent dispatch (0–7). */
    days_with_subagents: number;
    /** Top subagent types invoked, ordered by count, capped at 5. */
    top_types: Array<{ type: string; count: number }>;
    /** Up to 3 illustrative dispatches with prompt_preview text — gives the
     *  reader a sense of what kind of work was orchestrated. */
    examples: Array<{
      date: string;
      project_display: string;
      type: string;
      prompt_preview: string;
    }>;
  };
  /** Skill / slash-command driven workflows. */
  skill_use: {
    skill_calls: number;
    /** Days with at least one skill load (0–7). */
    days_with_skills: number;
    /** Top skills loaded, ordered by count, capped at 5. */
    top_skills: Array<{ skill: string; count: number }>;
    /** Up to 3 illustrative skill loads paired with the first_user text from
     *  the entry that loaded them — shows what the user reached for the
     *  skill *for*, not just which ones got loaded. */
    examples: Array<{
      date: string;
      skill: string;
      first_user_preview: string;
    }>;
  };
  /** Plan Mode discipline — exit_plan tool calls + days with the plan_used flag. */
  plan_gating: {
    exit_plan_calls: number;
    /** Days with at least one exit_plan or plan_used flag (0–7). */
    days_with_plan: number;
  };
  /** Turn shape — rapid back-and-forth vs big-batch autonomous turns. */
  turn_shape: {
    /** Total tool calls divided by total turns across the week. Higher = more
     *  tools per turn = bigger autonomous batches. */
    tools_per_turn: number;
    /** Total user interrupts across the week. */
    interrupts: number;
    /** Days where the long_autonomous flag fired (0–7). */
    long_autonomous_days: number;
    /** Bucket label for quick UI rendering. */
    label: "rapid" | "mixed" | "batch";
    /** The single most-illustrative long-autonomous turn this week — the entry
     *  that fired long_autonomous with the highest active_min. Shows the
     *  reader the texture of the longest unbroken push. null when no such
     *  turn fired. */
    longest_turn: {
      date: string;
      project_display: string;
      active_min: number;
      top_tools: string[];
      first_user_preview: string;
    } | null;
  };
};

/** A signal that appeared on multiple days. Surfaces patterns the per-day
 *  digests already named — the week digest's job is to count + frame. */
export type WeekRecurringTheme = {
  /** Short label written in plain English. Never name a raw flag token here.
   *  E.g. "checkpoint after each phase" or "long sessions on Tue + Wed". */
  theme: string;
  /** Dates where this theme appeared. ≥ 2 dates required (otherwise it's not recurring). */
  days: string[];
  /** 1–2 sentences naming what the days share + why it deserves attention. */
  evidence: string;
  /** "suggestion": the same day-level suggestion text repeated.
   *  "friction": the same actual user-facing friction (from what_hit_friction) recurred.
   *  "helpfulness_dip": helpfulness regressed below the week's median.
   *  "flag_pattern": a deterministic flag fired on multiple days — informative
   *    *shape* of work, not friction. Use this (not "friction") for flags
   *    like loop_suspected / long_autonomous / orchestrated. */
  source: "suggestion" | "friction" | "helpfulness_dip" | "flag_pattern";
};

/** A cross-day pattern claim that requires both per-day rollups AND aggregate flags
 *  to surface — the kind of observation only a perception-layer week digest can make. */
export type WeekOutcomeCorrelation = {
  /** 1–2 sentences. Concrete claim grounded in named dates + flag/outcome data. */
  claim: string;
  /** Dates that support the claim. Renderer turns these into chips → /digest/[date]. */
  supporting_dates: string[];
};

/** A single annotated moment on a session timeline. Pin kinds map to the
 *  detection rules in top-sessions.ts. */
export type SessionPinKind =
  | "user-steering"
  | "subagent-burst"
  | "long-autonomous"
  | "plan-mode"
  | "pr-ship"
  | "harness-chain"
  | "interrupt"
  | "brainstorm-loop"
  | "agent-loop";

export type SessionPin = {
  /** Minutes from session start when the moment begins. */
  start_min: number;
  /** Optional — for span pins (long-autonomous, brainstorm-loop). */
  end_min?: number;
  kind: SessionPinKind;
  /** LLM-produced editorial sentence, ≤120 chars, second-person. */
  label: string;
};

/** A picked session worth a deep timeline view in the week digest. Replaces
 *  abstract working_shapes/interaction_grammar narrative with a concrete
 *  per-session story grounded in the actual transcript. */
export type WeekTopSession = {
  session_id: string;
  /** Source coding-agent. Lets the per-session card show an agent badge so
   *  a Codex top-session is visibly distinct from a Claude Code one. */
  agent?: AgentKind;
  /** Local day this session is anchored to (the entry's local_day). */
  date: string;
  project: string;
  project_display: string;

  // ── Timing ──
  start_iso: string;
  /** Wall-clock duration in minutes (end - start). */
  wall_min: number;
  /** Gap-filtered active duration (3-min idle threshold). */
  active_min: number;
  /** wall_min - active_min. Visible on the minimap as gap segments. */
  idle_min: number;
  turn_count: number;

  // ── Outcome + classification (pre-existing signals) ──
  outcome: DayOutcome | null;
  shipped_prs: string[];
  working_shape: NonNullable<WorkingShape> | null;
  /** Quoted from the day digest. Optional — null when the day didn't ship one. */
  day_signature: string | null;

  // ── Harness signature (deterministic blend — folded in from former
  //    interaction_grammar section) ──
  user_authored_skills: string[];
  user_authored_subagents: Array<{ type: string; count: number }>;
  stock_skills: string[];
  /** Top tools by use, with Bash sub-verbs ("Bash×33 (docker×19, ./compose.sh×5)"). */
  top_tools: string[];

  // ── Steering snapshot (deterministic) ──
  steering: {
    user_msg_count: number;
    long_user_msg_count: number;       // ≥800 chars
    median_user_msg_chars: number;
    interrupts: number;
  };

  // ── Timeline minimap data ──
  timeline: {
    /** Wall-clock span from first to last event, in minutes. This is the
     *  minimap's x-axis denominator. active_intervals carry wall-clock
     *  offsets so they must be scaled against wall_min, not active_min,
     *  otherwise intervals past the active budget get clipped invisibly. */
    duration_min: number;
    active_intervals: Array<{ start_min: number; end_min: number }>;
  };

  // ── LLM-produced narrative ──
  /** "What happened" — 1-2 sentences tying the pins into a story.
   *  Null if synth declined. (Field name kept for backward compat with
   *  cached digests; rendered as the "What happened" section.) */
  session_summary: string | null;
  /** 1 sentence on steering style — verbosity, framing, mid-flight redirects. */
  steering_summary: string | null;
  /** "Why this session" — 1 sentence on what made this session worth a deep
   *  look in the week's context (PR count, autonomous spans, harness chain,
   *  etc.). Optional for backward compat with cached digests. */
  why_picked?: string | null;
  /** Strongest positive signal in this session — 1 sentence. Null when the
   *  session was friction-dominated. Optional for backward compat. */
  what_worked?: string | null;
  /** Most load-bearing friction in this session — 1 sentence. Null when the
   *  session was smooth. Optional for backward compat. */
  what_hit_friction?: string | null;
  pins: SessionPin[];
};

export type WeekDigest = DigestEnvelope & {
  scope: "week";
  /** ISO Monday in server local TZ, e.g. "2026-04-20" — same value as envelope.key. */
  day_refs: string[];

  // ── Deterministic aggregations (computed from day digests) ──
  agent_min_total: number;
  /** Per-project rollup. `description` is filled by the LLM during synth; null until then. */
  projects: WeekProjectArea[];
  shipped: Array<{ title: string; project: string; date: string; session_id: string }>;
  /** Counts of days bucketed by their day-level outcome. Days with no entries are absent. */
  outcome_mix: Partial<Record<DayOutcome, number>>;
  /** 7 entries Mon→Sun. null where no enriched data exists for that day. */
  helpfulness_sparkline: DayHelpfulness[];
  top_flags: Array<{ flag: string; count: number }>;
  top_goal_categories: Array<{ category: string; minutes: number }>;
  /** The day during the week with the highest concurrency_peak. null if all days had peak 0. */
  concurrency_peak_day: { date: string; peak: number } | null;
  /** Per-day strip used for the time-and-shape visualization at the top of the report.
   *  Entries are dates with non-zero data, in chronological order. */
  days_active: Array<{
    date: string;
    agent_min: number;
    shipped_count: number;
    outcome_day: DayOutcome;
    helpfulness_day: DayHelpfulness;
    /** Optional — present when the day's DayDigest carries day_signals.
     *  Drives the per-day shape stripe on DaysActiveBars. */
    dominant_shape?: NonNullable<WorkingShape> | "mixed" | null;
  }>;
  /** The single day with the most agent-min. null if zero active days. */
  busiest_day: { date: string; agent_min: number; shipped_count: number } | null;
  /** The single longest contiguous entry across the week — points to a real session.
   *  Computed from entries (not day digests), so requires the pipeline to have loaded
   *  entry data; null on the deterministic-only path or when no entries exist. */
  longest_run: {
    session_id: string;
    date: string;
    /** display_name of the project this run sat under. */
    project_display: string;
    active_min: number;
  } | null;
  /** Minutes of activity per hour-of-day (0–23) summed across the week, in server local TZ.
   *  Each entry's active_min is attributed to its start_iso hour bucket. Length always 24. */
  hours_distribution: number[];

  /** "By the numbers" — count snapshot kept for the fold-down. Working shapes
   *  carry the qualitative texture; this is for the user who wants raw counts.
   *  Computed from per-Entry data; null on the deterministic-only path when
   *  entries weren't loaded. */
  interaction_modes: WeekInteractionModes | null;

  /** Named orchestration shapes observed across the week's sessions. Primary
   *  surface for "How you worked" — replaces the numeric mode-card grid as the
   *  reader's first qualitative anchor. */
  working_shapes: WeekWorkingShapeRow[] | null;

  /** The user's custom prompt-framings, ritual skills, harness handoffs,
   *  multi-day threads. Surfaces meta-tools the user has built around stock
   *  Claude Code that the count layer can't see. */
  interaction_grammar: WeekInteractionGrammar | null;

  /** 1–3 sessions picked as the most worthy to dive into, each with a
   *  per-session story, timeline minimap, and pin annotations.
   *  Optional — added in the day-first refactor. Null on legacy digests. */
  top_sessions?: WeekTopSession[];

  // ── LLM narrative (null when ai_features.enabled === false or synth failed) ──

  /** Concrete claim grounded in the data; second-person; ≤ 120 chars. */
  headline: string | null;
  /** One short line per day with data. Days with zero entries are omitted (not "idle"). */
  trajectory: Array<{ date: string; line: string }> | null;
  /** 1–2 days that defined the week. */
  standout_days: Array<{ date: string; why: string }> | null;
  /** One-line characterization of how the user worked this week. Subhead under the hero. */
  key_pattern: string | null;

  /** Things that worked, each anchored to a working_shape it came from.
   *  3–5 items, sorted by load-bearing-ness (the most week-defining first). */
  what_worked: WeekFinding[] | null;
  /** Things that stalled, each citing the working_shape they stalled INSIDE.
   *  2–4 items. Friction is mode-shape-specific by construction. */
  what_stalled: WeekFinding[] | null;
  /** Outliers, novel uses, user-built tooling that surprised the digest writer.
   *  1–3 items. */
  what_surprised: WeekSurprise[] | null;
  /** Recommendations grouped by anchor (mode-shape gap, grammar gap, plan-mode
   *  decision). 3–6 items. */
  where_to_lean: WeekLeanIn[] | null;

  // ── LEGACY narrative fields ──
  // Kept optional on the type so cached v2 digests generated before the
  // working_shapes refactor still parse. New digests leave these null and the
  // renderer prefers the new fields.
  recurring_themes?: WeekRecurringTheme[] | null;
  outcome_correlations?: WeekOutcomeCorrelation[] | null;
  friction_categories?: WeekFrictionCategory[] | null;
  suggestions?: {
    claude_md_additions: WeekClaudeMdAddition[];
    features_to_try: WeekFeatureToTry[];
    usage_patterns: WeekUsagePattern[];
  } | null;
  on_the_horizon?: WeekHorizonOpportunity | null;
  fun_ending?: { headline: string; detail: string } | null;
};

// ─────────────────────────────────────────────────────────────────────────
// Month digest (Phase 4) — synthesizes 4–5 week digests into a monthly story.
// ─────────────────────────────────────────────────────────────────────────

export type MonthDigest = DigestEnvelope & {
  scope: "month";
  /** "YYYY-MM" — same as envelope.key. */
  week_refs: string[];

  // ── Deterministic aggregations (computed from week digests) ──
  agent_min_total: number;
  projects: Array<{
    name: string;
    display_name: string;
    agent_min: number;
    share_pct: number;
    shipped_count: number;
  }>;
  shipped: Array<{ title: string; project: string; date: string; session_id: string }>;
  outcome_mix: Partial<Record<DayOutcome, number>>;
  /** One entry per ISO week-Monday in the month. May be 4 or 5 entries. */
  helpfulness_by_week: Array<{ week_start: string; helpfulness: DayHelpfulness }>;
  top_flags: Array<{ flag: string; count: number }>;
  top_goal_categories: Array<{ category: string; minutes: number }>;
  concurrency_peak_week: { week_start: string; peak: number } | null;

  // ── LLM narrative ──
  headline: string | null;
  /** One line per week (4 or 5 entries). */
  trajectory: Array<{ week_start: string; line: string }> | null;
  /** 1–2 weeks that defined the month. */
  standout_weeks: Array<{ week_start: string; why: string }> | null;
  friction_themes: string | null;
  suggestion: { headline: string; body: string } | null;
};
