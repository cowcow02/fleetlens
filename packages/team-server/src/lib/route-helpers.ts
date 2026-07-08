import { NextRequest, NextResponse } from "next/server";
import type pg from "pg";
import { getPool } from "../db/pool";
import { validateSession, type SessionContext } from "./auth";
import { loadGroupBySlug } from "./groups";
import { getIntegrationById, type IntegrationRow } from "./integrations";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function serverBaseUrl(req: NextRequest): string {
  if (process.env.BASE_URL) return process.env.BASE_URL;
  const host = req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}

export type TeamContext = SessionContext & {
  pool: pg.Pool;
  membership: { id: string; team_id: string; role: "admin" | "member" };
};

export async function requireSession(req: NextRequest): Promise<(SessionContext & { pool: pg.Pool }) | NextResponse> {
  const cookieToken = req.cookies.get("fleetlens_session")?.value;
  if (!cookieToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pool = getPool();
  const ctx = await validateSession(cookieToken, pool);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return { ...ctx, pool };
}

export async function requireTeamMembership(
  req: NextRequest,
  teamIdOrSlug: string,
  { bySlug = false }: { bySlug?: boolean } = {},
): Promise<TeamContext | NextResponse> {
  const base = await requireSession(req);
  if (base instanceof NextResponse) return base;

  let resolvedId = teamIdOrSlug;
  if (bySlug) {
    const slugRes = await base.pool.query("SELECT id FROM teams WHERE slug = $1", [teamIdOrSlug]);
    if (!slugRes.rowCount) return NextResponse.json({ error: "Team not found" }, { status: 404 });
    resolvedId = slugRes.rows[0].id;
  }

  const membership = base.memberships.find((m) => m.team_id === resolvedId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return {
    ...base,
    membership: { id: membership.id, team_id: membership.team_id, role: membership.role },
  };
}

export function requireAdmin(ctx: TeamContext): NextResponse | null {
  if (ctx.user.is_staff || ctx.membership.role === "admin") return null;
  return NextResponse.json({ error: "Admin only" }, { status: 403 });
}

export async function requireStaff(
  req: NextRequest,
): Promise<(SessionContext & { pool: pg.Pool }) | NextResponse> {
  const base = await requireSession(req);
  if (base instanceof NextResponse) return base;
  if (!base.user.is_staff) return NextResponse.json({ error: "Staff only" }, { status: 403 });
  return base;
}

export async function resolveGroupId(
  ctx: { pool: pg.Pool; membership: { team_id: string } },
  groupParam: string,
): Promise<string | null> {
  if (UUID_RE.test(groupParam)) return groupParam;
  const g = await loadGroupBySlug(ctx.membership.team_id, groupParam, ctx.pool);
  return g?.id ?? null;
}

// Returns false on malformed UUID too, so callers don't need a separate format check
// to avoid Postgres throwing on a non-UUID string.
export async function assertMembershipBelongsToTeam(
  ctx: { pool: pg.Pool; membership: { team_id: string } },
  membershipId: string,
): Promise<boolean> {
  if (!UUID_RE.test(membershipId)) return false;
  const r = await ctx.pool.query(
    "SELECT 1 FROM memberships WHERE id = $1 AND team_id = $2",
    [membershipId, ctx.membership.team_id],
  );
  return r.rowCount === 1;
}

// 404 not 403 so members can't probe which groups exist.
export async function requireGroupManager(
  ctx: TeamContext,
  groupSlug: string,
): Promise<{ id: string; slug: string; name: string } | NextResponse> {
  const g = await ctx.pool.query<{ id: string; slug: string; name: string }>(
    "SELECT id, slug, name FROM groups WHERE team_id = $1 AND slug = $2",
    [ctx.membership.team_id, groupSlug],
  );
  if (!g.rowCount) return NextResponse.json({ error: "Group not found" }, { status: 404 });
  if (ctx.user.is_staff || ctx.membership.role === "admin") return g.rows[0];
  if (!(await isGroupManager(ctx, g.rows[0].id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return g.rows[0];
}

async function isGroupManager(ctx: TeamContext, groupId: string): Promise<boolean> {
  const r = await ctx.pool.query(
    "SELECT 1 FROM group_members WHERE group_id = $1 AND membership_id = $2 AND is_manager = true",
    [groupId, ctx.membership.id],
  );
  return r.rowCount === 1;
}

// Validates a client-supplied group id belongs to the caller's team.
export async function resolveTeamGroup(
  ctx: { pool: pg.Pool; membership: { team_id: string } },
  groupId: string,
): Promise<{ id: string; slug: string; name: string } | null> {
  if (!UUID_RE.test(groupId)) return null;
  const r = await ctx.pool.query<{ id: string; slug: string; name: string }>(
    "SELECT id, slug, name FROM groups WHERE team_id = $1 AND id = $2",
    [ctx.membership.team_id, groupId],
  );
  return r.rows[0] ?? null;
}

// Manage rights on one integration: staff/admin always; otherwise the caller
// must manage the integration's owner group. Org-level integrations
// (owner_group_id NULL) are admin-only to mutate. 404 not 403, same
// anti-probing rationale as requireGroupManager.
export async function requireIntegrationManager(
  ctx: TeamContext,
  integrationId: string,
): Promise<IntegrationRow | NextResponse> {
  if (!UUID_RE.test(integrationId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const integ = await getIntegrationById(ctx.membership.team_id, integrationId, ctx.pool);
  if (!integ) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (ctx.user.is_staff || ctx.membership.role === "admin") return integ;
  if (integ.owner_group_id && (await isGroupManager(ctx, integ.owner_group_id))) return integ;
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

// Connect-flow pickers accept a fresh token in the body, so they don't touch
// stored credentials — open to anyone who can own an integration: admins and
// managers of at least one group.
export async function requireAdminOrAnyManager(ctx: TeamContext): Promise<NextResponse | null> {
  if (ctx.user.is_staff || ctx.membership.role === "admin") return null;
  const r = await ctx.pool.query(
    "SELECT 1 FROM group_members WHERE membership_id = $1 AND is_manager = true LIMIT 1",
    [ctx.membership.id],
  );
  return r.rowCount ? null : NextResponse.json({ error: "Admin or group manager only" }, { status: 403 });
}
