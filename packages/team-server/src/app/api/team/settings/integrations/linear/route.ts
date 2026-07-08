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
  normalizeLinearTeams,
  preserveGroupMappings,
  runLinearSync,
  saveLinearIntegration,
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

  const connections = await listIntegrations(ctx.membership.team_id, ctx.pool, "linear");
  if (connections.length === 0) return NextResponse.json({ connected: false, connections: [] });

  const [counts, groupNames] = await Promise.all([
    ctx.pool.query<{ linear_team_key: string; total: number; completed: number; started: number }>(
      `SELECT linear_team_key, COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE state_type = 'completed')::int AS completed,
              COUNT(*) FILTER (WHERE state_type = 'started')::int AS started
       FROM linear_issues WHERE team_id = $1 GROUP BY linear_team_key`,
      [ctx.membership.team_id],
    ),
    ctx.pool.query<{ id: string; name: string }>(
      "SELECT id, name FROM groups WHERE team_id = $1",
      [ctx.membership.team_id],
    ),
  ]);
  const byKey = new Map(counts.rows.map((r) => [r.linear_team_key, r]));
  const nameByGroup = new Map(groupNames.rows.map((g) => [g.id, g.name]));

  return NextResponse.json({
    connected: true,
    connections: connections.map((c) => {
      const config = c.config as { login?: string };
      const teams = normalizeLinearTeams(c.config).map((t) => ({
        ...t,
        issues_synced: byKey.get(t.key)?.total ?? 0,
        issues_completed: byKey.get(t.key)?.completed ?? 0,
        issues_in_progress: byKey.get(t.key)?.started ?? 0,
      }));
      return {
        id: c.id,
        label: c.label,
        owner_group_id: c.owner_group_id,
        owner_group_name: c.owner_group_id ? nameByGroup.get(c.owner_group_id) ?? null : null,
        login: config.login ?? null,
        teams,
        status: c.status,
        last_error: c.last_error,
        last_sync_at: c.last_sync_at,
        issues_synced: teams.reduce((s, t) => s + t.issues_synced, 0),
        issues_completed: teams.reduce((s, t) => s + t.issues_completed, 0),
        issues_in_progress: teams.reduce((s, t) => s + t.issues_in_progress, 0),
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
    id?: string; apiKey?: string; teams?: unknown; teamKeys?: string[]; label?: string; owner_group_id?: string | null;
  };
  const teams = normalizeLinearTeams({ teams: body.teams, team_keys: body.teamKeys });
  if (teams.length === 0) return NextResponse.json({ error: "select at least one Linear team" }, { status: 400 });

  let integrationId: string | null = null;
  let label: string;
  let ownerGroupId: string | null = null;
  let teamList = teams;
  if (body.id) {
    const integ = await requireIntegrationManager(ctx, body.id);
    if (integ instanceof NextResponse) return integ;
    if (integ.provider !== "linear") return NextResponse.json({ error: "Not a Linear integration" }, { status: 400 });
    integrationId = integ.id;
    label = body.label?.trim() || integ.label;
    ownerGroupId = integ.owner_group_id;
    if (!ctx.user.is_staff && ctx.membership.role !== "admin") {
      // owner_group_id is non-null here by invariant: requireIntegrationManager only
      // admits non-admin callers for group-owned integrations.
            teamList = preserveGroupMappings(teams, normalizeLinearTeams(integ.config), (t) => t.key, integ.owner_group_id!);
    }
  } else {
    const adminErr = requireAdmin(ctx);
    if (adminErr) return adminErr;
    label = body.label?.trim() || "Linear";
    if (body.owner_group_id) {
      const g = await resolveTeamGroup(ctx, body.owner_group_id);
      if (!g) return NextResponse.json({ error: "Unknown group" }, { status: 400 });
      ownerGroupId = g.id;
    }
  }

  let id: string;
  let login: string;
  try {
    ({ id, login } = await saveLinearIntegration(
      {
        teamId: ctx.membership.team_id,
        id: integrationId,
        label,
        ownerGroupId,
        apiKey: body.apiKey?.trim() || null,
        teams: teamList,
        createdBy: ctx.user.id,
      },
      ctx.pool,
    ));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  try {
    const summary = await runLinearSync(id, ctx.pool);
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
  if (integ.provider !== "linear") return NextResponse.json({ error: "Not a Linear integration" }, { status: 400 });
  await deleteIntegration(ctx.membership.team_id, integ.id, ctx.pool);
  return NextResponse.json({ deleted: true });
}
