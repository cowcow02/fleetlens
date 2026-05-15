import { describe, it, expect } from "vitest";
import { resetDb } from "../helpers/db.js";
import { createUserAccount } from "../../src/lib/auth.js";
import { createGroup, addGroupMember } from "../../src/lib/groups.js";
import { loadRoster, loadGroupRoster, loadMemberGroupAffiliations } from "../../src/lib/queries.js";

describe("loadRoster", () => {
  it("returns the full team roster (no filter)", async () => {
    const pool = await resetDb();
    const t = await pool.query("INSERT INTO teams (slug, name) VALUES ('t','T') RETURNING id");
    const teamId = t.rows[0].id;
    const u1 = await createUserAccount("a@x.com", "pw12345678", null, {}, pool);
    const u2 = await createUserAccount("b@x.com", "pw12345678", null, {}, pool);
    await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'admin'),($3,$2,'member')",
      [u1.id, teamId, u2.id],
    );
    const rows = await loadRoster(teamId, pool);
    expect(rows.length).toBe(2);
  });
});

describe("loadGroupRoster", () => {
  it("returns only memberships in the given group", async () => {
    const pool = await resetDb();
    const t = await pool.query("INSERT INTO teams (slug, name) VALUES ('t','T') RETURNING id");
    const teamId = t.rows[0].id;
    const u1 = await createUserAccount("in@x.com", "pw12345678", null, {}, pool);
    const u2 = await createUserAccount("out@x.com", "pw12345678", null, {}, pool);
    const m1 = (await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'member') RETURNING id",
      [u1.id, teamId],
    )).rows[0].id;
    const m2 = (await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'member') RETURNING id",
      [u2.id, teamId],
    )).rows[0].id;
    const g = await createGroup(teamId, "g", "G", u1.id, pool);
    await addGroupMember(g.id, m1, u1.id, pool);
    const rows = await loadGroupRoster(g.id, pool);
    expect(rows.map((r) => r.id)).toEqual([m1]);
    expect(rows.map((r) => r.id)).not.toContain(m2);
  });

  it("excludes revoked memberships", async () => {
    const pool = await resetDb();
    const t = await pool.query("INSERT INTO teams (slug, name) VALUES ('t','T') RETURNING id");
    const teamId = t.rows[0].id;
    const u1 = await createUserAccount("a@x.com", "pw12345678", null, {}, pool);
    const u2 = await createUserAccount("b@x.com", "pw12345678", null, {}, pool);
    const m1 = (await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'member') RETURNING id",
      [u1.id, teamId],
    )).rows[0].id;
    const m2 = (await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role, revoked_at) VALUES ($1,$2,'member', now()) RETURNING id",
      [u2.id, teamId],
    )).rows[0].id;
    const g = await createGroup(teamId, "g", "G", u1.id, pool);
    await addGroupMember(g.id, m1, u1.id, pool);
    await addGroupMember(g.id, m2, u1.id, pool);
    const rows = await loadGroupRoster(g.id, pool);
    expect(rows.map((r) => r.id)).toEqual([m1]);
  });

  it("orders managers first, then by last_seen_at desc", async () => {
    const pool = await resetDb();
    const t = await pool.query("INSERT INTO teams (slug, name) VALUES ('t','T') RETURNING id");
    const teamId = t.rows[0].id;
    const u1 = await createUserAccount("mgr@x.com", "pw12345678", null, {}, pool);
    const u2 = await createUserAccount("a@x.com", "pw12345678", null, {}, pool);
    const u3 = await createUserAccount("b@x.com", "pw12345678", null, {}, pool);
    const m1 = (await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role, last_seen_at) VALUES ($1,$2,'member', '2026-05-01 10:00') RETURNING id",
      [u1.id, teamId],
    )).rows[0].id;
    const m2 = (await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role, last_seen_at) VALUES ($1,$2,'member', '2026-05-15 10:00') RETURNING id",
      [u2.id, teamId],
    )).rows[0].id;
    const m3 = (await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role, last_seen_at) VALUES ($1,$2,'member', '2026-05-10 10:00') RETURNING id",
      [u3.id, teamId],
    )).rows[0].id;
    const g = await createGroup(teamId, "g", "G", u1.id, pool);
    await addGroupMember(g.id, m1, u1.id, pool, { isManager: true });
    await addGroupMember(g.id, m2, u1.id, pool);
    await addGroupMember(g.id, m3, u1.id, pool);
    const rows = await loadGroupRoster(g.id, pool);
    expect(rows.map((r) => r.id)).toEqual([m1, m2, m3]);
  });
});

describe("loadMemberGroupAffiliations", () => {
  it("returns an empty Map when there are no group_members rows", async () => {
    const pool = await resetDb();
    const t = await pool.query("INSERT INTO teams (slug, name) VALUES ('t','T') RETURNING id");
    const map = await loadMemberGroupAffiliations(t.rows[0].id, pool);
    expect(map.size).toBe(0);
  });

  it("groups multiple group memberships under one membership_id and surfaces isManager", async () => {
    const pool = await resetDb();
    const t = await pool.query("INSERT INTO teams (slug, name) VALUES ('t','T') RETURNING id");
    const teamId = t.rows[0].id;
    const u = await createUserAccount("a@x.com", "pw12345678", null, {}, pool);
    const m = (await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'member') RETURNING id",
      [u.id, teamId],
    )).rows[0].id;
    const g1 = await createGroup(teamId, "platform", "Platform", u.id, pool);
    const g2 = await createGroup(teamId, "growth", "Growth", u.id, pool);
    await addGroupMember(g1.id, m, u.id, pool, { isManager: true });
    await addGroupMember(g2.id, m, u.id, pool);
    const map = await loadMemberGroupAffiliations(teamId, pool);
    const affs = map.get(m);
    expect(affs).toBeDefined();
    expect(affs!.length).toBe(2);
    const platform = affs!.find((a) => a.slug === "platform");
    const growth = affs!.find((a) => a.slug === "growth");
    expect(platform?.isManager).toBe(true);
    expect(growth?.isManager).toBe(false);
  });

  it("still surfaces revoked memberships — filtering belongs to the visibility predicate, not this loader", async () => {
    const pool = await resetDb();
    const t = await pool.query("INSERT INTO teams (slug, name) VALUES ('t','T') RETURNING id");
    const teamId = t.rows[0].id;
    const u = await createUserAccount("a@x.com", "pw12345678", null, {}, pool);
    const m = (await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role, revoked_at) VALUES ($1,$2,'member', now()) RETURNING id",
      [u.id, teamId],
    )).rows[0].id;
    const g = await createGroup(teamId, "g", "G", u.id, pool);
    await addGroupMember(g.id, m, u.id, pool);
    const map = await loadMemberGroupAffiliations(teamId, pool);
    expect(map.get(m)?.length).toBe(1);
  });
});
