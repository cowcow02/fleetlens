import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership, requireAdmin } from "../../../../../../lib/route-helpers";
import { renameGroup, deleteGroup, loadGroupBySlug } from "../../../../../../lib/groups";

async function resolveGroupId(
  ctx: { pool: import("pg").Pool; membership: { team_id: string } },
  groupParam: string,
): Promise<string | null> {
  // Accept either a UUID id or a slug.
  if (/^[0-9a-f-]{36}$/i.test(groupParam)) return groupParam;
  const g = await loadGroupBySlug(ctx.membership.team_id, groupParam, ctx.pool);
  return g?.id ?? null;
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
  if (!body.name) return NextResponse.json({ error: "name required" }, { status: 400 });
  await renameGroup(id, body.name, ctx.user.id, ctx.pool);
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
  await deleteGroup(id, ctx.user.id, ctx.pool);
  return NextResponse.json({ ok: true });
}
