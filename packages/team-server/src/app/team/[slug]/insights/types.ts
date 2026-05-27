// Maximal Phase-1 prototype types. Each category A–DD from the enumeration in
// the 2026-05-15 conversation gets a typed payload here. Items marked ✗
// (raw tool family counts, productivity score, ROI score, EE section) are
// excluded. ⚠ items are included with a `sensitive` marker; the UI tags them
// visually so the design judge can see the cost.

// ─── Common primitives ─────────────────────────────────────────────────────

export type Fact = { label: string; value: string | number; sub?: string; sensitive?: boolean };
export type RankedRow = { label: string; value: string | number; sub?: string };
export type MemberMetric = { member: string; value: number | string; sub?: string };

// ─── BB. Spotlights (kept from previous iteration) ─────────────────────────

export type SpotlightFlavor =
  | "case-study"
  | "strength-surfacing"
  | "rescue"
  | "harness-invention"
  | "agent-team"
  | "long-autonomous"
  | "shape-specific"
  | "what-went-wrong";

export type SpotlightSessionMeta = {
  date: string;
  project: string;
  duration_hours: number;
  shipped: number;
};

export type Spotlight = {
  id: string;
  flavor: SpotlightFlavor;
  author: string;
  session_meta: SpotlightSessionMeta;
  title: string;
  body: string;
  harness_signature: string;
};

// ─── A. Volume / time / activity ───────────────────────────────────────────

export type VolumeStats = {
  agent_hours_total: number;
  agent_hours_wow_delta_pct: number;
  agent_hours_per_member: { member: string; hours: number }[];
  agent_hours_per_project: { project: string; hours: number }[];
  agent_hours_per_user_skill: { skill: string; hours: number }[];
  sessions_total: number;
  sessions_per_member: { member: string; count: number }[];
  median_session_min: number;
  session_length_histogram: { bucket: string; count: number }[];
  longest_session: { member: string; project: string; hours: number; date: string };
  total_turns: number;
  total_tool_calls: number;
  tools_per_turn: number;
  concurrency_peak: { date: string; peak: number };
  tokens: { input: number; output: number; cache_read: number; cache_write: number };
  cost_total_usd: number;
  cost_per_member: { member: string; usd: number }[];
  cost_per_project: { project: string; usd: number }[];
  cost_per_shipped_pr_per_member: { member: string; usd_per_pr: number }[]; // ⚠
};

// ─── B. Code zones ────────────────────────────────────────────────────────

export type CodeZoneStats = {
  file_heatmap: { path: string; touches: number; members: number }[];
  multi_member_files: { path: string; members: string[] }[];
  silo_files: { path: string; member: string; touches: number }[];
  cold_directories: { path: string; note: string }[];
  most_rewritten_files: { path: string; edits: number }[];
  file_type_mix: { ext: string; share_pct: number }[];
  new_files_originated: number;
  modified_files: number;
  languages: { name: string; share_pct: number }[];
  tests_to_code_ratio_pct: number;
  docs_to_code_ratio_pct: number;
  config_to_code_ratio_pct: number;
  shipped_vs_nonshipped_files: { shipped: number; nonshipped: number };
  extension_diversity_per_member: { member: string; extensions: number }[];
};

// ─── C. Working style (characterized, never quoted) ───────────────────────

export type WorkingStyleStats = {
  prompt_length_distribution_per_member: {
    member: string;
    short: number;
    medium: number;
    long: number;
    very_long: number;
  }[];
  long_brief_ratio_per_member: { member: string; ratio_pct: number }[];
  verbosity_drift_per_member: { member: string; direction: "shorter" | "longer" | "stable"; delta_pct: number }[];
  imperative_vs_conversational_per_member: { member: string; imperative_pct: number }[];
  code_block_usage_per_member: { member: string; pct: number }[];
  external_ref_vs_self_contained_per_member: { member: string; external_pct: number }[];
  structured_format_usage_per_member: { member: string; pct: number }[];
  interrupt_freq_per_member: { member: string; per_session: number }[];
  frustrated_signals_per_member: { member: string; count: number }[];
  tone_grade_per_member: { member: string; grade: string }[]; // ⚠
  politeness_markers_per_member: { member: string; per_msg: number }[]; // ⚠
  sentiment_user_messages_per_member: { member: string; positive: number; neutral: number; negative: number }[]; // ⚠
  sentiment_agent_responses: { positive: number; neutral: number; negative: number }; // ⚠
};

// ─── D. Tool usage (raw counts dropped; everything else stays) ───────────

export type ToolUsageStats = {
  bash_subverb_heatmap: { subverb: string; count: number }[];
  read_edit_ratio: number;
  webfetch_websearch_count: number;
  todowrite_ops_per_session_avg: number;
  tool_error_rate_per_member: { member: string; rate_pct: number }[];
  tool_retry_chains_count: number;
  avg_tools_per_turn: number;
};

// ─── E. Skills / harness ──────────────────────────────────────────────────

export type SkillsHarnessStats = {
  user_authored_skills: { name: string; originated_by: string; adopters: number; uses: number }[];
  user_authored_subagents: { name: string; originated_by: string; adopters: number; uses: number }[];
  skill_families: { family: string; members: number; uses: number }[];
  skills_loaded_never_dispatched: { name: string; loads: number }[];
  skills_newly_authored_this_week: { name: string; author: string; date: string }[];
  preflight_skill_loads: { skill: string; sessions: number }[];
  midsession_skill_loads: { skill: string; sessions: number }[];
  sessions_with_zero_skills: number;
  stock_vs_user_ratio_per_member: { member: string; stock_pct: number }[];
  slash_commands_used: { command: string; uses: number; users: number }[];
  skill_diffusion_events: { skill: string; from_member: string; to_member: string; date: string }[];
  skills_abandoned_this_week: { name: string; prev_uses: number; current_uses: number }[];
  skill_descriptions_updated_midweek: { skill: string; member: string }[];
};

// ─── F. Delegation / subagent patterns ─────────────────────────────────────

export type DelegationStats = {
  subagent_dispatches_per_member: { member: string; count: number }[];
  parallel_vs_sequential_batches: { parallel: number; sequential: number };
  background_runs: number;
  subagent_types_invoked: { type: string; count: number }[];
  user_authored_vs_stock_per_member: { member: string; user_pct: number }[];
  avg_subagent_prompt_chars: number;
  reviewer_triad_sessions: number;
  implementer_reviewer_pairs: number;
  orchestration_brief_first_sessions: number;
  solo_vs_orchestrated_per_member: { member: string; orchestrated_pct: number }[];
  subagent_shipping_rate_pct: number;
};

