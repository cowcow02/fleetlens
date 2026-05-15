import type pg from "pg";

export type ViewerContext = {
  membershipId: string;
  role: "admin" | "member";
  isStaff: boolean;
};

export function canSeeMember(
  viewer: ViewerContext,
  targetMembershipId: string,
  managedMemberIds: Set<string>,
): boolean {
  if (viewer.isStaff) return true;
  if (viewer.role === "admin") return true;
  if (viewer.membershipId === targetMembershipId) return true;
  return managedMemberIds.has(targetMembershipId);
}

/**
 * Returns the set of OTHER active membership ids that `viewerMembershipId`
 * can see by virtue of managing one or more groups. The viewer's own id is
 * NOT included — callers union it in if they want a full visibility set.
 */
export async function loadManagedMemberIds(
  viewerMembershipId: string,
  pool: pg.Pool,
): Promise<Set<string>> {
  const res = await pool.query<{ membership_id: string }>(
    `SELECT DISTINCT other.membership_id
     FROM group_members me
     JOIN group_members other ON other.group_id = me.group_id
     JOIN memberships m_other ON m_other.id = other.membership_id
     WHERE me.membership_id = $1
       AND me.is_manager = true
       AND m_other.revoked_at IS NULL`,
    [viewerMembershipId],
  );
  return new Set(res.rows.map((r) => r.membership_id));
}

/**
 * Full visibility set for a viewer, suitable for `WHERE membership_id = ANY($1)`.
 * Returns null for staff/admin (= no filter, see everything in scope).
 */
export async function loadVisibilitySet(
  viewer: ViewerContext,
  pool: pg.Pool,
): Promise<string[] | null> {
  if (viewer.isStaff || viewer.role === "admin") return null;
  const managed = await loadManagedMemberIds(viewer.membershipId, pool);
  managed.add(viewer.membershipId);
  return Array.from(managed);
}
