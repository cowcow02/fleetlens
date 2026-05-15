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
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query<GroupRow>(
      `INSERT INTO groups (team_id, slug, name) VALUES ($1, $2, $3)
       RETURNING id, team_id, slug, name, created_at`,
      [teamId, slug, name],
    );
    const row = res.rows[0];
    await client.query(
      "INSERT INTO events (team_id, actor_id, action, payload) VALUES ($1, $2, 'group.created', $3)",
      [teamId, actorUserId, JSON.stringify({ group_id: row.id, slug, name })],
    );
    await client.query("COMMIT");
    return row;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function renameGroup(
  groupId: string,
  newName: string,
  actorUserId: string,
  pool: pg.Pool,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query<{ team_id: string; name: string }>(
      "SELECT team_id, name FROM groups WHERE id = $1",
      [groupId],
    );
    if (!before.rowCount) throw new Error("group not found");
    await client.query("UPDATE groups SET name = $2 WHERE id = $1", [groupId, newName]);
    await client.query(
      "INSERT INTO events (team_id, actor_id, action, payload) VALUES ($1, $2, 'group.renamed', $3)",
      [before.rows[0].team_id, actorUserId, JSON.stringify({ group_id: groupId, from: before.rows[0].name, to: newName })],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteGroup(
  groupId: string,
  actorUserId: string,
  pool: pg.Pool,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const g = await client.query<{ team_id: string; slug: string; name: string }>(
      "SELECT team_id, slug, name FROM groups WHERE id = $1",
      [groupId],
    );
    if (!g.rowCount) throw new Error("group not found");
    await client.query("DELETE FROM groups WHERE id = $1", [groupId]);
    await client.query(
      "INSERT INTO events (team_id, actor_id, action, payload) VALUES ($1, $2, 'group.deleted', $3)",
      [g.rows[0].team_id, actorUserId, JSON.stringify({ group_id: groupId, slug: g.rows[0].slug, name: g.rows[0].name })],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
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
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const g = await client.query<{ team_id: string }>("SELECT team_id FROM groups WHERE id = $1", [groupId]);
    if (!g.rowCount) throw new Error("group not found");
    const inserted = await client.query(
      `INSERT INTO group_members (group_id, membership_id, is_manager, added_by)
       VALUES ($1, $2, false, $3)
       ON CONFLICT (group_id, membership_id) DO NOTHING
       RETURNING group_id`,
      [groupId, membershipId, actorUserId],
    );
    if (inserted.rowCount === 1) {
      await client.query(
        "INSERT INTO events (team_id, actor_id, action, payload) VALUES ($1, $2, 'group.member.added', $3)",
        [g.rows[0].team_id, actorUserId, JSON.stringify({ group_id: groupId, membership_id: membershipId })],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function removeGroupMember(
  groupId: string,
  membershipId: string,
  actorUserId: string,
  pool: pg.Pool,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const g = await client.query<{ team_id: string }>("SELECT team_id FROM groups WHERE id = $1", [groupId]);
    if (!g.rowCount) {
      await client.query("COMMIT");
      return;
    }
    const deleted = await client.query(
      "DELETE FROM group_members WHERE group_id = $1 AND membership_id = $2 RETURNING group_id",
      [groupId, membershipId],
    );
    if (deleted.rowCount === 1) {
      await client.query(
        "INSERT INTO events (team_id, actor_id, action, payload) VALUES ($1, $2, 'group.member.removed', $3)",
        [g.rows[0].team_id, actorUserId, JSON.stringify({ group_id: groupId, membership_id: membershipId })],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function setGroupMemberManager(
  groupId: string,
  membershipId: string,
  isManager: boolean,
  actorUserId: string,
  pool: pg.Pool,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (isManager) {
      const r = await client.query(
        "SELECT 1 FROM memberships WHERE id = $1 AND revoked_at IS NULL",
        [membershipId],
      );
      if (!r.rowCount) throw new Error("cannot promote: membership is revoked or missing");
    }
    const upd = await client.query<{ team_id: string }>(
      `UPDATE group_members gm
       SET is_manager = $3
       FROM groups g
       WHERE gm.group_id = $1 AND gm.membership_id = $2 AND g.id = gm.group_id
       RETURNING g.team_id`,
      [groupId, membershipId, isManager],
    );
    if (!upd.rowCount) throw new Error("group_members row not found");
    await client.query(
      "INSERT INTO events (team_id, actor_id, action, payload) VALUES ($1, $2, 'group.member.role_changed', $3)",
      [upd.rows[0].team_id, actorUserId, JSON.stringify({ group_id: groupId, membership_id: membershipId, is_manager: isManager })],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
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

export async function listGroupMembersByGroupForTeam(
  teamId: string,
  pool: pg.Pool,
): Promise<Map<string, GroupMembershipRow[]>> {
  const res = await pool.query<GroupMembershipRow>(
    `SELECT gm.group_id, gm.membership_id, gm.is_manager, gm.added_at
     FROM group_members gm
     JOIN groups g ON g.id = gm.group_id
     WHERE g.team_id = $1`,
    [teamId],
  );
  const byGroup = new Map<string, GroupMembershipRow[]>();
  for (const row of res.rows) {
    const list = byGroup.get(row.group_id) ?? [];
    list.push(row);
    byGroup.set(row.group_id, list);
  }
  return byGroup;
}
