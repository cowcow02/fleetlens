import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership, requireGroupManager } from "../../../../../../../lib/route-helpers";
import { listGroupsManagedBy } from "../../../../../../../lib/groups";
import { createInvite } from "../../../../../../../lib/members";

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string; group: string }> }) {
  const { slug, group } = await params;
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const gr = await requireGroupManager(ctx, group);
  if (gr instanceof NextResponse) return gr;

  const body = await req.json().catch(() => ({}));
  // Manager can choose additional groups, but only ones they also manage.
  const extras: string[] = Array.isArray(body.groupIds) ? body.groupIds : [];
  const allGroupIds = Array.from(new Set([gr.id, ...extras]));
  if (!(ctx.user.is_staff || ctx.membership.role === "admin")) {
    const managed = await listGroupsManagedBy(ctx.membership.id, ctx.pool);
    const managedSet = new Set(managed.map((m) => m.id));
    if (!allGroupIds.every((g) => managedSet.has(g))) {
      return NextResponse.json({ error: "Cannot invite into groups you don't manage" }, { status: 403 });
    }
  }

  const result = await createInvite(
    ctx.membership.team_id,
    ctx.user.id,
    { role: "member", email: typeof body.email === "string" ? body.email : undefined, groupIds: allGroupIds },
    ctx.pool,
  );
  return NextResponse.json(result);
}
