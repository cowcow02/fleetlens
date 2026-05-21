import type pg from "pg";
import { NextResponse } from "next/server";

export const INVITE_CONFLICT_ERROR =
  "An active link already exists for this configuration. Revoke it first.";

// Body shape for the two invite POST endpoints. Returns sanitised values
// with the API contract enforced: expiresInDays is clamped to [1, 365] and
// defaults to 90; label is trimmed; email is preserved as-is for downstream
// case-folding in createInvite. Role parsing is left to the caller because
// admin and group-manager routes differ on whether admin role is allowed.
export function parseInviteOpts(body: unknown): {
  email?: string;
  label?: string;
  expiresInDays: number;
} {
  const b = (body ?? {}) as Record<string, unknown>;
  const email = typeof b.email === "string" ? b.email : undefined;
  const label = typeof b.label === "string" && b.label.trim() ? b.label.trim() : undefined;
  const expiresInDays =
    typeof b.expiresInDays === "number"
      ? Math.min(365, Math.max(1, Math.floor(b.expiresInDays)))
      : 90;
  return { email, label, expiresInDays };
}

// Dedup precheck used by both invite POST routes. Returns the 409 response
// if a matching active multi-use invite already exists, or null when the
// caller may proceed with creation.
export async function checkActiveInviteConflict(
  teamId: string,
  role: "admin" | "member",
  groupIds: string[],
  pool: pg.Pool,
): Promise<NextResponse | null> {
  const existing = await findActiveInviteByConfig(teamId, role, groupIds, pool);
  return existing
    ? NextResponse.json({ error: INVITE_CONFLICT_ERROR }, { status: 409 })
    : null;
}

export type ActiveInviteRow = {
  id: string;
  team_id: string;
  label: string | null;
  role: "admin" | "member";
  group_ids: string[];
  created_by: string;
  created_by_display_name: string | null;
  created_at: string;
  expires_at: string;
  token: string | null;
  redemption_count: number;
};

// "Active" = un-revoked, un-expired, multi-use (email IS NULL).
// Single-use email invites are intentionally excluded from this listing —
// they have their own (deferred) UX.
export async function listActiveInvites(
  teamId: string,
  pool: pg.Pool,
): Promise<ActiveInviteRow[]> {
  const res = await pool.query<ActiveInviteRow>(
    `SELECT
       i.id, i.team_id, i.label, i.role, i.group_ids,
       i.created_by, u.display_name AS created_by_display_name,
       i.created_at, i.expires_at, i.token,
       (
         SELECT count(*)::int FROM events e
         WHERE e.action = 'member.join'
           AND e.payload->>'inviteId' = i.id::text
       ) AS redemption_count
     FROM invites i
     LEFT JOIN user_accounts u ON u.id = i.created_by
     WHERE i.team_id = $1
       AND i.email IS NULL
       AND i.revoked_at IS NULL
       AND i.expires_at > now()
     ORDER BY i.created_at DESC`,
    [teamId],
  );
  return res.rows;
}

// Manager-scope visibility / mutation rule, shared by the list filter and
// the revoke route. Admin-role invites are admin-only regardless of group
// match — otherwise a manager of group X could copy the plaintext token of
// an admin-role link scoped to {X} and self-elevate. Team-default invites
// (`group_ids = []`) are also admin-only for the same reason. Admin/staff
// callers bypass this gate upstream.
export function isInviteInManagerScope(
  invite: { role: "admin" | "member"; group_ids: string[] },
  managedGroupIds: Iterable<string>,
): boolean {
  if (invite.role === "admin") return false;
  if (invite.group_ids.length === 0) return false;
  const managed = managedGroupIds instanceof Set ? managedGroupIds : new Set(managedGroupIds);
  for (const id of invite.group_ids) if (!managed.has(id)) return false;
  return true;
}

export function filterInvitesByManagerScope(
  invites: ActiveInviteRow[],
  managedGroupIds: string[],
): ActiveInviteRow[] {
  const managed = new Set(managedGroupIds);
  return invites.filter((inv) => isInviteInManagerScope(inv, managed));
}

export async function findActiveInviteByConfig(
  teamId: string,
  role: "admin" | "member",
  groupIds: string[],
  pool: pg.Pool,
): Promise<{ id: string } | null> {
  const sorted = [...groupIds].sort();
  const res = await pool.query<{ id: string }>(
    `SELECT id FROM invites
     WHERE team_id = $1
       AND email IS NULL
       AND revoked_at IS NULL
       AND expires_at > now()
       AND role = $2
       AND (
         SELECT array_agg(g ORDER BY g) FROM unnest(group_ids) AS g
       ) IS NOT DISTINCT FROM (
         SELECT array_agg(g ORDER BY g) FROM unnest($3::uuid[]) AS g
       )
     LIMIT 1`,
    [teamId, role, sorted],
  );
  return res.rowCount ? res.rows[0] : null;
}

export async function revokeInvite(
  inviteId: string,
  actorUserId: string,
  pool: pg.Pool,
): Promise<{ teamId: string } | null> {
  const res = await pool.query<{ team_id: string }>(
    `UPDATE invites SET revoked_at = now()
     WHERE id = $1 AND revoked_at IS NULL
     RETURNING team_id`,
    [inviteId],
  );
  if (!res.rowCount) return null;
  const teamId = res.rows[0].team_id;
  await pool.query(
    "INSERT INTO events (team_id, actor_id, action, payload) VALUES ($1, $2, 'member.invite.revoke', $3)",
    [teamId, actorUserId, JSON.stringify({ inviteId })],
  );
  return { teamId };
}

export async function getInviteForAuthz(
  inviteId: string,
  pool: pg.Pool,
): Promise<{ id: string; team_id: string; group_ids: string[]; email: string | null; role: "admin" | "member" } | null> {
  const res = await pool.query<{ id: string; team_id: string; group_ids: string[]; email: string | null; role: "admin" | "member" }>(
    "SELECT id, team_id, group_ids, email, role FROM invites WHERE id = $1",
    [inviteId],
  );
  return res.rowCount ? res.rows[0] : null;
}
