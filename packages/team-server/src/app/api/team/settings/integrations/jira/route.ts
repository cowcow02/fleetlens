import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership, requireAdmin, type TeamContext } from "../../../../../../lib/route-helpers";
import {
  deleteIntegration,
  getIntegration,
  normalizeJiraProjects,
  runJiraSync,
  saveJiraIntegration,
} from "../../../../../../lib/integrations";

async function adminCtx(req: NextRequest): Promise<TeamContext | NextResponse> {
  const slug = req.nextUrl.searchParams.get("team");
  if (!slug) return NextResponse.json({ error: "team slug required" }, { status: 400 });
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const adminErr = requireAdmin(ctx);
  if (adminErr) return adminErr;
  return ctx;
}

export async function GET(req: NextRequest) {
  const ctx = await adminCtx(req);
  if (ctx instanceof NextResponse) return ctx;

  const integration = await getIntegration(ctx.membership.team_id, "jira", ctx.pool);
  if (!integration) return NextResponse.json({ connected: false });
  const config = integration.config as { login?: string; site?: string };

  const counts = await ctx.pool.query<{ jira_project_key: string; total: number; completed: number; started: number }>(
    `SELECT jira_project_key, COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE state_type = 'completed')::int AS completed,
            COUNT(*) FILTER (WHERE state_type = 'started')::int AS started
     FROM jira_issues WHERE team_id = $1 GROUP BY jira_project_key`,
    [ctx.membership.team_id],
  );
  const byKey = new Map(counts.rows.map((r) => [r.jira_project_key, r]));
  const projects = normalizeJiraProjects(integration.config).map((p) => ({
    ...p,
    issues_synced: byKey.get(p.key)?.total ?? 0,
    issues_completed: byKey.get(p.key)?.completed ?? 0,
    issues_in_progress: byKey.get(p.key)?.started ?? 0,
  }));

  return NextResponse.json({
    connected: true,
    login: config.login ?? null,
    site: config.site ?? null,
    projects,
    status: integration.status,
    last_error: integration.last_error,
    last_sync_at: integration.last_sync_at,
    issues_synced: projects.reduce((s, p) => s + p.issues_synced, 0),
    issues_completed: projects.reduce((s, p) => s + p.issues_completed, 0),
    issues_in_progress: projects.reduce((s, p) => s + p.issues_in_progress, 0),
  });
}

export async function PUT(req: NextRequest) {
  const ctx = await adminCtx(req);
  if (ctx instanceof NextResponse) return ctx;

  if (!process.env.FLEETLENS_ENCRYPTION_KEY) {
    return NextResponse.json(
      { error: "FLEETLENS_ENCRYPTION_KEY env var must be set to store integration credentials at rest" },
      { status: 501 },
    );
  }

  const body = (await req.json()) as {
    site?: string; email?: string; apiToken?: string; projects?: unknown; projectKeys?: string[];
  };
  const projects = normalizeJiraProjects({ projects: body.projects, project_keys: body.projectKeys });
  if (projects.length === 0) return NextResponse.json({ error: "select at least one Jira project" }, { status: 400 });

  let login: string;
  try {
    ({ login } = await saveJiraIntegration(
      ctx.membership.team_id,
      body.site?.trim() || null,
      body.email?.trim() || null,
      body.apiToken?.trim() || null,
      projects,
      ctx.user.id,
      ctx.pool,
    ));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  try {
    const summary = await runJiraSync(ctx.membership.team_id, ctx.pool);
    return NextResponse.json({ saved: true, login, sync: summary });
  } catch (err) {
    return NextResponse.json({ saved: true, login, sync_error: (err as Error).message });
  }
}

export async function DELETE(req: NextRequest) {
  const ctx = await adminCtx(req);
  if (ctx instanceof NextResponse) return ctx;
  await deleteIntegration(ctx.membership.team_id, "jira", ctx.pool);
  return NextResponse.json({ deleted: true });
}