// ─── G. Plan mode ─────────────────────────────────────────────────────────

export type PlanModeStats = {
  adopters: number;
  plan_then_build_vs_dive_in_ratio: number;
  avg_plan_duration_min: number;
  plans_shipped: number;
  plans_abandoned: number;
  brainstorm_warmup_adopters: number;
  longest_discipline_streak_days: number;
  warmup_ritual_sessions: number;
};

// ─── H. Outcomes / shipping ───────────────────────────────────────────────

export type OutcomeStats = {
  prs_shipped: number;
  prs_per_member: { member: string; count: number }[];
  prs_per_project: { project: string; count: number }[];
  sessions_ending_in_commit: number;
  sessions_ending_in_pr: number;
  median_first_user_to_merge_min_per_member: { member: string; minutes: number }[];
  per_project_outcome: { project: string; shipped: number; partial: number; blocked: number }[];
  skill_ship_rate: { skill: string; ship_rate_pct: number }[];
  subagent_ship_rate: { subagent: string; ship_rate_pct: number }[];
  time_of_day_ship_rate: { hour: number; ship_rate_pct: number }[];
  // ✗ ship rate per member ranking (item 91, kept as ⚠ — included)
  shipping_rate_ranking: { member: string; ship_rate_pct: number }[]; // ⚠
};

// ─── I. Friction / failure ────────────────────────────────────────────────

export type FrictionStats = {
  cooccurring_friction: { kind: string; members_affected: string[]; description: string }[];
  frustrated_sessions: number;
  multi_interrupt_sessions: number;
  abandoned_sessions: number;
  loops_detected: number;
  long_autonomous_failures: number;
  shared_errors: { error: string; members_affected: string[] }[];
  shared_dependency_trouble: { dep: string; members: string[] }[];
  shared_external_systems_frustrated: { system: string; refs: string[] }[];
  friction_rate_per_member: { member: string; rate_pct: number }[]; // ⚠
  retry_same_op_count: number;
  recovery_moves: { description: string; member: string; date: string }[];
};

// ─── J. Diffusion (multi-week / cross-member) ─────────────────────────────

export type DiffusionStats = {
  skill_pickups: { skill: string; from_member: string; to_member: string; days_to_pickup: number }[];
  subagent_spread: { type: string; weeks_ago: number; users_then: number; users_now: number }[];
  skill_family_curve: { family: string; weekly: number[] }[];
  prompt_pattern_diffusion: { pattern: string; first_seen_by: string; spread_to: string[] }[];
  tool_pattern_spreading: { pattern: string; adopters: string[] }[];
  plan_mode_curve: number[];
  brainstorm_warmup_curve: number[];
  reverse_diffusion: { practice: string; peak_count: number; current_count: number }[];
  first_used_other_member_skill_events: { event_member: string; skill: string; original_author: string; date: string }[];
  velocity_diffusion_note: string;
  skill_authoring_rate_trend: number[];
};

// ─── K. Co-occurrence ─────────────────────────────────────────────────────

export type CoOccurrenceStats = {
  shared_friction_kinds: { kind: string; members: string[] }[];
  shared_files_same_week: { path: string; members: string[] }[];
  shared_external_refs: { ref: string; members: string[] }[];
  shared_skills_same_day: { skill: string; date: string; members: string[] }[];
  concurrent_sessions: { date: string; window: string; members: string[] }[];
  shared_debugging: { dep: string; members: string[] }[];
  shared_subagent_dispatch_kinds: { type: string; members: string[] }[];
};

// ─── L. Team bench (comparative, low-shade framing) ───────────────────────

export type BenchStats = {
  task_category_bench: { category: string; member: string; metric_label: string }[];
  highest_delegation_rate: { member: string; dispatches_per_session: number };
  highest_skill_load_rate: { member: string; loads_per_session: number };
  most_disciplined_plan_mode_user: { member: string; days: number };
  most_parallel_dispatch_user: { member: string; sessions: number };
  longest_autonomous_tolerance: { member: string; hours: number };
  highest_first_pass_ship_rate: { member: string; pct: number };
  most_diverse_project_portfolio: { member: string; projects: number };
  highest_user_authored_skill_output: { member: string; skills_authored: number };
  most_efficient_member: { member: string; metric: string }; // ⚠
};

// ─── M. Novelty / invention ───────────────────────────────────────────────

export type NoveltyStats = {
  weeks_invention: { headline: string; member: string; session_date: string; project: string; detail: string };
  first_use_of_stock_skill: { skill: string; member: string; date: string }[];
  first_successful_parallel_dispatch: { member: string; date: string };
  first_long_autonomous_ship: { member: string; date: string; hours: number };
  first_used_other_member_skill: { event_member: string; skill: string; original_author: string }[];
  unprecedented_move: string;
  new_claudemd_additions: { member: string; summary: string; trigger_date: string }[];
  new_project_introduced: { project: string; member: string; date: string }[];
};

// ─── N. External systems ──────────────────────────────────────────────────

export type ExternalSystemStats = {
  linear_refs: { ref: string; member: string; sessions: number }[];
  github_refs: { ref: string; member: string; sessions: number }[];
  branch_refs: { branch: string; sessions: number }[];
  url_refs_count: number;
  external_triggered_sessions: number;
  sessions_ending_with_pr_post: number;
  most_leaned_on_system: { system: string; refs: number };
};

// ─── O. Prompting fingerprint ─────────────────────────────────────────────

export type PromptingFingerprintStats = {
  style_per_member: { member: string; style: string; descriptor: string }[];
  prompt_frame_mix_per_member: {
    member: string;
    teammate: number;
    slash_command: number;
    image_attached: number;
    handoff_prose: number;
  }[];
  first_user_length_histogram: { bucket: string; count: number }[];
};

// ─── P. Rhythm / time-of-day ──────────────────────────────────────────────

export type RhythmStats = {
  team_hour_histogram: number[]; // 24
  per_member_hour_histogram: { member: string; histogram: number[] }[];
  weekday_histogram: { weekday: string; count: number }[];
  peak_hours: number[];
  late_night_sessions: { member: string; count: number }[]; // ⚠
  weekend_sessions: { member: string; count: number }[]; // ⚠
  multi_timezone_signal: string;
  burndown_shape: string;
  burnout_proxy: { member: string; signal: string }[]; // ⚠
};

// ─── Q. Velocity ──────────────────────────────────────────────────────────

