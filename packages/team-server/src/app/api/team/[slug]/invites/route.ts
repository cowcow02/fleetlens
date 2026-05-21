import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership, serverBaseUrl } from "../../../../../lib/route-helpers";
import { listActiveInvites, filterInvitesByManagerScope } from "../../../../../lib/invites";
import { listGroupsForTeam, listGroupsManagedBy } from "../../../../../lib/groups";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;

  // Admins / staff see every link. Plain members get whatever passes the
  // manager-scope predicate; if they manage nothing, they see nothing.
  const isAdminOrStaff = ctx.user.is_staff || ctx.membership.role === "admin";
  const [all, managed, groups] = await Promise.all([
    listActiveInvites(ctx.membership.team_id, ctx.pool),
    isAdminOrStaff ? Promise.resolve(null) : listGroupsManagedBy(ctx.membership.id, ctx.pool),
    listGroupsForTeam(ctx.membership.team_id, ctx.pool),
  ]);

  const visible = managed === null
    ? all
    : filterInvitesByManagerScope(all, managed.map((g) => g.id));

  const groupNameById = new Map(groups.map((g) => [g.id, g.name] as const));
  const baseUrl = serverBaseUrl(req);

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
    joinUrl: inv.token ? `${baseUrl}/signup?invite=${inv.token}` : null,
    redemptionCount: inv.redemption_count,
  }));

  return NextResponse.json({ invites: rows });
}
