import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../db/pool.js";
import { createAdminSession, validateRecoveryToken } from "../../../../lib/auth.js";

export async function POST(req: NextRequest) {
  const { recoveryToken } = await req.json();
  if (!recoveryToken || typeof recoveryToken !== "string") {
    return NextResponse.json({ error: "recoveryToken required" }, { status: 400 });
  }

  const pool = getPool();
  const recovery = await validateRecoveryToken(recoveryToken, pool);
  if (!recovery) {
    return NextResponse.json({ error: "Invalid or expired recovery token" }, { status: 401 });
  }

  const { cookieToken } = await createAdminSession(recovery.memberId, pool);

  const res = NextResponse.json({ ok: true });
  res.cookies.set("fleetlens_session", cookieToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 90 * 24 * 60 * 60,
    path: "/",
  });
  return res;
}
