import { NextRequest, NextResponse } from "next/server";
import type pg from "pg";
import { getPool } from "../db/pool";
import { validateSession, type SessionContext } from "./auth";
import { loadGroupBySlug } from "./groups";

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
  const isMgr = await ctx.pool.query(
    "SELECT 1 FROM group_members WHERE group_id = $1 AND membership_id = $2 AND is_manager = true",
    [g.rows[0].id, ctx.membership.id],
  );
  if (!isMgr.rowCount) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return g.rows[0];
}
