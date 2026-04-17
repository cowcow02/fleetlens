import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getPool } from "../../src/db/pool.js";
import { runMigrations } from "../../src/db/migrate.js";
import { slugify, uniqueSlug, createTeamWithAdmin } from "../../src/lib/teams.js";
import { createUserAccount } from "../../src/lib/auth.js";

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

describe("slugify", () => {
  it("lowercases input", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("replaces non-alphanumeric runs with a single dash", () => {
    expect(slugify("Foo  Bar--Baz")).toBe("foo-bar-baz");
  });

  it("strips leading and trailing dashes", () => {
    expect(slugify("---foo---")).toBe("foo");
  });

  it("returns 'team' for empty-ish input (all special chars)", () => {
    expect(slugify("!!!")).toBe("team");
  });

  it("preserves numbers", () => {
    expect(slugify("Team 42")).toBe("team-42");
  });

  it("handles already-slugified string", () => {
    expect(slugify("my-team")).toBe("my-team");
  });
});

describe("uniqueSlug", () => {
  it("returns base slug when no collision exists", async () => {
    const slug = await uniqueSlug("Unique Team", pool);
    expect(slug).toBe("unique-team");
  });

  it("appends random suffix on collision", async () => {
    // Create a team so the slug is taken
    const u = await createUserAccount("slug-owner@example.com", "pass1234", null, {}, pool);
    await createTeamWithAdmin("Collision Team", u.id, pool);
    // slugify("Collision Team") === "collision-team"
    const slug = await uniqueSlug("Collision Team", pool);
    expect(slug).toMatch(/^collision-team-.+/);
    expect(slug).not.toBe("collision-team");
  });
});

describe("createTeamWithAdmin", () => {
  it("returns team with id, slug, and name", async () => {
    const u = await createUserAccount("admin@myteam.com", "pass1234", null, {}, pool);
    const { team } = await createTeamWithAdmin("My Team", u.id, pool);
    expect(team.id).toBeTruthy();
    expect(team.slug).toBe("my-team");
    expect(team.name).toBe("My Team");
  });

  it("creates an admin membership with a bearer token", async () => {
    const u = await createUserAccount("admin2@myteam.com", "pass1234", null, {}, pool);
    const { membership } = await createTeamWithAdmin("My Team 2", u.id, pool);
    expect(membership.id).toBeTruthy();
    expect(membership.bearerToken).toMatch(/^bt_/);

    const row = await pool.query(
      "SELECT role FROM memberships WHERE id = $1",
      [membership.id]
    );
    expect(row.rows[0].role).toBe("admin");
  });

  it("writes a team.create events row", async () => {
    const u = await createUserAccount("admin3@myteam.com", "pass1234", null, {}, pool);
    const { team } = await createTeamWithAdmin("Event Team", u.id, pool);
    const evRes = await pool.query(
      "SELECT action FROM events WHERE team_id = $1 AND action = 'team.create'",
      [team.id]
    );
    expect(evRes.rowCount).toBe(1);
  });
});
