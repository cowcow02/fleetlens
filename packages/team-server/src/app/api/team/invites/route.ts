import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership, requireAdmin, serverBaseUrl } from "../../../../lib/route-helpers";
import { createInvite } from "../../../../lib/members";
import { checkActiveInviteConflict, parseInviteOpts } from "../../../../lib/invites";

export async function POST(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("team");
  if (!slug) return NextResponse.json({ error: "team slug required" }, { status: 400 });

  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const adminErr = requireAdmin(ctx);
  if (adminErr) return adminErr;

  const body = await req.json().catch(() => ({}));
  const groupIds = body?.groupIds;
  if (groupIds !== undefined) {
    if (!Array.isArray(groupIds) || !groupIds.every((g) => typeof g === "string")) {
      return NextResponse.json({ error: "groupIds must be string[]" }, { status: 400 });
    }
    if (groupIds.length > 0) {
      const r = await ctx.pool.query(
        "SELECT id FROM groups WHERE id = ANY($1::uuid[]) AND team_id = $2",
        [groupIds, ctx.membership.team_id],
      );
      if (r.rowCount !== groupIds.length) {
        return NextResponse.json({ error: "one or more groups not in this team" }, { status: 400 });
      }
    }
  }

  const role: "admin" | "member" = body?.role === "admin" ? "admin" : "member";
  const resolvedGroupIds = Array.isArray(groupIds) ? groupIds : [];
  const { email, label, expiresInDays } = parseInviteOpts(body);

  // Dedup only applies to multi-use (no-email) share links.
  if (!email) {
    const conflict = await checkActiveInviteConflict(
      ctx.membership.team_id,
      role,
      resolvedGroupIds,
      ctx.pool,
    );
    if (conflict) return conflict;
  }

  const result = await createInvite(
    ctx.membership.team_id,
    ctx.user.id,
    { email, role, expiresInDays, groupIds: resolvedGroupIds, label },
    ctx.pool,
  );

  return NextResponse.json({
    inviteId: result.inviteId,
    joinUrl: `${serverBaseUrl(req)}/signup?invite=${result.token}`,
    tokenPlaintext: result.token,
    expiresAt: result.expiresAt,
  }, { status: 201 });
}
