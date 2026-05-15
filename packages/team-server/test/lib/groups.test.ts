import { describe, it, expect } from "vitest";
import { resetDb } from "../helpers/db.js";
import { createUserAccount } from "../../src/lib/auth.js";
import {
  createGroup, renameGroup, deleteGroup,
  listGroupsForTeam, listGroupsManagedBy,
  addGroupMember, removeGroupMember, setGroupMemberManager,
  loadGroupBySlug,
} from "../../src/lib/groups.js";

async function seedTeamWithMembership(): Promise<{ teamId: string; userId: string; membershipId: string; pool: Awaited<ReturnType<typeof resetDb>> }> {
  const pool = await resetDb();
  const t = await pool.query("INSERT INTO teams (slug, name) VALUES ('t','T') RETURNING id");
  const teamId = t.rows[0].id;
  const u = await createUserAccount("a@x.com", "pw12345678", null, {}, pool);
  const m = await pool.query(
    "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,'admin') RETURNING id",
    [u.id, teamId],
  );
  return { teamId, userId: u.id, membershipId: m.rows[0].id, pool };
}

describe("groups library", () => {
  it("creates, renames, lists, and deletes a group", async () => {
    const { teamId, userId, pool } = await seedTeamWithMembership();
    const g = await createGroup(teamId, "platform", "Platform", userId, pool);
    expect(g.slug).toBe("platform");
    const fetched = await loadGroupBySlug(teamId, "platform", pool);
    expect(fetched?.id).toBe(g.id);
    await renameGroup(g.id, "Platform Eng", userId, pool);
    const list = await listGroupsForTeam(teamId, pool);
    expect(list[0].name).toBe("Platform Eng");
    await deleteGroup(g.id, userId, pool);
    expect((await listGroupsForTeam(teamId, pool)).length).toBe(0);
  });

  it("adds, promotes, demotes, and removes a group member", async () => {
    const { teamId, userId, membershipId, pool } = await seedTeamWithMembership();
    const g = await createGroup(teamId, "g", "G", userId, pool);
    await addGroupMember(g.id, membershipId, userId, pool);
    await setGroupMemberManager(g.id, membershipId, true, userId, pool);
    let managed = await listGroupsManagedBy(membershipId, pool);
    expect(managed.length).toBe(1);
    await setGroupMemberManager(g.id, membershipId, false, userId, pool);
    managed = await listGroupsManagedBy(membershipId, pool);
    expect(managed.length).toBe(0);
    await removeGroupMember(g.id, membershipId, userId, pool);
    managed = await listGroupsManagedBy(membershipId, pool);
    expect(managed.length).toBe(0);
  });

  it("rejects setting is_manager=true on a revoked membership", async () => {
    const { teamId, userId, membershipId, pool } = await seedTeamWithMembership();
    const g = await createGroup(teamId, "g", "G", userId, pool);
    await addGroupMember(g.id, membershipId, userId, pool);
    await pool.query("UPDATE memberships SET revoked_at = now() WHERE id = $1", [membershipId]);
    await expect(setGroupMemberManager(g.id, membershipId, true, userId, pool)).rejects.toThrow(/revoked/i);
  });

  it("rejects duplicate slug within the same team", async () => {
    const { teamId, userId, pool } = await seedTeamWithMembership();
    await createGroup(teamId, "g", "G", userId, pool);
    await expect(createGroup(teamId, "g", "G2", userId, pool)).rejects.toThrow();
  });
});

describe("groups library — audit events", () => {
  it("writes group.created / group.renamed / group.deleted with the actor", async () => {
    const { teamId, userId, pool } = await seedTeamWithMembership();
    const g = await createGroup(teamId, "platform", "Platform", userId, pool);
    await renameGroup(g.id, "Platform Eng", userId, pool);
    await deleteGroup(g.id, userId, pool);
    const events = await pool.query(
      "SELECT action, actor_id, payload FROM events WHERE action LIKE 'group.%' ORDER BY id"
    );
    expect(events.rows.map((r) => r.action)).toEqual(["group.created", "group.renamed", "group.deleted"]);
    expect(events.rows.every((r) => r.actor_id === userId)).toBe(true);
    expect(events.rows[1].payload).toMatchObject({ from: "Platform", to: "Platform Eng" });
  });

  it("does NOT write group.member.added on a duplicate add", async () => {
    const { teamId, userId, membershipId, pool } = await seedTeamWithMembership();
    const g = await createGroup(teamId, "g", "G", userId, pool);
    await addGroupMember(g.id, membershipId, userId, pool);
    await addGroupMember(g.id, membershipId, userId, pool); // no-op
    const events = await pool.query(
      "SELECT id FROM events WHERE action = 'group.member.added'"
    );
    expect(events.rowCount).toBe(1);
  });

  it("does NOT write group.member.removed when there is no row to remove", async () => {
    const { teamId, userId, pool } = await seedTeamWithMembership();
    const g = await createGroup(teamId, "g", "G", userId, pool);
    // membershipId from fixture is NOT in the group, so remove is a no-op
    const fakeMembershipId = "00000000-0000-0000-0000-000000000000";
    await removeGroupMember(g.id, fakeMembershipId, userId, pool);
    const events = await pool.query(
      "SELECT id FROM events WHERE action = 'group.member.removed'"
    );
    expect(events.rowCount).toBe(0);
  });

  it("throws when renaming or deleting a non-existent group", async () => {
    const { userId, pool } = await seedTeamWithMembership();
    const fakeId = "00000000-0000-0000-0000-000000000000";
    await expect(renameGroup(fakeId, "X", userId, pool)).rejects.toThrow(/not found/);
    await expect(deleteGroup(fakeId, userId, pool)).rejects.toThrow(/not found/);
  });
});
