import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getPool } from "../../src/db/pool.js";
import { runMigrations } from "../../src/db/migrate.js";
import {
  createUserAccount,
  findUserByEmail,
  authenticate,
  createSession,
  validateSession,
  revokeSession,
  resolveMembershipFromBearer,
} from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";
import { generateToken, sha256 } from "../../src/lib/crypto.js";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost:5432/fleetlens_dev";

let pool: ReturnType<typeof getPool>;

beforeAll(async () => {
  pool = getPool();
  await runMigrations();
  // clean slate
  await pool.query("DELETE FROM events");
  await pool.query("DELETE FROM daily_rollups");
  await pool.query("DELETE FROM ingest_log");
  await pool.query("DELETE FROM invites");
  await pool.query("DELETE FROM memberships");
  await pool.query("DELETE FROM sessions");
  await pool.query("DELETE FROM server_config");
  await pool.query("DELETE FROM teams");
  await pool.query("DELETE FROM user_accounts");
});

afterAll(async () => {
  await pool.end();
});

describe("createUserAccount", () => {
  it("creates an account and returns the user row", async () => {
    const u = await createUserAccount("alice@example.com", "password123", "Alice", {}, pool);
    expect(u.email).toBe("alice@example.com");
    expect(u.display_name).toBe("Alice");
    expect(u.is_staff).toBe(false);
    expect(u.id).toBeTruthy();
  });

  it("lowercases and trims the email", async () => {
    const u = await createUserAccount("  BOB@EXAMPLE.COM  ", "password123", null, {}, pool);
    expect(u.email).toBe("bob@example.com");
  });

  it("marks staff when isStaff option is true", async () => {
    const u = await createUserAccount("staff@example.com", "password123", null, { isStaff: true }, pool);
    expect(u.is_staff).toBe(true);
  });

  it("throws on duplicate email", async () => {
    await expect(
      createUserAccount("alice@example.com", "other", null, {}, pool)
    ).rejects.toThrow(/unique|duplicate/i);
  });
});

describe("findUserByEmail", () => {
  it("returns the user with password_hash for a known email", async () => {
    const found = await findUserByEmail("alice@example.com", pool);
    expect(found).not.toBeNull();
    expect(found!.password_hash).toBeTruthy();
  });

  it("returns null for an unknown email", async () => {
    const found = await findUserByEmail("nobody@nowhere.com", pool);
    expect(found).toBeNull();
  });
});

describe("authenticate", () => {
  it("returns user on correct credentials", async () => {
    const user = await authenticate("alice@example.com", "password123", pool);
    expect(user).not.toBeNull();
    expect(user!.email).toBe("alice@example.com");
    // must NOT include password_hash
    expect((user as Record<string, unknown>).password_hash).toBeUndefined();
  });

  it("returns null for wrong password", async () => {
    const user = await authenticate("alice@example.com", "wrongpassword", pool);
    expect(user).toBeNull();
  });

  it("returns null for unknown email", async () => {
    const user = await authenticate("ghost@nowhere.com", "anything", pool);
    expect(user).toBeNull();
  });
});

