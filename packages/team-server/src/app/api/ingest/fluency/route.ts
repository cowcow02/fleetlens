import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../db/pool";
import { resolveMembershipFromBearer } from "../../../../lib/auth";
import { recomputeTeamAggregate, upsertMemberScorecard } from "../../../../lib/fluency-aggregate";

const ISO_MONDAY_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || !("scorecard" in body)) {
    return NextResponse.json({ error: "Missing scorecard" }, { status: 400 });
  }
  const scorecard = (body as { scorecard: unknown }).scorecard as
    | { week_monday?: unknown; observations?: unknown; score?: unknown }
    | undefined;
  if (!scorecard || typeof scorecard.week_monday !== "string" || !ISO_MONDAY_RE.test(scorecard.week_monday)) {
    return NextResponse.json({ error: "Invalid scorecard.week_monday" }, { status: 400 });
  }
  if (!Array.isArray(scorecard.observations) || scorecard.observations.length === 0) {
    return NextResponse.json({ error: "Empty observations" }, { status: 400 });
  }

  // Cast — schema validation could be tightened with zod; for now we trust
  // the CLI-side shape and let the JSONB column tolerate forward-compat fields.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const card = scorecard as any;
  await upsertMemberScorecard(membership.teamId, membership.id, card.week_monday, card, pool);
  await recomputeTeamAggregate(membership.teamId, card.week_monday, pool);

  return NextResponse.json({ ok: true, week_monday: card.week_monday });
}
