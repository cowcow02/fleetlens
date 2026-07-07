import { describe, it, expect } from "vitest";
import { resetDb } from "../helpers/db.js";
import { createUserAccount } from "../../src/lib/auth.js";
import { addGroupMember, createGroup } from "../../src/lib/groups.js";
import {
  groupMomentumTrend,
  isoMondayOf,
  perProjectTimeWoW,
  previousIsoMonday,
  nextIsoMonday,
  resolveWeekMonday,
  skillUsageWeek,
  teamPulseWeek,
  earliestWeekMonday,
  visibleMembershipIds,
  workingShapeDistribution,
} from "../../src/lib/insights-aggregate.js";
import { buildTeamInsightReport } from "../../src/lib/team-report-aggregate.js";

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

// daily_rollups is the base superset every push writes; rich_daily_rollups is
// only written when the member's perception entries existed at push time. A
// freshly-paired member whose backfill carried no rich blocks lands here with
// base-only rows and must still count as active in the aggregates.
async function insertBaseRollup(
  pool: Awaited<ReturnType<typeof resetDb>>,
  teamId: string,
  membershipId: string,
  day: string,
  patch: Partial<{ agentTimeMs: number; sessions: number }> = {},
): Promise<void> {
  const r = { agentTimeMs: 0, sessions: 0, ...patch };
  await pool.query(
    `INSERT INTO daily_rollups (team_id, membership_id, day, agent_time_ms, sessions)
     VALUES ($1,$2,$3,$4,$5)`,
    [teamId, membershipId, day, r.agentTimeMs, r.sessions],
  );
}

describe("daily-only (backfill) member visibility", () => {
  // Alice pushed only base daily_rollups (no rich); Bob pushed both (the prod
  // state — rich always implies a matching daily row for the same day). The
  // FULL OUTER JOIN must count Alice and must NOT double-count Bob.
  const thisWk = "2026-05-11";

  async function seedMixed() {
    const s = await seed();
    // Alice — backfill-only: daily_rollups only.
    await insertBaseRollup(s.pool, s.teamId, s.alice, thisWk, { agentTimeMs: 3_600_000, sessions: 3 });
    // Bob — normal: matching daily + rich rows for the same day.
    await insertBaseRollup(s.pool, s.teamId, s.bob, thisWk, { agentTimeMs: 7_200_000, sessions: 5 });
    await insertRichRollup(s.pool, s.teamId, s.bob, thisWk, {
      agentTimeMs: 7_200_000, sessions: 5, prs: 2, concurrencyPeak: 3,
    });
    return s;
  }

  it("teamPulseWeek counts the daily-only member with combined agent time (no double count)", async () => {
    const s = await seedMixed();
    const pulse = await teamPulseWeek(s.teamId, { kind: "team-wide" }, thisWk, s.pool);
    expect(pulse.membersActive).toBe(2); // Alice (daily-only) + Bob
    expect(pulse.agentHours).toBeCloseTo(3, 5); // (3.6M + 7.2M) ms — Bob counted once
    expect(pulse.sessions).toBe(8);
    expect(pulse.prs).toBe(2); // rich-only, from Bob
  });

  it("groupMomentumTrend's activeMembers includes the daily-only member", async () => {
    const s = await seedMixed();
    const g = await createGroup(s.teamId, "platform", "Platform", s.userId, s.pool);
    await addGroupMember(g.id, s.alice, s.userId, s.pool);
    await addGroupMember(g.id, s.bob, s.userId, s.pool);

    const trend = await groupMomentumTrend(s.teamId, { kind: "group", groupId: g.id }, thisWk, s.pool, 4);
    const wk = trend[trend.length - 1];
    expect(wk.weekMonday).toBe(thisWk);
    expect(wk.activeMembers).toBe(2); // daily-only Alice included
    expect(wk.agentHours).toBeCloseTo(3, 5);
    expect(wk.sessions).toBe(8);
    expect(wk.prs).toBe(2);
  });

  it("buildTeamInsightReport counts the daily-only member as active", async () => {
    const s = await seedMixed();
    const ctx = { teamSlug: "t", teamName: "Team T", membersTotal: 3 };
    const rep = await buildTeamInsightReport(s.teamId, { kind: "team-wide" }, s.pool, ctx, thisWk);

    // Alice (daily-only) + Bob active; Carol (no rows) inactive.
    expect(rep.live_extras?.active_rate.active_7d).toBe(2);
    expect(rep.live_extras?.active_rate.members_total).toBe(3);
    expect(rep.volume.agent_hours_total).toBeCloseTo(3, 5);
    expect(rep.outcomes.prs_shipped).toBe(2);
    // Alice must appear in the roster with her daily-only agent time.
    const aliceRow = rep.cross_edition.roster.find((r) => r.membership_id === s.alice);
    expect(aliceRow?.agent_hours).toBeCloseTo(1, 5); // 3.6M ms
    // Alice is not L0 — she has real activity from daily_rollups alone.
    const alicePortrait = rep.live_extras?.member_portraits.find((p) => p.member === "alice");
    expect(alicePortrait?.level).not.toBe("L0");
  });
});

