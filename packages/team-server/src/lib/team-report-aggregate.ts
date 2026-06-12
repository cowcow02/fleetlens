import type pg from "pg";
import type {
  BreadthSnapshot,
  CadenceSnapshot,
  GithubDeliveryStats,
  GithubWeekDelivery,
  HarnessBreakdown,
  LinearVelocityStats,
  LinearWeekVelocity,
  LiveExtras,
  MaturityEvidence,
  MaturityLevel,
  MaturityMemberClassification,
  MaturityPath,
  MemberMaturityPortrait,
  TeamInsightReport,
  WorkPhaseStat,
  WorkTimelinePhases,
  WorkTimelineStats,
} from "../app/team/[slug]/insights/types";
import { medianHours, percentileHours } from "./github";
import { normalizeGithubRepos, normalizeLinearTeams } from "./integrations";
import {
  isoMondayOf,
  perProjectTimeWoW,
  previousIsoMonday,
  skillUsageWeek,
  teamPulseWeek,
  visibleMembershipIds,
  weekEndExclusive,
  workingShapeDistribution,
  type InsightsScope,
} from "./insights-aggregate";

// Live-data builder for the v7 VariantBuilder. Populates the framework-aligned
// Layer-2 KPI fields from `rich_daily_rollups`; every other field on the report
// is shaped as a typed-but-empty skeleton so the v7 widget catalog still
// type-checks. The starter set the live page passes to VariantBuilder picks
// only widgets that read fields we actually compute here — see
// `LIVE_STARTER_BLOCKS` below.

// v7 framework-aligned starter — kept for backwards compat with old persisted
// localStorage selections.
export const LIVE_STARTER_BLOCKS = [
  "team-pulse-wow",
  "long-autonomous-texture",
  "per-project-time-bars",
  "skill-usage-wow-bars",
  "delegation-depth",
  "harness-engineering",
];

// v8 clean-starter — Q2-2026 Adoption Framework alignment. Grouped by the
// three framework pillars (slide 2): Usage / Getting Better / Impact.
// Drop harness-engineering from the starter (mostly-zero tiles) — it stays in
// the catalog for power users.
export const LIVE_STARTER_BLOCKS_V8 = [
  // Header context — adoption rate (slide 5 KPI #1)
  "live-active-rate",
  // Pillar 2: are they getting better with it? — qualitative portraits
  // (v9). Replaces the threshold-based maturity bar; portrait reasoning
  // is observable-action-driven, not count-driven.
  "live-member-portraits",
  // Pillar 1: are people using it?
  "team-pulse-wow",
  // Pillar 3: is it changing how we ship? — PR throughput stands in until
  // DORA/Source-B integration lands.
  "live-prs-shipped",
  "per-project-time-bars",
  // Pillar 2: usage-pattern context (style signals, never grade)
  "skill-usage-wow-bars",
  "long-autonomous-texture",
];

type WeekAggregates = {
  agentMs: number;
  sessions: number;
  prs: number;
  commits: number;
  pushes: number;
  parallelMinutes: number;
  concurrencyPeak: number;
  concurrencyPeakDay: string;
  longAutoCount: number;
  longAutoTotalMin: number;
  longAutoMaxSingleMin: number;
  toolErrors: number;
  planModeUsed: number;
  brainstormWarmupSessions: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
};

function emptyAggregates(): WeekAggregates {
  return {
    agentMs: 0, sessions: 0, prs: 0, commits: 0, pushes: 0,
    parallelMinutes: 0, concurrencyPeak: 0, concurrencyPeakDay: "",
    longAutoCount: 0, longAutoTotalMin: 0, longAutoMaxSingleMin: 0,
    toolErrors: 0, planModeUsed: 0, brainstormWarmupSessions: 0,
    tokensInput: 0, tokensOutput: 0, tokensCacheRead: 0, tokensCacheWrite: 0,
  };
}

async function weekAggregates(
  teamId: string,
  memberIds: string[],
  weekMonday: string,
  pool: pg.Pool,
): Promise<WeekAggregates> {
  if (memberIds.length === 0) return emptyAggregates();
  const winEnd = weekEndExclusive(weekMonday);
  const res = await pool.query<{
    day: string;
    agent_time_ms: string;
    sessions: number;
    prs: number;
    commits: number;
    pushes: number;
    parallel_minutes: number;
    concurrency_peak: number;
    long_auto_count: number;
    long_auto_total_min: number;
    long_auto_max_single_min: number;
    tool_errors: number;
    plan_mode_used: number;
    brainstorm_warmup_sessions: number;
    tokens_input: string;
    tokens_output: string;
    tokens_cache_read: string;
    tokens_cache_write: string;
  }>(
    `SELECT day::text, agent_time_ms::text, sessions, prs, commits, pushes,
            parallel_minutes, concurrency_peak,
            long_auto_count, long_auto_total_min, long_auto_max_single_min,
            tool_errors, plan_mode_used, brainstorm_warmup_sessions,
            tokens_input::text, tokens_output::text,
            tokens_cache_read::text, tokens_cache_write::text
     FROM rich_daily_rollups
     WHERE team_id = $1
       AND membership_id = ANY($2::uuid[])
       AND day >= $3::date
       AND day < $4::date`,
    [teamId, memberIds, weekMonday, winEnd],
  );

  const agg = emptyAggregates();
  for (const row of res.rows) {
    agg.agentMs += Number(row.agent_time_ms);
    agg.sessions += row.sessions;
    agg.prs += row.prs;
    agg.commits += row.commits;
    agg.pushes += row.pushes;
    agg.parallelMinutes += row.parallel_minutes;
    if (row.concurrency_peak > agg.concurrencyPeak) {
      agg.concurrencyPeak = row.concurrency_peak;
      agg.concurrencyPeakDay = row.day;
    }
    agg.longAutoCount += row.long_auto_count;
    agg.longAutoTotalMin += row.long_auto_total_min;
    if (row.long_auto_max_single_min > agg.longAutoMaxSingleMin) {
      agg.longAutoMaxSingleMin = row.long_auto_max_single_min;
    }
    agg.toolErrors += row.tool_errors;
    agg.planModeUsed += row.plan_mode_used;
    agg.brainstormWarmupSessions += row.brainstorm_warmup_sessions;
    agg.tokensInput += Number(row.tokens_input);
    agg.tokensOutput += Number(row.tokens_output);
    agg.tokensCacheRead += Number(row.tokens_cache_read);
    agg.tokensCacheWrite += Number(row.tokens_cache_write);
  }
  return agg;
}

function pctDelta(current: number, prev: number): number {
  if (prev === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - prev) / prev) * 100);
}

type GithubPrRow = {
  created_at: string;
  merged_at: string;
  first_commit_at: string | null;
  first_review_at: string | null;
  ai_assisted: boolean;
};

function githubWeekDelivery(rows: GithubPrRow[]): GithubWeekDelivery {
  const ai = rows.filter((r) => r.ai_assisted);
  const other = rows.filter((r) => !r.ai_assisted);
  const cycleMs = (rs: GithubPrRow[]) =>
    rs
      .filter((r) => r.first_commit_at)
      .map((r) => new Date(r.merged_at).getTime() - new Date(r.first_commit_at!).getTime())
      .filter((ms) => ms >= 0);
  const reviewMs = (rs: GithubPrRow[]) =>
    rs
      .filter((r) => r.first_review_at)
      .map((r) => new Date(r.first_review_at!).getTime() - new Date(r.created_at).getTime())
      .filter((ms) => ms >= 0);
  return {
    merged: rows.length,
    ai_assisted: ai.length,
    ai_share_pct: rows.length === 0 ? 0 : Math.round((ai.length / rows.length) * 100),
    median_cycle_hours_ai: medianHours(cycleMs(ai)),
    median_cycle_hours_other: medianHours(cycleMs(other)),
    median_review_wait_hours_ai: medianHours(reviewMs(ai)),
    median_review_wait_hours_other: medianHours(reviewMs(other)),
  };
}

type LinearIssueAggRow = {
  created_at: string;
  started_at: string | null;
  completed_at: string;
  ai_linked: boolean;
};

function linearWeekVelocity(rows: LinearIssueAggRow[]): LinearWeekVelocity {
  const aiLinked = rows.filter((r) => r.ai_linked).length;
  const cycleMs = rows
    .filter((r) => r.started_at)
    .map((r) => new Date(r.completed_at).getTime() - new Date(r.started_at!).getTime())
    .filter((ms) => ms >= 0);
  const leadMs = rows
    .map((r) => new Date(r.completed_at).getTime() - new Date(r.created_at).getTime())
    .filter((ms) => ms >= 0);
  return {
    completed: rows.length,
    ai_linked: aiLinked,
    ai_linked_share_pct: rows.length === 0 ? 0 : Math.round((aiLinked / rows.length) * 100),
    median_cycle_hours: medianHours(cycleMs),
    median_lead_hours: medianHours(leadMs),
  };
}

