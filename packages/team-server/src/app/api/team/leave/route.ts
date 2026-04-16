import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../db/pool.js";
import { resolveMemberFromToken } from "../../../../lib/auth.js";
import { leaveTeam } from "../../../../lib/members.js";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }
  const token = authHeader.slice(7);
  const pool = getPool();
  const member = await resolveMemberFromToken(token, pool);
  if (!member) {
    return NextResponse.json({ error: "Invalid or revoked token" }, { status: 401 });
  }

  await leaveTeam(member.id, pool);
  return NextResponse.json({ ok: true }, { status: 200 });
}
