import type pg from "pg";
import type {
  JiraVelocityStats,
  LinearVelocityStats,
  LinearWeekVelocity,
} from "../app/team/[slug]/insights/types";
import { medianHours } from "./github";
import { normalizeLinearTeams, normalizeJiraProjects } from "./integrations";
import {
  previousIsoMonday,
  weekEndExclusive,
  type InsightsScope,
} from "./insights-aggregate";

// One row of team_integrations, fetched once per report build and passed into
// every block that needs a provider config — they used to each re-query it.
export type IntegrationConfigRow = {
  provider: string;
  config: {
    login?: string; repos?: unknown; teams?: unknown; team_keys?: unknown; sync_days?: number;
    projects?: unknown; project_keys?: unknown;
  };
  last_sync_at: string | null;
};

export type LinearIssueAggRow = {
  created_at: string;
  started_at: string | null;
  completed_at: string;
  ai_linked: boolean;
};

export function linearWeekVelocity(rows: LinearIssueAggRow[]): LinearWeekVelocity {
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
export async function linearVelocity(
  teamId: string,
  scope: InsightsScope,
  weekMonday: string,
  pool: pg.Pool,
  integ: IntegrationConfigRow | undefined,
): Promise<LinearVelocityStats | null> {
  if (!integ) return null;

  const allTeams = normalizeLinearTeams(integ.config);
  const scoped =
    scope.kind === "group"
      ? allTeams.filter((t) => t.group_ids.length === 0 || t.group_ids.includes(scope.groupId))
      : allTeams;
  const teamKeys = scoped.map((t) => t.key);
  if (teamKeys.length === 0) {
    return {
      team_keys: [],
      last_sync_at: integ.last_sync_at,
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
                  AND p.title ~* ('\\m' || i.identifier || '\\M')
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
    last_sync_at: integ.last_sync_at,
    wip_now: wip.rows[0].n,
    week: linearWeekVelocity(issues.rows.filter((r) => r.in_current_week)),
    prev_week: linearWeekVelocity(issues.rows.filter((r) => !r.in_current_week)),
  };
}

// Ticket velocity from the Jira integration — the Jira mirror of
// linearVelocity. Jira projects are group-mapped like Linear teams (empty
// group_ids = all groups). Reuses linearWeekVelocity since jira_issues carries
// the same normalized buckets (state_type) and timestamps; cycle time uses the
// changelog-derived started_at. Null when not connected; connected with zero
// mapped projects returns empty-keys stats so the widget can point the admin
// at the mapping.
export async function jiraVelocity(
  teamId: string,
  scope: InsightsScope,
  weekMonday: string,
  pool: pg.Pool,
  integ: IntegrationConfigRow | undefined,
): Promise<JiraVelocityStats | null> {
  if (!integ) return null;

  const allProjects = normalizeJiraProjects(integ.config);
  const scoped =
    scope.kind === "group"
      ? allProjects.filter((p) => p.group_ids.length === 0 || p.group_ids.includes(scope.groupId))
      : allProjects;
  const projectKeys = scoped.map((p) => p.key);
  if (projectKeys.length === 0) {
    return {
      project_keys: [],
      last_sync_at: integ.last_sync_at,
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
                  AND p.title ~* ('\\m' || i.identifier || '\\M')
              ) AS ai_linked
       FROM jira_issues i
       WHERE i.team_id = $1 AND i.jira_project_key = ANY($5::text[])
         AND i.completed_at >= $2::date AND i.completed_at < $4::date`,
      [teamId, prevMonday, weekMonday, winEnd, projectKeys],
    ),
    pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM jira_issues
       WHERE team_id = $1 AND jira_project_key = ANY($2::text[]) AND state_type = 'started'`,
      [teamId, projectKeys],
    ),
  ]);

  return {
    project_keys: projectKeys,
    last_sync_at: integ.last_sync_at,
    wip_now: wip.rows[0].n,
    week: linearWeekVelocity(issues.rows.filter((r) => r.in_current_week)),
    prev_week: linearWeekVelocity(issues.rows.filter((r) => !r.in_current_week)),
  };
}
