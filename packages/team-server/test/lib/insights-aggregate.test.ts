import { describe, it, expect } from "vitest";
import { resetDb } from "../helpers/db.js";
import { createUserAccount } from "../../src/lib/auth.js";
import { addGroupMember, createGroup } from "../../src/lib/groups.js";
import {
  isoMondayOf,
  perProjectTimeWoW,
  previousIsoMonday,
  skillUsageWeek,
  teamPulseWeek,
  visibleMembershipIds,
  workingShapeDistribution,
} from "../../src/lib/insights-aggregate.js";

async function seed(): Promise<{
  pool: Awaited<ReturnType<typeof resetDb>>;
  teamId: string;
  alice: string;
  bob: string;
  carol: string;
  userId: string;
}> {
  const pool = await resetDb();
  const t = await pool.query("INSERT INTO teams (slug, name) VALUES ('t','Team T') RETURNING id");
  const teamId = t.rows[0].id;
  const u = await createUserAccount("admin@x.com", "pw12345678", null, {}, pool);
  const mk = async (label: string, role: "admin" | "member" = "member") => {
    const usr = await createUserAccount(`${label}@x.com`, "pw12345678", null, {}, pool);
    const r = await pool.query(
      "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1,$2,$3) RETURNING id",
      [usr.id, teamId, role],
    );
    return r.rows[0].id;
  };
  const alice = await mk("alice");
  const bob = await mk("bob");
  const carol = await mk("carol");
  return { pool, teamId, alice, bob, carol, userId: u.id };
}

async function insertRichRollup(
  pool: Awaited<ReturnType<typeof resetDb>>,
  teamId: string,
  membershipId: string,
  day: string,
  patch: Partial<{
    agentTimeMs: number;
    sessions: number;
    prs: number;
    concurrencyPeak: number;
    parallelMinutes: number;
    projects: Array<{ project: string; agentTimeMs: number; sessions: number }>;
    skills: Array<{ name: string; sessions: number }>;
    shapes: Array<{ shape: string; sessions: number; agentTimeMs: number }>;
  }>,
): Promise<void> {
  const r = {
    agentTimeMs: 0,
    sessions: 0,
    prs: 0,
    concurrencyPeak: 0,
    parallelMinutes: 0,
    projects: [] as Array<{ project: string; agentTimeMs: number; sessions: number }>,
    skills: [] as Array<{ name: string; sessions: number }>,
    shapes: [] as Array<{ shape: string; sessions: number; agentTimeMs: number }>,
    ...patch,
  };
  await pool.query(
    `INSERT INTO rich_daily_rollups (
      team_id, membership_id, day,
      agent_time_ms, sessions, prs,
      concurrency_peak, parallel_minutes,
      projects, working_shapes, skills_loaded, subagents_dispatched
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'[]'::jsonb)`,
    [
      teamId, membershipId, day,
      r.agentTimeMs, r.sessions, r.prs,
      r.concurrencyPeak, r.parallelMinutes,
      JSON.stringify(r.projects),
      JSON.stringify(r.shapes),
      JSON.stringify(r.skills),
    ],
  );
}

describe("insights-aggregate · week math", () => {
  it("isoMondayOf rolls Sunday back to the previous Monday", () => {
    expect(isoMondayOf(new Date("2026-05-17T12:00:00Z"))).toBe("2026-05-11");
    expect(isoMondayOf(new Date("2026-05-11T00:00:00Z"))).toBe("2026-05-11");
    expect(isoMondayOf(new Date("2026-05-16T23:59:00Z"))).toBe("2026-05-11");
  });

  it("previousIsoMonday steps back exactly 7 days", () => {
    expect(previousIsoMonday("2026-05-11")).toBe("2026-05-04");
  });
});

describe("visibleMembershipIds", () => {
  it("team-wide returns every non-revoked membership", async () => {
    const s = await seed();
    const ids = await visibleMembershipIds(s.teamId, { kind: "team-wide" }, s.pool);
    expect(ids.sort()).toEqual([s.alice, s.bob, s.carol].sort());
  });

  it("excludes revoked memberships", async () => {
    const s = await seed();
    await s.pool.query("UPDATE memberships SET revoked_at = now() WHERE id = $1", [s.carol]);
    const ids = await visibleMembershipIds(s.teamId, { kind: "team-wide" }, s.pool);
    expect(ids).not.toContain(s.carol);
  });

  it("group-scoped returns only the group's roster", async () => {
    const s = await seed();
    const g = await createGroup(s.teamId, "platform", "Platform", s.userId, s.pool);
    await addGroupMember(g.id, s.alice, s.userId, s.pool);
    await addGroupMember(g.id, s.bob, s.userId, s.pool);
    const ids = await visibleMembershipIds(s.teamId, { kind: "group", groupId: g.id }, s.pool);
    expect(ids.sort()).toEqual([s.alice, s.bob].sort());
  });
});