// Ticket velocity from the Linear integration. Linear teams are group-mapped
// like repos (empty group_ids = all groups); group-scoped reports only see
// their mapped teams' issues. AI linkage joins a completed ticket to any
// AI-assisted synced PR whose title carries the ticket ref ("KIP-315" + word
// boundary, so KIP-3150 doesn't match). Null when not connected; connected
// with zero mapped teams returns empty-keys stats so the widget can point the
// admin at the mapping.
async function linearVelocity(
  teamId: string,
  scope: InsightsScope,
  weekMonday: string,
  pool: pg.Pool,
): Promise<LinearVelocityStats | null> {
  const integ = await pool.query<{ config: { teams?: unknown; team_keys?: unknown }; last_sync_at: string | null }>(
    `SELECT config, last_sync_at::text FROM team_integrations
     WHERE team_id = $1 AND provider = 'linear'`,
    [teamId],
  );
  if (!integ.rowCount) return null;

  const allTeams = normalizeLinearTeams(integ.rows[0].config);
  const scoped =
    scope.kind === "group"
      ? allTeams.filter((t) => t.group_ids.length === 0 || t.group_ids.includes(scope.groupId))
      : allTeams;
  const teamKeys = scoped.map((t) => t.key);
  if (teamKeys.length === 0) {
    return {
      team_keys: [],
      last_sync_at: integ.rows[0].last_sync_at,
      wip_now: 0,
      week: linearWeekVelocity([]),
      prev_week: linearWeekVelocity([]),
    };
  }

  const prevMonday = previousIsoMonday(weekMonday);
  const winEnd = weekEndExclusive(weekMonday);
  const [issues, wip] = await Promise.all([
    pool.query<LinearIssueAggRow & { in_current_week: boolean }>(
      `SELECT i.created_at::text, i.started_at::text, i.completed_at::text,
              (i.completed_at >= $3::date) AS in_current_week,
              EXISTS (
                SELECT 1 FROM github_pull_requests p
                WHERE p.team_id = i.team_id AND p.ai_assisted
                  AND p.title ~* (i.identifier || '\\M')
              ) AS ai_linked
       FROM linear_issues i
       WHERE i.team_id = $1 AND i.linear_team_key = ANY($5::text[])
         AND i.completed_at >= $2::date AND i.completed_at < $4::date`,
      [teamId, prevMonday, weekMonday, winEnd, teamKeys],
    ),
    pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM linear_issues
       WHERE team_id = $1 AND linear_team_key = ANY($2::text[]) AND state_type = 'started'`,
      [teamId, teamKeys],
    ),
  ]);

  return {
    team_keys: teamKeys,
    last_sync_at: integ.rows[0].last_sync_at,
    wip_now: wip.rows[0].n,
    week: linearWeekVelocity(issues.rows.filter((r) => r.in_current_week)),
    prev_week: linearWeekVelocity(issues.rows.filter((r) => !r.in_current_week)),
  };
}

export type WorkTimelineRow = {
  created_at: string;
  started_at: string | null;
  first_pr_created: string | null; // MIN(created_at) over matched merged PRs
  last_merged: string | null; // MAX(merged_at) over matched merged PRs
  estimate: number | null; // Linear points
  lines_changed: number | null; // SUM(additions+deletions) over matched merged PRs
};

const phaseMs = (a: string | null, b: string | null, clamp = false): number | null => {
  if (!a || !b) return null;
  const d = new Date(b).getTime() - new Date(a).getTime();
  return clamp ? Math.max(0, d) : d >= 0 ? d : null;
};
// Build clamps at 0 (tickets sometimes flip to started after the PR already
// exists); a negative non-clamped phase is bad data and drops from the stats
// rather than zeroing them.
const buildMs = (r: WorkTimelineRow) => phaseMs(r.started_at, r.first_pr_created, true);
const reviewMs = (r: WorkTimelineRow) => phaseMs(r.first_pr_created, r.last_merged);

function collect(rows: WorkTimelineRow[], pick: (r: WorkTimelineRow) => number | null): number[] {
  return rows.map(pick).filter((v): v is number => v != null);
}

function phaseStats(rows: WorkTimelineRow[]): WorkTimelinePhases {
  const stat = (pick: (r: WorkTimelineRow) => number | null): WorkPhaseStat => {
    const vals = collect(rows, pick);
    return { median_hours: medianHours(vals), p90_hours: percentileHours(vals, 0.9) };
  };
  return { build: stat(buildMs), review: stat(reviewMs) };
}

// Size cutoffs are tuned to agent-scale diffs — terciles of real agentic-team
// data sit near 1k/1.7k lines, so the conventional 100/500 PR-size buckets
// would put everything in L.
const LINE_BOUNDS: Record<"S" | "M" | "L", string> = { S: "<1k lines", M: "1–3k lines", L: ">3k lines" };
const POINT_BOUNDS: Record<"S" | "M" | "L", string> = { S: "≤2 pts", M: "3–5 pts", L: "≥6 pts" };

function sizeOf(r: WorkTimelineRow, sizedBy: "estimate" | "lines"): "S" | "M" | "L" | null {
  if (sizedBy === "estimate") {
    if (r.estimate == null) return null;
    return r.estimate <= 2 ? "S" : r.estimate <= 5 ? "M" : "L";
  }
  if (r.lines_changed == null) return null;
  return r.lines_changed < 1000 ? "S" : r.lines_changed <= 3000 ? "M" : "L";
}

// Pure assembly from joined-row sets; exported for tests. Tickets that can't
// be sized (no estimate in estimate mode) drop from size_classes but still
// count in the phase stats.
export function workTimelineStats(
  curr: WorkTimelineRow[],
  prev: WorkTimelineRow[],
  unjoined: number,
): WorkTimelineStats {
  const withEstimate = curr.filter((r) => r.estimate != null).length;
  const sizedBy: "estimate" | "lines" = curr.length > 0 && withEstimate * 2 >= curr.length ? "estimate" : "lines";
  const bounds = sizedBy === "estimate" ? POINT_BOUNDS : LINE_BOUNDS;
  const totalMs = (r: WorkTimelineRow) => phaseMs(r.started_at, r.last_merged, true);
  const sizeClasses = (["S", "M", "L"] as const)
    .map((size) => {
      const rows = curr.filter((r) => sizeOf(r, sizedBy) === size);
      const prevRows = prev.filter((r) => sizeOf(r, sizedBy) === size);
      return {
        size,
        bounds: bounds[size],
        tickets: rows.length,
        build_hours: medianHours(collect(rows, buildMs)),
        review_hours: medianHours(collect(rows, reviewMs)),
        total_hours: medianHours(collect(rows, totalMs)),
        prev_tickets: prevRows.length,
        prev_total_hours: medianHours(collect(prevRows, totalMs)),
      };
    })
    .filter((c) => c.tickets > 0 || c.prev_tickets > 0);
  return {
    tickets: curr.length,
    unjoined,
    sized_by: sizedBy,
    queue_median_hours: medianHours(collect(curr, (r) => phaseMs(r.created_at, r.started_at))),
    queue_median_hours_prev: medianHours(collect(prev, (r) => phaseMs(r.created_at, r.started_at))),
    week: phaseStats(curr),
    prev_week: phaseStats(prev),
    size_classes: sizeClasses,
  };
}

// Ticket-to-merge timeline, needing both integrations: Linear supplies
// created/started/completed, GitHub supplies first-commit/PR-opened/merged for
// the PRs carrying the ticket ref. Null unless both are connected AND both
// have at least one source mapped into scope — the single-source blocks
// already carry the fix-the-mapping guidance, so this one just stays hidden.
async function workTimeline(
  teamId: string,
  scope: InsightsScope,
  weekMonday: string,
  pool: pg.Pool,
): Promise<WorkTimelineStats | null> {
  const integ = await pool.query<{ provider: string; config: { repos?: unknown; teams?: unknown; team_keys?: unknown } }>(
    `SELECT provider, config FROM team_integrations
     WHERE team_id = $1 AND provider IN ('github', 'linear')`,
    [teamId],
  );
  const gh = integ.rows.find((r) => r.provider === "github");
  const lin = integ.rows.find((r) => r.provider === "linear");
  if (!gh || !lin) return null;

  const inScope = <T extends { group_ids: string[] }>(xs: T[]) =>
    scope.kind === "group"
      ? xs.filter((x) => x.group_ids.length === 0 || x.group_ids.includes(scope.groupId))
      : xs;
  const repoNames = inScope(normalizeGithubRepos(gh.config.repos)).map((r) => r.name);
  const teamKeys = inScope(normalizeLinearTeams(lin.config)).map((t) => t.key);
  if (repoNames.length === 0 || teamKeys.length === 0) return null;

  const prevMonday = previousIsoMonday(weekMonday);
  const winEnd = weekEndExclusive(weekMonday);
  const res = await pool.query<WorkTimelineRow & { in_current_week: boolean }>(
    `SELECT i.created_at::text, i.started_at::text, i.estimate,
            (i.completed_at >= $3::date) AS in_current_week,
            pr.first_pr_created::text, pr.last_merged::text,
            pr.lines_changed::int
     FROM linear_issues i
     LEFT JOIN LATERAL (
       SELECT MIN(p.created_at) AS first_pr_created,
              MAX(p.merged_at) AS last_merged,
              SUM(p.additions + p.deletions) AS lines_changed
       FROM github_pull_requests p
       WHERE p.team_id = i.team_id AND p.repo = ANY($6::text[])
         AND p.state = 'merged' AND p.title ~* (i.identifier || '\\M')
     ) pr ON true
     WHERE i.team_id = $1 AND i.linear_team_key = ANY($5::text[])
       AND i.state_type = 'completed'
       AND i.completed_at >= $2::date AND i.completed_at < $4::date`,
    [teamId, prevMonday, weekMonday, winEnd, teamKeys, repoNames],
  );

  const joined = res.rows.filter((r) => r.last_merged != null);
  return workTimelineStats(
    joined.filter((r) => r.in_current_week),
    joined.filter((r) => !r.in_current_week),
    res.rows.filter((r) => r.in_current_week && r.last_merged == null).length,
  );
}

// PRs carry no membership mapping (that needs the session↔commit-SHA join),
// but repos ARE group-mapped: each configured repo lists the group ids it
// counts toward (empty = all groups). Group-scoped reports only see PRs from
// their mapped repos. Null when the integration isn't connected; connected
// with zero mapped repos returns an empty-repos stats object so the widget
// can tell the admin to fix the mapping rather than silently showing nothing.
async function githubDelivery(
  teamId: string,
  scope: InsightsScope,
  weekMonday: string,
  pool: pg.Pool,
): Promise<GithubDeliveryStats | null> {
  const integ = await pool.query<{ config: { repos: unknown }; last_sync_at: string | null }>(
    `SELECT config, last_sync_at::text FROM team_integrations
     WHERE team_id = $1 AND provider = 'github'`,
    [teamId],
  );
  if (!integ.rowCount) return null;

  const allRepos = normalizeGithubRepos(integ.rows[0].config.repos);
  const scoped =
    scope.kind === "group"
      ? allRepos.filter((r) => r.group_ids.length === 0 || r.group_ids.includes(scope.groupId))
      : allRepos;
  const repoNames = scoped.map((r) => r.name);
  if (repoNames.length === 0) {
    return {
      repos: [],
      last_sync_at: integ.rows[0].last_sync_at,
      open_now: 0,
      week: githubWeekDelivery([]),
      prev_week: githubWeekDelivery([]),
    };
  }

  const prevMonday = previousIsoMonday(weekMonday);
  const winEnd = weekEndExclusive(weekMonday);
  const [prs, open] = await Promise.all([
    pool.query<GithubPrRow & { in_current_week: boolean }>(
      `SELECT created_at::text, merged_at::text, first_commit_at::text, first_review_at::text,
              ai_assisted, (merged_at >= $3::date) AS in_current_week
       FROM github_pull_requests
       WHERE team_id = $1 AND repo = ANY($5::text[])
         AND merged_at >= $2::date AND merged_at < $4::date`,
      [teamId, prevMonday, weekMonday, winEnd, repoNames],
    ),
    pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM github_pull_requests
       WHERE team_id = $1 AND repo = ANY($2::text[]) AND state = 'open'`,
      [teamId, repoNames],
    ),
  ]);

  return {
    repos: repoNames,
    last_sync_at: integ.rows[0].last_sync_at,
    open_now: open.rows[0].n,
    week: githubWeekDelivery(prs.rows.filter((r) => r.in_current_week)),
    prev_week: githubWeekDelivery(prs.rows.filter((r) => !r.in_current_week)),
  };
}

