import type pg from "pg";

export type GroupRow = {
  id: string;
  team_id: string;
  slug: string;
  name: string;
  created_at: string;
};

export type GroupMembershipRow = {
  group_id: string;
  membership_id: string;
  is_manager: boolean;
  added_at: string;
};

export async function createGroup(
  teamId: string,
  slug: string,
  name: string,
  actorUserId: string,
  pool: pg.Pool,
): Promise<GroupRow> {
  const res = await pool.query<GroupRow>(
    `INSERT INTO groups (team_id, slug, name) VALUES ($1, $2, $3)
     RETURNING id, team_id, slug, name, created_at`,
    [teamId, slug, name],
  );
  const row = res.rows[0];
  await pool.query(
    "INSERT INTO events (team_id, actor_id, action, payload) VALUES ($1, $2, 'group.created', $3)",
    [teamId, actorUserId, JSON.stringify({ group_id: row.id, slug, name })],
  );
  return row;
}

export async function renameGroup(
  groupId: string,
  newName: string,
  pool: pg.Pool,
  actorUserId?: string,
): Promise<void> {
  // Capture old name first for the event, then update.
  const before = await pool.query<{ team_id: string; name: string }>(
    "SELECT team_id, name FROM groups WHERE id = $1",
    [groupId],
  );
  if (!before.rowCount) throw new Error("group not found");
  await pool.query("UPDATE groups SET name = $2 WHERE id = $1", [groupId, newName]);
  await pool.query(
    "INSERT INTO events (team_id, actor_id, action, payload) VALUES ($1, $2, 'group.renamed', $3)",
    [before.rows[0].team_id, actorUserId ?? null, JSON.stringify({ group_id: groupId, from: before.rows[0].name, to: newName })],
  );
}

export async function deleteGroup(groupId: string, pool: pg.Pool, actorUserId?: string): Promise<void> {
  const g = await pool.query<{ team_id: string; slug: string; name: string }>(
    "SELECT team_id, slug, name FROM groups WHERE id = $1",
    [groupId],
  );
  if (!g.rowCount) return;
  await pool.query("DELETE FROM groups WHERE id = $1", [groupId]);
  await pool.query(
    "INSERT INTO events (team_id, actor_id, action, payload) VALUES ($1, $2, 'group.deleted', $3)",
    [g.rows[0].team_id, actorUserId ?? null, JSON.stringify({ group_id: groupId, slug: g.rows[0].slug, name: g.rows[0].name })],
  );
}

export async function loadGroupBySlug(
  teamId: string,
  slug: string,
  pool: pg.Pool,
): Promise<GroupRow | null> {
  const res = await pool.query<GroupRow>(
    "SELECT id, team_id, slug, name, created_at FROM groups WHERE team_id = $1 AND slug = $2",
    [teamId, slug],
  );
  return res.rowCount ? res.rows[0] : null;
}

export async function listGroupsForTeam(teamId: string, pool: pg.Pool): Promise<GroupRow[]> {
  const res = await pool.query<GroupRow>(
    "SELECT id, team_id, slug, name, created_at FROM groups WHERE team_id = $1 ORDER BY name",
    [teamId],
  );
  return res.rows;
}

export async function listGroupsManagedBy(
  membershipId: string,
  pool: pg.Pool,
): Promise<GroupRow[]> {
  const res = await pool.query<GroupRow>(
    `SELECT g.id, g.team_id, g.slug, g.name, g.created_at
     FROM groups g
     JOIN group_members gm ON gm.group_id = g.id
     WHERE gm.membership_id = $1 AND gm.is_manager = true
     ORDER BY g.name`,
    [membershipId],
  );
  return res.rows;
}

export async function addGroupMember(
  groupId: string,
  membershipId: string,
  actorUserId: string,
  pool: pg.Pool,
  opts: { isManager?: boolean } = {},
): Promise<void> {
  const g = await pool.query<{ team_id: string }>("SELECT team_id FROM groups WHERE id = $1", [groupId]);
  if (!g.rowCount) throw new Error("group not found");
  await pool.query(
    `INSERT INTO group_members (group_id, membership_id, is_manager, added_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (group_id, membership_id) DO NOTHING`,
    [groupId, membershipId, !!opts.isManager, actorUserId],
  );
  await pool.query(
    "INSERT INTO events (team_id, actor_id, action, payload) VALUES ($1, $2, 'group.member.added', $3)",
    [g.rows[0].team_id, actorUserId, JSON.stringify({ group_id: groupId, membership_id: membershipId, is_manager: !!opts.isManager })],
  );
}

export async function removeGroupMember(
  groupId: string,
  membershipId: string,
  pool: pg.Pool,
  actorUserId?: string,
): Promise<void> {
  const g = await pool.query<{ team_id: string }>("SELECT team_id FROM groups WHERE id = $1", [groupId]);
  if (!g.rowCount) return;
  await pool.query(
    "DELETE FROM group_members WHERE group_id = $1 AND membership_id = $2",
    [groupId, membershipId],
  );
  await pool.query(
    "INSERT INTO events (team_id, actor_id, action, payload) VALUES ($1, $2, 'group.member.removed', $3)",
    [g.rows[0].team_id, actorUserId ?? null, JSON.stringify({ group_id: groupId, membership_id: membershipId })],
  );
}

export async function setGroupMemberManager(
  groupId: string,
  membershipId: string,
  isManager: boolean,
  pool: pg.Pool,
  actorUserId?: string,
): Promise<void> {
  if (isManager) {
    const r = await pool.query(
      "SELECT 1 FROM memberships WHERE id = $1 AND revoked_at IS NULL",
      [membershipId],
    );
    if (!r.rowCount) throw new Error("cannot promote: membership is revoked or missing");
  }
  const upd = await pool.query<{ team_id: string }>(
    `UPDATE group_members gm
     SET is_manager = $3
     FROM groups g
     WHERE gm.group_id = $1 AND gm.membership_id = $2 AND g.id = gm.group_id
     RETURNING g.team_id`,
    [groupId, membershipId, isManager],
  );
  if (!upd.rowCount) throw new Error("group_members row not found");
  await pool.query(
    "INSERT INTO events (team_id, actor_id, action, payload) VALUES ($1, $2, 'group.member.role_changed', $3)",
    [upd.rows[0].team_id, actorUserId ?? null, JSON.stringify({ group_id: groupId, membership_id: membershipId, is_manager: isManager })],
  );
}

export async function listGroupMembers(
  groupId: string,
  pool: pg.Pool,
): Promise<GroupMembershipRow[]> {
  const res = await pool.query<GroupMembershipRow>(
    `SELECT group_id, membership_id, is_manager, added_at
     FROM group_members WHERE group_id = $1`,
    [groupId],
  );
  return res.rows;
}
