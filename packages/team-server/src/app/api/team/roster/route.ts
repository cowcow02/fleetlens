import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "../../../../lib/route-helpers.js";
import { loadRoster } from "../../../../lib/queries.js";

export async function GET(req: NextRequest) {
  const ctx = await requireAdminSession(req);
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json(await loadRoster(ctx.teamId, ctx.pool));
}
