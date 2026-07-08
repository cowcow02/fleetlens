import { NextRequest, NextResponse } from "next/server";
import {
  requireTeamMembership,
  requireAdmin,
  requireIntegrationManager,
  resolveTeamGroup,
  type TeamContext,
} from "../../../../../../lib/route-helpers";
import {
  deleteIntegration,
  listIntegrations,
  normalizeJiraProjects,
  preserveGroupMappings,
  runJiraSync,
  saveJiraIntegration,
} from "../../../../../../lib/integrations";

async function teamCtx(req: NextRequest): Promise<TeamContext | NextResponse> {
  const slug = req.nextUrl.searchParams.get("team");
  if (!slug) return NextResponse.json({ error: "team slug required" }, { status: 400 });
  return requireTeamMembership(req, slug, { bySlug: true });
}

export async function GET(req: NextRequest) {
  const ctx = await teamCtx(req);
  if (ctx instanceof NextResponse) return ctx;
  const adminErr = requireAdmin(ctx);
  if (adminErr) return adminErr;

  const connections = await listIntegrations(ctx.membership.team_id, ctx.pool, "jira");
  if (connections.length === 0) return NextResponse.json({ connected: false, connections: [] });

  const [counts, groupNames] = await Promise.all([
    ctx.pool.query<{ jira_project_key: string; total: number; completed: number; started: number }>(
      `SELECT jira_project_key, COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE state_type = 'completed')::int AS completed,
              COUNT(*) FILTER (WHERE state_type = 'started')::int AS started
       FROM jira_issues WHERE team_id = $1 GROUP BY jira_project_key`,
      [ctx.membership.team_id],
    ),
    ctx.pool.query<{ id: string; name: string }>(
      "SELECT id, name FROM groups WHERE team_id = $1",
      [ctx.membership.team_id],
    ),
  ]);
  const byKey = new Map(counts.rows.map((r) => [r.jira_project_key, r]));
  const nameByGroup = new Map(groupNames.rows.map((g) => [g.id, g.name]));

  return NextResponse.json({
    connected: true,
    connections: connections.map((c) => {
      const config = c.config as { login?: string; site?: string };
      const projects = normalizeJiraProjects(c.config).map((p) => ({
        ...p,
        issues_synced: byKey.get(p.key)?.total ?? 0,
        issues_completed: byKey.get(p.key)?.completed ?? 0,
        issues_in_progress: byKey.get(p.key)?.started ?? 0,
      }));
      return {
        id: c.id,
        label: c.label,
        owner_group_id: c.owner_group_id,
        owner_group_name: c.owner_group_id ? nameByGroup.get(c.owner_group_id) ?? null : null,
        login: config.login ?? null,
        site: config.site ?? null,
        projects,
        status: c.status,
        last_error: c.last_error,
        last_sync_at: c.last_sync_at,
        issues_synced: projects.reduce((s, p) => s + p.issues_synced, 0),
        issues_completed: projects.reduce((s, p) => s + p.issues_completed, 0),
        issues_in_progress: projects.reduce((s, p) => s + p.issues_in_progress, 0),
      };
    }),
  });
}

export async function PUT(req: NextRequest) {
  const ctx = await teamCtx(req);
  if (ctx instanceof NextResponse) return ctx;

  if (!process.env.FLEETLENS_ENCRYPTION_KEY) {
    return NextResponse.json(
      { error: "FLEETLENS_ENCRYPTION_KEY env var must be set to store integration credentials at rest" },
      { status: 501 },
    );
  }

  const body = (await req.json()) as {
    id?: string; site?: string; email?: string; apiToken?: string;
    projects?: unknown; projectKeys?: string[]; label?: string; owner_group_id?: string | null;
  };
  const projects = normalizeJiraProjects({ projects: body.projects, project_keys: body.projectKeys });
  if (projects.length === 0) return NextResponse.json({ error: "select at least one Jira project" }, { status: 400 });

  let integrationId: string | null = null;
  let label: string;
  let ownerGroupId: string | null = null;
  let projectList = projects;
  if (body.id) {
    const integ = await requireIntegrationManager(ctx, body.id);
    if (integ instanceof NextResponse) return integ;
    if (integ.provider !== "jira") return NextResponse.json({ error: "Not a Jira integration" }, { status: 400 });
    integrationId = integ.id;
    label = body.label?.trim() || integ.label;
    ownerGroupId = integ.owner_group_id;
    if (!ctx.user.is_staff && ctx.membership.role !== "admin") {
      // owner_group_id is non-null here by invariant: requireIntegrationManager only
      // admits non-admin callers for group-owned integrations.
            projectList = preserveGroupMappings(projects, normalizeJiraProjects(integ.config), (p) => p.key, integ.owner_group_id!);
    }
  } else {
    const adminErr = requireAdmin(ctx);
    if (adminErr) return adminErr;
    label = body.label?.trim() || "Jira";
    if (body.owner_group_id) {
      const g = await resolveTeamGroup(ctx, body.owner_group_id);
      if (!g) return NextResponse.json({ error: "Unknown group" }, { status: 400 });
      ownerGroupId = g.id;
    }
  }

  let id: string;
  let login: string;
  try {
    ({ id, login } = await saveJiraIntegration(
      {
        teamId: ctx.membership.team_id,
        id: integrationId,
        label,
        ownerGroupId,
        site: body.site?.trim() || null,
        email: body.email?.trim() || null,
        token: body.apiToken?.trim() || null,
        projects: projectList,
        createdBy: ctx.user.id,
      },
      ctx.pool,
    ));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  try {
    const summary = await runJiraSync(id, ctx.pool);
    return NextResponse.json({ saved: true, id, login, sync: summary });
  } catch (err) {
    return NextResponse.json({ saved: true, id, login, sync_error: (err as Error).message });
  }
}

export async function DELETE(req: NextRequest) {
  const ctx = await teamCtx(req);
  if (ctx instanceof NextResponse) return ctx;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const integ = await requireIntegrationManager(ctx, id);
  if (integ instanceof NextResponse) return integ;
  if (integ.provider !== "jira") return NextResponse.json({ error: "Not a Jira integration" }, { status: 400 });
  await deleteIntegration(ctx.membership.team_id, integ.id, ctx.pool);
  return NextResponse.json({ deleted: true });
}
