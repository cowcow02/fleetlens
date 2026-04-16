import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../db/pool.js";
import { joinTeam } from "../../../../lib/members.js";

export async function POST(req: NextRequest) {
  const host = req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const serverBaseUrl = process.env.BASE_URL || `${proto}://${host}`;

  try {
    const body = await req.json();
    const pool = getPool();
    const result = await joinTeam(body, pool);
    return NextResponse.json({ ...result, serverBaseUrl }, { status: 201 });
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
