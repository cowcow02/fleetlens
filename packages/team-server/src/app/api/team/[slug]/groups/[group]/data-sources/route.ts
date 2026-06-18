import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership, requireGroupManager } from "../../../../../../../lib/route-helpers";
import {
  getIntegration,
  normalizeGithubRepos,
  normalizeLinearTeams,
  normalizeJiraProjects,
  type GithubRepoMapping,
  type LinearTeamMapping,
  type JiraProjectMapping,
} from "../../../../../../../lib/integrations";

// Group-scoped view of the integration mappings: which repos / Linear teams
// count toward THIS group's insight report. Editable by team admins/staff or
// the group's manager — managers never see credentials or other groups'
// config, only a per-source boolean for their own group.

async function groupCtx(req: NextRequest, slug: string, groupSlug: string) {
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const group = await requireGroupManager(ctx, groupSlug);
  if (group instanceof NextResponse) return group;
  return { ctx, group };
}

function countsToward(groupIds: string[], groupId: string) {
  return {
    counts: groupIds.length === 0 || groupIds.includes(groupId),
    via_all_groups: groupIds.length === 0,
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string; group: string }> }) {
  const { slug, group: groupSlug } = await params;
  const res = await groupCtx(req, slug, groupSlug);
  if (res instanceof NextResponse) return res;
  const { ctx, group } = res;

  const [github, linear, jira] = await Promise.all([
    getIntegration(ctx.membership.team_id, "github", ctx.pool),
    getIntegration(ctx.membership.team_id, "linear", ctx.pool),
    getIntegration(ctx.membership.team_id, "jira", ctx.pool),
  ]);

  return NextResponse.json({
    github: github
      ? { connected: true, repos: normalizeGithubRepos(github.config.repos).map((r) => ({ name: r.name, ...countsToward(r.group_ids, group.id) })) }
      : { connected: false, repos: [] },
    linear: linear
      ? { connected: true, teams: normalizeLinearTeams(linear.config).map((t) => ({ key: t.key, ...countsToward(t.group_ids, group.id) })) }
      : { connected: false, teams: [] },
    jira: jira
      ? { connected: true, projects: normalizeJiraProjects(jira.config).map((p) => ({ key: p.key, ...countsToward(p.group_ids, group.id) })) }
      : { connected: false, projects: [] },
  });
}

// Re-derive each mapping from the desired per-source boolean for this group.
// Empty group_ids means "all groups", so excluding a source from one group
// expands the default to the remaining groups first.
export function applyDesired<T extends { group_ids: string[] }>(
  entries: T[],
  desired: Map<string, boolean>,
  keyOf: (e: T) => string,
  groupId: string,
  allGroupIds: string[],
): { updated: T[]; error?: string } {
  let orphaned = false;
  const updated = entries.map((e) => {
    const want = desired.get(keyOf(e));
    if (want === undefined) return e;
    const isAll = e.group_ids.length === 0;
    const has = isAll || e.group_ids.includes(groupId);
    if (want === has) return e;
    if (want) {
      const next = [...e.group_ids, groupId];
      return { ...e, group_ids: allGroupIds.every((g) => next.includes(g)) ? [] : next };
    }
    const expanded = isAll ? allGroupIds : e.group_ids;
    const next = expanded.filter((g) => g !== groupId);
    if (next.length === 0) {
      orphaned = true;
      return e;
    }
    return { ...e, group_ids: next };
  });
  if (orphaned) {
    return {
      updated: entries,
      error: "A source must count toward at least one group — remove it from the integration instead of excluding it everywhere.",
    };
  }
  return { updated };
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ slug: string; group: string }> }) {
  const { slug, group: groupSlug } = await params;
  const res = await groupCtx(req, slug, groupSlug);
  if (res instanceof NextResponse) return res;
  const { ctx, group } = res;

  const body = (await req.json()) as {
    github?: { name: string; counts: boolean }[];
    linear?: { key: string; counts: boolean }[];
    jira?: { key: string; counts: boolean }[];
  };

  const allGroups = await ctx.pool.query<{ id: string }>(
    "SELECT id FROM groups WHERE team_id = $1",
    [ctx.membership.team_id],
  );
  const allGroupIds = allGroups.rows.map((g) => g.id);

  if (body.github?.length) {
    const integ = await getIntegration(ctx.membership.team_id, "github", ctx.pool);
    if (!integ) return NextResponse.json({ error: "GitHub integration not connected" }, { status: 400 });
    const desired = new Map(body.github.map((r) => [r.name, r.counts]));
    const { updated, error } = applyDesired<GithubRepoMapping>(
      normalizeGithubRepos(integ.config.repos), desired, (r) => r.name, group.id, allGroupIds,
    );
    if (error) return NextResponse.json({ error }, { status: 400 });
    await ctx.pool.query(
      `UPDATE team_integrations SET config = config || jsonb_build_object('repos', $2::jsonb)
       WHERE team_id = $1 AND provider = 'github'`,
      [ctx.membership.team_id, JSON.stringify(updated)],
    );
  }

  if (body.linear?.length) {
    const integ = await getIntegration(ctx.membership.team_id, "linear", ctx.pool);
    if (!integ) return NextResponse.json({ error: "Linear integration not connected" }, { status: 400 });
    const desired = new Map(body.linear.map((t) => [t.key, t.counts]));
    const { updated, error } = applyDesired<LinearTeamMapping>(
      normalizeLinearTeams(integ.config), desired, (t) => t.key, group.id, allGroupIds,
    );
    if (error) return NextResponse.json({ error }, { status: 400 });
    // Writing 'teams' upgrades legacy team_keys configs in place; drop the
    // stale key so the two never disagree.
    await ctx.pool.query(
      `UPDATE team_integrations
       SET config = (config - 'team_keys') || jsonb_build_object('teams', $2::jsonb)
       WHERE team_id = $1 AND provider = 'linear'`,
      [ctx.membership.team_id, JSON.stringify(updated)],
    );
  }

  if (body.jira?.length) {
    const integ = await getIntegration(ctx.membership.team_id, "jira", ctx.pool);
    if (!integ) return NextResponse.json({ error: "Jira integration not connected" }, { status: 400 });
    const desired = new Map(body.jira.map((p) => [p.key, p.counts]));
    const { updated, error } = applyDesired<JiraProjectMapping>(
      normalizeJiraProjects(integ.config), desired, (p) => p.key, group.id, allGroupIds,
    );
    if (error) return NextResponse.json({ error }, { status: 400 });
    // Writing 'projects' upgrades legacy project_keys configs in place; drop
    // the stale key so the two never disagree.
    await ctx.pool.query(
      `UPDATE team_integrations
       SET config = (config - 'project_keys') || jsonb_build_object('projects', $2::jsonb)
       WHERE team_id = $1 AND provider = 'jira'`,
      [ctx.membership.team_id, JSON.stringify(updated)],
    );
  }

  return NextResponse.json({ saved: true });
}