describe("createSession + validateSession", () => {
  it("creates a session and validates it immediately", async () => {
    const u = await createUserAccount("session@example.com", "pass1234", null, {}, pool);
    const { cookieToken, sessionId } = await createSession(u.id, pool);
    expect(cookieToken).toBeTruthy();
    expect(sessionId).toBeTruthy();

    const ctx = await validateSession(cookieToken, pool);
    expect(ctx).not.toBeNull();
    expect(ctx!.user.email).toBe("session@example.com");
    expect(ctx!.sessionId).toBe(sessionId);
  });

  it("returns null for an unknown token", async () => {
    const ctx = await validateSession("totally-bogus-token", pool);
    expect(ctx).toBeNull();
  });

  it("includes memberships in the context", async () => {
    const u = await createUserAccount("member@example.com", "pass1234", null, {}, pool);
    const { team } = await createTeamWithAdmin("Test Team", u.id, pool);
    const { cookieToken } = await createSession(u.id, pool);
    const ctx = await validateSession(cookieToken, pool);
    expect(ctx!.memberships.length).toBeGreaterThan(0);
    expect(ctx!.memberships[0].team_id).toBe(team.id);
  });

  it("bumps last_used_at when last_used_at is older than 5 minutes", async () => {
    const u = await createUserAccount("bump@example.com", "pass1234", null, {}, pool);
    const { cookieToken, sessionId } = await createSession(u.id, pool);

    // Manually set last_used_at to 10 minutes ago
    await pool.query(
      "UPDATE sessions SET last_used_at = now() - interval '10 minutes' WHERE id = $1",
      [sessionId]
    );

    const before = await pool.query(
      "SELECT last_used_at FROM sessions WHERE id = $1",
      [sessionId]
    );
    const oldTime = before.rows[0].last_used_at;

    await validateSession(cookieToken, pool);

    const after = await pool.query(
      "SELECT last_used_at FROM sessions WHERE id = $1",
      [sessionId]
    );
    // last_used_at should have been updated to a more recent time
    expect(new Date(after.rows[0].last_used_at).getTime()).toBeGreaterThan(
      new Date(oldTime).getTime()
    );
  });

  it("does NOT bump last_used_at when session was used recently (within 5 min)", async () => {
    const u = await createUserAccount("nobump@example.com", "pass1234", null, {}, pool);
    const { cookieToken, sessionId } = await createSession(u.id, pool);

    // Set last_used_at to just now
    await pool.query(
      "UPDATE sessions SET last_used_at = now() - interval '1 minute' WHERE id = $1",
      [sessionId]
    );

    const before = await pool.query(
      "SELECT last_used_at FROM sessions WHERE id = $1",
      [sessionId]
    );
    const beforeTime = new Date(before.rows[0].last_used_at).getTime();

    await validateSession(cookieToken, pool);

    const after = await pool.query(
      "SELECT last_used_at FROM sessions WHERE id = $1",
      [sessionId]
    );
    // Should be within 1 second of the original (no update)
    expect(Math.abs(new Date(after.rows[0].last_used_at).getTime() - beforeTime)).toBeLessThan(2000);
  });
});

describe("revokeSession", () => {
  it("deletes the session so subsequent validation returns null", async () => {
    const u = await createUserAccount("revoke@example.com", "pass1234", null, {}, pool);
    const { cookieToken, sessionId } = await createSession(u.id, pool);
    await revokeSession(sessionId, pool);
    const ctx = await validateSession(cookieToken, pool);
    expect(ctx).toBeNull();
  });

  it("is idempotent — revoking twice does not throw", async () => {
    const u = await createUserAccount("revoke2@example.com", "pass1234", null, {}, pool);
    const { sessionId } = await createSession(u.id, pool);
    await revokeSession(sessionId, pool);
    await expect(revokeSession(sessionId, pool)).resolves.toBeUndefined();
  });
});

describe("resolveMembershipFromBearer", () => {
  it("returns membership details for a valid bearer token", async () => {
    const u = await createUserAccount("bearer@example.com", "pass1234", null, {}, pool);
    const { membership } = await createTeamWithAdmin("Bearer Team", u.id, pool);
    const resolved = await resolveMembershipFromBearer(membership.bearerToken, pool);
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe(membership.id);
    expect(resolved!.role).toBe("admin");
  });

  it("returns null for a missing/unknown token", async () => {
    const resolved = await resolveMembershipFromBearer("bt_nonexistent", pool);
    expect(resolved).toBeNull();
  });

  it("returns null after membership is revoked", async () => {
    const u = await createUserAccount("revokedbearer@example.com", "pass1234", null, {}, pool);
    const { membership } = await createTeamWithAdmin("Revoked Bearer Team", u.id, pool);
    // Revoke by clearing bearer_token_hash
    await pool.query(
      "UPDATE memberships SET revoked_at = now(), bearer_token_hash = NULL WHERE id = $1",
      [membership.id]
    );
    const resolved = await resolveMembershipFromBearer(membership.bearerToken, pool);
    expect(resolved).toBeNull();
  });
});
