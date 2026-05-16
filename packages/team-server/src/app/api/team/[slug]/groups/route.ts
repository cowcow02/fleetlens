import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership, requireAdmin } from "../../../../../lib/route-helpers";
import { createGroup, listGroupsForTeam, listGroupsManagedBy } from "../../../../../lib/groups";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const isAdminOrStaff = ctx.user.is_staff || ctx.membership.role === "admin";
  const groups = isAdminOrStaff
    ? await listGroupsForTeam(ctx.membership.team_id, ctx.pool)
    : await listGroupsManagedBy(ctx.membership.id, ctx.pool);
  return NextResponse.json({ groups });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const fail = requireAdmin(ctx);
  if (fail) return fail;

  const body = await req.json().catch(() => ({}));
  if (!body.slug || !body.name) return NextResponse.json({ error: "slug and name required" }, { status: 400 });
  if (!/^[a-z0-9-]+$/.test(body.slug)) return NextResponse.json({ error: "slug must be lowercase letters, digits, hyphens" }, { status: 400 });

  try {
    const group = await createGroup(ctx.membership.team_id, body.slug, body.name, ctx.user.id, ctx.pool);
    return NextResponse.json({ group });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "Group slug already exists in this team" }, { status: 409 });
    }
    throw err;
  }
}
