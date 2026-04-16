import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../db/pool.js";
import { createInvite } from "../../../../lib/members.js";
import { validateAdminSession } from "../../../../lib/auth.js";

export async function POST(req: NextRequest) {
  const cookieToken = req.cookies.get("fleetlens_session")?.value;
  if (!cookieToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const pool = getPool();
  const session = await validateAdminSession(cookieToken, pool);
  if (!session) {
    return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
  }

  // Resolve admin's team
  const memberRes = await pool.query("SELECT team_id FROM members WHERE id = $1", [session.memberId]);
  if (!memberRes.rowCount) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  const teamId = memberRes.rows[0].team_id;

  const host = req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const serverBaseUrl = process.env.BASE_URL || `${proto}://${host}`;

  try {
    const body = await req.json().catch(() => ({}));
    const result = await createInvite(body, session.memberId, teamId, serverBaseUrl, pool);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.name === "ZodError") {
      return NextResponse.json({ error: "Validation failed", details: err.message }, { status: 400 });
    }
    throw err;
  }
}
