import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../db/pool.js";
import { claimTeam } from "../../../../lib/teams.js";
import { bootstrapState } from "../../../../lib/bootstrap-state.js";

export async function POST(req: NextRequest) {
  if (!bootstrapState) {
    return NextResponse.json({ error: "Bootstrap not initialized" }, { status: 503 });
  }

  try {
    const body = await req.json();
    const pool = getPool();
    const result = await claimTeam(body, bootstrapState.hash, bootstrapState.expiresAt, pool);

    const res = NextResponse.json(
      { team: result.team, admin: result.admin, recoveryToken: result.recoveryToken },
      { status: 201 }
    );
    res.cookies.set("fleetlens_session", result.sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 90 * 24 * 60 * 60,
      path: "/",
    });
    return res;
  } catch (err) {
    if (err instanceof Error && err.name === "ZodError") {
      return NextResponse.json({ error: "Validation failed", details: err.message }, { status: 400 });
    }
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