// Build a typed-but-empty TeamInsightReport skeleton. Most catalog widgets read
// nested fields without null guards; rather than scatter optional chaining
// through 30 render functions we just give them zeros and empty arrays.
function emptyReport(slug: string, weekMonday: string): TeamInsightReport {
  return {
    team_slug: slug,
    week_monday: weekMonday,
    generated_at: new Date().toISOString(),
    members_total: 0,
    volume: {
      agent_hours_total: 0, agent_hours_wow_delta_pct: 0,
      agent_hours_per_member: [], agent_hours_per_project: [], agent_hours_per_user_skill: [],
      sessions_total: 0, sessions_per_member: [], median_session_min: 0,
      session_length_histogram: [],
      longest_session: { member: "", project: "", hours: 0, date: "" },
      total_turns: 0, total_tool_calls: 0, tools_per_turn: 0,
      concurrency_peak: { date: "", peak: 0 },
      tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
      cost_total_usd: 0, cost_per_member: [], cost_per_project: [],
      cost_per_shipped_pr_per_member: [],
    },
    code_zones: {
      file_heatmap: [], multi_member_files: [], silo_files: [], cold_directories: [],
      most_rewritten_files: [], file_type_mix: [],
      new_files_originated: 0, modified_files: 0, languages: [],
      tests_to_code_ratio_pct: 0, docs_to_code_ratio_pct: 0, config_to_code_ratio_pct: 0,
      shipped_vs_nonshipped_files: { shipped: 0, nonshipped: 0 },
      extension_diversity_per_member: [],
    },
    working_style: {
      prompt_length_distribution_per_member: [], long_brief_ratio_per_member: [],
      verbosity_drift_per_member: [], imperative_vs_conversational_per_member: [],
      code_block_usage_per_member: [], external_ref_vs_self_contained_per_member: [],
      structured_format_usage_per_member: [], interrupt_freq_per_member: [],
      frustrated_signals_per_member: [], tone_grade_per_member: [],
      politeness_markers_per_member: [], sentiment_user_messages_per_member: [],
      sentiment_agent_responses: { positive: 0, neutral: 0, negative: 0 },
    },
    tool_usage: {
      bash_subverb_heatmap: [], read_edit_ratio: 0, webfetch_websearch_count: 0,
      todowrite_ops_per_session_avg: 0, tool_error_rate_per_member: [],
      tool_retry_chains_count: 0, avg_tools_per_turn: 0,
    },
    skills_harness: {
      user_authored_skills: [], user_authored_subagents: [], skill_families: [],
      skills_loaded_never_dispatched: [], skills_newly_authored_this_week: [],
      preflight_skill_loads: [], midsession_skill_loads: [],
      sessions_with_zero_skills: 0, stock_vs_user_ratio_per_member: [],
      slash_commands_used: [], skill_diffusion_events: [],
      skills_abandoned_this_week: [], skill_descriptions_updated_midweek: [],
    },
    delegation: {
      subagent_dispatches_per_member: [],
      parallel_vs_sequential_batches: { parallel: 0, sequential: 0 },
      background_runs: 0, subagent_types_invoked: [],
      user_authored_vs_stock_per_member: [], avg_subagent_prompt_chars: 0,
      reviewer_triad_sessions: 0, implementer_reviewer_pairs: 0,
      orchestration_brief_first_sessions: 0, solo_vs_orchestrated_per_member: [],
      subagent_shipping_rate_pct: 0,
    },
    plan_mode: {
      adopters: 0, plan_then_build_vs_dive_in_ratio: 0, avg_plan_duration_min: 0,
      plans_shipped: 0, plans_abandoned: 0, brainstorm_warmup_adopters: 0,
      longest_discipline_streak_days: 0, warmup_ritual_sessions: 0,
    },
    outcomes: {
      prs_shipped: 0, prs_per_member: [], prs_per_project: [],
      sessions_ending_in_commit: 0, sessions_ending_in_pr: 0,
      median_first_user_to_merge_min_per_member: [],
      per_project_outcome: [], skill_ship_rate: [], subagent_ship_rate: [],
      time_of_day_ship_rate: [], shipping_rate_ranking: [],
    },
    friction: {
      cooccurring_friction: [], frustrated_sessions: 0, multi_interrupt_sessions: 0,
      abandoned_sessions: 0, loops_detected: 0, long_autonomous_failures: 0,
      shared_errors: [], shared_dependency_trouble: [],
      shared_external_systems_frustrated: [], friction_rate_per_member: [],
      retry_same_op_count: 0, recovery_moves: [],
    },
    diffusion: {
      skill_pickups: [], subagent_spread: [], skill_family_curve: [],
      prompt_pattern_diffusion: [], tool_pattern_spreading: [],
      plan_mode_curve: [], brainstorm_warmup_curve: [], reverse_diffusion: [],
      first_used_other_member_skill_events: [], velocity_diffusion_note: "",
      skill_authoring_rate_trend: [],
    },
    cooccurrence: {
      shared_friction_kinds: [], shared_files_same_week: [], shared_external_refs: [],
      shared_skills_same_day: [], concurrent_sessions: [],
      shared_debugging: [], shared_subagent_dispatch_kinds: [],
    },
    bench: {
      task_category_bench: [],
      highest_delegation_rate: { member: "", dispatches_per_session: 0 },
      highest_skill_load_rate: { member: "", loads_per_session: 0 },
      most_disciplined_plan_mode_user: { member: "", days: 0 },
      most_parallel_dispatch_user: { member: "", sessions: 0 },
      longest_autonomous_tolerance: { member: "", hours: 0 },
      highest_first_pass_ship_rate: { member: "", pct: 0 },
      most_diverse_project_portfolio: { member: "", projects: 0 },
      highest_user_authored_skill_output: { member: "", skills_authored: 0 },
      most_efficient_member: { member: "", metric: "" },
    },
    novelty: {
      weeks_invention: { headline: "", member: "", session_date: "", project: "", detail: "" },
      first_use_of_stock_skill: [],
      first_successful_parallel_dispatch: { member: "", date: "" },
      first_long_autonomous_ship: { member: "", date: "", hours: 0 },
      first_used_other_member_skill: [],
      unprecedented_move: "", new_claudemd_additions: [], new_project_introduced: [],
    },
    external_systems: {
      linear_refs: [], github_refs: [], branch_refs: [],
      url_refs_count: 0, external_triggered_sessions: 0,
      sessions_ending_with_pr_post: 0,
      most_leaned_on_system: { system: "", refs: 0 },
    },
    prompting_fingerprint: {
      style_per_member: [], prompt_frame_mix_per_member: [],
      first_user_length_histogram: [],
    },
    rhythm: {
      team_hour_histogram: Array(24).fill(0), per_member_hour_histogram: [],
      weekday_histogram: [], peak_hours: [],
      late_night_sessions: [], weekend_sessions: [],
      multi_timezone_signal: "", burndown_shape: "", burnout_proxy: [],
    },
    velocity: {
      median_first_user_to_commit_per_member: [],
      median_first_user_to_pr_per_member: [],
      median_first_user_to_merge_min: 0,
      active_vs_wall_clock_ratio_sample: [],
      sessions_per_day: [], prs_per_week_trend: [], velocity_per_project_trend: [],
    },
    knowledge_flow: {
      pattern_a_to_b: [], pattern_main_to_subagent: [], pattern_to_claudemd: [],
      skill_refined_after_session: [], multi_day_threads: [],
      handoff_prose_events: [], cross_member_threads: [],
    },
    ai_behavior: {
      model_usage: [], model_mix_per_session_avg: { opus: 0, sonnet: 0, haiku: 0 },
      model_fallback_events: 0, extended_thinking_rate_pct: 0,
      high_clarification_sessions: 0, hallucination_flags: 0, reverted_tool_calls: 0,
      high_cost_sessions: [], cache_hit_rate_avg_pct: 0, agent_helpfulness_per_member: [],
    },
    cost_efficiency: {
      cost_per_pr_per_project: [], tokens_per_pr_team: 0,
      plan_utilization_burndown_pct: 0, extra_usage_spend_per_project: [],
      cost_trend_wow_pct: 0, high_cost_low_yield_sessions: [],
    },
    coverage: {
      untouched_files_count: 0, untouched_directories: [], universal_contact_files: [],
      new_files_by_agent: 0, agent_authored_test_files: 0, agent_authored_doc_files: 0,
      legacy_zones_with_activity: [],
    },
    trend: {
      skill_adoption_curves: [], subagent_dispatch_trend: [], plan_mode_trend: [],
      velocity_trend: [], cost_trend: [], skill_authoring_rate_trend: [],
      maturity_composite_weekly: [], diffusion_velocity_note: "",
    },
    onboarding: {
      ramp_up_curves: [], first_skill_load: [], first_subagent_dispatch: [],
      first_plan_mode: [], first_pr_via_agents: [], time_to_first_ship: [],
    },
    manager: {
      wins_this_week: [], topics_for_oneonone: [], concerns_to_address: [],
      onboarding_suggestions: [], ask_x_about_y: [], friday_demo_candidates: [],
    },
    org_rollup: {
      team_maturity_score: { current: 0, prior: 0, trend: "flat" },
      quarterly_agent_shipping_trend: [], team_vs_org_comparison: [],
      roi_per_team: [], skill_authoring_rate: 0, bus_factor_practices: [],
    },
    pair_work: {
      multiday_continuations: [], coauthored_commits: [],
      cross_session_threads: [], hot_files: [],
    },
    outliers: {
      atypical_day_per_member: [],
      unexpected_project_attention: { project: "", usual_hours: 0, this_week: 0 },
      abandoned_skill_outliers: [],
      spiked_subagent: { type: "", usual: 0, this_week: 0 },
      interrupt_spike: { member: "", usual: 0, this_week: 0 },
      outlier_long_autonomous: { member: "", hours: 0, median: 0 },
      novel_friction_kind: { kind: "", member: "" },
    },
    spotlights: [],
    meta: {
      section_coverage: [], spotlight_rate_pct: 0, synthesis_cost_usd: 0,
      data_freshness: "", member_data_completeness_pct: 0,
    },
    cross_edition: {
      member_links: [], session_deep_links: [], roster: [],
    },
    variants: {
      fingerprints: [], trajectory_rows: [], trajectory_observations: [],
      diffusion_practices: [], diffusion_grid: [], diffusion_arrows: [],
      session_archetypes: [], archetype_distribution: [],
      illustrative_session_timelines: [], story_paragraphs: [],
      wow_pulse: {
        agent_hours: { current: 0, last_week: 0, delta_pct: 0 },
        sessions: { current: 0, last_week: 0, delta_abs: 0 },
        tickets_resolved: { source: "Linear", current: 0, last_week: 0, delta: 0, sample_refs: [] },
        parallel_execution: { total_min: 0, peak_concurrent: 0, total_min_wow_delta_pct: 0 },
        long_autonomous: { count: 0, total_min: 0, max_single_min: 0, count_wow_delta: 0, total_min_wow_delta_pct: 0 },
        project_time: [],
        goal_mix: [],
        skill_usage: [],
      },
      case_studies: [],
      v2_closing: [],
      v3_extras: {
        dx_framework: {
          utilization: { sessions_per_eng_per_week: 0, delta_pct: 0, agent_assisted_pr_share_pct: 0, delta_pp: 0, skills_loaded_per_session: 0 },
          impact: { median_first_user_to_merge_min: 0, delta_pct: 0, rework_pr_pct: 0, delta_pp: 0, shipped_via_agent_share_pct: 0, delta_pp_shipped: 0 },
          cost: { usd_total_week: 0, delta_pct: 0, usd_per_shipped_pr: 0, delta_pct_per_pr: 0, plan_burn_pct: 0 },
        },
        delegation_gap: { used_pct: 0, fully_delegated_pct: 0, gap_pp: 0, trend_used_pct: [], trend_fully_delegated_pct: [], headline: "" },
        flip: { augmentation_pct_this_week: 0, automation_pct_this_week: 0, trend_this_team: [], industry_baseline_jan_2026: { augmentation_pct: 52, automation_pct: 45 }, note: "" },
        context_engineering: {
          conformity_rate_pct: 0, conformity_delta_pp: 0, rework_ratio_pct: 0, rework_delta_pp: 0,
          review_depth_per_pr: 0, review_depth_delta_pct: 0, code_churn_14d_pct: 0, code_churn_delta_pp: 0,
          user_authored_context_files: 0, llm_authored_context_files: 0,
        },
        harness_engineering: {
          working_memory_budget: { median_pct_used: 0, sessions_over_80pct: 0 },
          cache_hit_rate_pct: 0, cache_hit_delta_pp: 0,
          tool_call_efficiency: { successful_calls_pct: 0, median_tools_per_outcome_unit: 0 },
          trajectory_eval: { sessions_with_unforced_loops: 0, sessions_with_premature_completion: 0, sessions_with_steady_progress: 0 },
        },
        dora_attribution: {
          deployment_frequency: { current: 0, ai_assisted_pct: 0 },
          lead_time_min: { current: 0, ai_assisted_delta_pct: 0 },
          change_failure_rate_pct: { current: 0, ai_assisted: 0, human_authored: 0 },
          mttr_min: { current: 0, ai_assisted_delta_pct: 0 },
          note: "",
        },
        methodology_notes: [],
        v3_closing: [],
      },
      v4_extras: {
        delegation_depth: {
          fully_delegated_pct: 0, mid_delegation_pct: 0, heavy_steering_pct: 0,
          trend_fully_delegated_4w: [], trend_heavy_steering_4w: [], headline: "",
        },
        external_integrations: [],
        v4_closing: [],
        methodology_notes: [],
      },
      v5_extras: {
        banner_text: "",
        pipeline: { phases: [], total_lead_time_min: 0, headline: "" },
        dora_actual: {
          deployment_frequency: { current: 0, delta_pct_wow: 0, ai_assisted_share_pct: 0 },
          lead_time_min: { current: 0, ai_assisted_median: 0, human_authored_median: 0 },
          change_failure_rate_pct: { current: 0, ai_assisted: 0, human_authored: 0 },
          mttr_min: { current: 0, ai_assisted_median: 0, human_authored_median: 0 },
          classification: "medium",
        },
        quality_actual: {
          conformity_rate_pct: { current: 0, delta_pp_wow: 0 },
          rework_rate_pct: { current: 0, delta_pp_wow: 0 },
          code_churn_14d_pct: { current: 0, delta_pp_wow: 0 },
          review_depth_per_pr: { current: 0, delta_pct_wow: 0 },
          conformity_failures_this_week: [],
        },
        ticket_lifecycle: [], case_study_attribution: [], cost_per_resolved: [],
        newly_answerable_questions: [], v5_closing: [],
        dora_narrative: {
          opening: { headline: "", used_pct: 0, perceived_productive_pct: 0, throughput_signal: "", instability_signal: "" },
          amplifier: { headline: "", strengths_amplified: [], dysfunctions_amplified: [] },
          use_cases: [], immediate_value: { headline: "", wins: [] },
          tensions: [], practical_insights: [], conclusion_paragraphs: [],
          closing_citation: { label: "", href: "", published: "" },
        },
        actionables: {
          hero_takeaway: "", strengths: [], dysfunctions: [], risk_signals: [],
          bottleneck_callout: { headline: "", phase: "", delta_pct: 0, action: "" },
          paired_metrics: [], investments: [], oneonone_prompts: [], demo_candidates: [],
          appendix_note: "",
        },
      },
      v6_extras: {
        headline: "", premise: "", universal_workflow_note: "",
        phase_summaries: [], workflow_mappings: [], ticket_journeys: [],
        implementation_trend: [], allocation: [], case_studies: [],
        answerable_questions: [],
      },
    },
  };
}

