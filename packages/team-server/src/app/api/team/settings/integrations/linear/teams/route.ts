import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership, requireAdmin } from "../../../../../../../lib/route-helpers";
import { listLinearTeams } from "../../../../../../../lib/linear";
import { storedLinearKey } from "../../../../../../../lib/integrations";

// Lists Linear teams visible to a key, for the connect-flow picker. Key comes
// from the request body (pre-save) or falls back to the stored one. POST
// because credentials don't belong in URLs.
export async function POST(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("team");
  if (!slug) return NextResponse.json({ error: "team slug required" }, { status: 400 });
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const adminErr = requireAdmin(ctx);
  if (adminErr) return adminErr;

  const body = (await req.json().catch(() => ({}))) as { apiKey?: string };
  let apiKey = body.apiKey?.trim() || null;
  if (!apiKey) {
    if (!process.env.FLEETLENS_ENCRYPTION_KEY) {
      return NextResponse.json({ error: "API key required" }, { status: 400 });
    }
    apiKey = await storedLinearKey(ctx.membership.team_id, ctx.pool);
    if (!apiKey) return NextResponse.json({ error: "API key required — no stored credentials yet" }, { status: 400 });
  }

  try {
    const teams = await listLinearTeams(apiKey);
    return NextResponse.json({ teams });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
