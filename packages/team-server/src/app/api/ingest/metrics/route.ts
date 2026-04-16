import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../db/pool.js";
import { processIngest } from "../../../../lib/ingest.js";
import { resolveMemberFromToken } from "../../../../lib/auth.js";

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

  try {
    const body = await req.json();
    const result = await processIngest(body, member.id, member.teamId, pool);
    return NextResponse.json(result, { status: result.deduplicated ? 202 : 200 });
  } catch (err) {
    if (err instanceof Error && err.name === "ZodError") {
      return NextResponse.json({ error: "Validation failed", details: err.message }, { status: 400 });
    }
    throw err;
  }
}