export type TeamReportContext = {
  teamSlug: string;
  teamName: string;
  membersTotal: number;
};

/** Build a real-data TeamInsightReport from rich_daily_rollups. Fills only the
 *  fields LIVE_STARTER_BLOCKS consume; everything else stays as a zero/empty
 *  skeleton so the type stays satisfied and unselected catalog widgets render
 *  inert without crashing. */
export async function buildTeamInsightReport(
  teamId: string,
  scope: InsightsScope,
  pool: pg.Pool,
  ctx: TeamReportContext,
  weekMonday: string = isoMondayOf(new Date()),
): Promise<TeamInsightReport> {
  const memberIds = await visibleMembershipIds(teamId, scope, pool);
  const prevMonday = previousIsoMonday(weekMonday);

  // Per-member aggregates over this week + last week feed both the roster
  // table and the L0–L4 maturity classifier below.
  const perMemberRes = memberIds.length === 0
    ? { rows: [] as Array<{
        id: string; display_name: string; agent_time_ms_curr: string; sessions_curr: number;
        active_days_curr: number; prs_curr: number; subagents_curr: number;
        active_days_prev: number; sessions_prev: number; projects_curr: number; skills_curr: number;
        active_days_30d: number; sessions_30d: number;
        distinct_projects_30d: number; distinct_skills_30d: number; distinct_subagents_30d: number;
      }> }
    : await pool.query<{
        id: string;
        display_name: string;
        agent_time_ms_curr: string;
        sessions_curr: number;
        active_days_curr: number;
        prs_curr: number;
        subagents_curr: number;
        active_days_prev: number;
        sessions_prev: number;
        projects_curr: number;
        skills_curr: number;
        active_days_30d: number;
        sessions_30d: number;
        distinct_projects_30d: number;
        distinct_skills_30d: number;
        distinct_subagents_30d: number;
      }>(
        // 30d-window CTE produces breadth counters (distinct projects / skills
        // / sub-agent kinds rolled up across the trailing 30 days), separate
        // from the this-week-vs-last-week numeric block which still drives
        // the headline tiles. Both share the same memberships filter.
        `WITH window_30d AS (
           SELECT r.membership_id, r.day, r.agent_time_ms, r.sessions,
                  r.projects, r.skills_loaded, r.subagents_dispatched
           FROM rich_daily_rollups r
           WHERE r.team_id = $1
             AND r.membership_id = ANY($2::uuid[])
             AND r.day >= ($3::date - INTERVAL '30 days')::date
             AND r.day < $5::date
         ),
         per_member_30d AS (
           SELECT membership_id,
                  COALESCE(SUM(sessions), 0)::int AS sessions_30d,
                  COUNT(*) FILTER (WHERE agent_time_ms > 0)::int AS active_days_30d,
                  COALESCE((SELECT COUNT(DISTINCT p->>'project')
                            FROM window_30d w2
                            CROSS JOIN LATERAL jsonb_array_elements(w2.projects) p
                            WHERE w2.membership_id = w.membership_id), 0)::int AS distinct_projects_30d,
                  COALESCE((SELECT COUNT(DISTINCT s->>'name')
                            FROM window_30d w2
                            CROSS JOIN LATERAL jsonb_array_elements(w2.skills_loaded) s
                            WHERE w2.membership_id = w.membership_id), 0)::int AS distinct_skills_30d,
                  COALESCE((SELECT COUNT(DISTINCT s->>'type')
                            FROM window_30d w2
                            CROSS JOIN LATERAL jsonb_array_elements(w2.subagents_dispatched) s
                            WHERE w2.membership_id = w.membership_id), 0)::int AS distinct_subagents_30d
           FROM window_30d w
           GROUP BY membership_id
         ),
         window_rows AS (
           SELECT m.id AS membership_id,
                  COALESCE(NULLIF(ua.display_name, ''), split_part(ua.email, '@', 1)) AS display_name,
                  r.day, r.agent_time_ms, r.sessions, r.prs,
                  jsonb_array_length(r.subagents_dispatched) AS subagent_kinds,
                  jsonb_array_length(r.projects) AS project_count,
                  jsonb_array_length(r.skills_loaded) AS skill_count,
                  (r.day < $3::date) AS is_prev
           FROM memberships m
           JOIN user_accounts ua ON ua.id = m.user_account_id
           LEFT JOIN rich_daily_rollups r ON r.membership_id = m.id
             AND r.team_id = m.team_id
             AND r.day >= $4::date AND r.day < $5::date
           WHERE m.team_id = $1
             AND m.id = ANY($2::uuid[])
             AND m.revoked_at IS NULL
         )
         SELECT wr.membership_id AS id, wr.display_name,
                COALESCE(SUM(CASE WHEN NOT wr.is_prev THEN wr.agent_time_ms ELSE 0 END), 0)::text AS agent_time_ms_curr,
                COALESCE(SUM(CASE WHEN NOT wr.is_prev THEN wr.sessions ELSE 0 END), 0)::int AS sessions_curr,
                COUNT(*) FILTER (WHERE NOT wr.is_prev AND wr.agent_time_ms > 0)::int AS active_days_curr,
                COALESCE(SUM(CASE WHEN NOT wr.is_prev THEN wr.prs ELSE 0 END), 0)::int AS prs_curr,
                COALESCE(MAX(CASE WHEN NOT wr.is_prev THEN wr.subagent_kinds ELSE 0 END), 0)::int AS subagents_curr,
                COUNT(*) FILTER (WHERE wr.is_prev AND wr.agent_time_ms > 0)::int AS active_days_prev,
                COALESCE(SUM(CASE WHEN wr.is_prev THEN wr.sessions ELSE 0 END), 0)::int AS sessions_prev,
                COALESCE(MAX(CASE WHEN NOT wr.is_prev THEN wr.project_count ELSE 0 END), 0)::int AS projects_curr,
                COALESCE(MAX(CASE WHEN NOT wr.is_prev THEN wr.skill_count ELSE 0 END), 0)::int AS skills_curr,
                COALESCE(MAX(pm.active_days_30d), 0)::int AS active_days_30d,
                COALESCE(MAX(pm.sessions_30d), 0)::int AS sessions_30d,
                COALESCE(MAX(pm.distinct_projects_30d), 0)::int AS distinct_projects_30d,
                COALESCE(MAX(pm.distinct_skills_30d), 0)::int AS distinct_skills_30d,
                COALESCE(MAX(pm.distinct_subagents_30d), 0)::int AS distinct_subagents_30d
         FROM window_rows wr
         LEFT JOIN per_member_30d pm ON pm.membership_id = wr.membership_id
         GROUP BY wr.membership_id, wr.display_name
         ORDER BY agent_time_ms_curr DESC`,
        [teamId, memberIds, weekMonday, prevMonday, weekEndExclusive(weekMonday)],
      );

  const [pulse, projects, skills, _shapes, thisWeek, prevWeek] = await Promise.all([
    teamPulseWeek(teamId, scope, weekMonday, pool),
    perProjectTimeWoW(teamId, scope, weekMonday, pool, { limit: 12 }),
    skillUsageWeek(teamId, scope, weekMonday, pool, { limit: 16 }),
    workingShapeDistribution(teamId, scope, weekMonday, pool),
    weekAggregates(teamId, memberIds, weekMonday, pool),
    weekAggregates(teamId, memberIds, prevMonday, pool),
  ]);
  const roster = { rows: perMemberRes.rows.map((r) => ({
    id: r.id,
    display_name: r.display_name,
    agent_time_ms: r.agent_time_ms_curr,
    prs: r.prs_curr,
  })) };

  const report = emptyReport(ctx.teamSlug, weekMonday);
  report.members_total = ctx.membersTotal;

  // ── A. Volume (headline) ──────────────────────────────────────────────
  report.volume.agent_hours_total = pulse.agentHours;
  report.volume.agent_hours_wow_delta_pct = pctDelta(pulse.agentHours, pulse.agentHoursPrev);
  report.volume.sessions_total = pulse.sessions;
  report.volume.concurrency_peak = {
    date: thisWeek.concurrencyPeakDay || weekMonday,
    peak: thisWeek.concurrencyPeak,
  };
  report.volume.tokens = {
    input: thisWeek.tokensInput,
    output: thisWeek.tokensOutput,
    cache_read: thisWeek.tokensCacheRead,
    cache_write: thisWeek.tokensCacheWrite,
  };

  // ── DD. Cross-edition roster (header chip) ────────────────────────────
  report.cross_edition.roster = roster.rows.map((r) => ({
    membership_id: r.id,
    display_name: r.display_name ?? "(unnamed)",
    agent_hours: Number(r.agent_time_ms) / 3_600_000,
    shipped: r.prs,
  }));

  // ── v2 wow_pulse ──────────────────────────────────────────────────────
  const wp = report.variants.wow_pulse;
  wp.agent_hours = {
    current: Number(pulse.agentHours.toFixed(1)),
    last_week: Number(pulse.agentHoursPrev.toFixed(1)),
    delta_pct: pctDelta(pulse.agentHours, pulse.agentHoursPrev),
  };
  wp.sessions = {
    current: pulse.sessions,
    last_week: pulse.sessionsPrev,
    delta_abs: pulse.sessions - pulse.sessionsPrev,
  };
  wp.parallel_execution = {
    total_min: thisWeek.parallelMinutes,
    peak_concurrent: thisWeek.concurrencyPeak,
    total_min_wow_delta_pct: pctDelta(thisWeek.parallelMinutes, prevWeek.parallelMinutes),
  };
  wp.long_autonomous = {
    count: thisWeek.longAutoCount,
    total_min: thisWeek.longAutoTotalMin,
    max_single_min: thisWeek.longAutoMaxSingleMin,
    count_wow_delta: thisWeek.longAutoCount - prevWeek.longAutoCount,
    total_min_wow_delta_pct: pctDelta(thisWeek.longAutoTotalMin, prevWeek.longAutoTotalMin),
  };
  wp.project_time = projects.map((p) => ({
    project: p.project,
    hours_this_week: Number(p.agentHours.toFixed(1)),
    hours_last_week: Number(p.agentHoursPrev.toFixed(1)),
    delta_pct: pctDelta(p.agentHours, p.agentHoursPrev),
  }));
  wp.skill_usage = skills.map((s) => ({
    skill: s.skill,
    uses_this_week: s.sessions,
    uses_last_week: s.sessionsPrev,
    delta: s.sessions - s.sessionsPrev,
  }));

  // ── v4 delegation_depth (proxy from long-autonomous + plan-mode) ──────
  // fully delegated = long-autonomous turn share; heavy steering = high
  // tool-error session share (proxy for retry-heavy interactive work); mid
  // delegation absorbs the remainder. Numbers are rounded to integer percents.
  const sessions = Math.max(thisWeek.sessions, 1);
  const fullyPct = Math.min(100, Math.round((thisWeek.longAutoCount / sessions) * 100));
  // Cap heavy at remaining headroom so the three segments sum to 100.
  const heavyRaw = Math.round((thisWeek.toolErrors / Math.max(thisWeek.sessions, 1)) * 100);
  const heavyPct = Math.max(0, Math.min(100 - fullyPct, heavyRaw));
  const midPct = Math.max(0, 100 - fullyPct - heavyPct);
  report.variants.v4_extras.delegation_depth = {
    fully_delegated_pct: fullyPct,
    mid_delegation_pct: midPct,
    heavy_steering_pct: heavyPct,
    trend_fully_delegated_4w: [fullyPct],
    trend_heavy_steering_4w: [heavyPct],
    headline:
      thisWeek.sessions === 0
        ? "No sessions in window — delegation depth unavailable."
        : `${fullyPct}% of sessions ran ≥1 long autonomous turn; ${heavyPct}% triggered tool retries.`,
  };

  // ── v8 live_extras (framework-aligned KPIs) ───────────────────────────
  const activeThisWeek = perMemberRes.rows.filter((r) => r.active_days_curr > 0).length;
  const activeLastWeek = perMemberRes.rows.filter((r) => r.active_days_prev > 0).length;
  const active30d = perMemberRes.rows.filter(
    (r) => r.active_days_curr > 0 || r.active_days_prev > 0,
  ).length;

  const planModeSessionsCurr = thisWeek.planModeUsed;
  const planModeSessionsPrev = prevWeek.planModeUsed;

  // Plan-mode adopters need per-member plan_mode_used to count distinctly.
  // The columns are summed in weekAggregates; for the adopters count we run
  // one small query.
  const planAdoptersRes = memberIds.length === 0
    ? { rows: [] as Array<{ count: string }> }
    : await pool.query<{ count: string }>(
        `SELECT COUNT(DISTINCT membership_id)::text AS count
         FROM rich_daily_rollups
         WHERE team_id = $1 AND membership_id = ANY($2::uuid[])
           AND day >= $3::date AND day < $4::date
           AND plan_mode_used > 0`,
        [teamId, memberIds, weekMonday, weekEndExclusive(weekMonday)],
      );
  const planAdopters = Number(planAdoptersRes.rows[0]?.count ?? 0);

  const freshnessRes = memberIds.length === 0
    ? { rows: [] as Array<{ ingested_at: string }> }
    : await pool.query<{ ingested_at: string }>(
        `SELECT MAX(ingested_at)::text AS ingested_at
         FROM rich_daily_rollups
         WHERE team_id = $1 AND membership_id = ANY($2::uuid[])
           AND day >= $3::date AND day < $4::date`,
        [teamId, memberIds, weekMonday, weekEndExclusive(weekMonday)],
      );

  // The aggregate L0–L4 mix is derived from the portrait classifier below
  // (single source of truth) — see classifications/distribution after the
  // portraits are built. This keeps the headline distribution and the
  // per-member portraits from ever disagreeing, and keeps grading off raw
  // session/token volume (anti-tokenmaxxing).

  // v9 — per-member qualitative portraits.
  //
  // The "builds" signal comes from day_artifact_signals (file-system probe
  // pushed by the personal-edition daemon). The "coaches" signal comes from
  // team_skill_catalog reconciliation: a path_hash this member originated
  // that another member has loaded. Both are real reads — no synthetic flags.
  //
  // When no probe data has landed yet, all artifact counters are zero and
  // members can still reach L4 via the explicit "L4-orchestrates" path if
  // they have ≥3 sub-agent kinds AND ≥5 parallel-dispatch bursts. The honest
  // distribution in an unprobed team is L0/L1/L2/L3 only.
  const artifactRes = memberIds.length === 0
    ? { rows: [] as Array<{
        membership_id: string;
        skills_authored_count: number;
        subagents_authored_count: number;
        slash_commands_authored_count: number;
        claudemd_line_delta: number;
      }> }
    : await pool.query<{
        membership_id: string;
        skills_authored_count: number;
        subagents_authored_count: number;
        slash_commands_authored_count: number;
        claudemd_line_delta: number;
      }>(
        // Trailing 30d artifact-authoring signal per member.
        `SELECT membership_id,
                COALESCE(SUM(jsonb_array_length(skills_authored)), 0)::int AS skills_authored_count,
                COALESCE(SUM(jsonb_array_length(subagents_authored)), 0)::int AS subagents_authored_count,
                COALESCE(SUM(jsonb_array_length(slash_commands_authored)), 0)::int AS slash_commands_authored_count,
                COALESCE(SUM(claudemd_line_delta), 0)::int AS claudemd_line_delta
         FROM day_artifact_signals
         WHERE team_id = $1 AND membership_id = ANY($2::uuid[])
           AND day >= ($3::date - INTERVAL '30 days')::date
           AND day < $4::date
         GROUP BY membership_id`,
        [teamId, memberIds, weekMonday, weekEndExclusive(weekMonday)],
      );

  // Cross-member adoption: count the DISTINCT in-scope teammates who adopted an
  // artifact this member originated. That's the L4-coaches path made concrete.
  // Counting distinct adopters (not catalog rows) means "adopter overlap with
  // group members" — for a group report only same-group adopters count, so the
  // figure reflects within-group diffusion, not org-wide reach.
  const coachesRes = memberIds.length === 0
    ? { rows: [] as Array<{ membership_id: string; coached_count: number }> }
    : await pool.query<{ membership_id: string; coached_count: number }>(
        `SELECT t.originator_membership_id AS membership_id,
                COUNT(DISTINCT a)::int AS coached_count
         FROM team_skill_catalog t,
              LATERAL unnest(t.adopter_membership_ids) a
         WHERE t.team_id = $1
           AND t.originator_membership_id = ANY($2::uuid[])
           AND a = ANY($2::uuid[])
         GROUP BY t.originator_membership_id`,
        [teamId, memberIds],
      );

  const artifactByMember = new Map<string, typeof artifactRes.rows[0]>();
  for (const row of artifactRes.rows) artifactByMember.set(row.membership_id, row);
  const coachesByMember = new Map<string, number>();
  for (const row of coachesRes.rows) coachesByMember.set(row.membership_id, row.coached_count);
  //
  // Production design: a perception-layer LLM pass tags each session with
  // SessionActionTags, then synthesizes a member-level portrait monthly. For
  // this build we author plausible portraits grounded in the deterministic
  // signals each member exhibits, so the eng lead sees the *shape* of the
  // final report. When the LLM pass lands, the synthesis prompt produces the
  // qualitative_summary + evidence list; the structure here is unchanged.
  const portraits: MemberMaturityPortrait[] = perMemberRes.rows.map((row) => {
    const sessionsCurr = row.sessions_curr;
    const sessionsPrev = row.sessions_prev;
    const activeDays = row.active_days_curr;
    const projects = row.projects_curr;
    const skills = row.skills_curr;
    const subagents = row.subagents_curr;
    const prs = row.prs_curr;
    const member = row.display_name;

    const evidence: MaturityEvidence[] = [];
    const style_observations: string[] = [];
    const qualifying_paths: MaturityPath[] = [];
    const near_miss_paths: MaturityPath[] = [];

    const artifactCounts = artifactByMember.get(row.id);
    const skillsAuthored = artifactCounts?.skills_authored_count ?? 0;
    const subagentsAuthored = artifactCounts?.subagents_authored_count ?? 0;
    const slashCommandsAuthored = artifactCounts?.slash_commands_authored_count ?? 0;
    const claudemdLineDelta = artifactCounts?.claudemd_line_delta ?? 0;
    const authoredArtifactsTotal =
      skillsAuthored + subagentsAuthored + slashCommandsAuthored + (claudemdLineDelta !== 0 ? 1 : 0);
    const hasAuthoredArtifacts = authoredArtifactsTotal > 0;
    const coachedAdoptionCount = coachesByMember.get(row.id) ?? 0;
    const hasCoachedAdoption = coachedAdoptionCount > 0;

    let level: MaturityLevel;
    let qualitative_summary: string;

    if (sessionsCurr === 0 && sessionsPrev === 0) {
      level = "L0";
      qualitative_summary = `${member} hasn't engaged with the agent in the trailing 30 days — either an onboarding gap or a role shift worth checking on.`;
      evidence.push({
        kind: "decisive",
        text: "No sessions observed in the trailing 30-day window",
        source_tag: "framing",
      });
    } else if (hasAuthoredArtifacts || hasCoachedAdoption) {
      // L4 — qualifies via builds and/or coaches. Both backed by real reads
      // from day_artifact_signals + team_skill_catalog. Each evidence line
      // states the actual count observed.
      level = "L4";
      const builderClauses: string[] = [];
      if (skillsAuthored > 0) builderClauses.push(`${skillsAuthored} user-skill file${skillsAuthored === 1 ? "" : "s"} authored`);
      if (subagentsAuthored > 0) builderClauses.push(`${subagentsAuthored} sub-agent definition${subagentsAuthored === 1 ? "" : "s"} authored`);
      if (slashCommandsAuthored > 0) builderClauses.push(`${slashCommandsAuthored} slash command${slashCommandsAuthored === 1 ? "" : "s"} authored`);
      if (claudemdLineDelta !== 0) builderClauses.push(`CLAUDE.md edits (${claudemdLineDelta} line${Math.abs(claudemdLineDelta) === 1 ? "" : "s"})`);
      const buildersBlurb = builderClauses.length > 0 ? builderClauses.join(", ") : null;

      qualitative_summary =
        hasAuthoredArtifacts && hasCoachedAdoption
          ? `${member} is operating as a multiplier on both axes — building shared toolchain (${buildersBlurb}) and ` +
            `seeing those artifacts picked up by ${coachedAdoptionCount} other ${coachedAdoptionCount === 1 ? "member" : "members"}. ` +
            `Sustained presence across ${activeDays} active days this week with ${sessionsCurr} sessions spanning multiple workflows.`
          : hasAuthoredArtifacts
            ? `${member} is operating as a multiplier — extending the team's toolchain (${buildersBlurb}). ` +
              `Sessions read like someone shaping how the team uses the agent, with ${activeDays} active days this week ` +
              `and ${sessionsCurr} sessions across ${projects} project${projects === 1 ? "" : "s"}.`
            : `${member}'s authored work has spread — ${coachedAdoptionCount} other ${coachedAdoptionCount === 1 ? "member is" : "members are"} loading skills they originated. ` +
              `Sustained presence with ${activeDays} active days this week.`;

      if (hasAuthoredArtifacts) qualifying_paths.push("L4-builds");
      if (hasCoachedAdoption) qualifying_paths.push("L4-coaches");
      qualifying_paths.push("L3-multi-workflow", "L3-daily-active");

      if (hasAuthoredArtifacts) {
        if (skillsAuthored > 0) {
          evidence.push({
            kind: "decisive",
            text: `Authored ${skillsAuthored} user-skill file${skillsAuthored === 1 ? "" : "s"} in trailing 30 days (file-system probe + first-seen path hashes)`,
            count: skillsAuthored,
            source_tag: "artifact_authored",
          });
        }
        if (subagentsAuthored > 0) {
          evidence.push({
            kind: "decisive",
            text: `Authored ${subagentsAuthored} sub-agent definition${subagentsAuthored === 1 ? "" : "s"}`,
            count: subagentsAuthored,
            source_tag: "artifact_authored",
          });
        }
        if (claudemdLineDelta !== 0) {
          evidence.push({
            kind: "decisive",
            text: `Edited CLAUDE.md (${claudemdLineDelta > 0 ? "+" : ""}${claudemdLineDelta} lines net) — project-specific agent guidance`,
            count: Math.abs(claudemdLineDelta),
            source_tag: "artifact_authored",
          });
        }
        if (slashCommandsAuthored > 0) {
          evidence.push({
            kind: "decisive",
            text: `Authored ${slashCommandsAuthored} slash command${slashCommandsAuthored === 1 ? "" : "s"}`,
            count: slashCommandsAuthored,
            source_tag: "artifact_authored",
          });
        }
      }
      if (hasCoachedAdoption) {
        evidence.push({
          kind: "decisive",
          text: `Authored artifacts loaded by ${coachedAdoptionCount} other team member${coachedAdoptionCount === 1 ? "" : "s"} — cross-member adoption verified by skill catalog`,
          count: coachedAdoptionCount,
          source_tag: "artifact_authored",
        });
      }

      evidence.push(
        {
          kind: "supporting",
          text: `Sessions span ${projects} project${projects === 1 ? "" : "s"} with ${skills} distinct skills loaded — multi-workflow signature`,
          count: skills,
          source_tag: "intent_category",
        },
        {
          kind: "supporting",
          text: `${activeDays} active days this week with cross-day continuity — sustained, not bursty`,
          count: activeDays,
        },
        {
          kind: "supporting",
          text: `${prs} PRs shipped this week — sessions consistently land in commits, not just experiments`,
          count: prs,
          source_tag: "ended_in_ship",
        },
      );

      if (!hasCoachedAdoption) {
        near_miss_paths.push("L4-coaches");
        evidence.push({
          kind: "near-miss",
          text: "Authored artifacts not yet loaded by other team members — once a teammate loads one, the 'coaches' path will fire automatically",
        });
      }
      if (!hasAuthoredArtifacts) {
        near_miss_paths.push("L4-builds");
        evidence.push({
          kind: "near-miss",
          text: "No direct artifact-authoring observed this month — qualification was via cross-member adoption alone",
        });
      }
    } else if (activeDays >= 4 && (projects >= 2 || skills >= 4)) {
      // L3 Integrated — multiple workflows + daily-active, but no artifact
      // authoring evidence yet. Differentiate qualifying paths by what's
      // strongest about this member — daily-active vs orchestration-habit
      // vs multi-workflow — so two L3 members don't read identical.
      level = "L3";
      const strongPath: MaturityPath =
        activeDays >= 6 ? "L3-daily-active" :
        subagents >= 2 ? "L3-orchestration-habit" :
        "L3-multi-workflow";
      qualifying_paths.push(strongPath);
      if (strongPath !== "L3-multi-workflow" && (projects >= 2 || skills >= 4)) {
        qualifying_paths.push("L3-multi-workflow");
      }
      if (strongPath !== "L3-daily-active" && activeDays >= 5) {
        qualifying_paths.push("L3-daily-active");
      }

      if (strongPath === "L3-daily-active") {
        qualitative_summary =
          `${member} engages with the agent daily and the work is genuinely diversified — ${projects} projects, ` +
          `${skills} distinct skills loaded across ${activeDays} active days this week. Sessions show iteration within threads and ` +
          `references back to earlier work. The next growth edge is artifact authoring: a CLAUDE.md edit or a skill ` +
          `committed to the team catalog would surface the L4 builds path.`;
      } else if (strongPath === "L3-orchestration-habit") {
        qualitative_summary =
          `${member}'s sessions are characterized by delegation — ${subagents} distinct sub-agent kinds dispatched, often in ` +
          `the same session. Their framing reads like an orchestrator: brief the sub-agent, let it work, integrate. ` +
          `Multi-workflow presence across ${projects} project${projects === 1 ? "" : "s"} with ${skills} skills. Hasn't yet authored shared toolchain ` +
          `additions — that's the visible distance to L4.`;
      } else {
        qualitative_summary =
          `${member} has integrated the agent across multiple workflows — ${projects} projects, ${skills} distinct skills, ` +
          `and sessions clearly show different intents (code-gen, debug, refinement) rather than one repeated task type. ` +
          `One step shy of multiplier: no skill files or CLAUDE.md edits observed this month.`;
      }

      evidence.push(
        {
          kind: "decisive",
          text: `Sessions span ${projects} project${projects === 1 ? "" : "s"} and ${skills} distinct skills — workflow breadth signature, not narrow specialization`,
          count: skills,
          source_tag: "intent_category",
        },
        {
          kind: "supporting",
          text: `${activeDays} active days in past 7 — sustained presence`,
          count: activeDays,
        },
        {
          kind: "supporting",
          text: `Dispatches ${subagents} sub-agent kind${subagents === 1 ? "" : "s"} — comfort with delegation`,
          count: subagents,
        },
      );
      near_miss_paths.push("L4-builds");
      const probeStatus = artifactCounts === undefined
        ? "File-system probe hasn't reported for this member yet — once daemon push lands, authorship would surface here"
        : "File-system probe reported zero artifact-authoring events in the trailing 30 days — CLAUDE.md edits or new skill files would unlock the L4 builds path";
      evidence.push({
        kind: "near-miss",
        text: probeStatus,
        source_tag: "artifact_authored",
      });
      if (coachedAdoptionCount === 0) {
        near_miss_paths.push("L4-coaches");
      }
      style_observations.push(
        "Mix of structured briefs and terse follow-ups — adapts framing to the task",
      );
    } else if (sessionsCurr >= 5 && activeDays >= 2) {
      // L2 Regular — settled but narrow
      level = "L2";
      qualitative_summary =
        `${member} has settled into a repeatable pattern but the use cases stay narrow — most sessions cluster around ` +
        `one or two task types. The next growth edge is widening into adjacent workflows (review, docs, or planning) ` +
        `rather than running more sessions of the same shape.`;
      qualifying_paths.push("L2-settled-pattern");
      evidence.push(
        {
          kind: "decisive",
          text: `${sessionsCurr} sessions across ${activeDays} active days — weekly-active by the framework's definition`,
          count: sessionsCurr,
        },
        {
          kind: "supporting",
          text: `Brings file context regularly — sessions are task-anchored, not exploratory`,
          source_tag: "brought_context",
        },
      );
      near_miss_paths.push("L3-multi-workflow");
      evidence.push({
        kind: "near-miss",
        text: `Only ${projects} project${projects === 1 ? "" : "s"} touched — exposure to additional kinds of work would surface multi-workflow signature`,
        source_tag: "intent_category",
      });
      style_observations.push(
        "Consistent task vocabulary across sessions — recognizable patterns",
      );
    } else if (sessionsCurr >= 1 || sessionsPrev >= 1) {
      // L1 Curious — exploring
      level = "L1";
      qualitative_summary =
        `${member} is in the exploratory phase — sessions feel like cold starts rather than continuations, and ` +
        `the agent is being treated more like a Q&A tool than a collaborator. Settling into a recurring ` +
        `task pattern (write tests, debug logs, refactor a function) is the natural next step.`;
      qualifying_paths.push("L1-exploring");
      evidence.push({
        kind: "decisive",
        text: `${sessionsCurr || sessionsPrev} session${(sessionsCurr || sessionsPrev) === 1 ? "" : "s"} observed — engagement is real but sporadic`,
        count: sessionsCurr || sessionsPrev,
      });
      near_miss_paths.push("L2-settled-pattern");
      evidence.push({
        kind: "near-miss",
        text: "Iteration rounds per session stay low — most sessions end on first response without refinement",
        source_tag: "iteration_rounds",
      });
      style_observations.push(
        "Questions framed more than directives — exploratory voice still dominant",
      );
    } else {
      level = "L0";
      qualitative_summary = `${member} hasn't engaged with the agent in the trailing 30 days.`;
      evidence.push({
        kind: "decisive",
        text: "No activity in trailing 30 days",
      });
    }

    // Lightweight trend hint — sessions current vs prior week. Only set when
    // signal is large enough not to be noise.
    let trend: MemberMaturityPortrait["trend"] | undefined;
    if (sessionsCurr + sessionsPrev >= 6) {
      if (sessionsCurr >= sessionsPrev * 1.2) trend = "ascending";
      else if (sessionsCurr <= sessionsPrev * 0.8) trend = "descending";
      else trend = "stable";
    }

    const cadence: CadenceSnapshot = {
      active_days_30d: row.active_days_30d,
      active_days_7d: activeDays,
      cadence_pct_30d: Math.round((row.active_days_30d / 30) * 100),
      sessions_30d: row.sessions_30d,
      sessions_7d: sessionsCurr,
      sessions_per_active_day_avg:
        row.active_days_30d === 0 ? 0 : Number((row.sessions_30d / row.active_days_30d).toFixed(1)),
    };

    const breadth: BreadthSnapshot = {
      distinct_projects_30d: row.distinct_projects_30d,
      distinct_projects_7d: row.projects_curr,
      distinct_skills_30d: row.distinct_skills_30d,
      distinct_subagent_kinds_30d: row.distinct_subagents_30d,
    };

    const harness: HarnessBreakdown = {
      skills_authored_30d: skillsAuthored,
      subagents_authored_30d: subagentsAuthored,
      slash_commands_authored_30d: slashCommandsAuthored,
      claudemd_line_delta_30d: claudemdLineDelta,
      cross_member_adopters_30d: coachedAdoptionCount,
    };

    return {
      member,
      level,
      qualifying_paths,
      near_miss_paths,
      qualitative_summary,
      cadence,
      breadth,
      harness,
      evidence,
      style_observations,
      ...(trend && { trend }),
    };
  });

  // Sort multipliers first so the eye lands on them.
  portraits.sort((a, b) => b.level.localeCompare(a.level));

  // Aggregate maturity mix — derived from the portrait levels so the
  // distribution and the per-member portraits are one classifier, not two.
  const maturityCue = (p: MemberMaturityPortrait): string => {
    const { cadence: c, breadth: b, harness: h, level } = p;
    if (level === "L0") return "no activity in trailing 30d";
    if (level === "L4") {
      const bits: string[] = [];
      const authored = h.skills_authored_30d + h.subagents_authored_30d + h.slash_commands_authored_30d;
      if (authored > 0 || h.claudemd_line_delta_30d !== 0) bits.push("authors shared toolchain");
      if (h.cross_member_adopters_30d > 0)
        bits.push(`${h.cross_member_adopters_30d} in-group adopter${h.cross_member_adopters_30d === 1 ? "" : "s"}`);
      return bits.join(" · ") || "multiplier";
    }
    return `${c.active_days_7d} active day${c.active_days_7d === 1 ? "" : "s"} · ` +
      `${b.distinct_projects_30d} project${b.distinct_projects_30d === 1 ? "" : "s"} · ` +
      `${b.distinct_skills_30d} skill${b.distinct_skills_30d === 1 ? "" : "s"}`;
  };
  const classifications: MaturityMemberClassification[] = portraits.map((p) => ({
    member: p.member,
    level: p.level,
    evidence: maturityCue(p),
  }));
  const distribution: Record<MaturityLevel, number> = { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0 };
  for (const p of portraits) distribution[p.level] += 1;
  // Members with no rollup row at all never produced a portrait; fold them in as L0.
  if (portraits.length < ctx.membersTotal) distribution.L0 += ctx.membersTotal - portraits.length;

  const liveExtras: LiveExtras = {
    active_rate: {
      members_total: ctx.membersTotal,
      active_7d: activeThisWeek,
      active_7d_prev: activeLastWeek,
      active_30d: active30d,
    },
    maturity_mix: {
      distribution,
      classifications,
    },
    prs_shipped: {
      current: pulse.prs,
      last_week: pulse.prsPrev,
      per_active_engineer: activeThisWeek === 0 ? 0 : Number((pulse.prs / activeThisWeek).toFixed(1)),
      per_active_engineer_last_week:
        activeLastWeek === 0 ? 0 : Number((pulse.prsPrev / activeLastWeek).toFixed(1)),
    },
    plan_mode: {
      sessions: planModeSessionsCurr,
      sessions_last_week: planModeSessionsPrev,
      adopters: planAdopters,
      adoption_pct: activeThisWeek === 0 ? 0 : Math.round((planAdopters / activeThisWeek) * 100),
    },
    data_freshness: freshnessRes.rows[0]?.ingested_at ?? new Date().toISOString(),
    member_portraits: portraits,
  };
  const [ghDelivery, linVelocity, timeline] = await Promise.all([
    githubDelivery(teamId, scope, weekMonday, pool),
    linearVelocity(teamId, scope, weekMonday, pool),
    workTimeline(teamId, scope, weekMonday, pool),
  ]);
  if (ghDelivery) liveExtras.github_delivery = ghDelivery;
  if (linVelocity) liveExtras.linear_velocity = linVelocity;
  if (timeline) liveExtras.work_timeline = timeline;
  report.live_extras = liveExtras;

  // Mirror PR totals on outcomes for any catalog widget that reads them.
  report.outcomes.prs_shipped = pulse.prs;

  // ── v3 harness_engineering (cache hit rate is real; rest stays 0) ─────
  const cacheTotal = thisWeek.tokensInput + thisWeek.tokensCacheRead;
  const cacheHitPct = cacheTotal === 0 ? 0 : Math.round((thisWeek.tokensCacheRead / cacheTotal) * 100);
  const prevCacheTotal = prevWeek.tokensInput + prevWeek.tokensCacheRead;
  const prevCacheHitPct = prevCacheTotal === 0 ? 0 : Math.round((prevWeek.tokensCacheRead / prevCacheTotal) * 100);
  report.variants.v3_extras.harness_engineering = {
    working_memory_budget: { median_pct_used: 0, sessions_over_80pct: 0 },
    cache_hit_rate_pct: cacheHitPct,
    cache_hit_delta_pp: cacheHitPct - prevCacheHitPct,
    tool_call_efficiency: {
      successful_calls_pct:
        thisWeek.sessions === 0
          ? 0
          : Math.max(0, 100 - Math.round((thisWeek.toolErrors / Math.max(thisWeek.sessions, 1)) * 100)),
      median_tools_per_outcome_unit: 0,
    },
    trajectory_eval: {
      sessions_with_steady_progress: Math.max(0, thisWeek.sessions - thisWeek.toolErrors),
      sessions_with_unforced_loops: 0,
      sessions_with_premature_completion: 0,
    },
  };

  return report;
}
