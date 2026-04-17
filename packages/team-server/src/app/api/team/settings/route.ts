import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, requireAdminRole } from "../../../../lib/route-helpers.js";

export async function GET(req: NextRequest) {
  const ctx = await requireAdminSession(req);
  if (ctx instanceof NextResponse) return ctx;
  const roleErr = requireAdminRole(ctx);
  if (roleErr) return roleErr;

  const res = await ctx.pool.query(
    "SELECT name, slug, retention_days, custom_domain, settings, created_at FROM teams WHERE id = $1",
    [ctx.teamId]
  );
  return NextResponse.json(res.rows[0]);
}

export async function PUT(req: NextRequest) {
  const ctx = await requireAdminSession(req);
  if (ctx instanceof NextResponse) return ctx;
  const roleErr = requireAdminRole(ctx);
  if (roleErr) return roleErr;

  const body = await req.json();
  if (body.name) {
    await ctx.pool.query("UPDATE teams SET name = $1 WHERE id = $2", [body.name, ctx.teamId]);
  }
  if (body.retentionDays) {
    await ctx.pool.query("UPDATE teams SET retention_days = $1 WHERE id = $2", [body.retentionDays, ctx.teamId]);
  }
  return NextResponse.json({ updated: true });
}
