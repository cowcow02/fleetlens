import { NextRequest, NextResponse } from "next/server";
import {
  requireTeamMembership,
  requireGroupManager,
  serverBaseUrl,
} from "../../../../../../../lib/route-helpers";
import { listGroupsManagedBy } from "../../../../../../../lib/groups";
import { createInvite } from "../../../../../../../lib/members";
import { checkActiveInviteConflict, parseInviteOpts } from "../../../../../../../lib/invites";

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string; group: string }> }) {
  const { slug, group } = await params;
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const gr = await requireGroupManager(ctx, group);
  if (gr instanceof NextResponse) return gr;

  const body = await req.json().catch(() => ({}));
  if (body.groupIds !== undefined) {
    if (!Array.isArray(body.groupIds) || !body.groupIds.every((g: unknown) => typeof g === "string")) {
      return NextResponse.json({ error: "groupIds must be string[]" }, { status: 400 });
    }
  }
  const extras: string[] = Array.isArray(body.groupIds) ? body.groupIds : [];
  const allGroupIds = Array.from(new Set([gr.id, ...extras]));

  if (ctx.user.is_staff || ctx.membership.role === "admin") {
    if (extras.length > 0) {
      const r = await ctx.pool.query(
        "SELECT id FROM groups WHERE id = ANY($1::uuid[]) AND team_id = $2",
        [allGroupIds, ctx.membership.team_id],
      );
      if (r.rowCount !== allGroupIds.length) {
        return NextResponse.json({ error: "one or more groups not in this team" }, { status: 400 });
      }
    }
  } else {
    const managed = await listGroupsManagedBy(ctx.membership.id, ctx.pool);
    const managedSet = new Set(managed.map((m) => m.id));
    if (!allGroupIds.every((g) => managedSet.has(g))) {
      return NextResponse.json({ error: "Cannot invite into groups you don't manage" }, { status: 403 });
    }
  }

  const { email, label, expiresInDays } = parseInviteOpts(body);

  if (!email) {
    const conflict = await checkActiveInviteConflict(
      ctx.membership.team_id,
      "member",
      allGroupIds,
      ctx.pool,
    );
    if (conflict) return conflict;
  }

  const result = await createInvite(
    ctx.membership.team_id,
    ctx.user.id,
    { role: "member", email, groupIds: allGroupIds, label, expiresInDays },
    ctx.pool,
  );

  return NextResponse.json({
    inviteId: result.inviteId,
    joinUrl: `${serverBaseUrl(req)}/signup?invite=${result.token}`,
    tokenPlaintext: result.token,
    expiresAt: result.expiresAt,
  }, { status: 201 });
}
