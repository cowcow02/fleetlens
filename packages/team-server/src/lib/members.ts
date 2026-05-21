import type pg from "pg";
import { generateToken, sha256 } from "./crypto";

export async function createInvite(
  teamId: string,
  createdBy: string,
  opts: {
    email?: string;
    role?: "admin" | "member";
    expiresInDays?: number;
    groupIds?: string[];
    label?: string;
  } = {},
  pool: pg.Pool,
): Promise<{ inviteId: string; token: string; expiresAt: string }> {
  const token = "iv_" + generateToken(16);
  const role = opts.role ?? "member";
  // 90-day default for multi-use share links; legacy callers can pass any value.
  const expiresAt = new Date(Date.now() + (opts.expiresInDays ?? 90) * 24 * 60 * 60 * 1000);
  const groupIds = opts.groupIds ?? [];

  const res = await pool.query(
    `INSERT INTO invites (team_id, created_by, email, role, token_hash, token, label, expires_at, group_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      teamId,
      createdBy,
      opts.email?.toLowerCase() ?? null,
      role,
      sha256(token),
      token,
      opts.label ?? null,
      expiresAt,
      groupIds,
    ],
  );

  await pool.query(
    "INSERT INTO events (team_id, actor_id, action, payload) VALUES ($1, $2, 'member.invite', $3)",
    [teamId, createdBy, JSON.stringify({ inviteId: res.rows[0].id, email: opts.email ?? null, role, groupIds, label: opts.label ?? null })],
  );

  return { inviteId: res.rows[0].id, token, expiresAt: expiresAt.toISOString() };
}

export type InviteRow = {
  id: string;
  team_id: string;
  created_by: string;
  email: string | null;
  role: "admin" | "member";
  expires_at: Date;
  group_ids: string[];
};

export async function lookupInvite(token: string, pool: pg.Pool): Promise<InviteRow | null> {
  const res = await pool.query<InviteRow>(
    `SELECT id, team_id, created_by, email, role, expires_at, group_ids FROM invites
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [sha256(token)],
  );
  return res.rowCount ? res.rows[0] : null;
}

export async function redeemInvite(
  inviteToken: string,
  userAccountId: string,
  pool: pg.Pool,
): Promise<{ membershipId: string; bearerToken: string; teamId: string; joinedGroupIds: string[] } | null> {
  const invite = await lookupInvite(inviteToken, pool);
  if (!invite) return null;

  const bearerToken = "bt_" + generateToken(32);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Single-use (email-scoped) invites auto-revoke on first redemption.
    // Multi-use share links (email IS NULL) leave revoked_at alone — only an
    // admin/manager revoke clears them. used_at is still written for one
    // release of back-compat; dropped in the follow-up release.
    if (invite.email !== null) {
      await client.query(
        "UPDATE invites SET used_at = now(), revoked_at = now() WHERE id = $1",
        [invite.id],
      );
    }
    // Bearer always rotates on conflict — admin issued a fresh invite, so any
    // stale daemon token is the intended casualty. Role uses CASE so an active
    // admin is never silently downgraded by a member-role invite, but a
    // post-revoke rejoin still respects whatever role the new invite carries.
    const mRes = await client.query(
      `INSERT INTO memberships (user_account_id, team_id, role, bearer_token_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_account_id, team_id) DO UPDATE SET
         revoked_at = NULL,
         bearer_token_hash = EXCLUDED.bearer_token_hash,
         role = CASE
           WHEN memberships.revoked_at IS NOT NULL THEN EXCLUDED.role
           WHEN memberships.role = 'admin' THEN memberships.role
           ELSE EXCLUDED.role
         END
       RETURNING id`,
      [userAccountId, invite.team_id, invite.role, sha256(bearerToken)],
    );
    const membershipId = mRes.rows[0].id;

    let joinedGroupIds: string[] = [];
    if (invite.group_ids.length > 0) {
      const ins = await client.query<{ group_id: string }>(
        `INSERT INTO group_members (group_id, membership_id, is_manager, added_by)
         SELECT g.id, $2, false, $3 FROM groups g
         WHERE g.id = ANY($1::uuid[]) AND g.team_id = $4
         ON CONFLICT (group_id, membership_id) DO NOTHING
         RETURNING group_id`,
        [invite.group_ids, membershipId, invite.created_by, invite.team_id],
      );
      joinedGroupIds = ins.rows.map((r) => r.group_id);
    }

    await client.query(
      "INSERT INTO events (team_id, actor_id, action, payload) VALUES ($1, $2, 'member.join', $3)",
      [invite.team_id, userAccountId, JSON.stringify({ via: "invite", inviteId: invite.id, joinedGroupIds })],
    );
    await client.query("COMMIT");
    return { membershipId, bearerToken, teamId: invite.team_id, joinedGroupIds };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function revokeMembership(membershipId: string, pool: pg.Pool): Promise<void> {
  await pool.query(
    "UPDATE memberships SET revoked_at = now(), bearer_token_hash = NULL WHERE id = $1",
    [membershipId]
  );
}

export async function reactivateMembership(
  membershipId: string,
  pool: pg.Pool,
): Promise<string | null> {
  const bearerToken = "bt_" + generateToken(32);
  const res = await pool.query(
    "UPDATE memberships SET revoked_at = NULL, bearer_token_hash = $1 WHERE id = $2 AND revoked_at IS NOT NULL",
    [sha256(bearerToken), membershipId],
  );
  return res.rowCount ? bearerToken : null;
}
