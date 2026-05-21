import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership } from "../../../../lib/route-helpers";
import { loadRoster, parseRange, RANGE_DAYS } from "../../../../lib/queries";

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("team");
  if (!slug) return NextResponse.json({ error: "team slug required" }, { status: 400 });

  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;

  const range = parseRange(req.nextUrl.searchParams.get("range") ?? undefined);
  const roster = await loadRoster(ctx.membership.team_id, RANGE_DAYS[range], ctx.pool);
  // Non-admin members see only their own row.
  if (ctx.membership.role !== "admin") {
    return NextResponse.json(roster.filter((r) => r.id === ctx.membership.id));
  }
  return NextResponse.json(roster);
}
