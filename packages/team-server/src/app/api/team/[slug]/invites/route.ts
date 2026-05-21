import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership } from "../../../../../lib/route-helpers";
import { listActiveInvites, filterInvitesByManagerScope } from "../../../../../lib/invites";
import { listGroupsForTeam, listGroupsManagedBy } from "../../../../../lib/groups";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;

  const all = await listActiveInvites(ctx.membership.team_id, ctx.pool);

  // Admins / staff see every link. Plain members get whatever is a subset of
  // the groups they manage; if they manage nothing, they see nothing.
  const isAdminOrStaff = ctx.user.is_staff || ctx.membership.role === "admin";
  let visible = all;
  if (!isAdminOrStaff) {
    const managed = await listGroupsManagedBy(ctx.membership.id, ctx.pool);
    visible = filterInvitesByManagerScope(all, managed.map((g) => g.id));
  }

  // Look up group names once for display labels.
  const groups = await listGroupsForTeam(ctx.membership.team_id, ctx.pool);
  const groupNameById = new Map(groups.map((g) => [g.id, g.name] as const));

  const host = req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const serverBaseUrl = process.env.BASE_URL || `${proto}://${host}`;

  const rows = visible.map((inv) => ({
    id: inv.id,
    label: inv.label,
    role: inv.role,
    groupIds: inv.group_ids,
    groupNames: inv.group_ids.map((id) => groupNameById.get(id) ?? id),
    createdBy: { id: inv.created_by, displayName: inv.created_by_display_name },
    createdAt: inv.created_at,
    expiresAt: inv.expires_at,
    token: inv.token,
    joinUrl: inv.token ? `${serverBaseUrl}/signup?invite=${inv.token}` : null,
    redemptionCount: inv.redemption_count,
  }));

  return NextResponse.json({ invites: rows });
}
