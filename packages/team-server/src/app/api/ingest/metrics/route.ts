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
    // No member to attribute — but still log so a daemon wedged on a stale/
    // revoked token is observable (it would otherwise retry forever silently).
    console.warn("[ingest] auth rejected: invalid or revoked bearer token (no member)");
    return NextResponse.json({ error: "Invalid or revoked token" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const result = await processIngest(body, membership.id, membership.teamId, pool);
    // processIngest sets nextSyncAfter iff work happened. Pure replay omits
    // it → 202; everything else → 200.
    return NextResponse.json(result, { status: result.nextSyncAfter ? 200 : 202 });
  } catch (err) {
    if (err instanceof Error && err.name === "ZodError") {
      const issues = (err as unknown as { issues?: unknown[] }).issues;
      // Identity-tagged so a member whose daemon sends a malformed ENVELOPE
      // (rejected whole, before per-block ingest) is attributable, not anonymous.
      console.warn(
        `[ingest] envelope rejected member=${membership.id} team=${membership.teamId}:`,
        JSON.stringify(issues?.slice(0, 3)),
      );
      return NextResponse.json({ error: "Validation failed", issues }, { status: 400 });
    }
    throw err;
  }
}
