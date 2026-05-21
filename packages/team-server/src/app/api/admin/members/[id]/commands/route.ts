import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireSession } from "../../../../../../lib/route-helpers";
import { loadMember } from "../../../../../../lib/queries";

// Single discriminated union mirrors ServerCommand in
// packages/parser/src/team-wire.ts. Add a new variant here + a new entry in
// the daemon's command switch + a new wire-type variant — all three move
// together.
const BodySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("backfill-activity"),
    params: z.object({ days: z.number().int().min(1).max(365) }),
  }),
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (session instanceof NextResponse) return session;

  const { id: membershipId } = await params;
  const member = await loadMember(membershipId, session.pool);
  if (!member) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Staff bypass the team-admin check entirely; otherwise the caller must be
  // an admin in the target's team. Mirrors requireGroupManager in
  // route-helpers.ts.
  if (!session.user.is_staff) {
    const membership = session.memberships.find((m) => m.team_id === member.team_id);
    if (!membership || membership.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.format() },
      { status: 400 },
    );
  }
  const { type, params: cmdParams } = parsed.data;

  // Idempotency: an existing pending (not yet completed) command with the
  // same type + structurally-equal params returns the existing row instead
  // of creating a duplicate. jsonb equality is structural so key order
  // doesn't matter.
  const existing = await session.pool.query<{
    id: string;
    command_type: string;
    params: Record<string, unknown>;
    issued_at: Date;
  }>(
    `SELECT id, command_type, params, issued_at
       FROM member_commands
      WHERE membership_id = $1
        AND command_type = $2
        AND params = $3::jsonb
        AND completed_at IS NULL
      LIMIT 1`,
    [membershipId, type, JSON.stringify(cmdParams)],
  );
  if (existing.rowCount && existing.rowCount > 0) {
    return NextResponse.json(existing.rows[0], { status: 200 });
  }

  const id = `cmd_${randomUUID().replace(/-/g, "")}`;
  const inserted = await session.pool.query<{
    id: string;
    command_type: string;
    params: Record<string, unknown>;
    issued_at: Date;
  }>(
    `INSERT INTO member_commands (id, team_id, membership_id, command_type, params, issued_by_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING id, command_type, params, issued_at`,
    [id, member.team_id, membershipId, type, JSON.stringify(cmdParams), session.user.id],
  );
  return NextResponse.json(inserted.rows[0], { status: 201 });
}
