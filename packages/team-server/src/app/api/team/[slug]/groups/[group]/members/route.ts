import { NextRequest, NextResponse } from "next/server";
import {
  requireTeamMembership,
  requireAdmin,
  resolveGroupId,
  assertMembershipBelongsToTeam,
} from "../../../../../../../lib/route-helpers";
import { addGroupMember, removeGroupMember, setGroupMemberManager } from "../../../../../../../lib/groups";

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string; group: string }> }) {
  const { slug, group } = await params;
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const fail = requireAdmin(ctx);
  if (fail) return fail;
  const id = await resolveGroupId(ctx, group);
  if (!id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  if (!body.membershipId) return NextResponse.json({ error: "membershipId required" }, { status: 400 });
  if (body.isManager !== undefined && typeof body.isManager !== "boolean") {
    return NextResponse.json({ error: "isManager must be a boolean" }, { status: 400 });
  }
  if (!(await assertMembershipBelongsToTeam(ctx, body.membershipId))) {
    return NextResponse.json({ error: "membership not in this team" }, { status: 400 });
  }
  await addGroupMember(id, body.membershipId, ctx.user.id, ctx.pool);
  if (body.isManager === true) {
    await setGroupMemberManager(id, body.membershipId, true, ctx.user.id, ctx.pool);
  }
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
  if (!(await assertMembershipBelongsToTeam(ctx, membershipId))) {
    return NextResponse.json({ error: "membership not in this team" }, { status: 400 });
  }
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
  const body = await req.json().catch(() => ({}));
  if (!body.membershipId || typeof body.isManager !== "boolean") {
    return NextResponse.json({ error: "membershipId and isManager required" }, { status: 400 });
  }
  if (!(await assertMembershipBelongsToTeam(ctx, body.membershipId))) {
    return NextResponse.json({ error: "membership not in this team" }, { status: 400 });
  }
  try {
    await setGroupMemberManager(id, body.membershipId, body.isManager, ctx.user.id, ctx.pool);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("revoked")) {
      return NextResponse.json({ error: "Cannot promote a revoked member" }, { status: 400 });
    }
    if (msg.includes("not found")) {
      return NextResponse.json({ error: "Group member not found" }, { status: 404 });
    }
    throw err;
  }
}
