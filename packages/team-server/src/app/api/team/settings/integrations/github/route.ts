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
  normalizeGithubRepos,
  runGithubSync,
  saveGithubIntegration,
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

  const connections = await listIntegrations(ctx.membership.team_id, ctx.pool, "github");
  if (connections.length === 0) return NextResponse.json({ connected: false, connections: [] });

  const counts = await ctx.pool.query<{ repo: string; total: number; ai: number; merged: number }>(
    `SELECT repo, COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE ai_assisted)::int AS ai,
            COUNT(*) FILTER (WHERE state = 'merged')::int AS merged
     FROM github_pull_requests WHERE team_id = $1 GROUP BY repo`,
    [ctx.membership.team_id],
  );
  const countsByRepo = new Map(counts.rows.map((r) => [r.repo, r]));
  const groupNames = await ctx.pool.query<{ id: string; name: string }>(
    "SELECT id, name FROM groups WHERE team_id = $1",
    [ctx.membership.team_id],
  );
  const nameByGroup = new Map(groupNames.rows.map((g) => [g.id, g.name]));

  return NextResponse.json({
    connected: true,
    connections: connections.map((c) => {
      const repos = normalizeGithubRepos(c.config.repos).map((r) => ({
        ...r,
        prs_synced: countsByRepo.get(r.name)?.total ?? 0,
        prs_merged: countsByRepo.get(r.name)?.merged ?? 0,
        prs_ai_assisted: countsByRepo.get(r.name)?.ai ?? 0,
      }));
      return {
        id: c.id,
        label: c.label,
        owner_group_id: c.owner_group_id,
        owner_group_name: c.owner_group_id ? nameByGroup.get(c.owner_group_id) ?? null : null,
        login: c.config.login ?? null,
        repos,
        status: c.status,
        last_error: c.last_error,
        last_sync_at: c.last_sync_at,
        prs_synced: repos.reduce((s, r) => s + r.prs_synced, 0),
        prs_ai_assisted: repos.reduce((s, r) => s + r.prs_ai_assisted, 0),
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
    id?: string; token?: string; repos?: unknown; label?: string; owner_group_id?: string | null;
  };
  const repoList = normalizeGithubRepos(body.repos);
  if (repoList.length === 0) return NextResponse.json({ error: "select at least one repository" }, { status: 400 });
  if (repoList.some((r) => !/^[\w.-]+\/[\w.-]+$/.test(r.name))) {
    return NextResponse.json({ error: "repos must be owner/name" }, { status: 400 });
  }

  let integrationId: string | null = null;
  let label: string;
  let ownerGroupId: string | null = null;
  if (body.id) {
    const integ = await requireIntegrationManager(ctx, body.id);
    if (integ instanceof NextResponse) return integ;
    if (integ.provider !== "github") return NextResponse.json({ error: "Not a GitHub integration" }, { status: 400 });
    integrationId = integ.id;
    label = body.label?.trim() || integ.label;
    ownerGroupId = integ.owner_group_id;
  } else {
    const adminErr = requireAdmin(ctx);
    if (adminErr) return adminErr;
    label = body.label?.trim() || "GitHub";
    if (body.owner_group_id) {
      const g = await resolveTeamGroup(ctx, body.owner_group_id);
      if (!g) return NextResponse.json({ error: "Unknown group" }, { status: 400 });
      ownerGroupId = g.id;
    }
  }

  let id: string;
  let login: string;
  try {
    ({ id, login } = await saveGithubIntegration(
      {
        teamId: ctx.membership.team_id,
        id: integrationId,
        label,
        ownerGroupId,
        token: body.token?.trim() || null,
        repos: repoList,
        createdBy: ctx.user.id,
      },
      ctx.pool,
    ));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  // Initial sync inline so the caller sees data immediately after connecting.
  try {
    const summary = await runGithubSync(id, ctx.pool);
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
  if (integ.provider !== "github") return NextResponse.json({ error: "Not a GitHub integration" }, { status: 400 });
  await deleteIntegration(ctx.membership.team_id, integ.id, ctx.pool);
  return NextResponse.json({ deleted: true });
}