export type VelocityStats = {
  median_first_user_to_commit_per_member: { member: string; minutes: number }[];
  median_first_user_to_pr_per_member: { member: string; minutes: number }[];
  median_first_user_to_merge_min: number;
  active_vs_wall_clock_ratio_sample: { session_id: string; project: string; ratio_pct: number }[];
  sessions_per_day: { date: string; count: number }[];
  prs_per_week_trend: number[];
  velocity_per_project_trend: { project: string; weekly: number[] }[];
};

// ─── R. Knowledge flow / pattern propagation ──────────────────────────────

export type KnowledgeFlowStats = {
  pattern_a_to_b: { pattern: string; member_a: string; date_a: string; member_b: string; date_b: string }[];
  pattern_main_to_subagent: { pattern: string; session_label: string }[];
  pattern_to_claudemd: { pattern: string; member: string; addition_date: string }[];
  skill_refined_after_session: { skill: string; member: string; refinement: string }[];
  multi_day_threads: { thread_id: string; member: string; days: number; sessions: number }[];
  handoff_prose_events: { member: string; from_session: string; to_session: string; date: string }[];
  cross_member_threads: { topic: string; members: string[]; sessions: number }[];
};

// ─── S. AI behavior ───────────────────────────────────────────────────────

export type AIBehaviorStats = {
  model_usage: { model: string; share_pct: number }[];
  model_mix_per_session_avg: { opus: number; sonnet: number; haiku: number };
  model_fallback_events: number;
  extended_thinking_rate_pct: number;
  high_clarification_sessions: number;
  hallucination_flags: number;
  reverted_tool_calls: number;
  high_cost_sessions: { session_label: string; cost_usd: number; member: string }[];
  cache_hit_rate_avg_pct: number;
  agent_helpfulness_per_member: {
    member: string;
    essential: number;
    helpful: number;
    neutral: number;
    unhelpful: number;
  }[]; // ⚠
};

// ─── T. Cost / efficiency ─────────────────────────────────────────────────

export type CostEfficiencyStats = {
  cost_per_pr_per_project: { project: string; cost_usd: number; prs: number; ratio: number }[];
  tokens_per_pr_team: number;
  plan_utilization_burndown_pct: number;
  extra_usage_spend_per_project: { project: string; usd: number }[];
  cost_trend_wow_pct: number;
  high_cost_low_yield_sessions: { description: string; cost_usd: number; outcome: string }[];
};

// ─── U. Coverage / dead zones ─────────────────────────────────────────────

export type CoverageStats = {
  untouched_files_count: number;
  untouched_directories: string[];
  universal_contact_files: string[];
  new_files_by_agent: number;
  agent_authored_test_files: number;
  agent_authored_doc_files: number;
  legacy_zones_with_activity: { zone: string; sessions: number }[];
};

// ─── V. Trend (multi-week) ────────────────────────────────────────────────

export type TrendStats = {
  skill_adoption_curves: { skill: string; weekly: number[] }[];
  subagent_dispatch_trend: number[];
  plan_mode_trend: number[];
  velocity_trend: number[];
  cost_trend: number[];
  skill_authoring_rate_trend: number[];
  maturity_composite_weekly: number[];
  diffusion_velocity_note: string;
};

// ─── W. Onboarding / maturation ───────────────────────────────────────────

export type OnboardingStats = {
  ramp_up_curves: { member: string; weeks_since_join: number; weekly_hours: number[] }[];
  first_skill_load: { member: string; skill: string; days_since_join: number }[];
  first_subagent_dispatch: { member: string; type: string; days_since_join: number }[];
  first_plan_mode: { member: string; days_since_join: number }[];
  first_pr_via_agents: { member: string; days_since_join: number }[];
  time_to_first_ship: { member: string; days: number }[];
};

// ─── X. Manager affordances ───────────────────────────────────────────────

export type ManagerStats = {
  wins_this_week: { member: string; win: string }[];
  topics_for_oneonone: { member: string; topic: string }[];
  concerns_to_address: { member: string; concern: string }[]; // ⚠
  onboarding_suggestions: { member: string; suggestion: string }[];
  ask_x_about_y: { ask_member: string; topic: string }[];
  friday_demo_candidates: { session_label: string; member: string }[];
};

// ─── Y. Org roll-up ───────────────────────────────────────────────────────

export type OrgRollupStats = {
  team_maturity_score: { current: number; prior: number; trend: "up" | "down" | "flat" };
  quarterly_agent_shipping_trend: number[];
  team_vs_org_comparison: { metric: string; team: number; org_baseline: number }[];
  roi_per_team: { team: string; cost_per_pr: number }[]; // ⚠
  skill_authoring_rate: number;
  bus_factor_practices: { practice: string; sole_practitioner: string }[]; // ⚠
};

// ─── Z. Pair work / threads ───────────────────────────────────────────────

export type PairWorkStats = {
  multiday_continuations: { thread_id: string; member: string; days: number }[];
  coauthored_commits: { file: string; members: string[]; date: string }[];
  cross_session_threads: { topic: string; sessions: number; member: string }[];
  hot_files: { path: string; consecutive_sessions: number }[];
};

// ─── AA. Outliers / surprises ─────────────────────────────────────────────

export type OutlierStats = {
  atypical_day_per_member: { member: string; date: string; what_was_different: string }[];
  unexpected_project_attention: { project: string; usual_hours: number; this_week: number };
  abandoned_skill_outliers: { skill: string; prev_uses: number; current_uses: number }[];
  spiked_subagent: { type: string; usual: number; this_week: number };
  interrupt_spike: { member: string; usual: number; this_week: number };
  outlier_long_autonomous: { member: string; hours: number; median: number };
  novel_friction_kind: { kind: string; member: string };
};

// ─── CC. Meta / dashboard self-signals ────────────────────────────────────

export type MetaStats = {
  section_coverage: { letter: string; populated: boolean }[];
  spotlight_rate_pct: number;
  synthesis_cost_usd: number;
  data_freshness: string;
  member_data_completeness_pct: number;
};

// ─── DD. Cross-edition affordances ────────────────────────────────────────

export type CrossEditionStats = {
  member_links: { member: string; personal_digest_shared: boolean; personal_digest_href: string | null }[];
  session_deep_links: { session_label: string; href: string }[];
  roster: { membership_id: string; display_name: string; agent_hours: number; shipped: number }[];
};

// ─── Variant-specific shapes (v1–v5) ─────────────────────────────────────

