import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership, requireAdmin } from "../../../../../../../lib/route-helpers";
import { addGroupMember, removeGroupMember, setGroupMemberManager, loadGroupBySlug } from "../../../../../../../lib/groups";

async function resolveGroupId(
  ctx: { pool: import("pg").Pool; membership: { team_id: string } },
  groupParam: string,
): Promise<string | null> {
  if (/^[0-9a-f-]{36}$/i.test(groupParam)) return groupParam;
  const g = await loadGroupBySlug(ctx.membership.team_id, groupParam, ctx.pool);
  return g?.id ?? null;
}

async function assertMembershipBelongsToTeam(
  ctx: { pool: import("pg").Pool; membership: { team_id: string } },
  membershipId: string,
): Promise<boolean> {
  const r = await ctx.pool.query(
    "SELECT 1 FROM memberships WHERE id = $1 AND team_id = $2",
    [membershipId, ctx.membership.team_id],
  );
  return r.rowCount === 1;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string; group: string }> }) {
  const { slug, group } = await params;
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const fail = requireAdmin(ctx);
  if (fail) return fail;
  const id = await resolveGroupId(ctx, group);
  if (!id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json();
  if (!body.membershipId) return NextResponse.json({ error: "membershipId required" }, { status: 400 });
  if (!(await assertMembershipBelongsToTeam(ctx, body.membershipId))) {
    return NextResponse.json({ error: "membership not in this team" }, { status: 400 });
  }
  await addGroupMember(id, body.membershipId, ctx.user.id, ctx.pool, { isManager: !!body.isManager });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string; group: string }> }) {
  const { slug, group } = await params;
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const fail = requireAdmin(ctx);
  if (fail) return fail;
  const id = await resolveGroupId(ctx, group);
  if (!id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membershipId = req.nextUrl.searchParams.get("membershipId");
  if (!membershipId) return NextResponse.json({ error: "membershipId required" }, { status: 400 });
  await removeGroupMember(id, membershipId, ctx.user.id, ctx.pool);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string; group: string }> }) {
  const { slug, group } = await params;
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const fail = requireAdmin(ctx);
  if (fail) return fail;
  const id = await resolveGroupId(ctx, group);
  if (!id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json();
  if (!body.membershipId || typeof body.isManager !== "boolean") {
    return NextResponse.json({ error: "membershipId and isManager required" }, { status: 400 });
  }
  try {
    await setGroupMemberManager(id, body.membershipId, body.isManager, ctx.user.id, ctx.pool);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
