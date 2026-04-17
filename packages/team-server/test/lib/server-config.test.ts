import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getPool } from "../../src/db/pool.js";
import { runMigrations } from "../../src/db/migrate.js";
import {
  getConfig,
  setConfig,
  getBool,
  instanceState,
  canCreateTeam,
} from "../../src/lib/server-config.js";
import { createUserAccount } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost:5432/fleetlens_dev";

let pool: ReturnType<typeof getPool>;

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
});

afterAll(async () => {
  await pool.end();
});

describe("getConfig / setConfig", () => {
  it("returns null for a missing key", async () => {
    const v = await getConfig("nonexistent_key", pool);
    expect(v).toBeNull();
  });

  it("sets and retrieves a value", async () => {
    await setConfig("test_key", "hello", pool);
    const v = await getConfig("test_key", pool);
    expect(v).toBe("hello");
  });

  it("upserts (overwrites) an existing value", async () => {
    await setConfig("upsert_key", "first", pool);
    await setConfig("upsert_key", "second", pool);
    const v = await getConfig("upsert_key", pool);
    expect(v).toBe("second");
  });
});

describe("getBool", () => {
  it("returns the default when key is absent", async () => {
    const b = await getBool("missing_bool", true, pool);
    expect(b).toBe(true);
  });

  it("returns the default=false when key is absent", async () => {
    const b = await getBool("missing_bool_false", false, pool);
    expect(b).toBe(false);
  });

  it("returns true when stored value is 'true'", async () => {
    await setConfig("bool_true", "true", pool);
    const b = await getBool("bool_true", false, pool);
    expect(b).toBe(true);
  });

  it("returns false when stored value is not 'true'", async () => {
    await setConfig("bool_false", "false", pool);
    const b = await getBool("bool_false", true, pool);
    expect(b).toBe(false);
  });
});

describe("instanceState", () => {
  it("reports hasAnyUser=false and hasAnyTeam=false on empty DB", async () => {
    const state = await instanceState(pool);
    expect(state.hasAnyUser).toBe(false);
    expect(state.hasAnyTeam).toBe(false);
    expect(state.allowPublicSignup).toBe(false);
    expect(state.allowMultipleTeams).toBe(false);
  });

  it("has the right shape", async () => {
    const state = await instanceState(pool);
    expect(typeof state.hasAnyUser).toBe("boolean");
    expect(typeof state.hasAnyTeam).toBe("boolean");
    expect(typeof state.allowPublicSignup).toBe("boolean");
    expect(typeof state.allowMultipleTeams).toBe("boolean");
  });

  it("reports hasAnyUser=true after creating a user", async () => {
    await createUserAccount("state-user@example.com", "pass1234", null, {}, pool);
    const state = await instanceState(pool);
    expect(state.hasAnyUser).toBe(true);
  });

  it("reports hasAnyTeam=true after creating a team", async () => {
    const u = await createUserAccount("state-admin@example.com", "pass1234", null, {}, pool);
    await createTeamWithAdmin("State Test Team", u.id, pool);
    const state = await instanceState(pool);
    expect(state.hasAnyTeam).toBe(true);
  });

  it("reads allowPublicSignup from config", async () => {
    await setConfig("allow_public_signup", "true", pool);
    const state = await instanceState(pool);
    expect(state.allowPublicSignup).toBe(true);
    await setConfig("allow_public_signup", "false", pool);
  });
});

describe("canCreateTeam", () => {
  it("returns true when no team exists", async () => {
    // Start fresh
    await pool.query("DELETE FROM events");
    await pool.query("DELETE FROM daily_rollups");
    await pool.query("DELETE FROM ingest_log");
    await pool.query("DELETE FROM invites");
    await pool.query("DELETE FROM memberships");
    await pool.query("DELETE FROM sessions");
    await pool.query("DELETE FROM server_config");
    await pool.query("DELETE FROM teams");
    await pool.query("DELETE FROM user_accounts");

    const result = await canCreateTeam(pool);
    expect(result).toBe(true);
  });

  it("returns false when a team exists and allow_multiple_teams is not set", async () => {
    const u = await createUserAccount("cantcreate@example.com", "pass1234", null, {}, pool);
    await createTeamWithAdmin("Existing Team", u.id, pool);
    const result = await canCreateTeam(pool);
    expect(result).toBe(false);
  });

  it("returns true when allow_multiple_teams is set to 'true'", async () => {
    await setConfig("allow_multiple_teams", "true", pool);
    const result = await canCreateTeam(pool);
    expect(result).toBe(true);
  });
});
