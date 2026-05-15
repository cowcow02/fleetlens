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
};

void MEMBERS;
