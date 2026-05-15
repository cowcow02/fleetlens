import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resetDb } from "../helpers/db.js";
import { getPool } from "../../src/db/pool.js";
import { createUserAccount, createSession, validateSession } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";
import { createInvite, redeemInvite } from "../../src/lib/members.js";
import { createGroup, addGroupMember } from "../../src/lib/groups.js";
import { canSeeMember, loadManagedMemberIds } from "../../src/lib/visibility.js";

/**
 * Page-shaped visibility tests for the member detail page guard.
 *
 * The page (apps/team-server/src/app/team/[slug]/members/[id]/page.tsx) wraps
 *   const managed = await loadManagedMemberIds(viewer.membershipId, pool);
 *   if (!canSeeMember(viewer, id, managed)) notFound();
 *
 * Calling the page directly is awkward (cookies() / notFound() rely on a Next
 * request context that doesn't exist in a vitest worker). Instead we exercise
 * the exact two building blocks the guard calls, against real DB fixtures,
 * with the same shape: viewer derived from the session row, target = some
 * other membership id in the same team.
 *
 * 404 vs allowed shows up as `canSeeMember(...) === false` vs `true`.
 */

let pool: ReturnType<typeof getPool>;

beforeAll(async () => {
  pool = await resetDb();
});

afterAll(async () => {
  await pool.end();
});

async function resolveViewer(cookieToken: string, teamId: string) {
  const ctx = await validateSession(cookieToken, pool);
  if (!ctx) throw new Error("session missing");
  const my = ctx.memberships.find((m) => m.team_id === teamId);
  if (!my) throw new Error("membership missing");
  return {
    viewer: { membershipId: my.id, role: my.role, isStaff: ctx.user.is_staff },
    membership: my,
  };
}

describe("member detail page visibility guard", () => {
  it("manager can see a member in the group they manage", async () => {
    const admin = await createUserAccount("vis-admin-a@example.com", "pw12345678", "Admin", {}, pool);
    const { team } = await createTeamWithAdmin("Vis Team A", admin.id, pool);

    const mgrUser = await createUserAccount("vis-mgr-a@example.com", "pw12345678", "Mgr", {}, pool);
    const tgtUser = await createUserAccount("vis-tgt-a@example.com", "pw12345678", "Target", {}, pool);
    const inv1 = await createInvite(team.id, admin.id, {}, pool);
    const mgrM = (await redeemInvite(inv1.token, mgrUser.id, pool))!.membershipId;
    const inv2 = await createInvite(team.id, admin.id, {}, pool);
    const tgtM = (await redeemInvite(inv2.token, tgtUser.id, pool))!.membershipId;

    const group = await createGroup(team.id, "managed-grp", "Managed", admin.id, pool);
    await addGroupMember(group.id, mgrM, admin.id, pool, { isManager: true });
    await addGroupMember(group.id, tgtM, admin.id, pool);

    const mgrSess = await createSession(mgrUser.id, pool);
    const { viewer } = await resolveViewer(mgrSess.cookieToken, team.id);
    const managed = await loadManagedMemberIds(viewer.membershipId, pool);

    expect(viewer.role).toBe("member");
    expect(canSeeMember(viewer, tgtM, managed)).toBe(true);
  });

  it("plain member cannot see another plain member in the same team", async () => {
    const admin = await createUserAccount("vis-admin-b@example.com", "pw12345678", "Admin", {}, pool);
    const { team } = await createTeamWithAdmin("Vis Team B", admin.id, pool);

    const aUser = await createUserAccount("vis-a@example.com", "pw12345678", "A", {}, pool);
    const bUser = await createUserAccount("vis-b@example.com", "pw12345678", "B", {}, pool);
    const inv1 = await createInvite(team.id, admin.id, {}, pool);
    const aM = (await redeemInvite(inv1.token, aUser.id, pool))!.membershipId;
    const inv2 = await createInvite(team.id, admin.id, {}, pool);
    const bM = (await redeemInvite(inv2.token, bUser.id, pool))!.membershipId;

    const sess = await createSession(aUser.id, pool);
    const { viewer } = await resolveViewer(sess.cookieToken, team.id);
    const managed = await loadManagedMemberIds(viewer.membershipId, pool);

    expect(canSeeMember(viewer, bM, managed)).toBe(false);
    // Self is always visible — sanity check the predicate's other branches.
    expect(canSeeMember(viewer, aM, managed)).toBe(true);
  });

  it("manager of group A cannot see a member of group B they don't manage", async () => {
    const admin = await createUserAccount("vis-admin-c@example.com", "pw12345678", "Admin", {}, pool);
    const { team } = await createTeamWithAdmin("Vis Team C", admin.id, pool);

    const mgrAUser = await createUserAccount("vis-mgr-c-a@example.com", "pw12345678", "MgrA", {}, pool);
    const memAUser = await createUserAccount("vis-mem-c-a@example.com", "pw12345678", "MemA", {}, pool);
    const mgrBUser = await createUserAccount("vis-mgr-c-b@example.com", "pw12345678", "MgrB", {}, pool);
    const memBUser = await createUserAccount("vis-mem-c-b@example.com", "pw12345678", "MemB", {}, pool);

    const newMembership = async (uid: string) => {
      const inv = await createInvite(team.id, admin.id, {}, pool);
      return (await redeemInvite(inv.token, uid, pool))!.membershipId;
    };
    const mgrAM = await newMembership(mgrAUser.id);
    const memAM = await newMembership(memAUser.id);
    const mgrBM = await newMembership(mgrBUser.id);
    const memBM = await newMembership(memBUser.id);

    const gA = await createGroup(team.id, "grp-a", "Group A", admin.id, pool);
    const gB = await createGroup(team.id, "grp-b", "Group B", admin.id, pool);
    await addGroupMember(gA.id, mgrAM, admin.id, pool, { isManager: true });
    await addGroupMember(gA.id, memAM, admin.id, pool);
    await addGroupMember(gB.id, mgrBM, admin.id, pool, { isManager: true });
    await addGroupMember(gB.id, memBM, admin.id, pool);

    const sess = await createSession(mgrAUser.id, pool);
    const { viewer } = await resolveViewer(sess.cookieToken, team.id);
    const managed = await loadManagedMemberIds(viewer.membershipId, pool);

    // Manager A sees their own group's members but not Group B's members.
    expect(canSeeMember(viewer, memAM, managed)).toBe(true);
    expect(canSeeMember(viewer, memBM, managed)).toBe(false);
    expect(canSeeMember(viewer, mgrBM, managed)).toBe(false);
  });

  it("admin viewer sees any member in the team (no managed-set needed)", async () => {
    const admin = await createUserAccount("vis-admin-d@example.com", "pw12345678", "Admin", {}, pool);
    const { team } = await createTeamWithAdmin("Vis Team D", admin.id, pool);
    const memUser = await createUserAccount("vis-mem-d@example.com", "pw12345678", "Mem", {}, pool);
    const inv = await createInvite(team.id, admin.id, {}, pool);
    const memM = (await redeemInvite(inv.token, memUser.id, pool))!.membershipId;

    const sess = await createSession(admin.id, pool);
    const { viewer } = await resolveViewer(sess.cookieToken, team.id);
    const managed = await loadManagedMemberIds(viewer.membershipId, pool);

    expect(viewer.role).toBe("admin");
    expect(canSeeMember(viewer, memM, managed)).toBe(true);
  });
});