// v1: Member fingerprints — per-member synthesized portrait of how they
// collaborate with the agent + their weekly arc.

export type MemberFingerprintArc = {
  weeks_back: number; // e.g. 4 for a 4-week window
  // Each array is length === weeks_back, oldest → newest.
  sessions_per_week: number[];
  skill_loads_per_session: number[];
  orchestrated_pct: number[];
  median_session_min: number[];
  first_user_to_merge_min: number[];
  cost_per_pr_usd: number[];
};

export type MemberFingerprint = {
  member: string;
  role_hint: string; // editorial: "Structured-imperative", "Terse delegator", …
  signature_move: string; // single short line: "5-min brainstorm → long brief → small refinements"
  signature_paragraph: string; // 2-3 sentence synthesis of how they collaborate
  this_week: {
    sessions: number;
    hours: number;
    prs: number;
    median_first_user_to_merge_min: number;
    notable_signals: string[];
  };
  arc: MemberFingerprintArc;
  growth_synthesis: string; // 1-2 sentences naming the multi-week trend
};

// v2: Growth trajectories — practice × member matrix of weekly sparklines.

export type TrajectoryRow = {
  practice: string;
  unit: string; // for tooltips: "sessions/week", "min", "%", "$"
  direction_better: "higher" | "lower"; // semantics for color hints
  per_member: { member: string; weekly: number[]; current_label?: string }[];
};

export type TrajectoryObservation = {
  member: string;
  observation: string;
};

// v3: Practice diffusion grid — members × practices, cells = status.

export type DiffusionStatus = "originator" | "regular" | "tried" | "not_yet";

export type DiffusionPractice = {
  key: string;
  label: string;
  short_desc: string;
};

export type DiffusionGridRow = {
  member: string;
  cells: Record<string, DiffusionStatus>; // keyed by DiffusionPractice.key
};

export type DiffusionArrow = {
  practice_key: string;
  from_member: string;
  to_member: string;
  date: string;
  note: string;
};

// v4: Session archetypes — named shapes + per-member distribution.

export type SessionArchetype = {
  key: string;
  name: string;
  description: string;
  cue: string;
  illustrative_signature: string;
};

export type ArchetypeDistributionRow = {
  member: string;
  distribution: { archetype_key: string; pct: number }[];
};

export type IllustrativeSessionTimeline = {
  session_label: string;
  member: string;
  archetype_key: string;
  // Sequence of turns, each a label + relative size (chars or duration).
  turns: { kind: "user" | "agent" | "tool" | "subagent"; weight: number; tag?: string }[];
};

// v5: Story — ordered prose paragraphs that read like a magazine column.

export type StoryParagraph = {
  heading?: string;
  body: string;
};

export type VariantsPayload = {
  // v1 (kept; consumed by v1-combined)
  fingerprints: MemberFingerprint[];
  trajectory_rows: TrajectoryRow[];
  trajectory_observations: TrajectoryObservation[];
  diffusion_practices: DiffusionPractice[];
  diffusion_grid: DiffusionGridRow[];
  diffusion_arrows: DiffusionArrow[];
  session_archetypes: SessionArchetype[];
  archetype_distribution: ArchetypeDistributionRow[];
  illustrative_session_timelines: IllustrativeSessionTimeline[];
  story_paragraphs: StoryParagraph[];

  // v2 — case-studies-first
  wow_pulse: WowPulseStats;
  case_studies: CaseStudy[];
  v2_closing: StoryParagraph[];

  // v3 — grounded in industry precedent (Anthropic Economic Index, Faros, DORA, SPACE)
  v3_extras: V3Extras;
  // v4 — finalized, capturability-tagged combination of v1-v3 best bits
  v4_extras: V4Extras;
  // v5 — hypothetical with all 4 external integrations enabled
  v5_extras: V5Extras;
  // v6 — ticket lifecycle spine + individual telemetry overlay
  v6_extras: V6Extras;
};

// v3 reference set (all Q1/Q2 2026):
// - DX AI Measurement Framework (April 2026): Utilization / Impact / Cost
//   https://getdx.com/whitepaper/ai-measurement-framework/
// - Anthropic 2026 Agentic Coding Trends Report (May 2026): delegation gap
//   https://resources.anthropic.com/2026-agentic-coding-trends-report
// - Anthropic Economic Index Jan 2026: five economic primitives
//   https://www.anthropic.com/research/anthropic-economic-index-january-2026-report
// - Context engineering (Fowler, May 2026)
//   https://martinfowler.com/articles/exploring-gen-ai/context-engineering-coding-agents.html
// - Harness engineering (OpenAI 2026, Philipp Schmid 2026)
//   https://openai.com/index/harness-engineering/
// - METR self-reported impact May 2026 (walks back 2025 RCT)
//   https://metr.org/blog/2026-05-11-ai-usage-survey/
// - DX AI Impact Report Q1 2026 (April 2026) — "Shadow AI" counter-pattern
//   https://getdx.com/blog/ai-impact-report-q1-2026/

// Anthropic Economic Index January 2026 — five primitives per session.
export type EconomicPurpose =
  | "build"
  | "debug"
  | "refactor"
  | "plan"
  | "research"
  | "test"
  | "release"
  | "meta";

export type EconomicPrimitives = {
  task_complexity: 1 | 2 | 3 | 4 | 5;
  skill_level_required: 1 | 2 | 3 | 4 | 5; // 1=junior, 5=staff/expert
  purpose: EconomicPurpose;
  ai_autonomy: 1 | 2 | 3 | 4 | 5; // 1=heavy human steer, 5=fully autonomous
  task_success: 1 | 2 | 3 | 4 | 5; // 1=blocked, 5=shipped clean
};

// DX AI Measurement Framework (April 2026, Atlassian/DX).
export type DxFramework = {
  utilization: {
    sessions_per_eng_per_week: number;
    delta_pct: number;
    agent_assisted_pr_share_pct: number;
    delta_pp: number;
    skills_loaded_per_session: number;
  };
  impact: {
    median_first_user_to_merge_min: number;
    delta_pct: number;
    rework_pr_pct: number;
    delta_pp: number;
    shipped_via_agent_share_pct: number;
    delta_pp_shipped: number;
  };
  cost: {
    usd_total_week: number;
    delta_pct: number;
    usd_per_shipped_pr: number;
    delta_pct_per_pr: number;
    plan_burn_pct: number;
  };
};