describe("insights-aggregate · week math", () => {
  it("isoMondayOf rolls Sunday back to the previous Monday", () => {
    expect(isoMondayOf(new Date("2026-05-17T12:00:00Z"))).toBe("2026-05-11");
    expect(isoMondayOf(new Date("2026-05-11T00:00:00Z"))).toBe("2026-05-11");
    expect(isoMondayOf(new Date("2026-05-16T23:59:00Z"))).toBe("2026-05-11");
  });

  it("previousIsoMonday steps back exactly 7 days", () => {
    expect(previousIsoMonday("2026-05-11")).toBe("2026-05-04");
  });

  it("nextIsoMonday steps forward exactly 7 days", () => {
    expect(nextIsoMonday("2026-05-11")).toBe("2026-05-18");
    expect(nextIsoMonday(previousIsoMonday("2026-05-11"))).toBe("2026-05-11");
  });

  it("resolveWeekMonday clamps to the last completed week and rejects non-Mondays", () => {
    const now = new Date("2026-05-20T12:00:00Z"); // a Wednesday
    const last = "2026-05-11"; // last completed week's Monday
    // Valid past Monday passes through.
    expect(resolveWeekMonday("2026-05-04", now)).toBe("2026-05-04");
    // The current (in-progress) week and any future week clamp to last completed.
    expect(resolveWeekMonday("2026-05-18", now)).toBe(last);
    expect(resolveWeekMonday("2026-06-01", now)).toBe(last);
    // Non-Monday, malformed, and blank all fall back to last completed.
    expect(resolveWeekMonday("2026-05-13", now)).toBe(last); // a Wednesday
    expect(resolveWeekMonday("not-a-date", now)).toBe(last);
    expect(resolveWeekMonday(undefined, now)).toBe(last);
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

describe("groupMomentumTrend", () => {
  it("buckets the group's last 4 weeks oldest→newest, zero-filling empty weeks", async () => {
    const s = await seed();
    const g = await createGroup(s.teamId, "platform", "Platform", s.userId, s.pool);
    await addGroupMember(g.id, s.alice, s.userId, s.pool);

    const thisWk = "2026-05-11";
    const wk2ago = "2026-04-27";
    // Alice in two of the four weeks; Bob (outside the group) must not leak.
    await insertRichRollup(s.pool, s.teamId, s.alice, thisWk, { agentTimeMs: 3_600_000, sessions: 2, prs: 1 });
    await insertRichRollup(s.pool, s.teamId, s.alice, wk2ago, { agentTimeMs: 1_800_000, sessions: 1, prs: 0 });
    await insertRichRollup(s.pool, s.teamId, s.bob, thisWk, { agentTimeMs: 7_200_000, sessions: 9, prs: 4 });

    const trend = await groupMomentumTrend(s.teamId, { kind: "group", groupId: g.id }, thisWk, s.pool, 4);
    expect(trend.map((t) => t.weekMonday)).toEqual([
      "2026-04-20", "2026-04-27", "2026-05-04", "2026-05-11",
    ]);
    expect(trend[0]).toMatchObject({ agentHours: 0, sessions: 0, prs: 0, activeMembers: 0 });
    expect(trend[1]).toMatchObject({ sessions: 1, prs: 0, activeMembers: 1 });
    expect(trend[1].agentHours).toBeCloseTo(0.5, 5);
    expect(trend[2]).toMatchObject({ agentHours: 0, sessions: 0, activeMembers: 0 });
    expect(trend[3]).toMatchObject({ sessions: 2, prs: 1, activeMembers: 1 }); // Bob excluded
    expect(trend[3].agentHours).toBeCloseTo(1, 5);
  });

  it("returns all-zero weeks for an empty group", async () => {
    const s = await seed();
    const g = await createGroup(s.teamId, "empty", "Empty", s.userId, s.pool);
    const trend = await groupMomentumTrend(s.teamId, { kind: "group", groupId: g.id }, "2026-05-11", s.pool, 4);
    expect(trend).toHaveLength(4);
    expect(trend.every((t) => t.agentHours === 0 && t.activeMembers === 0)).toBe(true);
  });
});

describe("earliestWeekMonday", () => {
  it("returns the rollup floor when no integration data exists", async () => {
    const s = await seed();
    await insertRichRollup(s.pool, s.teamId, s.alice, "2026-05-13", { sessions: 1 });
    expect(await earliestWeekMonday(s.teamId, [s.alice], s.pool)).toBe("2026-05-11");
  });

  it("widens the floor to synced integration history older than any rollup", async () => {
    const s = await seed();
    await insertRichRollup(s.pool, s.teamId, s.alice, "2026-05-13", { sessions: 1 });
    await s.pool.query(
      `INSERT INTO github_pull_requests (team_id, repo, number, title, state, created_at, merged_at)
       VALUES ($1, 'acme/app', 1, 'KIP-1 fix', 'merged', '2026-04-14T10:00:00Z', '2026-04-15T10:00:00Z')`,
      [s.teamId],
    );
    expect(await earliestWeekMonday(s.teamId, [s.alice], s.pool)).toBe("2026-04-13");
  });

  it("stays null for an empty scope", async () => {
    const s = await seed();
    expect(await earliestWeekMonday(s.teamId, [], s.pool)).toBeNull();
  });
});

describe("earliestWeekMonday · group-scoped sources", () => {
  it("ignores integration history outside the scope's mapped sources", async () => {
    const s = await seed();
    await insertRichRollup(s.pool, s.teamId, s.alice, "2026-05-13", { sessions: 1 });
    await s.pool.query(
      `INSERT INTO github_pull_requests (team_id, repo, number, title, state, created_at, merged_at)
       VALUES ($1, 'acme/other-groups-repo', 1, 'KIP-1 fix', 'merged', '2026-04-14T10:00:00Z', '2026-04-15T10:00:00Z')`,
      [s.teamId],
    );
    // Scoped to no mapped repos/teams → the April PR can't widen the floor.
    expect(
      await earliestWeekMonday(s.teamId, [s.alice], s.pool, { repoNames: [], teamKeys: [] }),
    ).toBe("2026-05-11");
    // Scoped to the repo → it can.
    expect(
      await earliestWeekMonday(s.teamId, [s.alice], s.pool, { repoNames: ["acme/other-groups-repo"], teamKeys: [] }),
    ).toBe("2026-04-13");
  });
});
