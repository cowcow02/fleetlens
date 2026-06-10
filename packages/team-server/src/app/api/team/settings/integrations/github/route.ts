import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership, requireAdmin, type TeamContext } from "../../../../../../lib/route-helpers";
import {
  deleteIntegration,
  getIntegration,
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

  const counts = await ctx.pool.query(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE ai_assisted)::int AS ai
     FROM github_pull_requests WHERE team_id = $1`,
    [ctx.membership.team_id],
  );
  return NextResponse.json({
    connected: true,
    login: integration.config.login ?? null,
    repos: integration.config.repos,
    status: integration.status,
    last_error: integration.last_error,
    last_sync_at: integration.last_sync_at,
    prs_synced: counts.rows[0].total,
    prs_ai_assisted: counts.rows[0].ai,
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

  const { token, repos } = (await req.json()) as { token?: string; repos?: string[] };
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });
  const repoList = (repos ?? []).map((r) => r.trim()).filter(Boolean);
  if (repoList.length === 0) return NextResponse.json({ error: "at least one owner/name repo required" }, { status: 400 });
  if (repoList.some((r) => !/^[\w.-]+\/[\w.-]+$/.test(r))) {
    return NextResponse.json({ error: "repos must be owner/name" }, { status: 400 });
  }

  let login: string;
  try {
    ({ login } = await saveGithubIntegration(ctx.membership.team_id, token, repoList, ctx.user.id, ctx.pool));
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