// Anthropic 2026 Agentic Coding Trends Report — delegation gap.
// used = sessions where AI is in the loop; fully_delegated = sessions with
// minimal human turns after the initial brief (Anthropic 2026: ~60% / <20%).
export type DelegationGap = {
  used_pct: number; // share of sessions using AI
  fully_delegated_pct: number; // share where human ≤ 1 turn after initial brief
  gap_pp: number; // used_pct - fully_delegated_pct
  trend_used_pct: number[]; // 4 weeks
  trend_fully_delegated_pct: number[]; // 4 weeks
  headline: string;
};

// Context engineering metrics (Fowler 2026, packmind).
export type ContextEngineeringMetrics = {
  conformity_rate_pct: number; // generated code matches team standards
  conformity_delta_pp: number;
  rework_ratio_pct: number; // post-merge fix time vs initial dev time
  rework_delta_pp: number;
  review_depth_per_pr: number; // human comments per agent-authored PR
  review_depth_delta_pct: number;
  code_churn_14d_pct: number; // new code reverted within 14 days
  code_churn_delta_pp: number;
  user_authored_context_files: number; // CLAUDE.md, skills, etc.
  llm_authored_context_files: number; // generated rules/skills
};

// Harness engineering metrics (OpenAI 2026, Philipp Schmid 2026).
export type HarnessEngineeringMetrics = {
  working_memory_budget: {
    median_pct_used: number; // % of context window consumed at session end
    sessions_over_80pct: number; // sessions that bumped against the ceiling
  };
  cache_hit_rate_pct: number;
  cache_hit_delta_pp: number;
  tool_call_efficiency: {
    successful_calls_pct: number;
    median_tools_per_outcome_unit: number; // tools per shipped change
  };
  trajectory_eval: {
    sessions_with_unforced_loops: number;
    sessions_with_premature_completion: number;
    sessions_with_steady_progress: number;
  };
};

// Augmentation vs automation flip (Economic Index Jan 2026: 52% / 45% reversed
// from August 2025's automation lead).
export type AutomationAugmentationFlip = {
  augmentation_pct_this_week: number;
  automation_pct_this_week: number;
  trend_this_team: { week_monday: string; augmentation_pct: number; automation_pct: number }[];
  industry_baseline_jan_2026: { augmentation_pct: number; automation_pct: number };
  note: string;
};

// DORA + attribution layers — the 2026 reframing (DORA "Balancing AI tensions").
export type DoraAttribution = {
  deployment_frequency: { current: number; ai_assisted_pct: number };
  lead_time_min: { current: number; ai_assisted_delta_pct: number };
  change_failure_rate_pct: { current: number; ai_assisted: number; human_authored: number };
  mttr_min: { current: number; ai_assisted_delta_pct: number };
  note: string;
};

// v4 — finalized version, every section tagged with capturability.
export type CapturabilityTier = "deterministic" | "llm-enriched" | "external-plug-in";

export type DelegationDepth = {
  fully_delegated_pct: number; // ≤1 human turn after the initial brief
  mid_delegation_pct: number; // 2–9 human turns after the brief
  heavy_steering_pct: number; // ≥10 short user turns
  trend_fully_delegated_4w: number[];
  trend_heavy_steering_4w: number[];
  headline: string;
};

export type ExternalIntegrationStatus = "not-connected" | "available-via-plug-in" | "connected";

export type ExternalIntegrationPlaceholder = {
  name: string;
  status: ExternalIntegrationStatus;
  would_capture: string[];
  integration_note: string;
};

export type V4Extras = {
  delegation_depth: DelegationDepth;
  external_integrations: ExternalIntegrationPlaceholder[];
  v4_closing: { heading?: string; body: string; cites?: { label: string; href: string }[] }[];
  methodology_notes: {
    title: string;
    body: string;
    capturability: CapturabilityTier;
    citation?: { label: string; href: string };
  }[];
};

// v5 — hypothetical "all 4 external integrations connected"
export type V5PipelinePhase = {
  name: "ticket-opened" | "session-start" | "commit" | "pr-opened" | "review" | "merge" | "ci-passing" | "deployed";
  label: string;
  median_min: number;
  delta_pct_wow: number;
  attribution_note?: string;
};

export type V5TicketLifecycle = {
  id: string; // KIP-148
  title: string;
  status: "in-flight" | "merged" | "deployed" | "shipped" | "blocked";
  cycle_min: number;
  ai_assisted_pct: number;
  linked_sessions: string[]; // case_study ids
  linked_pr?: string;
};

export type V5DoraActual = {
  deployment_frequency: { current: number; delta_pct_wow: number; ai_assisted_share_pct: number };
  lead_time_min: { current: number; ai_assisted_median: number; human_authored_median: number };
  change_failure_rate_pct: { current: number; ai_assisted: number; human_authored: number };
  mttr_min: { current: number; ai_assisted_median: number; human_authored_median: number };
  classification: "elite" | "high" | "medium" | "low";
};

export type V5QualityActual = {
  conformity_rate_pct: { current: number; delta_pp_wow: number };
  rework_rate_pct: { current: number; delta_pp_wow: number };
  code_churn_14d_pct: { current: number; delta_pp_wow: number };
  review_depth_per_pr: { current: number; delta_pct_wow: number };
  conformity_failures_this_week: { check: string; sessions: number }[];
};

export type V5CostPerResolved = {
  project: string;
  usd_total_week: number;
  tickets_resolved: number;
  usd_per_ticket: number;
  prs_merged: number;
  usd_per_pr: number;
};

export type V5CaseStudyAttribution = {
  case_study_id: string;
  ticket_ids: string[];
  pr_links: { label: string; status: "merged" | "open" | "abandoned"; review_comments: number }[];
  ci_result: "green" | "yellow" | "red" | "n/a";
  deployed: boolean;
};

export type V5Extras = {
  banner_text: string;
  pipeline: { phases: V5PipelinePhase[]; total_lead_time_min: number; headline: string };
  dora_actual: V5DoraActual;
  quality_actual: V5QualityActual;
  ticket_lifecycle: V5TicketLifecycle[];
  case_study_attribution: V5CaseStudyAttribution[];
  cost_per_resolved: V5CostPerResolved[];
  newly_answerable_questions: { question: string; answer: string }[];
  v5_closing: { heading?: string; body: string; cites?: { label: string; href: string }[] }[];
  // v5.1 — DORA-narrative version (kept for reference but no longer the v5 spine).
  dora_narrative: V5DoraNarrative;
  // v5.2 — manager-action dashboard (current v5 spine).
  actionables: V5Actionables;
};

