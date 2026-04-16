import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../db/pool.js";
import { sha256 } from "../../../../lib/crypto.js";
import { createAdminSession } from "../../../../lib/auth.js";

export async function POST(req: NextRequest) {
  try {
    const { recoveryToken } = await req.json();
    if (!recoveryToken || typeof recoveryToken !== "string") {
      return NextResponse.json({ error: "recoveryToken required" }, { status: 400 });
    }

    const pool = getPool();
    const hash = sha256(recoveryToken);
    const sessionRes = await pool.query(
      `SELECT s.member_id FROM admin_sessions s
       JOIN members m ON s.member_id = m.id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND m.revoked_at IS NULL`,
      [hash]
    );
    if (!sessionRes.rowCount || sessionRes.rowCount === 0) {
      return NextResponse.json({ error: "Invalid or expired recovery token" }, { status: 401 });
    }

    const memberId = sessionRes.rows[0].member_id;
    const { cookieToken } = await createAdminSession(memberId, pool);

    const res = NextResponse.json({ ok: true }, { status: 200 });
    res.cookies.set("fleetlens_session", cookieToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 90 * 24 * 60 * 60,
      path: "/",
    });
    return res;
  } catch (err) {
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
