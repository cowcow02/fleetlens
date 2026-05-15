import { describe, it, expect } from "vitest";
import { canSeeMember, loadManagedMemberIds, loadVisibilitySet } from "../../src/lib/visibility.js";
import { resetDb } from "../helpers/db.js";
import { createUserAccount } from "../../src/lib/auth.js";

describe("canSeeMember", () => {
  const baseViewer = { membershipId: "v1", role: "member" as const, isStaff: false };

  it("staff sees everyone", () => {
    expect(canSeeMember({ ...baseViewer, isStaff: true }, "anyone", new Set())).toBe(true);
  });
  it("admin sees everyone", () => {
    expect(canSeeMember({ ...baseViewer, role: "admin" }, "anyone", new Set())).toBe(true);
  });
  it("member sees self", () => {
    expect(canSeeMember(baseViewer, "v1", new Set())).toBe(true);
  });
  it("member cannot see others", () => {
    expect(canSeeMember(baseViewer, "other", new Set())).toBe(false);
  });
  it("manager sees members in their managed set", () => {
    expect(canSeeMember(baseViewer, "managed", new Set(["managed"]))).toBe(true);
  });
  it("manager cannot see members outside their managed set", () => {
    expect(canSeeMember(baseViewer, "outside", new Set(["managed"]))).toBe(false);
  });
});

describe("loadManagedMemberIds (integration)", () => {
  it("includes other group members but not unrelated members", async () => {
    const pool = await resetDb();
    const team = await pool.query(
      "INSERT INTO teams (slug, name) VALUES ('t1', 'Team 1') RETURNING id",
    );
    const teamId = team.rows[0].id;

    const mgr = await createUserAccount("mgr@x.com", "pw12345678", "Mgr", {}, pool);
    const m1 = await createUserAccount("m1@x.com", "pw12345678", "M1", {}, pool);
    const m2 = await createUserAccount("m2@x.com", "pw12345678", "M2", {}, pool);
    const out = await createUserAccount("out@x.com", "pw12345678", "Out", {}, pool);

    const mkMembership = async (userId: string) => {
      const r = await pool.query(
        "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1, $2, 'member') RETURNING id",
        [userId, teamId],
      );
      return r.rows[0].id;
    };
    const mgrM = await mkMembership(mgr.id);
    const m1M = await mkMembership(m1.id);
    const m2M = await mkMembership(m2.id);
    const outM = await mkMembership(out.id);

    const gRes = await pool.query(
      "INSERT INTO groups (team_id, slug, name) VALUES ($1, 'platform', 'Platform') RETURNING id",
      [teamId],
    );
    const groupId = gRes.rows[0].id;

    await pool.query(
      `INSERT INTO group_members (group_id, membership_id, is_manager) VALUES
       ($1, $2, true), ($1, $3, false), ($1, $4, false)`,
      [groupId, mgrM, m1M, m2M],
    );

    const managed = await loadManagedMemberIds(mgrM, pool);
    expect(managed.has(m1M)).toBe(true);
    expect(managed.has(m2M)).toBe(true);
    expect(managed.has(mgrM)).toBe(true);
    expect(managed.has(outM)).toBe(false);
  });

  it("excludes revoked memberships", async () => {
    const pool = await resetDb();
    const team = await pool.query("INSERT INTO teams (slug, name) VALUES ('t1','t') RETURNING id");
    const teamId = team.rows[0].id;
    const a = await createUserAccount("a@x.com", "pw12345678", null, {}, pool);
    const b = await createUserAccount("b@x.com", "pw12345678", null, {}, pool);
    const aM = (await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'member') RETURNING id",
      [a.id, teamId],
    )).rows[0].id;
    const bM = (await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role, revoked_at) VALUES ($1,$2,'member', now()) RETURNING id",
      [b.id, teamId],
    )).rows[0].id;
    const g = (await pool.query(
      "INSERT INTO groups (team_id, slug, name) VALUES ($1, 'g', 'G') RETURNING id",
      [teamId],
    )).rows[0].id;
    await pool.query(
      "INSERT INTO group_members (group_id, membership_id, is_manager) VALUES ($1,$2,true), ($1,$3,false)",
      [g, aM, bM],
    );
    const managed = await loadManagedMemberIds(aM, pool);
    expect(managed.has(bM)).toBe(false);
  });
});

describe("loadVisibilitySet (integration)", () => {
  it("returns null for staff", async () => {
    const pool = await resetDb();
    const t = await pool.query("INSERT INTO teams (slug, name) VALUES ('t','T') RETURNING id");
    const u = await createUserAccount("s@x.com", "pw12345678", null, { isStaff: true }, pool);
    const m = (await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'member') RETURNING id",
      [u.id, t.rows[0].id],
    )).rows[0].id;
    const set = await loadVisibilitySet({ membershipId: m, role: "member", isStaff: true }, pool);
    expect(set).toBeNull();
  });

  it("returns null for admin", async () => {
    const pool = await resetDb();
    const t = await pool.query("INSERT INTO teams (slug, name) VALUES ('t','T') RETURNING id");
    const u = await createUserAccount("a@x.com", "pw12345678", null, {}, pool);
    const m = (await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'admin') RETURNING id",
      [u.id, t.rows[0].id],
    )).rows[0].id;
    const set = await loadVisibilitySet({ membershipId: m, role: "admin", isStaff: false }, pool);
    expect(set).toBeNull();
  });

  it("returns just self for plain member with no managed groups", async () => {
    const pool = await resetDb();
    const t = await pool.query("INSERT INTO teams (slug, name) VALUES ('t','T') RETURNING id");
    const u = await createUserAccount("m@x.com", "pw12345678", null, {}, pool);
    const m = (await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'member') RETURNING id",
      [u.id, t.rows[0].id],
    )).rows[0].id;
    const set = await loadVisibilitySet({ membershipId: m, role: "member", isStaff: false }, pool);
    expect(set).toEqual([m]);
  });

  it("returns self + managed members for a manager", async () => {
    const pool = await resetDb();
    const t = await pool.query("INSERT INTO teams (slug, name) VALUES ('t','T') RETURNING id");
    const teamId = t.rows[0].id;
    const u1 = await createUserAccount("mgr@x.com", "pw12345678", null, {}, pool);
    const u2 = await createUserAccount("rep@x.com", "pw12345678", null, {}, pool);
    const m1 = (await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'member') RETURNING id",
      [u1.id, teamId],
    )).rows[0].id;
    const m2 = (await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'member') RETURNING id",
      [u2.id, teamId],
    )).rows[0].id;
    const g = (await pool.query(
      "INSERT INTO groups (team_id, slug, name) VALUES ($1, 'g', 'G') RETURNING id",
      [teamId],
    )).rows[0].id;
    await pool.query(
      "INSERT INTO group_members (group_id, membership_id, is_manager) VALUES ($1,$2,true), ($1,$3,false)",
      [g, m1, m2],
    );
    const set = await loadVisibilitySet({ membershipId: m1, role: "member", isStaff: false }, pool);
    expect(new Set(set)).toEqual(new Set([m1, m2]));
  });
});
