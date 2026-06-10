import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership, requireAdmin } from "../../../../../../../lib/route-helpers";
import { listAccessibleRepos } from "../../../../../../../lib/github";
import { storedGithubToken } from "../../../../../../../lib/integrations";

// Lists repos a token can read, for the connect-flow picker. Token comes from
// the request body (pre-save, never logged) or falls back to the stored one
// (the "add repositories" path). POST because tokens don't belong in URLs.
export async function POST(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("team");
  if (!slug) return NextResponse.json({ error: "team slug required" }, { status: 400 });
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const adminErr = requireAdmin(ctx);
  if (adminErr) return adminErr;

  const body = (await req.json().catch(() => ({}))) as { token?: string };
  let token = body.token?.trim() || null;
  if (!token) {
    if (!process.env.FLEETLENS_ENCRYPTION_KEY) {
      return NextResponse.json({ error: "token required" }, { status: 400 });
    }
    token = await storedGithubToken(ctx.membership.team_id, ctx.pool);
    if (!token) return NextResponse.json({ error: "token required — no stored credentials yet" }, { status: 400 });
  }

  try {
    const repos = await listAccessibleRepos(token);
    return NextResponse.json({ repos });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
