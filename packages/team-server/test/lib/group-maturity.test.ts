import { describe, it, expect } from "vitest";
import { resetDb } from "../helpers/db.js";
import { createUserAccount } from "../../src/lib/auth.js";
import { createGroup, addGroupMember } from "../../src/lib/groups.js";
import { buildTeamInsightReport } from "../../src/lib/team-report-aggregate.js";

const WK = "2026-05-11"; // a Monday
const WK2 = "2026-05-12";

type Pool = Awaited<ReturnType<typeof resetDb>>;

async function mkMember(pool: Pool, teamId: string, label: string, role: "admin" | "member" = "member") {
  const usr = await createUserAccount(`${label}@x.com`, "pw12345678", null, {}, pool);
  const r = await pool.query(
    "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,$3) RETURNING id",
    [usr.id, teamId, role],
  );
  return { membershipId: r.rows[0].id as string, userId: usr.id as string };
}

async function richRollup(
  pool: Pool,
  teamId: string,
  membershipId: string,
  day: string,
  opts: { sessions?: number; agentMs?: number; projects?: string[]; skills?: string[] } = {},
) {
  const projects = (opts.projects ?? []).map((p) => ({ project: p, agentTimeMs: 1000, sessions: 1 }));
  const skills = (opts.skills ?? []).map((s) => ({ name: s, sessions: 1 }));
  await pool.query(
    `INSERT INTO rich_daily_rollups
       (team_id, membership_id, day, agent_time_ms, sessions, prs,
        projects, working_shapes, skills_loaded, subagents_dispatched)
     VALUES ($1,$2,$3,$4,$5,0,$6::jsonb,'[]'::jsonb,$7::jsonb,'[]'::jsonb)`,
    [teamId, membershipId, day, opts.agentMs ?? 0, opts.sessions ?? 0,
     JSON.stringify(projects), JSON.stringify(skills)],
  );
}

// Maya is an L4-coaches multiplier: she ORIGINATED a catalog skill that another
// member (Priya) adopted, but has NO recent artifact-authoring signals — so her
// L4 hinges entirely on the coaches path, which must respect group scope.
async function seedMultiplier(pool: Pool, teamId: string, mayaId: string, adopterId: string) {
  await pool.query(
    `INSERT INTO team_skill_catalog
       (team_id, path_hash, kind, originator_membership_id, originator_first_seen,
        adopter_membership_ids, loads_total)
     VALUES ($1, 'skill:hash:abc', 'skill', $2, $3, $4::uuid[], 12)`,
    [teamId, mayaId, WK, [adopterId]],
  );
}

async function setup() {
  const pool = await resetDb();
  const t = await pool.query("INSERT INTO teams (slug, name) VALUES ('t','Team T') RETURNING id");
  const teamId = t.rows[0].id as string;
  const admin = await createUserAccount("admin@x.com", "pw12345678", null, {}, pool);
  const maya = await mkMember(pool, teamId, "maya");
  const priya = await mkMember(pool, teamId, "priya");
  const bob = await mkMember(pool, teamId, "bob");

  // Maya: active but low-volume (3 sessions / 2 days) — the volume-based quick
  // classifier would grade her L1, but the portrait classifier sees coaches → L4.
  await richRollup(pool, teamId, maya.membershipId, WK, { sessions: 2, agentMs: 3_600_000, projects: ["p1"], skills: ["s1"] });
  await richRollup(pool, teamId, maya.membershipId, WK2, { sessions: 1, agentMs: 1_800_000, projects: ["p1"], skills: ["s1"] });
  await richRollup(pool, teamId, priya.membershipId, WK, { sessions: 1, agentMs: 600_000, projects: ["p1"], skills: ["s1"] });
  await richRollup(pool, teamId, bob.membershipId, WK, { sessions: 1, agentMs: 600_000, projects: ["p1"], skills: ["s1"] });

  // Maya coaches Priya (Priya adopted Maya's catalog skill).
  await seedMultiplier(pool, teamId, maya.membershipId, priya.membershipId);

  return { pool, teamId, adminId: admin.id as string, maya, priya, bob };
}

describe("per-group maturity — within-group L4 + classifier unification", () => {
  it("fires L4-coaches only when the adopter is inside the group", async () => {
    const s = await setup();
    const ctx = { teamSlug: "t", teamName: "Team T", membersTotal: 2 };

    // Group IN: Maya + Priya — the adopter is in-group, so coaches fires.
    const gIn = await createGroup(s.teamId, "in", "In", s.adminId, s.pool);
    await addGroupMember(gIn.id, s.maya.membershipId, s.adminId, s.pool);
    await addGroupMember(gIn.id, s.priya.membershipId, s.adminId, s.pool);

    // Group OUT: Maya + Bob — the only adopter (Priya) is NOT in this group.
    const gOut = await createGroup(s.teamId, "out", "Out", s.adminId, s.pool);
    await addGroupMember(gOut.id, s.maya.membershipId, s.adminId, s.pool);
    await addGroupMember(gOut.id, s.bob.membershipId, s.adminId, s.pool);

    const repIn = await buildTeamInsightReport(s.teamId, { kind: "group", groupId: gIn.id }, s.pool, ctx, WK);
    const repOut = await buildTeamInsightReport(s.teamId, { kind: "group", groupId: gOut.id }, s.pool, ctx, WK);

    const mayaIn = repIn.live_extras!.member_portraits!.find((p) => p.member === "maya")!;
    const mayaOut = repOut.live_extras!.member_portraits!.find((p) => p.member === "maya")!;

    expect(mayaIn.level).toBe("L4");
    expect(mayaIn.qualifying_paths).toContain("L4-coaches");
    expect(mayaIn.harness.cross_member_adopters_30d).toBe(1);

    // Out-of-group adopter must not count: with no recent authored artifacts and
    // no in-group adoption, Maya is no longer L4.
    expect(mayaOut.harness.cross_member_adopters_30d).toBe(0);
    expect(mayaOut.level).not.toBe("L4");
  });

  it("aggregate maturity_mix derives from portrait levels (volume excluded)", async () => {
    const s = await setup();
    const ctx = { teamSlug: "t", teamName: "Team T", membersTotal: 2 };
    const g = await createGroup(s.teamId, "in", "In", s.adminId, s.pool);
    await addGroupMember(g.id, s.maya.membershipId, s.adminId, s.pool);
    await addGroupMember(g.id, s.priya.membershipId, s.adminId, s.pool);

    const rep = await buildTeamInsightReport(s.teamId, { kind: "group", groupId: g.id }, s.pool, ctx, WK);
    const mix = rep.live_extras!.maturity_mix;
    const portraits = rep.live_extras!.member_portraits!;

    // The aggregate distribution and the per-member portraits must agree on
    // every member's level — one classifier, no volume-based divergence.
    for (const c of mix.classifications) {
      const p = portraits.find((x) => x.member === c.member)!;
      expect(c.level).toBe(p.level);
    }
    const mayaMix = mix.classifications.find((c) => c.member === "maya")!;
    expect(mayaMix.level).toBe("L4");
    expect(mix.distribution.L4).toBe(1);
  });
});