// v5.2 — action-first shape. Every card ends with a concrete next step.
export type V5ActionCard = {
  observation: string;
  metric: string;
  action: string;
};

export type V5RiskLevel = "green" | "yellow" | "red";

export type V5RiskSignal = {
  name: string;
  current_value: string;
  level: V5RiskLevel;
  threshold_note: string;
  trend_4w: number[];
  action: string;
};

export type V5PairedMetric = {
  speed: { label: string; value: string; delta?: string; delta_class?: "positive" | "negative" | "" };
  quality: { label: string; value: string; delta?: string; delta_class?: "positive" | "negative" | "" };
  honest_read: string;
};

export type V5Investment = {
  title: string;
  rationale: string;
  evidence: string;
  effort: "small" | "medium" | "large";
};

export type V5OneOnOnePrompt = {
  member: string;
  prompt: string;
  evidence: string;
};

export type V5DemoCandidate = {
  session_label: string;
  member: string;
  one_line: string;
};

export type V5Actionables = {
  hero_takeaway: string;
  strengths: V5ActionCard[];
  dysfunctions: V5ActionCard[];
  risk_signals: V5RiskSignal[];
  bottleneck_callout: { headline: string; phase: string; delta_pct: number; action: string };
  paired_metrics: V5PairedMetric[];
  investments: V5Investment[];
  oneonone_prompts: V5OneOnOnePrompt[];
  demo_candidates: V5DemoCandidate[];
  appendix_note: string;
};

// v6 — ticket lifecycle spine. Status names are source-specific; phases are
// normalized per team/project after reading the ticketing workflow.
export type V6PhaseId =
  | "spec"
  | "ready"
  | "implementation"
  | "code-review"
  | "qa"
  | "launch";

export type V6WorkflowMapping = {
  source: "Linear" | "Jira" | "Custom";
  raw_status: string;
  normalized_phase: V6PhaseId;
  confidence: "high" | "medium" | "needs-review";
  note: string;
};

export type V6SubmittedSectionMarker = {
  timestamp: string;
  member: string;
  label: string;
  sensitivity: "tier-1" | "opt-in";
};

export type V6PhaseSummary = {
  phase: V6PhaseId;
  label: string;
  median_min: number;
  previous_median_min: number;
  delta_pct: number;
  ticket_count: number;
  agent_time_min: number;
  submitted_sections: number;
  bottleneck_score: number;
  narrative: string;
};

export type V6TicketPhaseSpan = {
  phase: V6PhaseId;
  label: string;
  start: string;
  end: string;
  duration_min: number;
  agent_time_min: number;
  submitted_sections: V6SubmittedSectionMarker[];
};

export type V6TicketJourney = {
  id: string;
  title: string;
  source: "Linear" | "Jira";
  owner: string;
  outcome: "launched" | "qa-ready" | "reviewing" | "blocked";
  total_min: number;
  delta_vs_prior_pct: number;
  implementation_window_min: number;
  previous_implementation_window_min: number;
  phase_spans: V6TicketPhaseSpan[];
  insight: string;
};

export type V6ImplementationTrend = {
  period: string;
  median_implementation_min: number;
  median_total_min: number;
  review_qa_share_pct: number;
};

export type V6AllocationRow = {
  member: string;
  spec_min: number;
  implementation_min: number;
  review_min: number;
  qa_min: number;
  launch_min: number;
  dominant_phase: V6PhaseId;
  note: string;
};

export type V6CaseStudy = {
  title: string;
  ticket_id: string;
  member: string;
  session_window: string;
  phase: V6PhaseId;
  what_happened: string;
  why_it_matters: string;
  evidence_level: "ticket-only" | "ticket-plus-telemetry" | "opt-in-session";
};

export type V6AnswerableQuestion = {
  question: string;
  data_needed: string;
  answer_if_connected: string;
  capturability: "ticket-integration" | "individual-telemetry" | "opt-in-session" | "needs-workflow-mapping";
};

export type V6Extras = {
  headline: string;
  premise: string;
  universal_workflow_note: string;
  phase_summaries: V6PhaseSummary[];
  workflow_mappings: V6WorkflowMapping[];
  ticket_journeys: V6TicketJourney[];
  implementation_trend: V6ImplementationTrend[];
  allocation: V6AllocationRow[];
  case_studies: V6CaseStudy[];
  answerable_questions: V6AnswerableQuestion[];
};

// v5.1 — top-down narrative shape borrowed verbatim from
// dora.dev/insights/balancing-ai-tensions (March 10, 2026).
export type V5DoraUseCase = {
  // DORA article's 10 use-case taxonomy.
  name:
    | "code generation"
    | "info seeking"
    | "code review"
    | "testing"
    | "debugging"
    | "prototyping"
    | "idea generation"
    | "writing docs"
    | "refactoring"
    | "learning";
  our_mapping: string; // which of our goal_categories or signals maps to this
  sessions: number;
  hours: number;
  ai_autonomy_avg: 1 | 2 | 3 | 4 | 5;
  success_rate_pct: number;
  notable_signal?: string;
};

export type V5Tension = {
  number: 1 | 2 | 3;
  name: string;
  article_quote: string; // verbatim from the article
  our_data_summary: string;
  signal_metrics: { label: string; value: string; note?: string }[];
  canonical_example: {
    session_label: string;
    member: string;
    explanation: string;
  };
};

export type V5Framework = {
  framework: "SEQ" | "SPACE" | "H.E.A.R.T." | "VSM";
  full_name: string;
  purpose: string; // 1 sentence
  our_mapping: { dimension: string; current_value: string; note?: string }[];
  citation: { label: string; href: string };
};

export type V5DoraNarrative = {
  opening: {
    headline: string;
    used_pct: number;
    perceived_productive_pct: number;
    throughput_signal: string; // "PRs shipped 6 (+2 vs last week)"
    instability_signal: string; // "Rework rate 11% (-3pp WoW), but conformity failures up to 4 unique"
  };
  amplifier: {
    headline: string;
    strengths_amplified: { observation: string; supporting_metric: string }[];
    dysfunctions_amplified: { observation: string; supporting_metric: string }[];
  };
  use_cases: V5DoraUseCase[];
  immediate_value: {
    headline: string;
    wins: { title: string; member: string; ticket?: string; detail: string }[];
  };
  tensions: V5Tension[];
  practical_insights: V5Framework[];
  conclusion_paragraphs: { heading?: string; body: string }[];
  closing_citation: { label: string; href: string; published: string };
};

