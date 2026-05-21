import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership, requireAdmin } from "../../../../lib/route-helpers";
import { parseAllowedDomains, setAllowedSignupDomains } from "../../../../lib/teams";

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("team");
  if (!slug) return NextResponse.json({ error: "team slug required" }, { status: 400 });

  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const adminErr = requireAdmin(ctx);
  if (adminErr) return adminErr;

  const res = await ctx.pool.query(
    "SELECT name, slug, retention_days, custom_domain, settings, allowed_signup_domains, created_at FROM teams WHERE id = $1",
    [ctx.membership.team_id]
  );
  return NextResponse.json(res.rows[0]);
}

export async function PUT(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("team");
  if (!slug) return NextResponse.json({ error: "team slug required" }, { status: 400 });

  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const adminErr = requireAdmin(ctx);
  if (adminErr) return adminErr;

  const body = await req.json();
  if (body.name) {
    await ctx.pool.query("UPDATE teams SET name = $1 WHERE id = $2", [body.name, ctx.membership.team_id]);
  }
  if (body.retentionDays) {
    await ctx.pool.query("UPDATE teams SET retention_days = $1 WHERE id = $2", [body.retentionDays, ctx.membership.team_id]);
  }
  if (body.planOptimizer) {
    // Merge into the jsonb settings column rather than overwriting other keys.
    await ctx.pool.query(
      `UPDATE teams
         SET settings = settings || jsonb_build_object('planOptimizer', $1::jsonb)
       WHERE id = $2`,
      [JSON.stringify(body.planOptimizer), ctx.membership.team_id],
    );
  }
  if (body.allowedSignupDomains !== undefined) {
    let parsed: string[];
    try {
      parsed = parseAllowedDomains(body.allowedSignupDomains as string | string[]);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid allowedSignupDomains" },
        { status: 400 },
      );
    }
    await setAllowedSignupDomains(ctx.membership.team_id, parsed, ctx.pool);
  }
  return NextResponse.json({ updated: true });
}
