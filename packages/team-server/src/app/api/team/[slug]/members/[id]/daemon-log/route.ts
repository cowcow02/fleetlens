import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getPool } from "../../../../../../../db/pool";
import { validateSession } from "../../../../../../../lib/auth";
import { loadMember } from "../../../../../../../lib/queries";
import { loadMemberDaemonLogPage } from "../../../../../../../lib/plan-queries";
import { canSeeMember, loadManagedMemberIds } from "../../../../../../../lib/visibility";

export const dynamic = "force-dynamic";

// Paginated source for the per-member "View logs" modal — the member's own
// daemon sync log, uploaded from their machine. Gated to anyone who can
// already see this member (team admins / their manager), NOT staff-only:
// these lines are one member's sync story, scoped to their team. Cursor is
// the bigserial id via `?before=<id>`; response carries `nextCursor` for the
// next (older) page or null at the tail.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { id } = await params;
  const pool = getPool();

  const token = (await cookies()).get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await loadMember(id, pool);
  if (!member) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const myMembership = session.memberships.find((m) => m.team_id === member.team_id);
  if (!myMembership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const viewer = {
    membershipId: myMembership.id,
    role: myMembership.role,
    isStaff: session.user.is_staff,
  };
  const managed = await loadManagedMemberIds(viewer.membershipId, pool);
  if (!canSeeMember(viewer, id, managed)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const beforeRaw = new URL(req.url).searchParams.get("before");
  const before = beforeRaw != null ? Number(beforeRaw) : undefined;
  const { rows, nextCursor } = await loadMemberDaemonLogPage(member.team_id, id, pool, {
    before: before != null && Number.isFinite(before) ? before : undefined,
    limit: 50,
  });

  return NextResponse.json({ rows, nextCursor });
}
