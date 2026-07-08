import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership, requireGroupManager } from "../../../../../../../../../lib/route-helpers";
import {
  applyDesired,
  getIntegrationById,
  normalizeGithubRepos,
  normalizeLinearTeams,
  normalizeJiraProjects,
  type GithubRepoMapping,
  type LinearTeamMapping,
  type JiraProjectMapping,
} from "../../../../../../../../../lib/integrations";

// Toggle which of one integration's sources count toward THIS group's insight
// report. Managers only ever flip their own group's inclusion — never another
// group's, never credentials. The integration must be org-level or owned by
// this group; other groups' connections 404 (anti-probing, same as
// requireGroupManager).

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; group: string; id: string }> },
) {
  const { slug, group: groupSlug, id } = await params;
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const group = await requireGroupManager(ctx, groupSlug);
  if (group instanceof NextResponse) return group;

  const integ = await getIntegrationById(ctx.membership.team_id, id, ctx.pool);
  if (!integ || (integ.owner_group_id !== null && integ.owner_group_id !== group.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await req.json()) as { sources?: { key: string; counts: boolean }[] };
  if (!body.sources?.length) return NextResponse.json({ error: "sources required" }, { status: 400 });
  const desired = new Map(body.sources.map((s) => [s.key, s.counts]));

  const allGroups = await ctx.pool.query<{ id: string }>(
    "SELECT id FROM groups WHERE team_id = $1",
    [ctx.membership.team_id],
  );
  const allGroupIds = allGroups.rows.map((g) => g.id);

  if (integ.provider === "github") {
    const { updated, error } = applyDesired<GithubRepoMapping>(
      normalizeGithubRepos(integ.config.repos), desired, (r) => r.name, group.id, allGroupIds,
    );
    if (error) return NextResponse.json({ error }, { status: 400 });
    await ctx.pool.query(
      `UPDATE integrations SET config = config || jsonb_build_object('repos', $2::jsonb) WHERE id = $1`,
      [integ.id, JSON.stringify(updated)],
    );
  } else if (integ.provider === "linear") {
    const { updated, error } = applyDesired<LinearTeamMapping>(
      normalizeLinearTeams(integ.config), desired, (t) => t.key, group.id, allGroupIds,
    );
    if (error) return NextResponse.json({ error }, { status: 400 });
    // Writing 'teams' upgrades legacy team_keys configs in place; drop the
    // stale key so the two never disagree.
    await ctx.pool.query(
      `UPDATE integrations SET config = (config - 'team_keys') || jsonb_build_object('teams', $2::jsonb) WHERE id = $1`,
      [integ.id, JSON.stringify(updated)],
    );
  } else {
    const { updated, error } = applyDesired<JiraProjectMapping>(
      normalizeJiraProjects(integ.config), desired, (p) => p.key, group.id, allGroupIds,
    );
    if (error) return NextResponse.json({ error }, { status: 400 });
    // Writing 'projects' upgrades legacy project_keys configs in place; drop
    // the stale key so the two never disagree.
    await ctx.pool.query(
      `UPDATE integrations SET config = (config - 'project_keys') || jsonb_build_object('projects', $2::jsonb) WHERE id = $1`,
      [integ.id, JSON.stringify(updated)],
    );
  }

  return NextResponse.json({ saved: true });
}
