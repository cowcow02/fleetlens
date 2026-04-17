import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, requireAdminRole } from "../../../../../lib/route-helpers.js";
import { loadMember, loadMemberRollups } from "../../../../../lib/queries.js";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireAdminSession(req);
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  const member = await loadMember(id, ctx.pool);
  if (!member) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rollups = await loadMemberRollups(member.team_id, id, 30, ctx.pool);
  return NextResponse.json({ member, rollups });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireAdminSession(req);
  if (ctx instanceof NextResponse) return ctx;
  const roleErr = requireAdminRole(ctx);
  if (roleErr) return roleErr;

  const { id } = await params;
  await ctx.pool.query("UPDATE members SET revoked_at = now() WHERE id = $1", [id]);
  return NextResponse.json({ revoked: true });
}