export type V3Extras = {
  // DX AI Measurement Framework backbone
  dx_framework: DxFramework;
  // Anthropic 2026 delegation gap (replaces "AI adoption %")
  delegation_gap: DelegationGap;
  // Economic Index January 2026 augmentation/automation flip
  flip: AutomationAugmentationFlip;
  // Context engineering metrics (post-prompt-engineering frontier)
  context_engineering: ContextEngineeringMetrics;
  // Harness engineering metrics
  harness_engineering: HarnessEngineeringMetrics;
  // DORA + attribution layers
  dora_attribution: DoraAttribution;
  // Honest methodology — explicit Shadow-AI counter-pattern framing
  methodology_notes: {
    title: string;
    body: string;
    citation?: { label: string; href: string };
  }[];
  // Closing reflections each tied to a 2026 source
  v3_closing: { heading?: string; body: string; cites?: { label: string; href: string }[] }[];
};

// ─── v2 types ─────────────────────────────────────────────────────────────

export type WowDelta = {
  current: number;
  last_week: number;
  delta_pct?: number;
  delta_abs?: number;
};

export type WowProjectTime = {
  project: string;
  hours_this_week: number;
  hours_last_week: number;
  delta_pct: number;
};

export type WowGoalMix = {
  category: string;
  share_pct: number;
  delta_pp: number; // percentage points vs last week
};

export type WowSkillUse = {
  skill: string;
  uses_this_week: number;
  uses_last_week: number;
  delta: number;
};

export type WowTicket = {
  source: "Linear" | "GitHub" | "Jira";
  current: number;
  last_week: number;
  delta: number;
  sample_refs: string[]; // a few representative ref IDs
};

export type WowLongAutonomousTexture = {
  count: number; // count of "long" turns this week
  total_min: number; // total time spent in long turns
  max_single_min: number; // longest single turn
  count_wow_delta: number; // count delta vs last week
  total_min_wow_delta_pct: number; // total-min delta % vs last week
};

export type WowParallelExecution = {
  total_min: number; // total minutes the team had ≥2 concurrent sessions
  peak_concurrent: number;
  total_min_wow_delta_pct: number;
};

export type WowPulseStats = {
  agent_hours: WowDelta;
  sessions: WowDelta;
  tickets_resolved: WowTicket;
  parallel_execution: WowParallelExecution;
  long_autonomous: WowLongAutonomousTexture;
  project_time: WowProjectTime[];
  goal_mix: WowGoalMix[];
  skill_usage: WowSkillUse[];
};

export type CaseStudyPinKind =
  | "user-steering"
  | "subagent-burst"
  | "long-autonomous"
  | "plan-mode"
  | "pr-ship"
  | "harness-chain"
  | "interrupt"
  | "brainstorm-loop"
  | "skill-load";

export type CaseStudyPin = {
  start_min: number;
  end_min?: number;
  kind: CaseStudyPinKind;
  label: string;
};

// Per the Anthropic Economic Index (March 2026):
//   anthropic.com/research/economic-index-march-2026-report
export type InteractionType = "directive" | "feedback-loop" | "task-iteration" | "validation" | "learning";

// Complexity rubric (1 = trivial; 5 = expert-only). Economic Index moved from
// 3.2 → 3.8 across the H1 2025 window in Anthropic's internal Claude Code report.
export type ComplexityScore = 1 | 2 | 3 | 4 | 5;

export type CaseStudy = {
  id: string;
  author: string;
  date: string;
  project: string;
  duration: { wall_min: number; active_min: number; idle_min: number };
  turn_count: number;
  outcome: string; // "shipped 1 PR" | "partial · 1 commit" | "no PR · meta"
  working_shape: string;
  day_signature: string;

  // v3 additions — optional so v2 mock data still typechecks.
  interaction_type?: InteractionType;
  complexity?: ComplexityScore;
  // v3.1 — full Economic Index primitives (Jan 2026 taxonomy) when available.
  economic_primitives?: EconomicPrimitives;

  harness_signature: {
    user_skills: { name: string; uses: number }[];
    user_subagents: { type: string; count: number }[];
    stock_skills: { name: string; uses: number }[];
    top_tools: string[]; // already formatted ("Bash×142 (psql×38, …)")
  };

  steering: {
    user_msg_count: number;
    long_user_msg_count: number;
    median_user_msg_chars: number;
    interrupts: number;
  };

  timeline: {
    duration_min: number;
    active_intervals: { start_min: number; end_min: number }[];
    pins: CaseStudyPin[];
  };

  narrative: {
    why_picked: string;
    session_summary: string;
    steering_summary: string;
    what_worked: string;
    what_hit_friction: string;
  };

  drill_observations: {
    started_with_brainstorming: boolean;
    started_from_predefined_aspect: boolean;
    long_running_turns_count: number;
    long_running_turns_total_min: number;
    rapid_fire_after_initial: boolean;
    notes: string[];
  };
};

// ─── Maturity-portrait types (v9 — qualitative observation model) ───────
//
// These types model the output of a perception-layer LLM pass that reads each
// member's trailing-30d conversations and tags observable interaction actions
// per session. The portrait that lands here is the *consequence* of those
// session-level tags being summarized into a member-level claim.
//
// The session-level extraction belongs in packages/entries/src/types.ts
// (alongside EntrySignals). The shape is committed below as documentation;
// runtime extraction lands when we wire the LLM pass.
//
//   // Per-session action tags (target: packages/entries/src/types.ts)
//   type SessionActionTags = {
//     framing: "question" | "directive" | "brief" | "plan";
//     brought_context: boolean;
//     iteration_rounds: number;
//     course_corrections: number;
//     cross_session_ref: boolean;
//     meta_discussion: boolean;
//     artifact_authored: null | "claudemd" | "skill" | "subagent" | "slash-cmd" | "doc";
//     intent_category: "code-gen" | "review" | "debug" | "docs" | "planning" | "research" | "other";
//     ended_in_ship: boolean;
//   };

export type MaturityPath =
  // L4 paths (any one path qualifies; matches slide 7's "OR" wording)
  | "L4-builds"        // authored a skill / CLAUDE.md / sub-agent / slash-cmd
  | "L4-coaches"       // authored an artifact that another member adopted
  | "L4-orchestrates"  // parallel dispatch bursts + multi-subagent breadth
  // L3 paths
  | "L3-daily-active"
  | "L3-multi-workflow"
  | "L3-orchestration-habit"
  // L2 path
  | "L2-settled-pattern"
  // L1 path
  | "L1-exploring";

