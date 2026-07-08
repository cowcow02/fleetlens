import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership, requireAdminOrAnyManager, requireIntegrationManager } from "../../../../../../../lib/route-helpers";
import { listJiraProjects, normalizeSite } from "../../../../../../../lib/jira";
import { storedJiraToken, storedJiraConnection } from "../../../../../../../lib/integrations";

// Lists Jira projects visible to the credentials, for the connect-flow picker.
// Site/email/token come from the request body (pre-save) or fall back to the
// stored ones of an existing integration named by body.id. POST because
// credentials don't belong in URLs.
export async function POST(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("team");
  if (!slug) return NextResponse.json({ error: "team slug required" }, { status: 400 });
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;

  const body = (await req.json().catch(() => ({}))) as { site?: string; email?: string; apiToken?: string; id?: string };
  let site = body.site?.trim() ? normalizeSite(body.site) : null;
  let email = body.email?.trim() || null;
  let token = body.apiToken?.trim() || null;

  if (site && email && token) {
    const gateErr = await requireAdminOrAnyManager(ctx);
    if (gateErr) return gateErr;
  } else {
    if (!body.id || !process.env.FLEETLENS_ENCRYPTION_KEY) {
      return NextResponse.json({ error: "site, email and API token required" }, { status: 400 });
    }
    const integ = await requireIntegrationManager(ctx, body.id);
    if (integ instanceof NextResponse) return integ;
    const stored = await storedJiraConnection(integ.id, ctx.pool);
    const storedToken = await storedJiraToken(integ.id, ctx.pool);
    site = site ?? stored?.site ?? null;
    email = email ?? stored?.email ?? null;
    token = token ?? storedToken;
    if (!site || !email || !token) {
      return NextResponse.json({ error: "site, email and API token required — no stored credentials yet" }, { status: 400 });
    }
  }

  try {
    const projects = await listJiraProjects(site, email, token);
    return NextResponse.json({ projects });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
