import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../db/pool";
import { processIngest } from "../../../../lib/ingest";
import { resolveMembershipFromBearer } from "../../../../lib/auth";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }
  const token = authHeader.slice(7);
  const pool = getPool();
  const membership = await resolveMembershipFromBearer(token, pool);
  if (!membership) {
    return NextResponse.json({ error: "Invalid or revoked token" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const result = await processIngest(body, membership.id, membership.teamId, pool);
    // 202 means pure replay (no work done). A dedup'd headline that still
    // landed new snapshotHistory rows is HTTP 200 — actual writes happened.
    const isPureReplay = result.deduplicated && (result.snapshotHistory?.inserted ?? 0) === 0;
    return NextResponse.json(result, { status: isPureReplay ? 202 : 200 });
  } catch (err) {
    if (err instanceof Error && err.name === "ZodError") {
      return NextResponse.json({ error: "Validation failed" }, { status: 400 });
    }
    throw err;
  }
}
