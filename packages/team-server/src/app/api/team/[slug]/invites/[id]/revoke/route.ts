import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership } from "../../../../../../../lib/route-helpers";
import { getInviteForAuthz, isInviteInManagerScope, revokeInvite } from "../../../../../../../lib/invites";
import { listGroupsManagedBy } from "../../../../../../../lib/groups";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;

  const invite = await getInviteForAuthz(id, ctx.pool);
  if (!invite || invite.team_id !== ctx.membership.team_id) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  const isAdminOrStaff = ctx.user.is_staff || ctx.membership.role === "admin";
  if (!isAdminOrStaff) {
    const managed = await listGroupsManagedBy(ctx.membership.id, ctx.pool);
    if (!isInviteInManagerScope(invite, managed.map((g) => g.id))) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }
  }

  const result = await revokeInvite(id, ctx.user.id, ctx.pool);
  if (!result) {
    return NextResponse.json({ error: "Invite already revoked or missing" }, { status: 409 });
  }
  return NextResponse.json({ revoked: true });
}
