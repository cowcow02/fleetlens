import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership, requireAdmin, type TeamContext } from "../../../../../../lib/route-helpers";
import {
  deleteIntegration,
  getIntegration,
  runLinearSync,
  saveLinearIntegration,
  type LinearIntegrationConfig,
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

  const integration = await getIntegration(ctx.membership.team_id, "linear", ctx.pool);
  if (!integration) return NextResponse.json({ connected: false });
  const config = integration.config as unknown as LinearIntegrationConfig;

  const counts = await ctx.pool.query<{ total: number; completed: number; started: number }>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE state_type = 'completed')::int AS completed,
            COUNT(*) FILTER (WHERE state_type = 'started')::int AS started
     FROM linear_issues WHERE team_id = $1`,
    [ctx.membership.team_id],
  );
  return NextResponse.json({
    connected: true,
    login: config.login ?? null,
    team_keys: config.team_keys ?? [],
    status: integration.status,
    last_error: integration.last_error,
    last_sync_at: integration.last_sync_at,
    issues_synced: counts.rows[0].total,
    issues_completed: counts.rows[0].completed,
    issues_in_progress: counts.rows[0].started,
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

  const body = (await req.json()) as { apiKey?: string; teamKeys?: string[] };
  const teamKeys = (body.teamKeys ?? []).map((k) => k.trim()).filter(Boolean);
  if (teamKeys.length === 0) return NextResponse.json({ error: "select at least one Linear team" }, { status: 400 });

  let login: string;
  try {
    ({ login } = await saveLinearIntegration(
      ctx.membership.team_id,
      body.apiKey?.trim() || null,
      teamKeys,
      ctx.user.id,
      ctx.pool,
    ));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  try {
    const summary = await runLinearSync(ctx.membership.team_id, ctx.pool);
    return NextResponse.json({ saved: true, login, sync: summary });
  } catch (err) {
    return NextResponse.json({ saved: true, login, sync_error: (err as Error).message });
  }
}

export async function DELETE(req: NextRequest) {
  const ctx = await adminCtx(req);
  if (ctx instanceof NextResponse) return ctx;
  await deleteIntegration(ctx.membership.team_id, "linear", ctx.pool);
  return NextResponse.json({ deleted: true });
}
