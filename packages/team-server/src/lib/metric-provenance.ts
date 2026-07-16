// Provenance for the Explain overlay on the group momentum dashboard. Each
// entry answers, for one element: what it measures, where the data comes from,
// whether the pipeline is live or a placeholder, and whether the value/text is
// deterministic or LLM-generated (and if so, exactly how).
//
// `status` describes the PIPELINE, not today's data:
//   live      — computed from members' pushed rollups.
//   templated — prose assembled from deterministic signals, no model call.
//   planned   — not built yet.
export type MetricStatus = "live" | "templated" | "planned";

export type MetricProvenance = {
  description: string;
  source: string;
  status: MetricStatus;
  // false = deterministic (no model). Otherwise, precisely how the LLM output
  // is obtained in production.
  llm: false | string;
};

export const STATUS_LABEL: Record<MetricStatus, string> = {
  live: "Live pipeline · computed from members' pushed rollups",
  templated: "Templated prose · assembled from deterministic signals, no model call",
  planned: "Planned · not built yet",
};

const ROLLUPS = "rich_daily_rollups (pushed per member by the Fleetlens daemon)";

export const METRIC_PROVENANCE: Record<string, MetricProvenance> = {
  "momentum-trend": {
    description: "Trailing-4-week trajectory of agent time, active members, PRs and sessions for the group. Leads over week-over-week because single-week swings are noisy for a small group.",
    source: `${ROLLUPS}, bucketed by ISO week`,
    status: "live",
    llm: false,
  },
  "trend-agent-time": {
    description: "Combined agent time (active-segment time, gaps >3 min excluded) across the group, per week for the last 4 weeks.",
    source: `${ROLLUPS}.agent_time_ms, summed per ISO week`,
    status: "live",
    llm: false,
  },
  "trend-active-members": {
    description: "Distinct members with at least one active day in the week — the group's weekly reach.",
    source: `${ROLLUPS} — distinct membership_id with agent_time_ms > 0 per ISO week`,
    status: "live",
    llm: false,
  },
  "trend-prs": {
    description: "PRs the group shipped per week. An impact proxy — correlation, not causation; a true delivery measure needs the deferred GitHub/Jira integration.",
    source: `${ROLLUPS}.prs (from each member's git activity), summed per ISO week`,
    status: "live",
    llm: false,
  },
  "trend-sessions": {
    description: "Agent sessions the group started per week — a usage-volume signal, deliberately NOT used to grade maturity.",
    source: `${ROLLUPS}.unique_sessions (start-day count, falls back to sessions), summed per ISO week`,
    status: "live",
    llm: false,
  },
  "live-active-rate": {
    description: "Share of the group active in the last 7 and 30 days.",
    source: `${ROLLUPS} — distinct members with any active day in the window`,
    status: "live",
    llm: false,
  },
  "team-pulse-wow": {
    description: "Combined agent time, sessions, concurrency peak and parallel-execution minutes, week over week.",
    source: ROLLUPS,
    status: "live",
    llm: false,
  },
  "live-maturity-mix": {
    description: "L0–L4 adoption-ladder placement per member and the group distribution. The level is a deterministic classifier (active days, breadth, authored artifacts, in-group adoption) — it never grades on raw volume.",
    source: `${ROLLUPS} + day_artifact_signals (file-system probe) + team_skill_catalog (cross-member adoption)`,
    status: "live",
    llm: false,
  },
  "live-member-portraits": {
    description: "Per-member narrative portrait and the 'why this level' reasoning. The LEVEL and the stat strips are deterministic; the prose is assembled from the same deterministic signals — no model call.",
    source: `same signals as the L0–L4 mix`,
    status: "templated",
    llm: false,
  },
  "live-plan-mode": {
    description: "How many members used plan-mode this week and the adoption rate — an autonomy/steering signal.",
    source: `${ROLLUPS}.plan_mode_used`,
    status: "live",
    llm: false,
  },
  "long-autonomous-texture": {
    description: "Long uninterrupted autonomous turns and their total time — an autonomy signal (less hand-holding).",
    source: `${ROLLUPS}.long_auto_count / long_auto_total_min`,
    status: "live",
    llm: false,
  },
  "skill-usage-wow-bars": {
    description: "Which skills the group loaded, week over week. Usage-pattern context — never used to grade maturity.",
    source: `${ROLLUPS}.skills_loaded`,
    status: "live",
    llm: false,
  },
  "live-prs-shipped": {
    description: "PRs shipped and per-active-engineer, as an IMPACT PROXY — correlation, not causation. A real delivery measure needs the deferred GitHub/Jira (DORA) integration.",
    source: `${ROLLUPS}.prs (self-reported by the member's git activity)`,
    status: "live",
    llm: false,
  },
  "github-delivery": {
    description:
      "Merge-confirmed delivery from the GitHub integration: merged PRs WoW, AI-assisted share, and median cycle (first commit → merge) / review-wait (created → first review) hours split AI vs non-AI. Counts only the repositories mapped into this report's scope; synced PRs carry no member mapping yet. AI attribution is Co-Authored-By-trailer based and undercounts squash-merges that strip trailers.",
    source: "github_pull_requests (hourly poll of the GitHub API via the team's encrypted token)",
    status: "live",
    llm: false,
  },
  "linear-velocity": {
    description:
      "Ticket velocity from the Linear integration: completed tickets WoW, median cycle (started → done) and lead (created → done) hours from Linear's native timestamps, WIP count, and the share of completed tickets shipped via AI-assisted PRs (joined by ticket ref in synced PR titles — undercounts refless PRs). Counts only the Linear teams mapped into this report's scope.",
    source: "linear_issues + github_pull_requests (hourly poll via the team's encrypted Linear API key)",
    status: "live",
    llm: false,
  },
  "jira-velocity": {
    description: "Ticket velocity from the Jira integration: completed tickets, cycle/lead medians, WIP, and the share shipped via AI-assisted PRs. Cycle time uses the changelog's first In-Progress transition as pickup.",
    source: "jira_issues + github_pull_requests (hourly poll via the team's encrypted Jira API token)",
    status: "live",
    llm: false,
  },
  "per-project-time-bars": {
    description:
      "Agent time per GitHub repo for the group, this week vs last (rows resolved from members' git remotes); “others” is agent time not associated with any GitHub project. Hidden when GitHub isn't connected.",
    source: `${ROLLUPS}.projects`,
    status: "live",
    llm: false,
  },
  "seat-right-sizing": {
    description: "Members on a top-tier seat whose plan utilization is chronically low — candidates to move to a smaller seat. A cost lens, never a performance ranking; high usage is not flagged.",
    source: "plan_utilization snapshots → membership_weekly_utilization, against the optimizer's downgrade thresholds (avg <40% & peak <60% over 30 days)",
    status: "live",
    llm: false,
  },
};

export function provenanceFor(id: string): MetricProvenance | null {
  return METRIC_PROVENANCE[id] ?? null;
}