export type MaturityEvidenceKind = "decisive" | "supporting" | "near-miss" | "style";

export type MaturityEvidence = {
  kind: MaturityEvidenceKind;
  text: string;
  // The action-tag count or signal that fired this observation, when applicable.
  // Used by the widget to show "X of Y sessions" in the evidence row.
  count?: number;
  // Reference to the underlying session-level tag that produced this evidence.
  source_tag?:
    | "artifact_authored"
    | "intent_category"
    | "iteration_rounds"
    | "course_corrections"
    | "cross_session_ref"
    | "meta_discussion"
    | "framing"
    | "brought_context"
    | "ended_in_ship";
};

// Concrete numerical snapshots that anchor the portrait — surface the
// signals the classifier actually used, in a form an eng lead can audit
// without reading prose. Lifted directly from the trial-run audit: every
// number here is independently verifiable from rich_daily_rollups +
// day_artifact_signals queries.

export type CadenceSnapshot = {
  // Trailing-30d active days and the cadence ratio (active / total window).
  active_days_30d: number;
  active_days_7d: number;
  cadence_pct_30d: number;  // active_days_30d / 30 × 100, rounded
  sessions_30d: number;
  sessions_7d: number;
  sessions_per_active_day_avg: number;  // sessions_30d / max(active_days_30d, 1)
};

export type BreadthSnapshot = {
  distinct_projects_30d: number;
  distinct_projects_7d: number;
  distinct_skills_30d: number;
  distinct_subagent_kinds_30d: number;
};

export type HarnessBreakdown = {
  // Per-category file authorship counts (trailing 30d).
  skills_authored_30d: number;
  subagents_authored_30d: number;
  slash_commands_authored_30d: number;
  // CLAUDE.md is captured as net line delta only (commits, not file count).
  claudemd_line_delta_30d: number;
  // Cross-member adoption — count of this member's authored artifacts that
  // appear in another member's load history. From team_skill_catalog.
  cross_member_adopters_30d: number;
};

export type MemberMaturityPortrait = {
  member: string;
  level: MaturityLevel;
  // Which OR-paths the member qualified through. Multiple paths can fire.
  qualifying_paths: MaturityPath[];
  // Paths the member is one observable shy of — surfaces growth edges.
  near_miss_paths: MaturityPath[];
  // 2-3 sentence portrait. LLM-authored in production; templated in this build.
  qualitative_summary: string;
  // Concrete numeric snapshots — rendered as stat strips, audit-friendly.
  cadence: CadenceSnapshot;
  breadth: BreadthSnapshot;
  harness: HarnessBreakdown;
  // Observed actions, partitioned by kind so the widget can render them in
  // separate sections. "decisive" + "supporting" justify the level; "near-miss"
  // shows growth edges; "style" is descriptive context and NEVER grades.
  evidence: MaturityEvidence[];
  // Style observations — surfaced as context but explicitly not used for the
  // level claim. Examples: prompt verbosity, plan-mode usage, etc.
  style_observations: string[];
  // Comparison vs prior month, when available.
  trend?: "ascending" | "stable" | "descending";
};

// ─── Live extras (v8 clean starter — framework-aligned KPIs) ─────────────

// Maturity ladder per slide 7 of Q2-2026 Adoption Framework. The framework's
// signature concept: more useful than a single "active user" count because it
// captures progression, not frequency.
export type MaturityLevel = "L0" | "L1" | "L2" | "L3" | "L4";

export type MaturityMemberClassification = {
  member: string;
  level: MaturityLevel;
  // Short human-readable cue ("daily active · 3 projects") so the eng lead
  // can see why someone landed where they did.
  evidence: string;
};

export type LiveMaturityMix = {
  // Distribution counts must sum to members_total. L0 = unaware (no activity),
  // L4 = multiplier (builds shared skills / dispatches subagents).
  distribution: Record<MaturityLevel, number>;
  classifications: MaturityMemberClassification[];
};

export type LiveActiveRate = {
  members_total: number;
  active_7d: number;
  active_7d_prev: number;
  active_30d: number; // active in this week OR previous week
};

export type LivePrsShipped = {
  current: number;
  last_week: number;
  per_active_engineer: number;
  per_active_engineer_last_week: number;
};

export type LivePlanModeAdoption = {
  // Total plan-mode sessions across the team this week.
  sessions: number;
  sessions_last_week: number;
  // Adopters = members with ≥1 plan-mode session this week.
  adopters: number;
  adoption_pct: number; // adopters / active_7d × 100
};

export type LiveExtras = {
  active_rate: LiveActiveRate;
  maturity_mix: LiveMaturityMix;
  prs_shipped: LivePrsShipped;
  plan_mode: LivePlanModeAdoption;
  data_freshness: string; // ISO timestamp of the most recent ingest in window
  // v9 — per-member qualitative portraits. Sorted by maturity level descending
  // so the eng lead's eye lands on multipliers first.
  member_portraits?: MemberMaturityPortrait[];
};

// ─── The whole report ─────────────────────────────────────────────────────

export type TeamInsightReport = {
  team_slug: string;
  week_monday: string;
  generated_at: string;
  members_total: number;

  volume: VolumeStats;
  code_zones: CodeZoneStats;
  working_style: WorkingStyleStats;
  tool_usage: ToolUsageStats;
  skills_harness: SkillsHarnessStats;
  delegation: DelegationStats;
  plan_mode: PlanModeStats;
  outcomes: OutcomeStats;
  friction: FrictionStats;
  diffusion: DiffusionStats;
  cooccurrence: CoOccurrenceStats;
  bench: BenchStats;
  novelty: NoveltyStats;
  external_systems: ExternalSystemStats;
  prompting_fingerprint: PromptingFingerprintStats;
  rhythm: RhythmStats;
  velocity: VelocityStats;
  knowledge_flow: KnowledgeFlowStats;
  ai_behavior: AIBehaviorStats;
  cost_efficiency: CostEfficiencyStats;
  coverage: CoverageStats;
  trend: TrendStats;
  onboarding: OnboardingStats;
  manager: ManagerStats;
  org_rollup: OrgRollupStats;
  pair_work: PairWorkStats;
  outliers: OutlierStats;
  spotlights: Spotlight[];
  meta: MetaStats;
  cross_edition: CrossEditionStats;

  variants: VariantsPayload;

  // v8 clean-starter additions. Optional so existing mock data + tests keep
  // working without churn; live widgets render an empty state when absent.
  live_extras?: LiveExtras;
};
