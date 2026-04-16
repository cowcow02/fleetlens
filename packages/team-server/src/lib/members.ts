import type pg from "pg";
import { generateToken, sha256 } from "./crypto.js";
import { JoinPayload, InvitePayload } from "./zod-schemas.js";

export async function createInvite(raw: unknown, adminId: string, teamId: string, serverBaseUrl: string, pool: pg.Pool) {
  const payload = InvitePayload.parse(raw);
  const token = "iv_" + generateToken(16);
  const expiresAt = new Date(Date.now() + (payload.expiresInDays ?? 7) * 24 * 60 * 60 * 1000);

  const res = await pool.query(
    `INSERT INTO invites (team_id, created_by_user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [teamId, adminId, sha256(token), expiresAt]
  );

  await pool.query(
    "INSERT INTO events (team_id, member_id, action, payload) VALUES ($1, $2, 'member.invite', $3)",
    [teamId, adminId, JSON.stringify({ inviteId: res.rows[0].id })]
  );

  return {
    inviteId: res.rows[0].id,
    joinUrl: `${serverBaseUrl}/join?token=${token}`,
    tokenPlaintext: token,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function joinTeam(raw: unknown, pool: pg.Pool) {
  const payload = JoinPayload.parse(raw);
  const hash = sha256(payload.inviteToken);

  const inviteRes = await pool.query(
    `SELECT id, team_id FROM invites WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [hash]
  );
  if (!inviteRes.rowCount || inviteRes.rowCount === 0) throw new Error("Invalid or expired invite");

  const invite = inviteRes.rows[0];
  const bearerToken = "bt_" + generateToken(32);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query("UPDATE invites SET used_at = now() WHERE id = $1", [invite.id]);

    const memberRes = await client.query(
      `INSERT INTO members (team_id, email, display_name, role, bearer_token_hash)
       VALUES ($1, $2, $3, 'member', $4) RETURNING id, email, display_name, role`,
      [invite.team_id, payload.email || null, payload.displayName || null, sha256(bearerToken)]
    );
    const member = memberRes.rows[0];

    const teamRes = await client.query("SELECT slug FROM teams WHERE id = $1", [invite.team_id]);

    await client.query(
      "INSERT INTO events (team_id, member_id, action) VALUES ($1, $2, 'member.join')",
      [invite.team_id, member.id]
    );

    await client.query("COMMIT");

    return {
      member: { id: member.id, email: member.email, displayName: member.display_name, role: member.role },
      bearerToken,
      teamSlug: teamRes.rows[0].slug,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function leaveTeam(memberId: string, pool: pg.Pool) {
  await pool.query("UPDATE members SET revoked_at = now() WHERE id = $1", [memberId]);
}
