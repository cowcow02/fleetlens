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
    await renameGroup(g.id, "Platform Eng", pool, userId);
    const list = await listGroupsForTeam(teamId, pool);
    expect(list[0].name).toBe("Platform Eng");
    await deleteGroup(g.id, pool, userId);
    expect((await listGroupsForTeam(teamId, pool)).length).toBe(0);
  });

  it("adds, promotes, demotes, and removes a group member", async () => {
    const { teamId, userId, membershipId, pool } = await seedTeamWithMembership();
    const g = await createGroup(teamId, "g", "G", userId, pool);
    await addGroupMember(g.id, membershipId, userId, pool);
    await setGroupMemberManager(g.id, membershipId, true, pool, userId);
    let managed = await listGroupsManagedBy(membershipId, pool);
    expect(managed.length).toBe(1);
    await setGroupMemberManager(g.id, membershipId, false, pool, userId);
    managed = await listGroupsManagedBy(membershipId, pool);
    expect(managed.length).toBe(0);
    await removeGroupMember(g.id, membershipId, pool, userId);
    managed = await listGroupsManagedBy(membershipId, pool);
    expect(managed.length).toBe(0);
  });

  it("rejects setting is_manager=true on a revoked membership", async () => {
    const { teamId, userId, membershipId, pool } = await seedTeamWithMembership();
    const g = await createGroup(teamId, "g", "G", userId, pool);
    await addGroupMember(g.id, membershipId, userId, pool);
    await pool.query("UPDATE memberships SET revoked_at = now() WHERE id = $1", [membershipId]);
    await expect(setGroupMemberManager(g.id, membershipId, true, pool, userId)).rejects.toThrow(/revoked/i);
  });

  it("rejects duplicate slug within the same team", async () => {
    const { teamId, userId, pool } = await seedTeamWithMembership();
    await createGroup(teamId, "g", "G", userId, pool);
    await expect(createGroup(teamId, "g", "G2", userId, pool)).rejects.toThrow();
  });
});
