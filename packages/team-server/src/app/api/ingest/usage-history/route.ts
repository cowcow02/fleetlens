// DEPRECATED — kept for older CLIs (≤ 0.10.3) that still POST here.
//
// New daemons send the same payload through /api/ingest/metrics by setting
// IngestPayload.snapshotHistory, which is the single consolidated daemon→
// server path. This shim forwards to processUsageHistory, which itself wraps
// processIngest, so both routes share one DB code path and one set of
// invariants (idempotency, mat-view refresh, roster-updated broadcast).
//
// Operationally this route also exists because adding new daemon→server
// URLs is a coordination tax — each new path needs its own IAP/proxy
// allowlist entry. Routing everything through /api/ingest/metrics removes
// that tax going forward; this file can be deleted once CLI adoption of
// the consolidated endpoint is complete.
import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../db/pool";
import { processUsageHistory } from "../../../../lib/ingest";
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
    const result = await processUsageHistory(body, membership.id, membership.teamId, pool);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof Error && err.name === "ZodError") {
      return NextResponse.json({ error: "Validation failed" }, { status: 400 });
    }
    throw err;
  }
}
