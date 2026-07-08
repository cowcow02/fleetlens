import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership, requireIntegrationManager } from "../../../../../../../lib/route-helpers";
import { runLinearSync } from "../../../../../../../lib/integrations";

export async function POST(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("team");
  if (!slug) return NextResponse.json({ error: "team slug required" }, { status: 400 });
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const integ = await requireIntegrationManager(ctx, id);
  if (integ instanceof NextResponse) return integ;
  if (integ.provider !== "linear") return NextResponse.json({ error: "Not a Linear integration" }, { status: 400 });

  try {
    const summary = await runLinearSync(integ.id, ctx.pool);
    return NextResponse.json({ synced: true, ...summary });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
