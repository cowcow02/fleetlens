import type { TeamInsightReport } from "./types";

const MEMBERS = ["Charlie", "Alice", "Bob", "Dana"];

export const mockTeamInsightReport: TeamInsightReport = {
  team_slug: "acme-eng",
  week_monday: "2026-05-04",
  generated_at: "2026-05-12T09:14:00-07:00",
  members_total: 5,

  // ─── A. Volume / time / activity ────────────────────────────────────────
  volume: {
    agent_hours_total: 18.4,
    agent_hours_wow_delta_pct: 12,
    agent_hours_per_member: [
      { member: "Charlie", hours: 6.8 },
      { member: "Alice", hours: 4.9 },
      { member: "Bob", hours: 5.3 },
      { member: "Dana", hours: 1.4 },
    ],
    agent_hours_per_project: [
      { project: "topeka", hours: 8.2 },
      { project: "kipwise-v1", hours: 5.1 },
      { project: "ops-runbooks", hours: 3.4 },
      { project: "infra-bootstrap", hours: 1.7 },
    ],
    agent_hours_per_user_skill: [
      { skill: "harness-orchestrate", hours: 4.3 },
      { skill: "kipwise-migration-guard", hours: 2.8 },
      { skill: "release-ship-check", hours: 1.6 },
    ],
    sessions_total: 41,
    sessions_per_member: [
      { member: "Charlie", count: 16 },
      { member: "Alice", count: 11 },
      { member: "Bob", count: 9 },
      { member: "Dana", count: 5 },
    ],
    median_session_min: 22,
    session_length_histogram: [
      { bucket: "0–10m", count: 9 },
      { bucket: "10–30m", count: 14 },
      { bucket: "30–60m", count: 10 },
      { bucket: "1–2h", count: 5 },
      { bucket: "2h+", count: 3 },
    ],
    longest_session: { member: "Bob", project: "kipwise-v1", hours: 4.2, date: "2026-05-06" },
    total_turns: 612,
    total_tool_calls: 1843,
    tools_per_turn: 3.0,
    concurrency_peak: { date: "2026-05-07", peak: 4 },
    tokens: { input: 6_200_000, output: 980_000, cache_read: 18_400_000, cache_write: 2_100_000 },
    cost_total_usd: 142.36,
    cost_per_member: [
      { member: "Charlie", usd: 51.22 },
      { member: "Alice", usd: 36.74 },
      { member: "Bob", usd: 41.18 },
      { member: "Dana", usd: 13.22 },
    ],
    cost_per_project: [
      { project: "topeka", usd: 62.45 },
      { project: "kipwise-v1", usd: 38.84 },
      { project: "ops-runbooks", usd: 27.91 },
      { project: "infra-bootstrap", usd: 13.16 },
    ],
    cost_per_shipped_pr_per_member: [
      { member: "Charlie", usd_per_pr: 17.07 },
      { member: "Alice", usd_per_pr: 36.74 },
      { member: "Bob", usd_per_pr: 20.59 },
      { member: "Dana", usd_per_pr: 0 },
    ],
  },

  // ─── B. Code zones ──────────────────────────────────────────────────────
  code_zones: {
    file_heatmap: [
      { path: "packages/team-server/src/app/team/[slug]/page.tsx", touches: 41, members: 2 },
      { path: "packages/parser/src/analytics.ts", touches: 38, members: 2 },
      { path: "apps/web/components/week-digest.tsx", touches: 29, members: 1 },
      { path: "packages/team-server/src/db/migrations/0008_*.sql", touches: 24, members: 1 },
      { path: "scripts/conductor-setup.sh", touches: 18, members: 2 },
      { path: "docs/superpowers/specs/2026-05-14-*.md", touches: 14, members: 1 },
      { path: "packages/cli/src/perception/backfill.ts", touches: 12, members: 1 },
      { path: "CLAUDE.md", touches: 9, members: 3 },
    ],
    multi_member_files: [
      { path: "CLAUDE.md", members: ["Charlie", "Alice", "Bob"] },
      { path: "packages/parser/src/analytics.ts", members: ["Charlie", "Alice"] },
      { path: "scripts/conductor-setup.sh", members: ["Charlie", "Dana"] },
    ],
    silo_files: [
      { path: "packages/cli/src/perception/backfill.ts", member: "Charlie", touches: 12 },
      { path: "apps/web/components/week-digest.tsx", member: "Alice", touches: 29 },
      { path: "packages/team-server/src/db/migrations/0008_*.sql", member: "Bob", touches: 24 },
    ],
    cold_directories: [
      { path: "packages/entries/src/prompts/", note: "untouched for 4 weeks" },
      { path: "apps/web/components/runs-live-board.tsx", note: "no agent edits since v0.6" },
      { path: ".github/workflows/", note: "no edits this week" },
    ],
    most_rewritten_files: [
      { path: "packages/team-server/src/app/team/[slug]/insights/page.tsx", edits: 14 },
      { path: "docs/superpowers/specs/2026-05-14-team-insight-report-design.md", edits: 8 },
      { path: "packages/parser/src/analytics.ts", edits: 7 },
    ],
    file_type_mix: [
      { ext: ".ts", share_pct: 38 },
      { ext: ".tsx", share_pct: 22 },
      { ext: ".md", share_pct: 14 },
      { ext: ".sql", share_pct: 9 },
      { ext: ".css", share_pct: 7 },
      { ext: ".sh", share_pct: 5 },
      { ext: ".json", share_pct: 5 },
    ],
    new_files_originated: 17,
    modified_files: 124,
    languages: [
      { name: "TypeScript", share_pct: 60 },
      { name: "Markdown", share_pct: 14 },
      { name: "SQL", share_pct: 9 },
      { name: "CSS", share_pct: 7 },
      { name: "Shell", share_pct: 5 },
      { name: "JSON/YAML", share_pct: 5 },
    ],
    tests_to_code_ratio_pct: 18,
    docs_to_code_ratio_pct: 21,
    config_to_code_ratio_pct: 8,
    shipped_vs_nonshipped_files: { shipped: 86, nonshipped: 38 },
    extension_diversity_per_member: [
      { member: "Charlie", extensions: 9 },
      { member: "Alice", extensions: 6 },
      { member: "Bob", extensions: 4 },
      { member: "Dana", extensions: 3 },
    ],
  },

  // ─── C. Working style ───────────────────────────────────────────────────
  working_style: {
    prompt_length_distribution_per_member: [
      { member: "Charlie", short: 4, medium: 7, long: 4, very_long: 1 },
      { member: "Alice", short: 6, medium: 3, long: 1, very_long: 1 },
      { member: "Bob", short: 1, medium: 2, long: 4, very_long: 2 },
      { member: "Dana", short: 4, medium: 1, long: 0, very_long: 0 },
    ],
    long_brief_ratio_per_member: [
      { member: "Charlie", ratio_pct: 31 },
      { member: "Alice", ratio_pct: 18 },
      { member: "Bob", ratio_pct: 67 },
      { member: "Dana", ratio_pct: 0 },
    ],
    verbosity_drift_per_member: [
      { member: "Charlie", direction: "stable", delta_pct: 2 },
      { member: "Alice", direction: "shorter", delta_pct: -18 },
      { member: "Bob", direction: "longer", delta_pct: 24 },
      { member: "Dana", direction: "stable", delta_pct: 0 },
    ],
    imperative_vs_conversational_per_member: [
      { member: "Charlie", imperative_pct: 62 },
      { member: "Alice", imperative_pct: 88 },
      { member: "Bob", imperative_pct: 41 },
      { member: "Dana", imperative_pct: 72 },
    ],
    code_block_usage_per_member: [
      { member: "Charlie", pct: 22 },
      { member: "Alice", pct: 9 },
      { member: "Bob", pct: 38 },
      { member: "Dana", pct: 14 },
    ],
    external_ref_vs_self_contained_per_member: [
      { member: "Charlie", external_pct: 24 },
      { member: "Alice", external_pct: 8 },
      { member: "Bob", external_pct: 51 },
      { member: "Dana", external_pct: 0 },
    ],
    structured_format_usage_per_member: [
      { member: "Charlie", pct: 44 },
      { member: "Alice", pct: 14 },
      { member: "Bob", pct: 67 },
      { member: "Dana", pct: 12 },
    ],
    interrupt_freq_per_member: [
      { member: "Charlie", per_session: 0.4 },
      { member: "Alice", per_session: 0.2 },
      { member: "Bob", per_session: 1.1 },
      { member: "Dana", per_session: 0.6 },
    ],
    frustrated_signals_per_member: [
      { member: "Charlie", count: 1 },
      { member: "Alice", count: 0 },
      { member: "Bob", count: 3 },
      { member: "Dana", count: 1 },
    ],
    tone_grade_per_member: [
      { member: "Charlie", grade: "neutral-imperative" },
      { member: "Alice", grade: "terse-imperative" },
      { member: "Bob", grade: "exploratory-conversational" },
      { member: "Dana", grade: "neutral-imperative" },
    ],
    politeness_markers_per_member: [
      { member: "Charlie", per_msg: 0.04 },
      { member: "Alice", per_msg: 0.01 },
      { member: "Bob", per_msg: 0.11 },
      { member: "Dana", per_msg: 0.02 },
    ],
    sentiment_user_messages_per_member: [
      { member: "Charlie", positive: 8, neutral: 89, negative: 3 },
      { member: "Alice", positive: 4, neutral: 95, negative: 1 },
      { member: "Bob", positive: 14, neutral: 78, negative: 8 },
      { member: "Dana", positive: 5, neutral: 92, negative: 3 },
    ],
    sentiment_agent_responses: { positive: 11, neutral: 86, negative: 3 },
  },

  // ─── D. Tool usage (no raw family counts) ──────────────────────────────
  tool_usage: {
    bash_subverb_heatmap: [
      { subverb: "pnpm", count: 84 },
      { subverb: "git", count: 71 },
      { subverb: "docker", count: 22 },
      { subverb: "psql", count: 14 },
      { subverb: "curl", count: 11 },
      { subverb: "lsof", count: 8 },
    ],
    read_edit_ratio: 2.24,
    webfetch_websearch_count: 6,
    todowrite_ops_per_session_avg: 4.2,
    tool_error_rate_per_member: [
      { member: "Charlie", rate_pct: 3.1 },
      { member: "Alice", rate_pct: 1.2 },
      { member: "Bob", rate_pct: 6.4 },
      { member: "Dana", rate_pct: 2.8 },
    ],
    tool_retry_chains_count: 17,
    avg_tools_per_turn: 3.0,
  },

  // ─── E. Skills / harness ────────────────────────────────────────────────
  skills_harness: {
    user_authored_skills: [
      { name: "harness-orchestrate", originated_by: "Alice", adopters: 3, uses: 11 },
      { name: "kipwise-migration-guard", originated_by: "Bob", adopters: 1, uses: 5 },
      { name: "release-ship-check", originated_by: "Charlie", adopters: 2, uses: 4 },
      { name: "spec-frame-loader", originated_by: "Charlie", adopters: 2, uses: 3 },
    ],
    user_authored_subagents: [
      { name: "implement-teammate", originated_by: "Alice", adopters: 2, uses: 6 },
      { name: "spec-reviewer", originated_by: "Charlie", adopters: 1, uses: 3 },
    ],
    skill_families: [
      { family: "harness-*", members: 3, uses: 14 },
      { family: "release-*", members: 2, uses: 4 },
      { family: "kipwise-*", members: 1, uses: 5 },
      { family: "superpowers:*", members: 4, uses: 22 },
    ],
    skills_loaded_never_dispatched: [
      { name: "superpowers:requesting-code-review", loads: 3 },
      { name: "release-ship-check", loads: 1 },
    ],
    skills_newly_authored_this_week: [
      { name: "spec-frame-loader", author: "Charlie", date: "2026-05-05" },
    ],
    preflight_skill_loads: [
      { skill: "superpowers:brainstorming", sessions: 4 },
      { skill: "superpowers:writing-plans", sessions: 3 },
      { skill: "harness-orchestrate", sessions: 3 },
      { skill: "kipwise-migration-guard", sessions: 5 },
    ],
    midsession_skill_loads: [
      { skill: "superpowers:systematic-debugging", sessions: 3 },
      { skill: "superpowers:test-driven-development", sessions: 2 },
    ],
    sessions_with_zero_skills: 6,
    stock_vs_user_ratio_per_member: [
      { member: "Charlie", stock_pct: 68 },
      { member: "Alice", stock_pct: 41 },
      { member: "Bob", stock_pct: 53 },
      { member: "Dana", stock_pct: 92 },
    ],
    slash_commands_used: [
      { command: "/ultrareview", uses: 3, users: 2 },
      { command: "/loop", uses: 2, users: 1 },
      { command: "/init", uses: 1, users: 1 },
    ],
    skill_diffusion_events: [
      { skill: "harness-orchestrate", from_member: "Alice", to_member: "Charlie", date: "2026-05-07" },
      { skill: "release-ship-check", from_member: "Charlie", to_member: "Dana", date: "2026-05-09" },
    ],
    skills_abandoned_this_week: [
      { name: "old-spec-linter", prev_uses: 7, current_uses: 0 },
    ],
    skill_descriptions_updated_midweek: [
      { skill: "harness-orchestrate", member: "Alice" },
    ],
  },

  // ─── F. Delegation / subagent ───────────────────────────────────────────
  delegation: {
    subagent_dispatches_per_member: [
      { member: "Charlie", count: 11 },
      { member: "Alice", count: 14 },
      { member: "Bob", count: 3 },
      { member: "Dana", count: 0 },
    ],
    parallel_vs_sequential_batches: { parallel: 8, sequential: 20 },
    background_runs: 4,
    subagent_types_invoked: [
      { type: "general-purpose", count: 9 },
      { type: "Explore", count: 6 },
      { type: "implement-teammate", count: 6 },
      { type: "code-reviewer", count: 4 },
      { type: "spec-reviewer", count: 3 },
    ],
    user_authored_vs_stock_per_member: [
      { member: "Charlie", user_pct: 27 },
      { member: "Alice", user_pct: 43 },
      { member: "Bob", user_pct: 0 },
      { member: "Dana", user_pct: 0 },
    ],
    avg_subagent_prompt_chars: 384,
    reviewer_triad_sessions: 1,
    implementer_reviewer_pairs: 3,
    orchestration_brief_first_sessions: 3,
    solo_vs_orchestrated_per_member: [
      { member: "Charlie", orchestrated_pct: 38 },
      { member: "Alice", orchestrated_pct: 64 },
      { member: "Bob", orchestrated_pct: 12 },
      { member: "Dana", orchestrated_pct: 0 },
    ],
    subagent_shipping_rate_pct: 71,
  },

  // ─── G. Plan mode ───────────────────────────────────────────────────────
  plan_mode: {
    adopters: 3,
    plan_then_build_vs_dive_in_ratio: 0.62,
    avg_plan_duration_min: 8.4,
    plans_shipped: 7,
    plans_abandoned: 1,
    brainstorm_warmup_adopters: 2,
    longest_discipline_streak_days: 4,
    warmup_ritual_sessions: 5,
  },

  // ─── H. Outcomes / shipping ─────────────────────────────────────────────
  outcomes: {
    prs_shipped: 6,
    prs_per_member: [
      { member: "Charlie", count: 3 },
      { member: "Alice", count: 1 },
      { member: "Bob", count: 2 },
      { member: "Dana", count: 0 },
    ],
    prs_per_project: [
      { project: "topeka", count: 3 },
      { project: "kipwise-v1", count: 2 },
      { project: "ops-runbooks", count: 1 },
      { project: "infra-bootstrap", count: 0 },
    ],
    sessions_ending_in_commit: 24,
    sessions_ending_in_pr: 6,
    median_first_user_to_merge_min_per_member: [
      { member: "Charlie", minutes: 88 },
      { member: "Alice", minutes: 47 },
      { member: "Bob", minutes: 264 },
      { member: "Dana", minutes: 0 },
    ],
    per_project_outcome: [
      { project: "topeka", shipped: 3, partial: 1, blocked: 0 },
      { project: "kipwise-v1", shipped: 2, partial: 0, blocked: 0 },
      { project: "ops-runbooks", shipped: 1, partial: 1, blocked: 0 },
      { project: "infra-bootstrap", shipped: 0, partial: 1, blocked: 1 },
    ],
    skill_ship_rate: [
      { skill: "harness-orchestrate", ship_rate_pct: 100 },
      { skill: "kipwise-migration-guard", ship_rate_pct: 100 },
      { skill: "release-ship-check", ship_rate_pct: 75 },
      { skill: "superpowers:brainstorming", ship_rate_pct: 67 },
    ],
    subagent_ship_rate: [
      { subagent: "implement-teammate", ship_rate_pct: 83 },
      { subagent: "spec-reviewer", ship_rate_pct: 100 },
      { subagent: "code-reviewer", ship_rate_pct: 75 },
    ],
    time_of_day_ship_rate: [
      { hour: 9, ship_rate_pct: 50 },
      { hour: 10, ship_rate_pct: 67 },
      { hour: 14, ship_rate_pct: 80 },
      { hour: 16, ship_rate_pct: 45 },
      { hour: 22, ship_rate_pct: 20 },
    ],
    shipping_rate_ranking: [
      { member: "Alice", ship_rate_pct: 91 },
      { member: "Charlie", ship_rate_pct: 71 },
      { member: "Bob", ship_rate_pct: 56 },
      { member: "Dana", ship_rate_pct: 0 },
    ],
  },

  // ─── I. Friction / failure ──────────────────────────────────────────────
  friction: {
    cooccurring_friction: [
      {
        kind: "migration-safety",
        members_affected: ["Bob", "Dana"],
        description:
          "Bob caught a NOT-NULL backfill issue via kipwise-migration-guard on Wednesday; Dana hit the same shape on infra-bootstrap on Friday without a guard and ate a revert. Same friction, different harness preparation.",
      },
      {
        kind: "TypeScript-import-resolution",
        members_affected: ["Charlie", "Alice"],
        description:
          "Both hit cross-package type imports (@claude-lens/entries to team-server) requiring local type aliases. Multiple workaround patterns landed in different places.",
      },
    ],
    frustrated_sessions: 4,
    multi_interrupt_sessions: 6,
    abandoned_sessions: 3,
    loops_detected: 2,
    long_autonomous_failures: 1,
    shared_errors: [
      { error: "Type 'X' is not assignable to type 'Y'", members_affected: ["Charlie", "Alice"] },
      { error: "Connection refused on PG socket", members_affected: ["Charlie", "Dana"] },
    ],
    shared_dependency_trouble: [
      { dep: "@claude-lens/entries", members: ["Charlie", "Alice"] },
      { dep: "drizzle-kit", members: ["Bob"] },
    ],
    shared_external_systems_frustrated: [
      { system: "Linear", refs: ["KIP-148", "KIP-152"] },
    ],
    friction_rate_per_member: [
      { member: "Charlie", rate_pct: 6 },
      { member: "Alice", rate_pct: 0 },
      { member: "Bob", rate_pct: 33 },
      { member: "Dana", rate_pct: 20 },
    ],
    retry_same_op_count: 9,
    recovery_moves: [
      {
        description: "Bob's kipwise-migration-guard caught a DROP COLUMN before commit; revised in 4 turns.",
        member: "Bob",
        date: "2026-05-06",
      },
      {
        description: "Alice rolled back a parallel-dispatch session that returned conflicting diffs by re-running the orchestration brief.",
        member: "Alice",
        date: "2026-05-05",
      },
    ],
  },

  // ─── J. Diffusion ───────────────────────────────────────────────────────
  diffusion: {
    skill_pickups: [
      { skill: "harness-orchestrate", from_member: "Alice", to_member: "Charlie", days_to_pickup: 3 },
      { skill: "release-ship-check", from_member: "Charlie", to_member: "Dana", days_to_pickup: 5 },
    ],
    subagent_spread: [
      { type: "implement-teammate", weeks_ago: 4, users_then: 1, users_now: 2 },
      { type: "spec-reviewer", weeks_ago: 2, users_then: 1, users_now: 1 },
    ],
    skill_family_curve: [
      { family: "harness-*", weekly: [1, 2, 3, 3] },
      { family: "release-*", weekly: [0, 0, 1, 2] },
      { family: "kipwise-*", weekly: [1, 1, 1, 1] },
    ],
    prompt_pattern_diffusion: [
      {
        pattern: "lead with the goal-statement, end with the verification gate",
        first_seen_by: "Charlie",
        spread_to: ["Alice"],
      },
      {
        pattern: "embed Linear KIP refs at the top of long-form briefs",
        first_seen_by: "Bob",
        spread_to: ["Charlie"],
      },
    ],
    tool_pattern_spreading: [
      { pattern: "Read-then-Grep-then-Edit (no Bash for code search)", adopters: ["Charlie", "Alice", "Bob"] },
      { pattern: "TodoWrite immediately after the spec is loaded", adopters: ["Charlie", "Alice"] },
    ],
    plan_mode_curve: [1, 2, 3, 3],
    brainstorm_warmup_curve: [0, 1, 2, 2],
    reverse_diffusion: [
      { practice: "manual diff-then-commit (no Task subagents)", peak_count: 3, current_count: 1 },
    ],
    first_used_other_member_skill_events: [
      { event_member: "Charlie", skill: "harness-orchestrate", original_author: "Alice", date: "2026-05-07" },
      { event_member: "Dana", skill: "release-ship-check", original_author: "Charlie", date: "2026-05-09" },
    ],
    velocity_diffusion_note:
      "Median session-to-PR-merge time dropped 18% week-over-week; the drop is concentrated in topeka sessions, suggesting the harness-orchestrate pattern is starting to pay off.",
    skill_authoring_rate_trend: [0, 1, 1, 2],
  },

  // ─── K. Co-occurrence ───────────────────────────────────────────────────
  cooccurrence: {
    shared_friction_kinds: [
      { kind: "migration-safety", members: ["Bob", "Dana"] },
      { kind: "TypeScript import resolution", members: ["Charlie", "Alice"] },
    ],
    shared_files_same_week: [
      { path: "CLAUDE.md", members: ["Charlie", "Alice", "Bob"] },
      { path: "packages/parser/src/analytics.ts", members: ["Charlie", "Alice"] },
      { path: "scripts/conductor-setup.sh", members: ["Charlie", "Dana"] },
    ],
    shared_external_refs: [
      { ref: "KIP-148", members: ["Bob", "Charlie"] },
      { ref: "#41", members: ["Charlie", "Dana"] },
    ],
    shared_skills_same_day: [
      { skill: "harness-orchestrate", date: "2026-05-07", members: ["Alice", "Charlie"] },
      { skill: "superpowers:writing-plans", date: "2026-05-04", members: ["Charlie", "Alice"] },
    ],
    concurrent_sessions: [
      { date: "2026-05-07", window: "14:20–15:08", members: ["Alice", "Charlie", "Bob", "Dana"] },
      { date: "2026-05-05", window: "10:11–10:58", members: ["Alice", "Charlie"] },
    ],
    shared_debugging: [
      { dep: "@claude-lens/entries", members: ["Charlie", "Alice"] },
      { dep: "fleetlens-topeka Postgres", members: ["Charlie", "Dana"] },
    ],
    shared_subagent_dispatch_kinds: [
      { type: "Explore", members: ["Charlie", "Alice", "Bob"] },
      { type: "implement-teammate", members: ["Alice", "Charlie"] },
    ],
  },

  // ─── L. Bench (team comparative) ────────────────────────────────────────
  bench: {
    task_category_bench: [
      { category: "migrations", member: "Bob", metric_label: "1-pass ship rate 100% (kipwise-migration-guard)" },
      { category: "parallel dispatch", member: "Alice", metric_label: "3/3 sessions shipped on first pass" },
      { category: "spec-first reviews", member: "Charlie", metric_label: "reviewer-triad shipped zero-rework" },
      { category: "infra bring-up", member: "Charlie", metric_label: "fastest workspace setup via release-ship-check" },
      { category: "refactors", member: "Charlie", metric_label: "median refactor session 22min" },
      { category: "debugging", member: "Bob", metric_label: "highest interrupt-rate but highest recovery rate" },
    ],
    highest_delegation_rate: { member: "Alice", dispatches_per_session: 1.27 },
    highest_skill_load_rate: { member: "Charlie", loads_per_session: 1.94 },
    most_disciplined_plan_mode_user: { member: "Charlie", days: 4 },
    most_parallel_dispatch_user: { member: "Alice", sessions: 3 },
    longest_autonomous_tolerance: { member: "Bob", hours: 4.2 },
    highest_first_pass_ship_rate: { member: "Alice", pct: 91 },
    most_diverse_project_portfolio: { member: "Charlie", projects: 3 },
    highest_user_authored_skill_output: { member: "Charlie", skills_authored: 2 },
    most_efficient_member: { member: "Charlie", metric: "lowest cost-per-PR ($17.07)" },
  },

  // ─── M. Novelty / invention ─────────────────────────────────────────────
  novelty: {
    weeks_invention: {
      headline: "Alice's brief-as-contract pattern for parallel agents",
      member: "Alice",
      session_date: "2026-05-05",
      project: "topeka",
      detail:
        "Front-load one orchestration brief subagent, treat its output as the immutable contract for all worker dispatches, dispatch all workers in parallel with no cross-communication, merge diffs at the end. Eliminates the coordination overhead that typically breaks parallel-agent runs. The other three teams running multi-agent fleets haven't done this yet.",
    },
    first_use_of_stock_skill: [
      { skill: "superpowers:dispatching-parallel-agents", member: "Alice", date: "2026-05-05" },
      { skill: "superpowers:finishing-a-development-branch", member: "Charlie", date: "2026-05-12" },
    ],
    first_successful_parallel_dispatch: { member: "Alice", date: "2026-05-05" },
    first_long_autonomous_ship: { member: "Bob", date: "2026-05-06", hours: 4.2 },
    first_used_other_member_skill: [
      { event_member: "Charlie", skill: "harness-orchestrate", original_author: "Alice" },
      { event_member: "Dana", skill: "release-ship-check", original_author: "Charlie" },
    ],
    unprecedented_move:
      "Charlie's spec-frame-loader skill (authored Tue) is the team's first metasynthesized skill — a skill that loads other skills based on the session's first_user signature.",
    new_claudemd_additions: [
      {
        member: "Charlie",
        summary: "added rule: 'Specs must declare phasing before any code task.'",
        trigger_date: "2026-05-08",
      },
      {
        member: "Bob",
        summary: "added rule: 'Migrations on tables >10M rows require explicit confirmation.'",
        trigger_date: "2026-05-06",
      },
    ],
    new_project_introduced: [
      { project: "infra-bootstrap", member: "Charlie", date: "2026-05-11" },
    ],
  },

  // ─── N. External systems ────────────────────────────────────────────────
  external_systems: {
    linear_refs: [
      { ref: "KIP-148", member: "Bob", sessions: 3 },
      { ref: "KIP-152", member: "Alice", sessions: 2 },
      { ref: "KIP-144", member: "Charlie", sessions: 1 },
    ],
    github_refs: [
      { ref: "#41", member: "Charlie", sessions: 4 },
      { ref: "#39", member: "Charlie", sessions: 1 },
    ],
    branch_refs: [
      { branch: "cowcow02/team-insights-report", sessions: 8 },
      { branch: "release/0.10.0", sessions: 2 },
    ],
    url_refs_count: 14,
    external_triggered_sessions: 6,
    sessions_ending_with_pr_post: 5,
    most_leaned_on_system: { system: "Linear (KIP-*)", refs: 6 },
  },

  // ─── O. Prompting fingerprint ───────────────────────────────────────────
  prompting_fingerprint: {
    style_per_member: [
      { member: "Charlie", style: "Structured-imperative", descriptor: "Long briefs, numbered phases, code blocks for shape" },
      { member: "Alice", style: "Terse-imperative", descriptor: "Short one-liners, high delegation, low structure" },
      { member: "Bob", style: "Exploratory-conversational", descriptor: "Long context, external refs, many corrections mid-flight" },
      { member: "Dana", style: "Neutral-imperative", descriptor: "Medium-length, minimal structure, near-zero delegation (new)" },
    ],
    prompt_frame_mix_per_member: [
      { member: "Charlie", teammate: 2, slash_command: 1, image_attached: 0, handoff_prose: 4 },
      { member: "Alice", teammate: 6, slash_command: 0, image_attached: 0, handoff_prose: 1 },
      { member: "Bob", teammate: 0, slash_command: 0, image_attached: 2, handoff_prose: 1 },
      { member: "Dana", teammate: 0, slash_command: 1, image_attached: 0, handoff_prose: 0 },
    ],
    first_user_length_histogram: [
      { bucket: "<100 chars", count: 15 },
      { bucket: "100–500", count: 13 },
      { bucket: "500–2000", count: 9 },
      { bucket: ">2000", count: 4 },
    ],
  },

  // ─── P. Rhythm / time-of-day ────────────────────────────────────────────
  rhythm: {
    team_hour_histogram: [
      0, 0, 0, 0, 0, 0, 0, 1, 4, 12, 18, 21, 14, 9, 24, 22, 19, 14, 8, 6, 4, 2, 1, 0,
    ],
    per_member_hour_histogram: [
      { member: "Charlie", histogram: [0, 0, 0, 0, 0, 0, 0, 0, 2, 6, 9, 8, 5, 3, 11, 9, 7, 4, 2, 1, 0, 0, 0, 0] },
      { member: "Alice", histogram: [0, 0, 0, 0, 0, 0, 0, 0, 1, 3, 5, 6, 4, 2, 7, 7, 5, 3, 1, 0, 0, 0, 0, 0] },
      { member: "Bob", histogram: [0, 0, 0, 0, 0, 0, 0, 1, 1, 3, 4, 6, 4, 3, 4, 5, 6, 6, 4, 4, 3, 2, 1, 0] },
      { member: "Dana", histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 0, 0, 0] },
    ],
    weekday_histogram: [
      { weekday: "Mon", count: 7 },
      { weekday: "Tue", count: 9 },
      { weekday: "Wed", count: 8 },
      { weekday: "Thu", count: 7 },
      { weekday: "Fri", count: 6 },
      { weekday: "Sat", count: 2 },
      { weekday: "Sun", count: 2 },
    ],
    peak_hours: [14, 15, 11],
    late_night_sessions: [
      { member: "Bob", count: 3 },
      { member: "Charlie", count: 1 },
    ],
    weekend_sessions: [
      { member: "Bob", count: 2 },
      { member: "Charlie", count: 1 },
      { member: "Dana", count: 1 },
    ],
    multi_timezone_signal: "Bob's activity histogram is shifted 4h later than Alice's — likely cross-TZ collaboration window.",
    burndown_shape: "Tue/Wed peak (mid-week), Fri tapers — typical for spec→ship cadence.",
    burnout_proxy: [
      { member: "Bob", signal: "Three late-night sessions Tue/Wed/Thu, all > 2h. Worth a check-in." },
    ],
  },

  // ─── Q. Velocity ────────────────────────────────────────────────────────
  velocity: {
    median_first_user_to_commit_per_member: [
      { member: "Charlie", minutes: 41 },
      { member: "Alice", minutes: 22 },
      { member: "Bob", minutes: 168 },
      { member: "Dana", minutes: 0 },
    ],
    median_first_user_to_pr_per_member: [
      { member: "Charlie", minutes: 72 },
      { member: "Alice", minutes: 31 },
      { member: "Bob", minutes: 224 },
      { member: "Dana", minutes: 0 },
    ],
    median_first_user_to_merge_min: 81,
    active_vs_wall_clock_ratio_sample: [
      { session_id: "S-charlie-mon-am", project: "topeka", ratio_pct: 78 },
      { session_id: "S-alice-tue-pm", project: "topeka", ratio_pct: 96 },
      { session_id: "S-bob-wed", project: "kipwise-v1", ratio_pct: 71 },
    ],
    sessions_per_day: [
      { date: "2026-05-04", count: 7 },
      { date: "2026-05-05", count: 9 },
      { date: "2026-05-06", count: 8 },
      { date: "2026-05-07", count: 7 },
      { date: "2026-05-08", count: 6 },
      { date: "2026-05-09", count: 2 },
      { date: "2026-05-10", count: 2 },
    ],
    prs_per_week_trend: [3, 4, 4, 6],
    velocity_per_project_trend: [
      { project: "topeka", weekly: [2, 3, 2, 3] },
      { project: "kipwise-v1", weekly: [1, 1, 2, 2] },
      { project: "ops-runbooks", weekly: [0, 0, 0, 1] },
    ],
  },

  // ─── R. Knowledge flow ──────────────────────────────────────────────────
  knowledge_flow: {
    pattern_a_to_b: [
      {
        pattern: "Front-load orchestration brief subagent before parallel dispatch",
        member_a: "Alice",
        date_a: "2026-05-05",
        member_b: "Charlie",
        date_b: "2026-05-08",
      },
      {
        pattern: "Embed migration-guard skill before any ALTER TABLE",
        member_a: "Bob",
        date_a: "2026-05-06",
        member_b: "Dana",
        date_b: "2026-05-10",
      },
    ],
    pattern_main_to_subagent: [
      { pattern: "Read-then-Grep-then-Edit (no Bash for code search)", session_label: "Charlie · Mon · topeka" },
      { pattern: "TodoWrite right after spec load", session_label: "Alice · Tue · topeka" },
    ],
    pattern_to_claudemd: [
      { pattern: "Specs must declare phasing before any code task.", member: "Charlie", addition_date: "2026-05-08" },
      { pattern: "Migrations on tables >10M rows require explicit confirmation.", member: "Bob", addition_date: "2026-05-06" },
    ],
    skill_refined_after_session: [
      {
        skill: "harness-orchestrate",
        member: "Alice",
        refinement: "Added a `verification_gate` field to the orchestration brief schema after Tuesday's session surfaced conflicting diffs.",
      },
    ],
    multi_day_threads: [
      { thread_id: "T-team-insights-spec", member: "Charlie", days: 4, sessions: 6 },
      { thread_id: "T-kipwise-migration", member: "Bob", days: 3, sessions: 4 },
    ],
    handoff_prose_events: [
      { member: "Charlie", from_session: "Mon-pm", to_session: "Tue-am", date: "2026-05-04" },
      { member: "Charlie", from_session: "Wed-am", to_session: "Wed-pm", date: "2026-05-06" },
    ],
    cross_member_threads: [
      { topic: "team insight report design", members: ["Charlie", "Alice"], sessions: 3 },
    ],
  },

  // ─── S. AI behavior ─────────────────────────────────────────────────────
  ai_behavior: {
    model_usage: [
      { model: "claude-opus-4-7", share_pct: 64 },
      { model: "claude-sonnet-4-6", share_pct: 28 },
      { model: "claude-haiku-4-5", share_pct: 8 },
    ],
    model_mix_per_session_avg: { opus: 0.64, sonnet: 0.28, haiku: 0.08 },
    model_fallback_events: 3,
    extended_thinking_rate_pct: 21,
    high_clarification_sessions: 4,
    hallucination_flags: 2,
    reverted_tool_calls: 7,
    high_cost_sessions: [
      { session_label: "Bob · Wed · kipwise migration", cost_usd: 28.41, member: "Bob" },
      { session_label: "Charlie · Tue · spec design", cost_usd: 19.62, member: "Charlie" },
    ],
    cache_hit_rate_avg_pct: 78,
    agent_helpfulness_per_member: [
      { member: "Charlie", essential: 8, helpful: 6, neutral: 2, unhelpful: 0 },
      { member: "Alice", essential: 7, helpful: 3, neutral: 1, unhelpful: 0 },
      { member: "Bob", essential: 5, helpful: 2, neutral: 1, unhelpful: 1 },
      { member: "Dana", essential: 2, helpful: 2, neutral: 1, unhelpful: 0 },
    ],
  },

  // ─── T. Cost / efficiency ───────────────────────────────────────────────
  cost_efficiency: {
    cost_per_pr_per_project: [
      { project: "topeka", cost_usd: 62.45, prs: 3, ratio: 20.82 },
      { project: "kipwise-v1", cost_usd: 38.84, prs: 2, ratio: 19.42 },
      { project: "ops-runbooks", cost_usd: 27.91, prs: 1, ratio: 27.91 },
    ],
    tokens_per_pr_team: 4_546_667,
    plan_utilization_burndown_pct: 64,
    extra_usage_spend_per_project: [
      { project: "topeka", usd: 12.40 },
      { project: "kipwise-v1", usd: 8.10 },
    ],
    cost_trend_wow_pct: 8,
    high_cost_low_yield_sessions: [
      {
        description: "Long exploratory session on ops-runbooks that produced no commits and re-opened a closed Linear ticket.",
        cost_usd: 14.20,
        outcome: "exploratory · no ship",
      },
    ],
  },

  // ─── U. Coverage ────────────────────────────────────────────────────────
  coverage: {
    untouched_files_count: 1247,
    untouched_directories: [
      "packages/entries/src/prompts/",
      "apps/web/components/runs-live-board.tsx",
      ".github/workflows/",
      "scripts/generate-mock-usage.mjs",
    ],
    universal_contact_files: ["CLAUDE.md"],
    new_files_by_agent: 17,
    agent_authored_test_files: 1,
    agent_authored_doc_files: 3,
    legacy_zones_with_activity: [
      { zone: "packages/parser/src/codex.ts", sessions: 2 },
      { zone: "packages/parser/src/gemini.ts", sessions: 1 },
    ],
  },

  // ─── V. Trend (multi-week) ──────────────────────────────────────────────
  trend: {
    skill_adoption_curves: [
      { skill: "harness-orchestrate", weekly: [1, 1, 2, 3] },
      { skill: "kipwise-migration-guard", weekly: [1, 1, 1, 1] },
      { skill: "release-ship-check", weekly: [0, 0, 1, 2] },
      { skill: "superpowers:brainstorming", weekly: [2, 3, 3, 4] },
    ],
    subagent_dispatch_trend: [14, 19, 22, 28],
    plan_mode_trend: [1, 2, 3, 3],
    velocity_trend: [3, 4, 4, 6],
    cost_trend: [98.40, 112.60, 131.80, 142.36],
    skill_authoring_rate_trend: [0, 1, 1, 2],
    maturity_composite_weekly: [42, 48, 54, 61],
    diffusion_velocity_note: "Median time from a new skill being authored to first cross-member pickup dropped from 9 days four weeks ago to 3 days this week.",
  },

  // ─── W. Onboarding ──────────────────────────────────────────────────────
  onboarding: {
    ramp_up_curves: [
      { member: "Dana", weeks_since_join: 3, weekly_hours: [0.4, 0.9, 1.4] },
    ],
    first_skill_load: [
      { member: "Dana", skill: "superpowers:using-superpowers", days_since_join: 0 },
    ],
    first_subagent_dispatch: [
      { member: "Dana", type: "Explore", days_since_join: 12 },
    ],
    first_plan_mode: [
      { member: "Dana", days_since_join: 9 },
    ],
    first_pr_via_agents: [
      { member: "Dana", days_since_join: 0 }, // not shipped yet
    ],
    time_to_first_ship: [
      { member: "Dana", days: 0 }, // pending
    ],
  },

  // ─── X. Manager affordances ─────────────────────────────────────────────
  manager: {
    wins_this_week: [
      { member: "Alice", win: "Authored the brief-as-contract pattern; 3/3 parallel-dispatch sessions shipped." },
      { member: "Bob", win: "kipwise-migration-guard caught two would-be reverts on Wed's migration." },
      { member: "Charlie", win: "Lowest cost-per-PR at $17.07; reviewer-triad pattern landed zero-rework PR." },
    ],
    topics_for_oneonone: [
      { member: "Alice", topic: "Ask about generalizing harness-orchestrate beyond topeka — anyone else can use it?" },
      { member: "Bob", topic: "Three late-night sessions this week; check on workload + ask about long-autonomous tolerance." },
      { member: "Dana", topic: "Two weeks in — first subagent dispatch happened Friday. What did the ramp feel like?" },
    ],
    concerns_to_address: [
      { member: "Bob", concern: "Highest tool-error rate (6.4%) + highest interrupt rate (1.1/session) — friction is concentrated here." },
      { member: "Dana", concern: "Zero PRs shipped in 3 weeks since join. Likely onboarding-pacing, but worth confirming." },
    ],
    onboarding_suggestions: [
      { member: "Dana", suggestion: "Pair on a topeka session with Alice next week — exposure to harness-orchestrate before adopting it solo." },
    ],
    ask_x_about_y: [
      { ask_member: "Alice", topic: "parallel dispatch / harness-orchestrate" },
      { ask_member: "Bob", topic: "long-autonomous turns / migration safety" },
      { ask_member: "Charlie", topic: "spec phasing / reviewer-triad" },
    ],
    friday_demo_candidates: [
      { session_label: "Alice · Tue · topeka · 47-min parallel ship", member: "Alice" },
      { session_label: "Bob · Wed · kipwise-v1 · 4.2h autonomous migration", member: "Bob" },
    ],
  },

  // ─── Y. Org roll-up ─────────────────────────────────────────────────────
  org_rollup: {
    team_maturity_score: { current: 61, prior: 54, trend: "up" },
    quarterly_agent_shipping_trend: [12, 18, 24, 31],
    team_vs_org_comparison: [
      { metric: "PRs shipped per week", team: 6, org_baseline: 4.2 },
      { metric: "Skills authored per month", team: 4, org_baseline: 1.8 },
      { metric: "Plan-mode adoption %", team: 75, org_baseline: 41 },
      { metric: "Cost per PR ($)", team: 23.7, org_baseline: 31.2 },
    ],
    roi_per_team: [
      { team: "Acme Eng", cost_per_pr: 23.7 },
      { team: "Acme Platform", cost_per_pr: 31.2 },
      { team: "Acme Mobile", cost_per_pr: 41.8 },
    ],
    skill_authoring_rate: 2,
    bus_factor_practices: [
      { practice: "kipwise-migration-guard", sole_practitioner: "Bob" },
      { practice: "spec-frame-loader", sole_practitioner: "Charlie" },
    ],
  },

  // ─── Z. Pair work / threads ─────────────────────────────────────────────
  pair_work: {
    multiday_continuations: [
      { thread_id: "T-team-insights-spec", member: "Charlie", days: 4 },
      { thread_id: "T-kipwise-migration", member: "Bob", days: 3 },
    ],
    coauthored_commits: [
      { file: "CLAUDE.md", members: ["Charlie", "Alice", "Bob"], date: "2026-05-08" },
      { file: "packages/parser/src/analytics.ts", members: ["Charlie", "Alice"], date: "2026-05-06" },
    ],
    cross_session_threads: [
      { topic: "team insight report design", sessions: 6, member: "Charlie" },
      { topic: "kipwise migration runbook", sessions: 4, member: "Bob" },
    ],
    hot_files: [
      { path: "packages/team-server/src/app/team/[slug]/insights/page.tsx", consecutive_sessions: 5 },
      { path: "docs/superpowers/specs/2026-05-14-*.md", consecutive_sessions: 4 },
    ],
  },

  // ─── AA. Outliers / surprises ───────────────────────────────────────────
  outliers: {
    atypical_day_per_member: [
      { member: "Bob", date: "2026-05-06", what_was_different: "4.2h autonomous turn — 6× his weekly median session length." },
      { member: "Alice", date: "2026-05-05", what_was_different: "47-min session shipped a PR; her usual session is ~2h." },
    ],
    unexpected_project_attention: { project: "infra-bootstrap", usual_hours: 0, this_week: 1.7 },
    abandoned_skill_outliers: [
      { skill: "old-spec-linter", prev_uses: 7, current_uses: 0 },
    ],
    spiked_subagent: { type: "implement-teammate", usual: 2, this_week: 6 },
    interrupt_spike: { member: "Bob", usual: 0.4, this_week: 1.1 },
    outlier_long_autonomous: { member: "Bob", hours: 4.2, median: 0.7 },
    novel_friction_kind: {
      kind: "@claude-lens/entries cross-package type resolution",
      member: "Charlie",
    },
  },

  // ─── BB. Spotlights ─────────────────────────────────────────────────────
  spotlights: [
    {
      id: "spotlight-charlie-mon-spec-review",
      flavor: "case-study",
      author: "Charlie",
      session_meta: { date: "2026-05-04", project: "topeka", duration_hours: 3.1, shipped: 1 },
      title: "A reviewer-triad before any code was written",
      body:
        "Charlie opened Monday on topeka by pinning a reviewer-triad on the spec before writing any code. Three reviewer subagents dispatched in parallel — one with a correctness lens, one with an ergonomics lens, one with a rollback lens — each reading the full spec and returning structured findings. Charlie merged the three reviews into a revised spec, then started implementation only after the spec converged.\n\nThe session ran 3.1 active hours and produced one shipped PR with zero follow-up review cycles needed. The upfront triad caught edge cases that would normally surface during the first review pass — a meaningful pattern for any spec where the cost of a revert is high.",
      harness_signature: "skills: superpowers:writing-plans, superpowers:brainstorming · subagents: spec-reviewer ×3 (parallel dispatch) · tools: Read ×84, Edit ×26, Write ×11",
    },
    {
      id: "spotlight-bob-wed-migration",
      flavor: "long-autonomous",
      author: "Bob",
      session_meta: { date: "2026-05-06", project: "kipwise-v1", duration_hours: 7.0, shipped: 1 },
      title: "A migration that didn't need a rework cycle",
      body:
        "Bob spent Wednesday on a column-not-null migration on a 50M-row table. Two long autonomous turns (4.2h and 2.8h) carried the migration end-to-end without a rework cycle, which is unusual for a flag-touching change — typically these come back twice before shipping.\n\nThe load-bearing piece was Bob's kipwise-migration-guard skill, loaded at session start. It gates risky operations (DROP COLUMN, ALTER TABLE, anything touching audit_log) behind explicit confirmation prompts, and on Wednesday it caught two would-be early commits before they landed. The pattern: long autonomous runs become safe when there's a deterministic guardrail catching the irreversible moves, even when the LLM is otherwise in a build-fast mode. Worth studying as a template for any future migration touching live tables.",
      harness_signature: "skills: kipwise-migration-guard ×5 · long-autonomous turns: 4.2h, 2.8h · tools: Bash ×142, Edit ×38, Read ×96",
    },
    {
      id: "spotlight-alice-tue-parallel",
      flavor: "agent-team",
      author: "Alice",
      session_meta: { date: "2026-05-05", project: "topeka", duration_hours: 0.78, shipped: 1 },
      title: "Four parallel workers, one orchestration brief",
      body:
        "Alice on Tuesday afternoon dispatched four worker subagents in parallel against topeka, all reading a single orchestration brief that Alice loaded first via harness-orchestrate. The workers had no cross-communication — each took its slice, ran in isolation, and returned its diff. The orchestration brief was the contract.\n\nResult: 47 minutes of wall-clock to a shipped PR. The same work split across four sequential sessions would have taken closer to three hours. Across the team this week, this is the only session in which parallel dispatch shipped on the first pass — the brief-as-contract pattern eliminated the coordination overhead that typically breaks parallel-agent runs. Worth a Friday demo, and worth copying anywhere on the team that's running parallel agents regularly.",
      harness_signature: "skills: harness-orchestrate ×1 (brief loaded once) · subagents: implement-teammate ×4 (parallel dispatch) · tools: Task ×4, Edit ×12, Bash ×31",
    },
    {
      id: "spotlight-alice-thu-rescue",
      flavor: "rescue",
      author: "Alice",
      session_meta: { date: "2026-05-07", project: "topeka", duration_hours: 1.2, shipped: 1 },
      title: "Recovering from a conflict-diff parallel-dispatch run",
      body:
        "Alice's Thursday session opened with the same parallel-dispatch shape as Tuesday's, but two workers returned conflicting diffs to the same file. Alice's recovery move: kill the merge, re-run the orchestration brief with an explicit non-overlap constraint, redispatch — shipped within an hour. The pattern matters because the natural failure mode of parallel dispatch is silent drift; here the team has a recovery template.",
      harness_signature: "skills: harness-orchestrate (re-run) · subagents: implement-teammate ×4 (second dispatch) · tools: Task ×4, Edit ×9",
    },
    {
      id: "spotlight-charlie-tue-harness-invention",
      flavor: "harness-invention",
      author: "Charlie",
      session_meta: { date: "2026-05-05", project: "topeka", duration_hours: 2.4, shipped: 0 },
      title: "Authoring spec-frame-loader — a skill that loads other skills",
      body:
        "Charlie's Tuesday afternoon session produced the team's first metasynthesized skill: spec-frame-loader. The skill reads the session's first_user and decides which of (writing-plans, brainstorming, systematic-debugging, …) to load before any tool runs. It's a skill that picks skills.\n\nThe session didn't ship a PR — the work was meta — but the skill landed in CLAUDE.md and is already loaded in two of Charlie's subsequent sessions. The diffusion frontier worth watching.",
      harness_signature: "skills: superpowers:writing-skills · skill authored: spec-frame-loader · tools: Edit ×17, Read ×42",
    },
  ],

  // ─── CC. Meta ───────────────────────────────────────────────────────────
  meta: {
    section_coverage: [
      { letter: "A", populated: true },
      { letter: "B", populated: true },
      { letter: "C", populated: true },
      { letter: "D", populated: true },
      { letter: "E", populated: true },
      { letter: "F", populated: true },
      { letter: "G", populated: true },
      { letter: "H", populated: true },
      { letter: "I", populated: true },
      { letter: "J", populated: true },
      { letter: "K", populated: true },
      { letter: "L", populated: true },
      { letter: "M", populated: true },
      { letter: "N", populated: true },
      { letter: "O", populated: true },
      { letter: "P", populated: true },
      { letter: "Q", populated: true },
      { letter: "R", populated: true },
      { letter: "S", populated: true },
      { letter: "T", populated: true },
      { letter: "U", populated: true },
      { letter: "V", populated: true },
      { letter: "W", populated: true },
      { letter: "X", populated: true },
      { letter: "Y", populated: true },
      { letter: "Z", populated: true },
      { letter: "AA", populated: true },
      { letter: "BB", populated: true },
      { letter: "CC", populated: true },
      { letter: "DD", populated: true },
    ],
    spotlight_rate_pct: 80,
    synthesis_cost_usd: 4.21,
    data_freshness: "Last session ingested 2026-05-12 09:08 PDT (6 min ago)",
    member_data_completeness_pct: 80,
  },

  // ─── DD. Cross-edition ──────────────────────────────────────────────────
  cross_edition: {
    member_links: [
      { member: "Charlie", personal_digest_shared: true, personal_digest_href: "/team/acme-eng/members/mock-charlie/digest/2026-05-04" },
      { member: "Alice", personal_digest_shared: true, personal_digest_href: "/team/acme-eng/members/mock-alice/digest/2026-05-04" },
      { member: "Bob", personal_digest_shared: false, personal_digest_href: null },
      { member: "Dana", personal_digest_shared: false, personal_digest_href: null },
    ],
    session_deep_links: [
      { session_label: "Alice · Tue · topeka · 47-min parallel ship", href: "/team/acme-eng/sessions/S-alice-tue-pm" },
      { session_label: "Bob · Wed · kipwise-v1 · 4.2h autonomous", href: "/team/acme-eng/sessions/S-bob-wed" },
      { session_label: "Charlie · Mon · topeka · reviewer-triad", href: "/team/acme-eng/sessions/S-charlie-mon-am" },
    ],
    roster: [
      { membership_id: "mock-membership-charlie", display_name: "Charlie", agent_hours: 6.8, shipped: 3 },
      { membership_id: "mock-membership-alice", display_name: "Alice", agent_hours: 4.9, shipped: 1 },
      { membership_id: "mock-membership-bob", display_name: "Bob", agent_hours: 5.3, shipped: 2 },
      { membership_id: "mock-membership-dana", display_name: "Dana", agent_hours: 1.4, shipped: 0 },
    ],
  },

  // ─── Variant-specific payloads ──────────────────────────────────────────
  variants: {
    // ─── v1: Member fingerprints ──────────────────────────────────────────
    fingerprints: [
      {
        member: "Charlie",
        role_hint: "Structured-imperative · planning-heavy",
        signature_move: "Brainstorm warmup → long structured brief → TodoWrite → small refinements",
        signature_paragraph:
          "Charlie almost always loads a brainstorming or writing-plans skill before any tool fires, then drops a 900-character structured brief, then iterates through small turn-by-turn refinements. The planning is front-loaded; the building is delegated. He's the team's lowest cost-per-PR ($17.07), and the front-loaded planning seems to be why.",
        this_week: {
          sessions: 16,
          hours: 6.8,
          prs: 3,
          median_first_user_to_merge_min: 88,
          notable_signals: [
            "Pre-flight skill loads in 11/16 sessions",
            "4-day plan-mode discipline streak",
            "Authored 2 new skills this week (release-ship-check, spec-frame-loader)",
            "First-time use of harness-orchestrate (picked up from Alice)",
          ],
        },
        arc: {
          weeks_back: 4,
          sessions_per_week: [9, 11, 14, 16],
          skill_loads_per_session: [0.8, 1.1, 1.5, 1.9],
          orchestrated_pct: [22, 28, 31, 38],
          median_session_min: [41, 38, 31, 25],
          first_user_to_merge_min: [124, 102, 95, 88],
          cost_per_pr_usd: [28.40, 24.10, 20.20, 17.07],
        },
        growth_synthesis:
          "Compressing planning into a tighter, more delegated workflow — sessions are getting shorter, orchestrated-session share is climbing, and time-to-merge is dropping four weeks running.",
      },
      {
        member: "Alice",
        role_hint: "Terse-imperative · delegator",
        signature_move: "Short brief → harness-orchestrate brief subagent → parallel workers → merge",
        signature_paragraph:
          "Alice writes the shortest briefs on the team (median ~80 chars) and relies on harness-orchestrate to expand them into structured orchestration briefs that workers can read. Three of her sessions this week dispatched ≥3 subagents in parallel. Workers don't talk to each other; the orchestration brief is the contract.",
        this_week: {
          sessions: 11,
          hours: 4.9,
          prs: 1,
          median_first_user_to_merge_min: 47,
          notable_signals: [
            "3/3 parallel-dispatch sessions shipped first-pass",
            "Authored the brief-as-contract pattern (week's invention)",
            "Highest delegation rate (1.27 dispatches/session)",
            "Brief length dropped 18% week-over-week — leaning more on harness",
          ],
        },
        arc: {
          weeks_back: 4,
          sessions_per_week: [7, 8, 10, 11],
          skill_loads_per_session: [0.4, 0.6, 1.2, 1.4],
          orchestrated_pct: [38, 47, 58, 64],
          median_session_min: [54, 48, 41, 38],
          first_user_to_merge_min: [82, 64, 51, 47],
          cost_per_pr_usd: [62.10, 48.80, 39.40, 36.74],
        },
        growth_synthesis:
          "Moving deeper into orchestration — briefs are shrinking as harness-orchestrate absorbs the structure, and first-pass ship rate keeps rising.",
      },
      {
        member: "Bob",
        role_hint: "Exploratory-conversational · long-autonomous",
        signature_move: "Long contextual brief → load migration-guard → long autonomous turn → review",
        signature_paragraph:
          "Bob writes the longest briefs on the team (median ~1400 chars) — heavy on external context, Linear ticket refs, error logs. Once briefed, the agent runs autonomously for a long time. His kipwise-migration-guard skill gates the irreversible operations, which is what lets the autonomous runs ship safely on flag-touching changes.",
        this_week: {
          sessions: 9,
          hours: 5.3,
          prs: 2,
          median_first_user_to_merge_min: 264,
          notable_signals: [
            "Longest single session: 4.2h autonomous on kipwise-v1",
            "Highest tool-error rate (6.4%) — also highest recovery rate",
            "Three late-night sessions (Tue/Wed/Thu) — worth a check-in",
            "Brief length rose 24% week-over-week — documenting more context up-front",
          ],
        },
        arc: {
          weeks_back: 4,
          sessions_per_week: [6, 7, 8, 9],
          skill_loads_per_session: [0.5, 0.6, 0.7, 0.8],
          orchestrated_pct: [8, 10, 11, 12],
          median_session_min: [38, 46, 58, 71],
          first_user_to_merge_min: [388, 312, 281, 264],
          cost_per_pr_usd: [34.20, 28.80, 23.40, 20.59],
        },
        growth_synthesis:
          "Building longer-running, lower-orchestration sessions — the bet is on better up-front context plus migration-guard, not delegation. Pattern is working: cost-per-PR keeps dropping even as autonomous runs get longer.",
      },
      {
        member: "Dana",
        role_hint: "New member · ramp-up week 3",
        signature_move: "Short imperative prompts → mostly stock skills → no subagents yet",
        signature_paragraph:
          "Dana joined three weeks ago and is mid-ramp. Sessions are short, stock-skill-heavy, near-zero delegation. The shape of her sessions resembles Alice's early weeks more than Bob's. Friday saw her first subagent dispatch (Explore) and her first cross-member skill pickup (release-ship-check from Charlie).",
        this_week: {
          sessions: 5,
          hours: 1.4,
          prs: 0,
          median_first_user_to_merge_min: 0,
          notable_signals: [
            "First subagent dispatch this week (Explore)",
            "First pickup of another member's skill: release-ship-check from Charlie",
            "Zero PRs shipped in 3 weeks — likely onboarding-pacing, not a problem yet",
            "Stock-vs-user skill ratio: 92% stock (still early)",
          ],
        },
        arc: {
          weeks_back: 4,
          sessions_per_week: [0, 2, 4, 5],
          skill_loads_per_session: [0, 0.5, 0.8, 1.0],
          orchestrated_pct: [0, 0, 0, 0],
          median_session_min: [0, 18, 22, 24],
          first_user_to_merge_min: [0, 0, 0, 0],
          cost_per_pr_usd: [0, 0, 0, 0],
        },
        growth_synthesis:
          "Standard new-member ramp — sessions and skill loads both climbing linearly. Friday's first subagent dispatch is the early-orchestration milestone usually seen around week 3-4.",
      },
    ],

    // ─── v2: Growth trajectories ──────────────────────────────────────────
    trajectory_rows: [
      {
        practice: "Sessions per week",
        unit: "sessions",
        direction_better: "higher",
        per_member: [
          { member: "Charlie", weekly: [9, 11, 14, 16], current_label: "16" },
          { member: "Alice", weekly: [7, 8, 10, 11], current_label: "11" },
          { member: "Bob", weekly: [6, 7, 8, 9], current_label: "9" },
          { member: "Dana", weekly: [0, 2, 4, 5], current_label: "5" },
        ],
      },
      {
        practice: "Pre-flight skill loads / session",
        unit: "loads",
        direction_better: "higher",
        per_member: [
          { member: "Charlie", weekly: [0.8, 1.1, 1.5, 1.9], current_label: "1.9" },
          { member: "Alice", weekly: [0.4, 0.6, 1.2, 1.4], current_label: "1.4" },
          { member: "Bob", weekly: [0.5, 0.6, 0.7, 0.8], current_label: "0.8" },
          { member: "Dana", weekly: [0, 0.5, 0.8, 1.0], current_label: "1.0" },
        ],
      },
      {
        practice: "Subagent dispatches / session",
        unit: "dispatches",
        direction_better: "higher",
        per_member: [
          { member: "Charlie", weekly: [0.4, 0.6, 0.8, 1.1], current_label: "1.1" },
          { member: "Alice", weekly: [0.8, 1.0, 1.2, 1.3], current_label: "1.3" },
          { member: "Bob", weekly: [0.1, 0.2, 0.2, 0.3], current_label: "0.3" },
          { member: "Dana", weekly: [0, 0, 0, 0.2], current_label: "0.2" },
        ],
      },
      {
        practice: "Orchestrated session share",
        unit: "%",
        direction_better: "higher",
        per_member: [
          { member: "Charlie", weekly: [22, 28, 31, 38], current_label: "38%" },
          { member: "Alice", weekly: [38, 47, 58, 64], current_label: "64%" },
          { member: "Bob", weekly: [8, 10, 11, 12], current_label: "12%" },
          { member: "Dana", weekly: [0, 0, 0, 0], current_label: "0%" },
        ],
      },
      {
        practice: "Plan-mode adoption (days/wk)",
        unit: "days",
        direction_better: "higher",
        per_member: [
          { member: "Charlie", weekly: [3, 3, 4, 4], current_label: "4" },
          { member: "Alice", weekly: [0, 1, 2, 2], current_label: "2" },
          { member: "Bob", weekly: [0, 0, 0, 0], current_label: "0" },
          { member: "Dana", weekly: [0, 0, 1, 1], current_label: "1" },
        ],
      },
      {
        practice: "Median brief length",
        unit: "chars",
        direction_better: "lower",
        per_member: [
          { member: "Charlie", weekly: [1100, 1050, 980, 920], current_label: "920" },
          { member: "Alice", weekly: [180, 140, 100, 80], current_label: "80" },
          { member: "Bob", weekly: [1100, 1200, 1320, 1400], current_label: "1400" },
          { member: "Dana", weekly: [0, 220, 280, 310], current_label: "310" },
        ],
      },
      {
        practice: "Median first-user → merge",
        unit: "min",
        direction_better: "lower",
        per_member: [
          { member: "Charlie", weekly: [124, 102, 95, 88], current_label: "88m" },
          { member: "Alice", weekly: [82, 64, 51, 47], current_label: "47m" },
          { member: "Bob", weekly: [388, 312, 281, 264], current_label: "264m" },
          { member: "Dana", weekly: [0, 0, 0, 0], current_label: "—" },
        ],
      },
      {
        practice: "Cost per shipped PR",
        unit: "$",
        direction_better: "lower",
        per_member: [
          { member: "Charlie", weekly: [28.40, 24.10, 20.20, 17.07], current_label: "$17" },
          { member: "Alice", weekly: [62.10, 48.80, 39.40, 36.74], current_label: "$37" },
          { member: "Bob", weekly: [34.20, 28.80, 23.40, 20.59], current_label: "$21" },
          { member: "Dana", weekly: [0, 0, 0, 0], current_label: "—" },
        ],
      },
      {
        practice: "Recovery moves (rescued sessions)",
        unit: "count",
        direction_better: "higher",
        per_member: [
          { member: "Charlie", weekly: [0, 1, 1, 2], current_label: "2" },
          { member: "Alice", weekly: [1, 1, 2, 3], current_label: "3" },
          { member: "Bob", weekly: [1, 2, 2, 2], current_label: "2" },
          { member: "Dana", weekly: [0, 0, 0, 0], current_label: "0" },
        ],
      },
    ],
    trajectory_observations: [
      {
        member: "Charlie",
        observation: "Pre-flight skill-loads more than doubled (0.8 → 1.9). The discipline is consolidating into a habit, and cost-per-PR is the lagging indicator: 39% drop in four weeks.",
      },
      {
        member: "Alice",
        observation: "Brief length dropping 18% week-over-week while delegation rate climbs — she's offloading structure to harness-orchestrate rather than to the prompt. The shape of her sessions is changing fast.",
      },
      {
        member: "Bob",
        observation: "Brief length is growing (1100 → 1400 chars), not shrinking — opposite of Alice. He's betting on richer up-front context rather than orchestration. Cost-per-PR still dropping, so the bet is paying off.",
      },
      {
        member: "Dana",
        observation: "Standard week-3 ramp curve. Friday's first subagent dispatch is the inflection most new members hit around week 3-4.",
      },
    ],

    // ─── v3: Practice diffusion grid ──────────────────────────────────────
    diffusion_practices: [
      { key: "plan_mode", label: "Plan-mode discipline", short_desc: "Uses ExitPlanMode before building" },
      { key: "brainstorm_warmup", label: "Brainstorm warmup", short_desc: "Opens with a brainstorming skill" },
      { key: "parallel_dispatch", label: "Parallel dispatch", short_desc: "≥3 subagents in parallel" },
      { key: "reviewer_triad", label: "Reviewer triad", short_desc: "Multiple reviewer subagents before merge" },
      { key: "long_autonomous", label: "Long autonomous", short_desc: "Tolerates >1h autonomous turns" },
      { key: "skill_authoring", label: "Skill authoring", short_desc: "Has authored a user-skill" },
      { key: "harness_orchestrate", label: "harness-orchestrate", short_desc: "Uses the brief-as-contract pattern" },
      { key: "migration_guard", label: "migration-guard", short_desc: "Uses kipwise-migration-guard" },
      { key: "release_ship_check", label: "release-ship-check", short_desc: "Pre-ship verification skill" },
      { key: "todowrite_discipline", label: "TodoWrite discipline", short_desc: "Loads TodoWrite after spec" },
      { key: "handoff_prose", label: "Cross-session handoff", short_desc: "Writes handoff prose between sessions" },
      { key: "subagent_pickup", label: "Cross-member skill pickup", short_desc: "Uses a skill another member authored" },
    ],
    diffusion_grid: [
      {
        member: "Charlie",
        cells: {
          plan_mode: "regular",
          brainstorm_warmup: "regular",
          parallel_dispatch: "tried",
          reviewer_triad: "originator",
          long_autonomous: "tried",
          skill_authoring: "originator",
          harness_orchestrate: "tried",
          migration_guard: "not_yet",
          release_ship_check: "originator",
          todowrite_discipline: "regular",
          handoff_prose: "regular",
          subagent_pickup: "regular",
        },
      },
      {
        member: "Alice",
        cells: {
          plan_mode: "tried",
          brainstorm_warmup: "tried",
          parallel_dispatch: "originator",
          reviewer_triad: "tried",
          long_autonomous: "not_yet",
          skill_authoring: "originator",
          harness_orchestrate: "originator",
          migration_guard: "not_yet",
          release_ship_check: "tried",
          todowrite_discipline: "regular",
          handoff_prose: "tried",
          subagent_pickup: "not_yet",
        },
      },
      {
        member: "Bob",
        cells: {
          plan_mode: "not_yet",
          brainstorm_warmup: "not_yet",
          parallel_dispatch: "not_yet",
          reviewer_triad: "not_yet",
          long_autonomous: "originator",
          skill_authoring: "originator",
          harness_orchestrate: "not_yet",
          migration_guard: "originator",
          release_ship_check: "tried",
          todowrite_discipline: "tried",
          handoff_prose: "tried",
          subagent_pickup: "not_yet",
        },
      },
      {
        member: "Dana",
        cells: {
          plan_mode: "tried",
          brainstorm_warmup: "not_yet",
          parallel_dispatch: "not_yet",
          reviewer_triad: "not_yet",
          long_autonomous: "not_yet",
          skill_authoring: "not_yet",
          harness_orchestrate: "not_yet",
          migration_guard: "not_yet",
          release_ship_check: "tried",
          todowrite_discipline: "tried",
          handoff_prose: "not_yet",
          subagent_pickup: "tried",
        },
      },
    ],
    diffusion_arrows: [
      {
        practice_key: "harness_orchestrate",
        from_member: "Alice",
        to_member: "Charlie",
        date: "2026-05-07",
        note: "Charlie used Alice's harness-orchestrate for the first time on Thursday's topeka session. 3 days from origin to pickup.",
      },
      {
        practice_key: "release_ship_check",
        from_member: "Charlie",
        to_member: "Dana",
        date: "2026-05-09",
        note: "Dana's first cross-member skill pickup — release-ship-check on a Friday ops-runbooks session.",
      },
    ],

    // ─── v4: Session archetypes ───────────────────────────────────────────
    session_archetypes: [
      {
        key: "spec_then_iterate",
        name: "Spec-then-iterate",
        description: "Long structured brief up-front, then small turn-by-turn refinements.",
        cue: "First user msg >800 chars, no immediate subagent dispatch, many short follow-ups.",
        illustrative_signature: "■■■■■ · ▪ · ▪ · ▪ · ▪ · ▪ · ▪ · ▪",
      },
      {
        key: "parallel_orchestration",
        name: "Parallel orchestration",
        description: "Brief loaded once, then ≥3 worker subagents dispatched in parallel, then merge.",
        cue: "Single subagent followed by N concurrent subagents within 2 min.",
        illustrative_signature: "▪ · ◆ · ◆◆◆◆ · ▪",
      },
      {
        key: "long_autonomous",
        name: "Long autonomous",
        description: "Short brief, then an extended uninterrupted agent run (>1h) with tool-heavy execution.",
        cue: "Single user msg, then >60 min of tool calls without user turn.",
        illustrative_signature: "▪ · ████████████████",
      },
      {
        key: "conversational_debug",
        name: "Conversational debug",
        description: "Many short back-and-forth turns, exploratory, often with external refs.",
        cue: "High turn-count, low tool-per-turn, multiple corrections mid-flight.",
        illustrative_signature: "▪·▪·▪·▪·▪·▪·▪·▪·▪·▪·▪·▪",
      },
      {
        key: "skill_loaded_ritual",
        name: "Skill-loaded ritual",
        description: "Pre-flight loads 2+ skills before any tool call, then executes structured workflow.",
        cue: "Two or more skill loads in the first 60 seconds.",
        illustrative_signature: "✦✦ · ▪ · ▪ · ▪ · ▪",
      },
      {
        key: "reviewer_triad_gate",
        name: "Reviewer-triad gate",
        description: "Implementer agent runs first; then N reviewer subagents critique in parallel before merge.",
        cue: "One implementation pass, then a burst of ≥2 reviewer subagents.",
        illustrative_signature: "▪ · ◆ · ▪ · ★★★ · ▪",
      },
    ],
    archetype_distribution: [
      {
        member: "Charlie",
        distribution: [
          { archetype_key: "spec_then_iterate", pct: 31 },
          { archetype_key: "parallel_orchestration", pct: 19 },
          { archetype_key: "long_autonomous", pct: 6 },
          { archetype_key: "conversational_debug", pct: 13 },
          { archetype_key: "skill_loaded_ritual", pct: 25 },
          { archetype_key: "reviewer_triad_gate", pct: 6 },
        ],
      },
      {
        member: "Alice",
        distribution: [
          { archetype_key: "spec_then_iterate", pct: 9 },
          { archetype_key: "parallel_orchestration", pct: 64 },
          { archetype_key: "long_autonomous", pct: 0 },
          { archetype_key: "conversational_debug", pct: 18 },
          { archetype_key: "skill_loaded_ritual", pct: 9 },
          { archetype_key: "reviewer_triad_gate", pct: 0 },
        ],
      },
      {
        member: "Bob",
        distribution: [
          { archetype_key: "spec_then_iterate", pct: 22 },
          { archetype_key: "parallel_orchestration", pct: 0 },
          { archetype_key: "long_autonomous", pct: 56 },
          { archetype_key: "conversational_debug", pct: 22 },
          { archetype_key: "skill_loaded_ritual", pct: 0 },
          { archetype_key: "reviewer_triad_gate", pct: 0 },
        ],
      },
      {
        member: "Dana",
        distribution: [
          { archetype_key: "spec_then_iterate", pct: 40 },
          { archetype_key: "parallel_orchestration", pct: 0 },
          { archetype_key: "long_autonomous", pct: 0 },
          { archetype_key: "conversational_debug", pct: 60 },
          { archetype_key: "skill_loaded_ritual", pct: 0 },
          { archetype_key: "reviewer_triad_gate", pct: 0 },
        ],
      },
    ],
    illustrative_session_timelines: [
      {
        session_label: "Charlie · Mon · topeka · reviewer-triad",
        member: "Charlie",
        archetype_key: "reviewer_triad_gate",
        turns: [
          { kind: "user", weight: 4, tag: "spec brief 920 ch" },
          { kind: "tool", weight: 1, tag: "Read" },
          { kind: "tool", weight: 1, tag: "Read" },
          { kind: "subagent", weight: 3, tag: "implementer" },
          { kind: "user", weight: 1, tag: "refine" },
          { kind: "subagent", weight: 2, tag: "reviewer (correctness)" },
          { kind: "subagent", weight: 2, tag: "reviewer (ergonomics)" },
          { kind: "subagent", weight: 2, tag: "reviewer (rollback)" },
          { kind: "agent", weight: 2, tag: "merge findings" },
          { kind: "user", weight: 1, tag: "ship" },
        ],
      },
      {
        session_label: "Alice · Tue · topeka · 4-way parallel",
        member: "Alice",
        archetype_key: "parallel_orchestration",
        turns: [
          { kind: "user", weight: 1, tag: "short brief 80 ch" },
          { kind: "tool", weight: 1, tag: "Skill: harness-orchestrate" },
          { kind: "subagent", weight: 2, tag: "orchestration brief" },
          { kind: "subagent", weight: 2, tag: "worker 1" },
          { kind: "subagent", weight: 2, tag: "worker 2" },
          { kind: "subagent", weight: 2, tag: "worker 3" },
          { kind: "subagent", weight: 2, tag: "worker 4" },
          { kind: "agent", weight: 2, tag: "merge diffs" },
          { kind: "user", weight: 1, tag: "ship" },
        ],
      },
      {
        session_label: "Bob · Wed · kipwise-v1 · 4.2h autonomous",
        member: "Bob",
        archetype_key: "long_autonomous",
        turns: [
          { kind: "user", weight: 5, tag: "1400-char context + KIP-148 ref" },
          { kind: "tool", weight: 1, tag: "Skill: kipwise-migration-guard" },
          { kind: "tool", weight: 1, tag: "Read schema" },
          { kind: "tool", weight: 1, tag: "Read migration history" },
          { kind: "tool", weight: 1, tag: "Bash: pg_dump" },
          { kind: "tool", weight: 1, tag: "Edit migration" },
          { kind: "tool", weight: 1, tag: "Bash: pnpm test" },
          { kind: "tool", weight: 1, tag: "Edit migration" },
          { kind: "tool", weight: 1, tag: "Bash: pnpm db:migrate" },
          { kind: "tool", weight: 1, tag: "guard caught DROP COLUMN" },
          { kind: "user", weight: 1, tag: "confirm" },
          { kind: "tool", weight: 1, tag: "Edit" },
          { kind: "tool", weight: 1, tag: "Bash: pnpm test" },
          { kind: "tool", weight: 1, tag: "Commit + PR" },
        ],
      },
    ],

    // ─── v2: WoW pulse ────────────────────────────────────────────────────
    wow_pulse: {
      agent_hours: { current: 18.4, last_week: 16.4, delta_pct: 12 },
      sessions: { current: 41, last_week: 36, delta_abs: 5 },
      tickets_resolved: {
        source: "Linear",
        current: 7,
        last_week: 5,
        delta: 2,
        sample_refs: ["KIP-148", "KIP-152", "KIP-144", "KIP-156"],
      },
      parallel_execution: { total_min: 87, peak_concurrent: 4, total_min_wow_delta_pct: 67 },
      long_autonomous: {
        count: 4,
        total_min: 412,
        max_single_min: 252,
        count_wow_delta: 2,
        total_min_wow_delta_pct: 88,
      },
      project_time: [
        { project: "topeka", hours_this_week: 8.2, hours_last_week: 6.4, delta_pct: 28 },
        { project: "kipwise-v1", hours_this_week: 5.1, hours_last_week: 4.9, delta_pct: 4 },
        { project: "ops-runbooks", hours_this_week: 3.4, hours_last_week: 4.2, delta_pct: -19 },
        { project: "infra-bootstrap", hours_this_week: 1.7, hours_last_week: 0.9, delta_pct: 89 },
      ],
      goal_mix: [
        { category: "build", share_pct: 42, delta_pp: 5 },
        { category: "debug", share_pct: 18, delta_pp: -2 },
        { category: "refactor", share_pct: 14, delta_pp: 1 },
        { category: "plan", share_pct: 12, delta_pp: 4 },
        { category: "review", share_pct: 8, delta_pp: -3 },
        { category: "research", share_pct: 6, delta_pp: -5 },
      ],
      skill_usage: [
        { skill: "superpowers:writing-plans", uses_this_week: 14, uses_last_week: 9, delta: 5 },
        { skill: "harness-orchestrate", uses_this_week: 11, uses_last_week: 7, delta: 4 },
        { skill: "superpowers:brainstorming", uses_this_week: 9, uses_last_week: 8, delta: 1 },
        { skill: "kipwise-migration-guard", uses_this_week: 5, uses_last_week: 5, delta: 0 },
        { skill: "release-ship-check", uses_this_week: 4, uses_last_week: 2, delta: 2 },
        { skill: "superpowers:systematic-debugging", uses_this_week: 3, uses_last_week: 1, delta: 2 },
        { skill: "spec-frame-loader", uses_this_week: 3, uses_last_week: 0, delta: 3 },
      ],
    },

    // ─── v2: Case studies (the spine of v2) ──────────────────────────────
    case_studies: [
      {
        id: "case-alice-tue-parallel",
        author: "Alice",
        date: "2026-05-05",
        project: "topeka",
        duration: { wall_min: 47, active_min: 45, idle_min: 2 },
        turn_count: 12,
        outcome: "shipped 1 PR",
        working_shape: "parallel-orchestration",
        day_signature: "Brief-as-contract · four workers in parallel · merge → ship",
        interaction_type: "directive",
        complexity: 3,
        harness_signature: {
          user_skills: [{ name: "harness-orchestrate", uses: 1 }],
          user_subagents: [{ type: "implement-teammate", count: 4 }],
          stock_skills: [],
          top_tools: ["Task×4 (parallel dispatch)", "Edit×12", "Bash×31 (pnpm×18, git×9)"],
        },
        steering: { user_msg_count: 5, long_user_msg_count: 0, median_user_msg_chars: 80, interrupts: 0 },
        timeline: {
          duration_min: 47,
          active_intervals: [{ start_min: 0, end_min: 12 }, { start_min: 14, end_min: 42 }, { start_min: 44, end_min: 47 }],
          pins: [
            { start_min: 0, kind: "user-steering", label: "Opens with 80-char brief — 'split this layout into 4 chunks'" },
            { start_min: 1, kind: "skill-load", label: "harness-orchestrate loaded" },
            { start_min: 3, end_min: 6, kind: "subagent-burst", label: "Orchestration brief subagent compiles the contract" },
            { start_min: 7, end_min: 14, kind: "subagent-burst", label: "4 worker subagents dispatched in parallel — each takes one chunk" },
            { start_min: 14, kind: "harness-chain", label: "Workers return diffs; agent merges into one branch" },
            { start_min: 26, kind: "user-steering", label: "Short refine — 'good, also strip the unused css'" },
            { start_min: 41, kind: "pr-ship", label: "PR opened, merged in CI" },
          ],
        },
        narrative: {
          why_picked: "Week's invention. The brief-as-contract pattern produced the fastest first-pass ship of the week. The orchestration shape itself is the story — short brief, contract, parallel workers, single merge.",
          session_summary:
            "Alice opened with an 80-character brief, loaded harness-orchestrate, and the skill expanded the brief into a structured orchestration contract that four worker subagents read independently. Workers returned diffs in about 7 minutes; the agent merged them into one branch; Alice made one short refine ('strip the unused css'); the PR shipped.",
          steering_summary: "Minimal mid-flight steering. Five short user messages, zero interrupts. The orchestration brief absorbed the structure that would normally live in the prompt.",
          what_worked: "Contract isolation. Workers don't see each other's output and don't coordinate. Merge happens once, at the end.",
          what_hit_friction: "Nothing this session. Compare with Thursday's session (Alice·Thu) where two workers returned overlapping diffs — that's the natural failure mode and Alice has a recovery template for it.",
        },
        drill_observations: {
          started_with_brainstorming: false,
          started_from_predefined_aspect: true,
          long_running_turns_count: 0,
          long_running_turns_total_min: 0,
          rapid_fire_after_initial: false,
          notes: [
            "Predefined harness, no warm-up — Alice has internalized the shape.",
            "Single refine then ship — minimal human hand-holding after the orchestration brief landed.",
            "47 min wall · 45 min active · 2 min idle — almost no thinking-pause time.",
          ],
        },
      },

      {
        id: "case-bob-wed-migration",
        author: "Bob",
        date: "2026-05-06",
        project: "kipwise-v1",
        duration: { wall_min: 252, active_min: 248, idle_min: 4 },
        turn_count: 18,
        outcome: "shipped 1 PR",
        working_shape: "long-autonomous",
        day_signature: "4.2h autonomous migration · guard caught 2 unsafe ops · zero-rework ship",
        interaction_type: "task-iteration",
        complexity: 5,
        harness_signature: {
          user_skills: [{ name: "kipwise-migration-guard", uses: 5 }],
          user_subagents: [],
          stock_skills: [{ name: "superpowers:systematic-debugging", uses: 1 }],
          top_tools: [
            "Bash×142 (psql×38, pnpm×27, git×19, pg_dump×9)",
            "Read×96 (schema, migration history)",
            "Edit×38 (migration files)",
          ],
        },
        steering: { user_msg_count: 4, long_user_msg_count: 3, median_user_msg_chars: 1400, interrupts: 1 },
        timeline: {
          duration_min: 252,
          active_intervals: [
            { start_min: 0, end_min: 42 },
            { start_min: 44, end_min: 98 },
            { start_min: 100, end_min: 158 },
            { start_min: 161, end_min: 252 },
          ],
          pins: [
            { start_min: 0, kind: "user-steering", label: "1400-char brief — schema dump + KIP-148 ref + prior-migration history" },
            { start_min: 2, kind: "skill-load", label: "kipwise-migration-guard loaded" },
            { start_min: 5, end_min: 42, kind: "long-autonomous", label: "Agent runs schema analysis, drafts migration (37 min)" },
            { start_min: 44, kind: "harness-chain", label: "Guard caught a DROP COLUMN — agent rewrites approach" },
            { start_min: 46, end_min: 98, kind: "long-autonomous", label: "Agent finalizes safe migration, runs tests on staging" },
            { start_min: 100, end_min: 158, kind: "long-autonomous", label: "Staging migration runs to completion, verification" },
            { start_min: 160, kind: "user-steering", label: "1100-char confirm — 'looks good, proceed with prod migration'" },
            { start_min: 161, kind: "harness-chain", label: "Guard caught a second unsafe ALTER, agent revises" },
            { start_min: 163, end_min: 248, kind: "long-autonomous", label: "Prod migration runs in 85 min, all checks green" },
            { start_min: 249, kind: "pr-ship", label: "PR opened, merged" },
          ],
        },
        narrative: {
          why_picked: "Longest single autonomous run of the week (4.2h), shipped without a rework cycle — unusual for a flag-touching change on a 50M-row table.",
          session_summary:
            "Bob wrote a 1400-character contextual brief at the start (schema dump, KIP-148 reference, prior-migration history). Then kipwise-migration-guard loaded and the agent ran four near-uninterrupted long stretches over 4.2 hours: schema analysis → drafting the migration → staging run + verification → prod migration. Bob's mid-flight interventions: one confirm before prod, and acknowledging two guard catches.",
          steering_summary: "Heavy front-loading. One long brief (1400 chars), near-zero mid-flight steering. The guard skill substitutes for human attention by gating the irreversible operations.",
          what_worked: "Migration-guard caught two unsafe operations that would have shipped otherwise. Long brief eliminated mid-flight context-gathering. Most of Bob's attention budget moved from mid-session to up-front.",
          what_hit_friction: "Bash had to retry 3 times for a transient pg connection issue (counted in the retry-chain stat). No friction on the migration logic itself.",
        },
        drill_observations: {
          started_with_brainstorming: false,
          started_from_predefined_aspect: true,
          long_running_turns_count: 4,
          long_running_turns_total_min: 232,
          rapid_fire_after_initial: false,
          notes: [
            "Front-loaded human time — ~15 min writing the brief, then 4h+ autonomous.",
            "Migration-guard is the load-bearing safety mechanism. Without it, this level of autonomy doesn't ship.",
            "Demonstrates: predefined harness + rich up-front context → long-running agent turns that ship.",
          ],
        },
      },

      {
        id: "case-bob-thu-rapid-fire",
        author: "Bob",
        date: "2026-05-07",
        project: "kipwise-v1",
        duration: { wall_min: 142, active_min: 130, idle_min: 12 },
        turn_count: 38,
        outcome: "partial · 1 commit, no PR",
        working_shape: "conversational-debug",
        day_signature: "Initial work autonomous · then rapid-fire debug cascade · last-mile human hand-holding",
        interaction_type: "feedback-loop",
        complexity: 4,
        harness_signature: {
          user_skills: [{ name: "kipwise-migration-guard", uses: 1 }],
          user_subagents: [{ type: "implement-teammate", count: 1 }],
          stock_skills: [{ name: "superpowers:systematic-debugging", uses: 1 }],
          top_tools: ["Bash×84 (psql×34, git×18)", "Read×52", "Edit×38", "Grep×24"],
        },
        steering: { user_msg_count: 28, long_user_msg_count: 0, median_user_msg_chars: 32, interrupts: 6 },
        timeline: {
          duration_min: 142,
          active_intervals: [
            { start_min: 0, end_min: 28 },
            { start_min: 30, end_min: 68 },
            { start_min: 72, end_min: 82 },
            { start_min: 84, end_min: 98 },
            { start_min: 100, end_min: 130 },
          ],
          pins: [
            { start_min: 0, kind: "user-steering", label: "Brief — 'fix the migration backfill that broke staging tonight, KIP-152'" },
            { start_min: 2, end_min: 28, kind: "long-autonomous", label: "Agent investigates, reproduces error, drafts a fix" },
            { start_min: 28, kind: "user-steering", label: "12-char nudge — 'try -X option'" },
            { start_min: 30, kind: "interrupt", label: "User stops agent before commit" },
            { start_min: 32, end_min: 48, kind: "long-autonomous", label: "Agent runs revised fix" },
            { start_min: 48, kind: "user-steering", label: "11-char — 'nope, retry'" },
            { start_min: 50, kind: "user-steering", label: "8-char — 'wait'" },
            { start_min: 54, kind: "user-steering", label: "22-char — 'check pg version first'" },
            { start_min: 60, end_min: 68, kind: "interrupt", label: "Cluster of 12+ short user nudges over 8 min (rapid fire)" },
            { start_min: 82, kind: "skill-load", label: "Bob loads superpowers:systematic-debugging mid-session" },
            { start_min: 84, end_min: 98, kind: "long-autonomous", label: "Agent applies the debugging framework" },
            { start_min: 100, end_min: 130, kind: "long-autonomous", label: "Final fix runs, tests pass" },
            { start_min: 130, kind: "interrupt", label: "Bob stops before PR — 'verify staging first'" },
          ],
        },
        narrative: {
          why_picked: "Demonstrates the 'harness works but last-mile needs hand-holding' pattern. Initial autonomous work landed in 28 minutes; the remaining 100 minutes were rapid-fire human steering through the actual bug.",
          session_summary:
            "Bob opened with a 60-character brief referencing KIP-152. The agent ran autonomously for 28 minutes, identified the issue, and drafted a fix. Then the pattern shifted: 18 short messages over 40 minutes as Bob debugged the actual root cause with the agent — short nudges, occasional 'wait', 'retry', 'check pg version first'. Mid-session at minute 82 Bob loaded systematic-debugging, which framed the search. Final fix landed at minute 130. Bob stopped before the PR to verify staging.",
          steering_summary:
            "Highest interrupt count of the week (6). Median user message: 32 chars — these are nudges, not briefs. The mid-session systematic-debugging load was a course correction. Phase change: median brief length dropped from 60 chars (initial brief) to ~20 chars during rapid-fire (debug nudges).",
          what_worked: "The agent's initial 28-minute autonomous diagnosis correctly identified the broken backfill. Without that initial run, the rapid-fire debug would have been pure exploration.",
          what_hit_friction:
            "The actual root cause needed Bob's domain knowledge of a pg version compatibility issue. The agent couldn't infer it from the codebase. The long tail of short nudges suggests the harness doesn't yet capture this 'debug-with-domain-expert' mode well.",
        },
        drill_observations: {
          started_with_brainstorming: false,
          started_from_predefined_aspect: false,
          long_running_turns_count: 3,
          long_running_turns_total_min: 72,
          rapid_fire_after_initial: true,
          notes: [
            "Canonical 'harness handles 70%, last 30% is rapid-fire hand-holding' shape.",
            "Phase change in steering style: long brief → short debug nudges.",
            "Mid-session skill-load (systematic-debugging) signals Bob recognized he needed more structure.",
            "Likely a candidate for authoring a new skill — 'rapid-fire debug with domain context' — to compress future sessions like this.",
          ],
        },
      },

      {
        id: "case-charlie-mon-reviewer-triad",
        author: "Charlie",
        date: "2026-05-04",
        project: "topeka",
        duration: { wall_min: 186, active_min: 180, idle_min: 6 },
        turn_count: 22,
        outcome: "shipped 1 PR",
        working_shape: "reviewer-triad",
        day_signature: "Three reviewer subagents BEFORE any code · zero-rework first PR",
        interaction_type: "validation",
        complexity: 4,
        harness_signature: {
          user_skills: [{ name: "spec-frame-loader", uses: 1 }],
          user_subagents: [{ type: "spec-reviewer", count: 3 }],
          stock_skills: [
            { name: "superpowers:writing-plans", uses: 1 },
            { name: "superpowers:brainstorming", uses: 1 },
          ],
          top_tools: ["Read×84", "Edit×26", "Write×11", "Task×3 (spec-reviewer parallel)"],
        },
        steering: { user_msg_count: 8, long_user_msg_count: 3, median_user_msg_chars: 520, interrupts: 0 },
        timeline: {
          duration_min: 186,
          active_intervals: [
            { start_min: 0, end_min: 32 },
            { start_min: 34, end_min: 68 },
            { start_min: 70, end_min: 108 },
            { start_min: 110, end_min: 142 },
            { start_min: 144, end_min: 180 },
          ],
          pins: [
            { start_min: 0, kind: "user-steering", label: "Brief — 'design the team insight report, reference the spec template'" },
            { start_min: 1, end_min: 5, kind: "brainstorm-loop", label: "superpowers:brainstorming — agent asks clarifying questions" },
            { start_min: 6, kind: "skill-load", label: "spec-frame-loader auto-selects writing-plans" },
            { start_min: 12, kind: "user-steering", label: "Refines scope — 'focus on opt-in submissions, defer LLM design'" },
            { start_min: 32, kind: "harness-chain", label: "Spec draft saved to docs/superpowers/specs/" },
            { start_min: 38, end_min: 68, kind: "subagent-burst", label: "Three spec-reviewer subagents in parallel — correctness / ergonomics / rollback lenses" },
            { start_min: 72, kind: "user-steering", label: "Reads reviewer findings, accepts 4 of 5 recommendations" },
            { start_min: 78, end_min: 108, kind: "long-autonomous", label: "Agent revises spec per accepted findings" },
            { start_min: 110, kind: "user-steering", label: "Approves revised spec, kicks off implementation" },
            { start_min: 115, end_min: 142, kind: "long-autonomous", label: "Agent implements per the spec" },
            { start_min: 144, end_min: 180, kind: "long-autonomous", label: "Test + commit + PR" },
            { start_min: 183, kind: "pr-ship", label: "PR shipped — no follow-up review needed" },
          ],
        },
        narrative: {
          why_picked: "First-time-on-team use of reviewer-triad gating BEFORE any code is written. Resulted in a zero-rework PR — unusual for a feature spec of this scope.",
          session_summary:
            "Charlie opened with a brainstorming warm-up, then loaded spec-frame-loader, which auto-selected writing-plans. The agent drafted the spec; three spec-reviewer subagents then critiqued in parallel — correctness, ergonomics, rollback. Charlie merged 4 of 5 recommendations into a revised spec. Only then did implementation start. The PR shipped without a follow-up review cycle.",
          steering_summary: "Eight user messages, three of them long. Steering concentrated at decision points: scope clarification, accepting reviewer findings, approving the revised spec. Implementation phase had near-zero steering.",
          what_worked: "Pre-implementation reviewer-triad caught issues at the spec level, where they're cheap to fix. The investment paid off in zero rework cycles after the code landed.",
          what_hit_friction: "Brainstorming warm-up was a slow start — 5 minutes of clarifying questions. Faster if Charlie front-loads more context.",
        },
        drill_observations: {
          started_with_brainstorming: true,
          started_from_predefined_aspect: false,
          long_running_turns_count: 3,
          long_running_turns_total_min: 96,
          rapid_fire_after_initial: false,
          notes: [
            "Investment in spec quality up front, paid off in implementation phase with zero rework.",
            "Reviewer-triad applied to spec, not code — moved the critique to the cheaper stage.",
            "Skill-loading chain: brainstorming → writing-plans (via spec-frame-loader) → spec-reviewer subagents.",
          ],
        },
      },

      {
        id: "case-charlie-tue-meta-skill",
        author: "Charlie",
        date: "2026-05-05",
        project: "topeka",
        duration: { wall_min: 144, active_min: 138, idle_min: 6 },
        turn_count: 16,
        outcome: "no PR · meta · new skill committed",
        working_shape: "solo-design",
        day_signature: "Authoring a skill that loads other skills — team's first metasynthesized skill",
        interaction_type: "learning",
        complexity: 4,
        harness_signature: {
          user_skills: [],
          user_subagents: [],
          stock_skills: [{ name: "superpowers:writing-skills", uses: 1 }],
          top_tools: ["Edit×17", "Read×42", "Glob×8", "Write×5"],
        },
        steering: { user_msg_count: 9, long_user_msg_count: 4, median_user_msg_chars: 480, interrupts: 0 },
        timeline: {
          duration_min: 144,
          active_intervals: [
            { start_min: 0, end_min: 18 },
            { start_min: 22, end_min: 52 },
            { start_min: 56, end_min: 98 },
            { start_min: 100, end_min: 138 },
          ],
          pins: [
            { start_min: 0, kind: "user-steering", label: "Brief — 'design a skill that picks which skills to load based on first_user'" },
            { start_min: 2, end_min: 18, kind: "brainstorm-loop", label: "Open exploration — agent surfaces taxonomy + fallback questions" },
            { start_min: 22, kind: "skill-load", label: "superpowers:writing-skills loaded" },
            { start_min: 28, end_min: 52, kind: "long-autonomous", label: "Agent drafts skill spec + decision tree" },
            { start_min: 54, kind: "user-steering", label: "Refines — 'add personal-habit category for handoff-prose'" },
            { start_min: 58, end_min: 98, kind: "long-autonomous", label: "Agent implements spec-frame-loader.md" },
            { start_min: 100, end_min: 138, kind: "long-autonomous", label: "Agent writes test prompts + adds to CLAUDE.md" },
            { start_min: 140, kind: "pr-ship", label: "Committed as workspace skill (no PR — local-only artifact)" },
          ],
        },
        narrative: {
          why_picked: "Team's first metasynthesized skill — a skill that loads other skills. Sets a pattern for adaptive harness selection.",
          session_summary:
            "Charlie spent the first 18 minutes in open exploration with the agent, deciding scope and taxonomy. Then loaded writing-skills as primary and the agent drafted the spec, implementation, and test prompts over three long autonomous stretches. Charlie's role was scope-setter and reviewer, not implementer.",
          steering_summary: "Nine user messages, four long. Steering concentrated at design-decision points. After spec lock-in, near-zero mid-flight steering.",
          what_worked: "Open exploration up front let the agent surface taxonomy questions Charlie hadn't considered. Writing-skills carried the implementation structure.",
          what_hit_friction: "Decision-fatigue mid-session — choosing between three competing taxonomies for skill-load triggers cost ~10 minutes.",
        },
        drill_observations: {
          started_with_brainstorming: true,
          started_from_predefined_aspect: false,
          long_running_turns_count: 3,
          long_running_turns_total_min: 110,
          rapid_fire_after_initial: false,
          notes: [
            "Inverse of Bob's debug session: planning-heavy phase, then long-autonomous build, very little last-mile steering.",
            "The session product isn't a PR but a tool for future sessions — harness-as-output.",
            "The resulting skill (spec-frame-loader) was used in 2 of Charlie's subsequent sessions this week.",
          ],
        },
      },
    ],

    // ─── v3: extras grounded in precedent (Economic Index, Faros, DORA, SPACE) ───
    v3_extras: {
      acceptance_rate: {
        pct_this_week: 87,
        pct_last_week: 82,
        delta_pp: 5,
      },
      automation_share: {
        automation_pct_this_week: 58,
        automation_pct_last_week: 49,
        automation_pct_trend: [38, 44, 49, 58],
        delta_pp: 9,
      },
      interaction_type_mix: [
        { type: "directive", share_pct: 32, delta_pp: 7 },
        { type: "feedback-loop", share_pct: 22, delta_pp: -4 },
        { type: "task-iteration", share_pct: 28, delta_pp: 2 },
        { type: "validation", share_pct: 11, delta_pp: 1 },
        { type: "learning", share_pct: 7, delta_pp: -6 },
      ],
      complexity_distribution: [
        { score: 1, sessions: 4 },
        { score: 2, sessions: 8 },
        { score: 3, sessions: 14 },
        { score: 4, sessions: 11 },
        { score: 5, sessions: 4 },
      ],
      complexity_median_this_week: 3.4,
      complexity_median_last_week: 3.0,
      bottleneck_shift: [
        { phase: "coding", minutes_this_week: 1108, minutes_last_week: 982, delta_pct: 13 },
        { phase: "reviewing", minutes_this_week: 484, minutes_last_week: 254, delta_pct: 91 },
        { phase: "merging", minutes_this_week: 88, minutes_last_week: 76, delta_pct: 16 },
        { phase: "deploying", minutes_this_week: 42, minutes_last_week: 38, delta_pct: 11 },
      ],
      bottleneck_headline:
        "Coding time grew 13% — but review time grew 91%. The team's bottleneck moved from writing code to reviewing it, the same pattern Faros documented across 10,000 developers.",
      quality_watch: {
        reverts_this_week: 1,
        reverts_last_week: 0,
        rework_prs_this_week: 2,
        rework_prs_last_week: 1,
        incident_tagged_sessions: 0,
        headline:
          "One revert + two rework PRs this week (vs zero + one last week). Quality picture is stable but slightly elevated — typical when output volume rises. Worth a check, not a flag.",
      },
      methodology_notes: [
        {
          title: "Acceptance rate is a proxy, not ground truth.",
          body: "We measure 'agent-suggested edits that survived to commit' as a proxy for acceptance. Edits that the agent revised before commit are counted as accepted (the revision was the human's accept signal). Different from GitHub Copilot's inline-completion acceptance, which counts ghost-text acceptances.",
        },
        {
          title: "These metrics are deliberately conservative.",
          body: "Sessions that haven't been opted into the team report contribute to numeric aggregates (Tier 1) but not to the case-study spine. Private projects don't contribute at any tier. Numbers here represent an underestimate of total agent activity.",
          citation: { label: "Claude Code analytics docs", href: "https://code.claude.com/docs/en/analytics" },
        },
        {
          title: "No per-member productivity ranking by design.",
          body: "We follow SPACE's framing: activity data should identify bottlenecks, not rank people. Per-member rates and counts appear only inside their own case studies; the dashboard does not produce a sorted leaderboard.",
          citation: { label: "SPACE framework — ACM Queue", href: "https://queue.acm.org/detail.cfm?id=3454124" },
        },
        {
          title: "Quality is reported alongside speed.",
          body: "Per DORA 2025: 'AI doesn't fix a team; it amplifies what's already there.' The Quality Watch section reports reverts, rework PRs, and incident-tagged sessions next to the speed metrics — not in a separate dashboard a reader might skip.",
          citation: { label: "DORA 2025 AI report", href: "https://cloud.google.com/resources/content/2025-dora-ai-assisted-software-development-report" },
        },
        {
          title: "Interaction types follow Anthropic's Economic Index taxonomy.",
          body: "Each shared session is classified as directive / feedback-loop / task-iteration / validation / learning. The taxonomy is from Anthropic's March 2026 Economic Index, applied here to a single team rather than population-scale Claude.ai data.",
          citation: { label: "Anthropic Economic Index March 2026", href: "https://www.anthropic.com/research/economic-index-march-2026-report" },
        },
      ],
      v3_closing: [
        {
          heading: "The bottleneck moved",
          body: "Coding time grew 13%; review time grew 91%. The pattern matches Faros's 10,000-developer study: 'AI Productivity Paradox' — individual speed wins don't aggregate to org-level delivery improvements when the bottleneck silently relocates to PR review. The team's next compounding investment is probably review tooling, not faster agents.",
          cites: [{ label: "Faros AI Productivity Paradox", href: "https://www.faros.ai/blog/ai-software-engineering" }],
        },
        {
          heading: "Automation share is climbing — augmentation isn't dying",
          body: "The team's automation share rose from 38% to 58% over four weeks (sessions with long autonomous turns, vs sessions with steady human steering). But Bob's Thursday debug session is the visible reminder that augmentation still carries the highest-complexity work — where the agent can't infer domain knowledge from the codebase. The two modes coexist; the share rebalances.",
          cites: [{ label: "Anthropic Economic Index", href: "https://www.anthropic.com/research/economic-index-march-2026-report" }],
        },
        {
          heading: "Complexity rose, acceptance rose",
          body: "Median session complexity moved from 3.0 to 3.4 over the week, and agent-edit acceptance rate moved from 82% to 87%. This is the team-scale version of the trajectory Anthropic published for its own Claude Code use (3.2 → 3.8 across H1 2025). Worth tracking month over month — a sustained climb here would be the strongest evidence the harness is genuinely getting better, not just busier.",
          cites: [{ label: "How Anthropic teams use Claude Code (PDF)", href: "https://www-cdn.anthropic.com/58284b19e702b49db9302d5b6f135ad8871e7658.pdf" }],
        },
      ],
    },

    // ─── v2: Closing reflections ─────────────────────────────────────────
    v2_closing: [
      {
        heading: "What the case studies are showing",
        body: "Five sessions submitted, four distinct collaboration shapes: front-loaded contract (Alice), front-loaded autonomy (Bob's migration), rapid-fire debug-after-initial (Bob's Thursday), pre-code reviewer triad (Charlie's Monday), and meta-skill authoring (Charlie's Tuesday). The shapes vary more than the members do — same member can show two textures in two days.",
      },
      {
        heading: "Where the harness is doing the work",
        body: "Three sessions had near-zero mid-flight steering: Alice's parallel ship, Bob's migration, Charlie's spec triad. In each, a load-bearing skill or contract absorbed the structure that would otherwise live in human attention — harness-orchestrate, kipwise-migration-guard, and the spec-reviewer subagent pattern. The lesson is the same across three different shapes: when the harness carries the structure, the agent runs long without losing direction.",
      },
      {
        heading: "Where the human is still doing the last mile",
        body: "Bob's Thursday debug is the visible counter-example. The agent's initial autonomous run nailed the diagnosis, then the team's harness ran out of structure and the next 100 minutes were rapid-fire nudges. Median user message dropped from 60 chars (the initial brief) to 32 chars (debug-mode shorthand). This is a clean signal that the harness covers the build path but not yet the debug-with-domain-knowledge path. The pattern is worth a 1:1 — does Bob want to author a 'rapid-fire debug' skill to compress sessions like this?",
      },
    ],

    // ─── v1 story-only paragraphs (kept; consumed by v1-combined) ────────
    story_paragraphs: [
      {
        heading: "The week the team noticed",
        body: "Five days that hint that the team's relationship with the coding agent is changing. Two members compressed their workflow, one member doubled down on the opposite approach, and a new member crossed the first orchestration milestone — all in the same week. None of it would show up in a PR review or a sprint report. It only shows up in how each of them held the keyboard.",
      },
      {
        heading: "Charlie's planning ritual is becoming a habit",
        body: "Four weeks ago, Charlie loaded a skill in roughly one of every two sessions. This week he loaded one in fourteen of sixteen. The skill is almost always superpowers:writing-plans or superpowers:brainstorming, fired before any tool call. The lagging indicator: his cost per shipped PR dropped from $28 to $17 in the same four weeks. The team's lowest now.",
      },
      {
        heading: "Alice taught the team how to dispatch in parallel",
        body: "On Tuesday afternoon Alice ran four worker subagents against the same file at the same time, with one orchestration brief subagent acting as their shared contract. The session shipped a PR in 47 minutes — the team's fastest first-pass ship of the week. By Thursday, Charlie tried the pattern for the first time. The diffusion arrow on the dashboard says three days from origin to first pickup. The pattern was unknown on this team four weeks ago.",
      },
      {
        heading: "Bob is making the opposite bet, and it's also working",
        body: "Where Alice shrinks her briefs and offloads structure to harness-orchestrate, Bob's briefs have grown 27% in four weeks. He's pouring more context — KIP refs, error logs, schema dumps — into the first user message, and then letting the agent run for hours. The 4.2-hour autonomous session on Wednesday's migration was the longest of the week, and it shipped without rework. His cost-per-PR is also dropping. Two different theories of the human-agent collaboration, both gaining evidence.",
      },
      {
        heading: "Dana hit the third-week inflection",
        body: "Dana's first three weeks resemble the curve every new member rides — short sessions, mostly stock skills, near-zero delegation. Friday's Explore subagent dispatch is the first orchestration milestone, the one most new members hit around week 3-4. The next inflection to watch for is the first cross-member skill pickup; that happened the same day (release-ship-check, from Charlie). Two milestones at once, slightly ahead of the median ramp.",
      },
      {
        heading: "Where the team is converging",
        body: "Three of the four active members loaded a brainstorming or writing-plans skill at least once this week, up from one last week. Plan-mode adoption is at 75% — far above the org baseline of 41%. The team is not just building with agents; they're starting to share a small repertoire of structured warmup moves. The team-built skill collection (harness-orchestrate, kipwise-migration-guard, release-ship-check, spec-frame-loader) is the visible product of that shared repertoire.",
      },
      {
        heading: "Where the team is still solo",
        body: "Bob's migration-guard skill is used by exactly one person — Bob — and it's the load-bearing piece of his Wednesday session. If Bob's out for a sprint, no one else on the team has that pattern in their muscle memory. The bus-factor view on the dashboard names the practice; the question for next week's 1:1s is whether to pair-document it or accept the concentration.",
      },
      {
        heading: "What to ask in this week's 1:1s",
        body: "Three concrete prompts surface from the week. Ask Alice whether harness-orchestrate generalizes beyond topeka or is project-specific. Ask Bob about the late-night session count — three nights in a row Tue/Wed/Thu, all over two hours, is a workload check, not a productivity question. Ask Dana what the ramp has felt like; she's a few days ahead of the median curve, and that's worth understanding before week four.",
      },
    ],
  },
};

void MEMBERS;
