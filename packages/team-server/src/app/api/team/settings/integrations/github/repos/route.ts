import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership, requireAdminOrAnyManager, requireIntegrationManager } from "../../../../../../../lib/route-helpers";
import { listAccessibleRepos } from "../../../../../../../lib/github";
import { storedGithubToken } from "../../../../../../../lib/integrations";

// Lists repos a token can read, for the connect-flow picker. Token comes from
// the request body (pre-save, never logged) or falls back to the stored one of
// an existing integration named by body.id (the "add repositories" path).
// POST because tokens don't belong in URLs.
export async function POST(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("team");
  if (!slug) return NextResponse.json({ error: "team slug required" }, { status: 400 });
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;

  const body = (await req.json().catch(() => ({}))) as { token?: string; id?: string };
  let token = body.token?.trim() || null;
  if (token) {
    const gateErr = await requireAdminOrAnyManager(ctx);
    if (gateErr) return gateErr;
  } else {
    if (!body.id) return NextResponse.json({ error: "token required" }, { status: 400 });
    if (!process.env.FLEETLENS_ENCRYPTION_KEY) {
      return NextResponse.json({ error: "token required" }, { status: 400 });
    }
    const integ = await requireIntegrationManager(ctx, body.id);
    if (integ instanceof NextResponse) return integ;
    // Provider pin: never decrypt another provider's secret and send it to GitHub.
    if (integ.provider !== "github") return NextResponse.json({ error: "Not a GitHub integration" }, { status: 400 });
    token = await storedGithubToken(integ.id, ctx.pool);
    if (!token) return NextResponse.json({ error: "token required — no stored credentials yet" }, { status: 400 });
  }

  try {
    const repos = await listAccessibleRepos(token);
    return NextResponse.json({ repos });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