describe("teamPulseWeek", () => {
  it("sums hours, sessions, PRs against previous week", async () => {
    const s = await seed();
    const thisWk = "2026-05-11";
    const lastWk = "2026-05-04";
    await insertRichRollup(s.pool, s.teamId, s.alice, thisWk, {
      agentTimeMs: 3_600_000, sessions: 3, prs: 1, concurrencyPeak: 2, parallelMinutes: 30,
    });
    await insertRichRollup(s.pool, s.teamId, s.bob, thisWk, {
      agentTimeMs: 7_200_000, sessions: 5, prs: 2, concurrencyPeak: 4, parallelMinutes: 90,
    });
    await insertRichRollup(s.pool, s.teamId, s.alice, lastWk, {
      agentTimeMs: 1_800_000, sessions: 2, prs: 0,
    });

    const pulse = await teamPulseWeek(s.teamId, { kind: "team-wide" }, thisWk, s.pool);
    expect(pulse.membersActive).toBe(2);
    expect(pulse.agentHours).toBeCloseTo(3, 5);
    expect(pulse.agentHoursPrev).toBeCloseTo(0.5, 5);
    expect(pulse.sessions).toBe(8);
    expect(pulse.sessionsPrev).toBe(2);
    expect(pulse.prs).toBe(3);
    expect(pulse.concurrencyPeak).toBe(4);
    expect(pulse.parallelHours).toBeCloseTo(2, 5);
  });

  it("group-scoped pulse ignores members outside the group", async () => {
    const s = await seed();
    const g = await createGroup(s.teamId, "platform", "Platform", s.userId, s.pool);
    await addGroupMember(g.id, s.alice, s.userId, s.pool);

    const thisWk = "2026-05-11";
    await insertRichRollup(s.pool, s.teamId, s.alice, thisWk, { agentTimeMs: 3_600_000, sessions: 1 });
    await insertRichRollup(s.pool, s.teamId, s.bob, thisWk, { agentTimeMs: 7_200_000, sessions: 5 });

    const pulse = await teamPulseWeek(s.teamId, { kind: "group", groupId: g.id }, thisWk, s.pool);
    expect(pulse.sessions).toBe(1);
    expect(pulse.agentHours).toBeCloseTo(1, 5);
  });

  it("returns an empty pulse when no members are visible", async () => {
    const s = await seed();
    const g = await createGroup(s.teamId, "empty", "Empty", s.userId, s.pool);
    const pulse = await teamPulseWeek(s.teamId, { kind: "group", groupId: g.id }, "2026-05-11", s.pool);
    expect(pulse.membersActive).toBe(0);
    expect(pulse.agentHours).toBe(0);
  });
});

describe("perProjectTimeWoW", () => {
  it("aggregates JSONB project breakdowns and computes WoW", async () => {
    const s = await seed();
    const thisWk = "2026-05-11";
    const lastWk = "2026-05-04";
    await insertRichRollup(s.pool, s.teamId, s.alice, thisWk, {
      projects: [
        { project: "fleetlens", agentTimeMs: 3_600_000, sessions: 4 },
        { project: "topeka", agentTimeMs: 1_800_000, sessions: 1 },
      ],
    });
    await insertRichRollup(s.pool, s.teamId, s.bob, thisWk, {
      projects: [{ project: "fleetlens", agentTimeMs: 7_200_000, sessions: 6 }],
    });
    await insertRichRollup(s.pool, s.teamId, s.alice, lastWk, {
      projects: [{ project: "fleetlens", agentTimeMs: 1_800_000, sessions: 2 }],
    });

    const rows = await perProjectTimeWoW(s.teamId, { kind: "team-wide" }, thisWk, s.pool);
    const fleetlens = rows.find((r) => r.project === "fleetlens");
    expect(fleetlens?.agentHours).toBeCloseTo(3, 5);
    expect(fleetlens?.agentHoursPrev).toBeCloseTo(0.5, 5);
    expect(fleetlens?.sessions).toBe(10);
    expect(rows[0]?.project).toBe("fleetlens"); // sorted by hours desc
  });
});

describe("skillUsageWeek", () => {
  it("aggregates JSONB skill counts WoW", async () => {
    const s = await seed();
    const thisWk = "2026-05-11";
    const lastWk = "2026-05-04";
    await insertRichRollup(s.pool, s.teamId, s.alice, thisWk, {
      skills: [
        { name: "brainstorming", sessions: 3 },
        { name: "writing-plans", sessions: 1 },
      ],
    });
    await insertRichRollup(s.pool, s.teamId, s.bob, lastWk, {
      skills: [{ name: "brainstorming", sessions: 2 }],
    });

    const rows = await skillUsageWeek(s.teamId, { kind: "team-wide" }, thisWk, s.pool);
    const brainstorm = rows.find((r) => r.skill === "brainstorming");
    expect(brainstorm?.sessions).toBe(3);
    expect(brainstorm?.sessionsPrev).toBe(2);
  });
});

describe("workingShapeDistribution", () => {
  it("sums shape sessions and hours within the week window", async () => {
    const s = await seed();
    const thisWk = "2026-05-11";
    await insertRichRollup(s.pool, s.teamId, s.alice, thisWk, {
      shapes: [
        { shape: "solo-build", sessions: 4, agentTimeMs: 3_600_000 },
        { shape: "reviewer-triad", sessions: 1, agentTimeMs: 1_800_000 },
      ],
    });
    await insertRichRollup(s.pool, s.teamId, s.bob, thisWk, {
      shapes: [{ shape: "solo-build", sessions: 2, agentTimeMs: 1_800_000 }],
    });

    const rows = await workingShapeDistribution(s.teamId, { kind: "team-wide" }, thisWk, s.pool);
    const solo = rows.find((r) => r.shape === "solo-build");
    expect(solo?.sessions).toBe(6);
    expect(solo?.agentHours).toBeCloseTo(1.5, 5);
    expect(rows[0]?.shape).toBe("solo-build"); // sorted by sessions
  });
});
