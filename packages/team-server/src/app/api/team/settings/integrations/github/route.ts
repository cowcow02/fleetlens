import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership, requireAdmin, type TeamContext } from "../../../../../../lib/route-helpers";
import {
  deleteIntegration,
  getIntegration,
  normalizeGithubRepos,
  runGithubSync,
  saveGithubIntegration,
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

  const integration = await getIntegration(ctx.membership.team_id, "github", ctx.pool);
  if (!integration) return NextResponse.json({ connected: false });

  const counts = await ctx.pool.query<{ repo: string; total: number; ai: number; merged: number }>(
    `SELECT repo, COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE ai_assisted)::int AS ai,
            COUNT(*) FILTER (WHERE state = 'merged')::int AS merged
     FROM github_pull_requests WHERE team_id = $1 GROUP BY repo`,
    [ctx.membership.team_id],
  );
  const countsByRepo = new Map(counts.rows.map((r) => [r.repo, r]));
  const repos = normalizeGithubRepos(integration.config.repos).map((r) => ({
    ...r,
    prs_synced: countsByRepo.get(r.name)?.total ?? 0,
    prs_merged: countsByRepo.get(r.name)?.merged ?? 0,
    prs_ai_assisted: countsByRepo.get(r.name)?.ai ?? 0,
  }));

  return NextResponse.json({
    connected: true,
    login: integration.config.login ?? null,
    repos,
    status: integration.status,
    last_error: integration.last_error,
    last_sync_at: integration.last_sync_at,
    prs_synced: repos.reduce((s, r) => s + r.prs_synced, 0),
    prs_ai_assisted: repos.reduce((s, r) => s + r.prs_ai_assisted, 0),
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

  const body = (await req.json()) as { token?: string; repos?: unknown };
  const repoList = normalizeGithubRepos(body.repos);
  if (repoList.length === 0) return NextResponse.json({ error: "select at least one repository" }, { status: 400 });
  if (repoList.some((r) => !/^[\w.-]+\/[\w.-]+$/.test(r.name))) {
    return NextResponse.json({ error: "repos must be owner/name" }, { status: 400 });
  }

  let login: string;
  try {
    ({ login } = await saveGithubIntegration(
      ctx.membership.team_id,
      body.token?.trim() || null,
      repoList,
      ctx.user.id,
      ctx.pool,
    ));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  // Initial sync inline so the admin sees data immediately after connecting.
  try {
    const summary = await runGithubSync(ctx.membership.team_id, ctx.pool);
    return NextResponse.json({ saved: true, login, sync: summary });
  } catch (err) {
    return NextResponse.json({ saved: true, login, sync_error: (err as Error).message });
  }
}

export async function DELETE(req: NextRequest) {
  const ctx = await adminCtx(req);
  if (ctx instanceof NextResponse) return ctx;
  await deleteIntegration(ctx.membership.team_id, "github", ctx.pool);
  return NextResponse.json({ deleted: true });
}
