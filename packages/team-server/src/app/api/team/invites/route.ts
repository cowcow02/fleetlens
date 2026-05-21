import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership, requireAdmin } from "../../../../lib/route-helpers";
import { createInvite } from "../../../../lib/members";
import { findActiveInviteByConfig } from "../../../../lib/invites";

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
  const email = typeof body?.email === "string" ? body.email : undefined;
  const resolvedGroupIds = Array.isArray(groupIds) ? groupIds : [];
  const expiresInDays = typeof body?.expiresInDays === "number" ? body.expiresInDays : 90;
  const label = typeof body?.label === "string" && body.label.trim() ? body.label.trim() : undefined;

  // Dedup only applies to multi-use (no-email) share links. Single-use
  // email-scoped invites can coexist freely.
  if (!email) {
    const existing = await findActiveInviteByConfig(
      ctx.membership.team_id,
      role,
      resolvedGroupIds,
      ctx.pool,
    );
    if (existing) {
      return NextResponse.json(
        { error: "An active link already exists for this configuration. Revoke it first." },
        { status: 409 },
      );
    }
  }

  const result = await createInvite(
    ctx.membership.team_id,
    ctx.user.id,
    {
      email,
      role,
      expiresInDays,
      groupIds: resolvedGroupIds,
      label,
    },
    ctx.pool,
  );

  const host = req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const serverBaseUrl = process.env.BASE_URL || `${proto}://${host}`;
  return NextResponse.json({
    inviteId: result.inviteId,
    joinUrl: `${serverBaseUrl}/signup?invite=${result.token}`,
    tokenPlaintext: result.token,
    expiresAt: result.expiresAt,
  }, { status: 201 });
}
