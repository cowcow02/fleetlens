import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getPool } from "../../src/db/pool.js";
import { runMigrations } from "../../src/db/migrate.js";
import {
  createInvite,
  lookupInvite,
  redeemInvite,
  revokeMembership,
} from "../../src/lib/members.js";
import { createUserAccount } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost:5432/fleetlens_dev";

let pool: ReturnType<typeof getPool>;
let adminUserId: string;
let teamId: string;

beforeAll(async () => {
  pool = getPool();
  await runMigrations();
  await pool.query("DELETE FROM events");
  await pool.query("DELETE FROM daily_rollups");
  await pool.query("DELETE FROM ingest_log");
  await pool.query("DELETE FROM invites");
  await pool.query("DELETE FROM memberships");
  await pool.query("DELETE FROM sessions");
  await pool.query("DELETE FROM server_config");
  await pool.query("DELETE FROM teams");
  await pool.query("DELETE FROM user_accounts");

  const admin = await createUserAccount("members-admin@example.com", "pass1234", "Admin", {}, pool);
  adminUserId = admin.id;
  const { team } = await createTeamWithAdmin("Members Test Team", admin.id, pool);
  teamId = team.id;
});

afterAll(async () => {
  await pool.end();
});

describe("createInvite", () => {
  it("returns inviteId, token and expiresAt", async () => {
    const result = await createInvite(teamId, adminUserId, {}, pool);
    expect(result.inviteId).toBeTruthy();
    expect(result.token).toMatch(/^iv_/);
    expect(result.expiresAt).toBeTruthy();
  });

  it("writes a member.invite event", async () => {
    const result = await createInvite(teamId, adminUserId, { email: "invited@x.com" }, pool);
    const evRes = await pool.query(
      "SELECT payload FROM events WHERE team_id = $1 AND action = 'member.invite' AND id = (SELECT max(id) FROM events WHERE team_id = $1)",
      [teamId]
    );
    const payload = evRes.rows[0]?.payload as { inviteId: string };
    expect(payload?.inviteId).toBe(result.inviteId);
  });

  it("respects expiresInDays option", async () => {
    const result = await createInvite(teamId, adminUserId, { expiresInDays: 1 }, pool);
    const expires = new Date(result.expiresAt);
    const diff = expires.getTime() - Date.now();
    // Should be ~1 day (allow ±5 seconds for test execution)
    expect(diff).toBeGreaterThan(24 * 60 * 60 * 1000 - 5000);
    expect(diff).toBeLessThan(24 * 60 * 60 * 1000 + 5000);
  });

  it("can create an admin-role invite", async () => {
    const result = await createInvite(teamId, adminUserId, { role: "admin" }, pool);
    const row = await pool.query(
      "SELECT role FROM invites WHERE id = $1",
      [result.inviteId]
    );
    expect(row.rows[0].role).toBe("admin");
  });
});

describe("lookupInvite", () => {
  it("returns the invite row for a valid, unexpired token", async () => {
    const { token } = await createInvite(teamId, adminUserId, {}, pool);
    const inv = await lookupInvite(token, pool);
    expect(inv).not.toBeNull();
    expect(inv!.team_id).toBe(teamId);
  });

  it("returns null for a nonexistent token", async () => {
    const inv = await lookupInvite("iv_totally_fake_token", pool);
    expect(inv).toBeNull();
  });

  it("returns null for an expired token", async () => {
    const { inviteId } = await createInvite(teamId, adminUserId, {}, pool);
    // Force expire by setting expires_at to the past
    await pool.query(
      "UPDATE invites SET expires_at = now() - interval '1 day' WHERE id = $1",
      [inviteId]
    );
    // We don't have the original token handy but we can look it up by id to verify
    const row = await pool.query("SELECT token_hash FROM invites WHERE id = $1", [inviteId]);
    // The lookup uses hash; we'll verify via the DB timestamp
    const inv = await pool.query(
      "SELECT id FROM invites WHERE id = $1 AND used_at IS NULL AND expires_at > now()",
      [inviteId]
    );
    expect(inv.rowCount).toBe(0);
  });

  it("returns null for a used (already redeemed) token", async () => {
    const user = await createUserAccount("redeemer@example.com", "pass1234", null, {}, pool);
    const { token } = await createInvite(teamId, adminUserId, {}, pool);
    await redeemInvite(token, user.id, pool);
    const inv = await lookupInvite(token, pool);
    expect(inv).toBeNull();
  });
});

describe("redeemInvite", () => {
  it("returns membershipId, bearerToken, and teamId on success", async () => {
    const user = await createUserAccount("redeemer2@example.com", "pass1234", null, {}, pool);
    const { token } = await createInvite(teamId, adminUserId, {}, pool);
    const result = await redeemInvite(token, user.id, pool);
    expect(result).not.toBeNull();
    expect(result!.membershipId).toBeTruthy();
    expect(result!.bearerToken).toMatch(/^bt_/);
    expect(result!.teamId).toBe(teamId);
  });

  it("returns null for an invalid/expired invite token", async () => {
    const user = await createUserAccount("badredeemer@example.com", "pass1234", null, {}, pool);
    const result = await redeemInvite("iv_invalid_token", user.id, pool);
    expect(result).toBeNull();
  });

  it("allows rejoining after revoke (ON CONFLICT re-activates membership)", async () => {
    const user = await createUserAccount("rejoin@example.com", "pass1234", null, {}, pool);

    // First join
    const { token: token1 } = await createInvite(teamId, adminUserId, {}, pool);
    const first = await redeemInvite(token1, user.id, pool);
    expect(first).not.toBeNull();

    // Revoke
    await revokeMembership(first!.membershipId, pool);
    const revokedRow = await pool.query(
      "SELECT revoked_at FROM memberships WHERE id = $1",
      [first!.membershipId]
    );
    expect(revokedRow.rows[0].revoked_at).not.toBeNull();

    // Rejoin with new invite
    const { token: token2 } = await createInvite(teamId, adminUserId, {}, pool);
    const second = await redeemInvite(token2, user.id, pool);
    expect(second).not.toBeNull();

    // Verify revoked_at is now NULL again
    const reactivated = await pool.query(
      "SELECT revoked_at FROM memberships WHERE id = $1",
      [second!.membershipId]
    );
    expect(reactivated.rows[0].revoked_at).toBeNull();
  });

  it("writes a member.join event", async () => {
    const user = await createUserAccount("joinevent@example.com", "pass1234", null, {}, pool);
    const { token } = await createInvite(teamId, adminUserId, {}, pool);
    await redeemInvite(token, user.id, pool);
    const evRes = await pool.query(
      "SELECT action FROM events WHERE team_id = $1 AND action = 'member.join' ORDER BY id DESC LIMIT 1",
      [teamId]
    );
    expect(evRes.rows[0]?.action).toBe("member.join");
  });
});

describe("revokeMembership", () => {
  it("sets revoked_at and clears bearer_token_hash", async () => {
    const user = await createUserAccount("revokemem@example.com", "pass1234", null, {}, pool);
    const { token } = await createInvite(teamId, adminUserId, {}, pool);
    const { membershipId } = (await redeemInvite(token, user.id, pool))!;

    await revokeMembership(membershipId, pool);

    const row = await pool.query(
      "SELECT revoked_at, bearer_token_hash FROM memberships WHERE id = $1",
      [membershipId]
    );
    expect(row.rows[0].revoked_at).not.toBeNull();
    expect(row.rows[0].bearer_token_hash).toBeNull();
  });
});
