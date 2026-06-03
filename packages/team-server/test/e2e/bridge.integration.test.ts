import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { resetDb } from "../helpers/db.js";
import { getPool } from "../../src/db/pool.js";
import { POST } from "../../src/app/api/ingest/metrics/route.js";
import { createUserAccount } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";
import { addGroupMember, createGroup } from "../../src/lib/groups.js";
import { generateToken, sha256 } from "../../src/lib/crypto.js";
import {
  isoMondayOf,
  perProjectTimeWoW,
  skillUsageWeek,
  teamPulseWeek,
  workingShapeDistribution,
} from "../../src/lib/insights-aggregate.js";

process.env.BASE_URL = "http://localhost:3322";

let pool: ReturnType<typeof getPool>;
let teamId: string;
let aliceMembershipId: string;
let bobMembershipId: string;
let aliceToken: string;
let bobToken: string;

async function issueBearer(pool: ReturnType<typeof getPool>, membershipId: string): Promise<string> {
  const token = generateToken();
  await pool.query(
    "UPDATE memberships SET bearer_token_hash = $1 WHERE id = $2",
    [sha256(token), membershipId],
  );
  return token;
}

// Mirrors the V2 payload shape buildIngestPayload({rollup, richExtras, enrichedExtras}) outputs.
// Kept inline so a CLI-layer refactor can't accidentally break the wire contract
// without this test catching it.
function makeRichPayload(args: {
  day: string;
  agentTimeMs: number;
  sessions: number;
  prs?: number;
  projects: Array<{ project: string; agentTimeMs: number; sessions: number }>;
  workingShapes: Array<{ shape: string; sessions: number; agentTimeMs: number }>;
  skillsLoaded?: Array<{ name: string; sessions: number }>;
  outcomeMix?: Record<string, number>;
}): Record<string, unknown> {
  return {
    ingestId: `e2e-${args.day}-${Math.random().toString(36).slice(2)}`,
    observedAt: new Date().toISOString(),
    schemaVersion: 2,
    dailyRollup: {
      day: args.day,
      agentTimeMs: args.agentTimeMs,
      sessions: args.sessions,
      toolCalls: 20,
      turns: 10,
      tokens: { input: 1000, output: 500, cacheRead: 100, cacheWrite: 50 },
    },
    richRollup: {
      day: args.day,
      agentTimeMs: args.agentTimeMs,
      sessions: args.sessions,
      toolCalls: 20,
      turns: 10,
      tokens: { input: 1000, output: 500, cacheRead: 100, cacheWrite: 50 },
      projects: args.projects,
      workingShapes: args.workingShapes,
      concurrencyPeak: 2,
      parallelMinutes: 30,
      longAutonomous: { count: 1, totalMin: 90, maxSingleMin: 90 },
      toolErrors: 1,
      skillsLoaded: args.skillsLoaded ?? [],
      subagentsDispatched: [],
      brainstormWarmupSessions: 0,
      planModeUsed: 1,
      prs: args.prs ?? 0,
      commits: 2,
      pushes: 1,
    },
    ...(args.outcomeMix ? {
      enrichedExtras: {
        outcomeMix: args.outcomeMix,
        helpfulnessMix: { essential: 1 },
        goalMix: { build: 60 },
      },
    } : {}),
  };
}

function makeAuthedReq(payload: unknown, token: string): NextRequest {
  return new NextRequest("http://localhost:3322/api/ingest/metrics", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

beforeAll(async () => {
  pool = await resetDb();
  const adminAcct = await createUserAccount("alice@e2e.test", "pw12345678", null, {}, pool);
  const { team, membership } = await createTeamWithAdmin("E2E Team", adminAcct.id, pool);
  teamId = team.id;
  aliceMembershipId = membership.id;
  aliceToken = await issueBearer(pool, aliceMembershipId);

  // Second member — verifies group-scoping really filters.
  const bobAcct = await createUserAccount("bob@e2e.test", "pw12345678", null, {}, pool);
  const bobMembership = await pool.query<{ id: string }>(
    "INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1, $2, 'member') RETURNING id",
    [bobAcct.id, teamId],
  );
  bobMembershipId = bobMembership.rows[0].id;
  bobToken = await issueBearer(pool, bobMembershipId);
});

afterAll(async () => {
  await pool.end();
});

describe("E2E · personal-to-team bridge", () => {
  const weekMonday = "2026-05-11"; // Monday
  const lastMonday = "2026-05-04";

  it("CLI-shaped V2 payload survives the HTTP route + lands in rich_daily_rollups", async () => {
    const payload = makeRichPayload({
      day: weekMonday,
      agentTimeMs: 3_600_000,
      sessions: 3,
      prs: 1,
      projects: [{ project: "/Users/x/Repo/fleetlens", agentTimeMs: 3_600_000, sessions: 3 }],
      workingShapes: [{ shape: "solo-build", sessions: 3, agentTimeMs: 3_600_000 }],
      skillsLoaded: [{ name: "brainstorming", sessions: 2 }],
      outcomeMix: { shipped: 2, partial: 1 },
    });

    const res = await POST(makeAuthedReq(payload, aliceToken));
    expect(res.status).toBe(200);

    const { rows } = await pool.query(
      `SELECT agent_time_ms, sessions, prs, concurrency_peak,
              projects, working_shapes, skills_loaded, outcome_mix
       FROM rich_daily_rollups WHERE team_id=$1 AND membership_id=$2 AND day=$3`,
      [teamId, aliceMembershipId, weekMonday],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].agent_time_ms)).toBe(3_600_000);
    expect(rows[0].prs).toBe(1);
    expect(rows[0].projects[0].project).toBe("/Users/x/Repo/fleetlens");
    expect(rows[0].working_shapes[0].shape).toBe("solo-build");
    expect(rows[0].skills_loaded[0].name).toBe("brainstorming");
    expect(rows[0].outcome_mix).toEqual({ shipped: 2, partial: 1 });
  });

  it("rejects payloads without a bearer token", async () => {
    const payload = makeRichPayload({
      day: weekMonday, agentTimeMs: 0, sessions: 0,
      projects: [], workingShapes: [],
    });
    const req = new NextRequest("http://localhost/api/ingest/metrics", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects payloads with a stranger's bearer token (no cross-member writes)", async () => {
    const payload = makeRichPayload({
      day: weekMonday, agentTimeMs: 0, sessions: 0,
      projects: [], workingShapes: [],
    });
    const res = await POST(makeAuthedReq(payload, "deadbeef-not-a-token"));
    expect(res.status).toBe(401);
  });

  it("aggregations over multiple members + days produce dashboard-ready blocks", async () => {
    // Drop the row from the first test so we control the dataset.
    await pool.query("DELETE FROM rich_daily_rollups WHERE team_id = $1", [teamId]);

    // ── Alice: this week ──
    await POST(makeAuthedReq(makeRichPayload({
      day: weekMonday,
      agentTimeMs: 7_200_000,
      sessions: 4,
      prs: 2,
      projects: [
        { project: "/Users/a/fleetlens", agentTimeMs: 5_400_000, sessions: 3 },
        { project: "/Users/a/topeka", agentTimeMs: 1_800_000, sessions: 1 },
      ],
      workingShapes: [
        { shape: "solo-build", sessions: 3, agentTimeMs: 5_400_000 },
        { shape: "reviewer-triad", sessions: 1, agentTimeMs: 1_800_000 },
      ],
      skillsLoaded: [{ name: "brainstorming", sessions: 2 }, { name: "writing-plans", sessions: 1 }],
      outcomeMix: { shipped: 3, partial: 1 },
    }), aliceToken));

    // ── Bob: this week ──
    await POST(makeAuthedReq(makeRichPayload({
      day: weekMonday,
      agentTimeMs: 3_600_000,
      sessions: 2,
      prs: 1,
      projects: [{ project: "/Users/b/fleetlens", agentTimeMs: 3_600_000, sessions: 2 }],
      workingShapes: [{ shape: "solo-build", sessions: 2, agentTimeMs: 3_600_000 }],
      skillsLoaded: [{ name: "brainstorming", sessions: 1 }],
    }), bobToken));

    // ── Alice: last week (for WoW) ──
    await POST(makeAuthedReq(makeRichPayload({
      day: lastMonday,
      agentTimeMs: 1_800_000,
      sessions: 1,
      prs: 0,
      projects: [{ project: "/Users/a/fleetlens", agentTimeMs: 1_800_000, sessions: 1 }],
      workingShapes: [{ shape: "solo-build", sessions: 1, agentTimeMs: 1_800_000 }],
      skillsLoaded: [{ name: "brainstorming", sessions: 1 }],
    }), aliceToken));

    // ── Team-wide aggregations ──
    const teamScope = { kind: "team-wide" as const };
    const pulse = await teamPulseWeek(teamId, teamScope, weekMonday, pool);
    expect(pulse.membersActive).toBe(2);
    expect(pulse.agentHours).toBeCloseTo(3, 5); // 7.2M + 3.6M ms = 10.8M ms = 3h
    expect(pulse.agentHoursPrev).toBeCloseTo(0.5, 5);
    expect(pulse.sessions).toBe(6);
    expect(pulse.prs).toBe(3);

    const projects = await perProjectTimeWoW(teamId, teamScope, weekMonday, pool);
    expect(projects.map((p) => p.project).sort()).toEqual(
      ["/Users/a/fleetlens", "/Users/a/topeka", "/Users/b/fleetlens"].sort(),
    );
    const aliceFleet = projects.find((p) => p.project === "/Users/a/fleetlens");
    expect(aliceFleet?.agentHoursPrev).toBeCloseTo(0.5, 5);
    expect(aliceFleet?.agentHours).toBeCloseTo(1.5, 5);

    const skills = await skillUsageWeek(teamId, teamScope, weekMonday, pool);
    const brainstorm = skills.find((s) => s.skill === "brainstorming");
    expect(brainstorm?.sessions).toBe(3); // alice 2 + bob 1
    expect(brainstorm?.sessionsPrev).toBe(1);

    const shapes = await workingShapeDistribution(teamId, teamScope, weekMonday, pool);
    expect(shapes.find((s) => s.shape === "solo-build")?.sessions).toBe(5);
    expect(shapes.find((s) => s.shape === "reviewer-triad")?.sessions).toBe(1);

    // ── Group-scoped: alice only ──
    const group = await createGroup(teamId, "core", "Core", "00000000-0000-0000-0000-000000000000", pool)
      .catch(async () => {
        // createGroup logs an event with actorUserId — use a real user.
        const u = await pool.query<{ id: string }>(
          "SELECT id FROM user_accounts WHERE email='alice@e2e.test'",
        );
        return createGroup(teamId, "core", "Core", u.rows[0].id, pool);
      });
    await addGroupMember(group.id, aliceMembershipId, group.id, pool).catch(() => {});
    const aliceUser = await pool.query<{ id: string }>(
      "SELECT id FROM user_accounts WHERE email='alice@e2e.test'",
    );
    await addGroupMember(group.id, aliceMembershipId, aliceUser.rows[0].id, pool).catch(() => {});

    const groupScope = { kind: "group" as const, groupId: group.id };
    const groupPulse = await teamPulseWeek(teamId, groupScope, weekMonday, pool);
    expect(groupPulse.sessions).toBe(4); // only alice's
    expect(groupPulse.membersActive).toBe(1);

    const groupProjects = await perProjectTimeWoW(teamId, groupScope, weekMonday, pool);
    expect(groupProjects.map((p) => p.project).sort()).toEqual(
      ["/Users/a/fleetlens", "/Users/a/topeka"].sort(),
    );
    // Bob's project must not leak into Alice's group.
    expect(groupProjects.find((p) => p.project === "/Users/b/fleetlens")).toBeUndefined();
  });

  it("matches the live aggregate contract end-to-end", async () => {
    // Use today's local Monday so the date math matches what the page computes.
    const today = new Date();
    const monday = isoMondayOf(today);

    await POST(makeAuthedReq(makeRichPayload({
      day: monday,
      agentTimeMs: 5_400_000,
      sessions: 3,
      prs: 1,
      projects: [{ project: "/Users/a/fleetlens", agentTimeMs: 5_400_000, sessions: 3 }],
      workingShapes: [{ shape: "solo-build", sessions: 3, agentTimeMs: 5_400_000 }],
      skillsLoaded: [{ name: "brainstorming", sessions: 2 }],
      outcomeMix: { shipped: 1 },
    }), aliceToken));

    const scope = { kind: "team-wide" as const };
    const [pulse, projects, skills, shapes] = await Promise.all([
      teamPulseWeek(teamId, scope, monday, pool),
      perProjectTimeWoW(teamId, scope, monday, pool, { limit: 12 }),
      skillUsageWeek(teamId, scope, monday, pool, { limit: 20 }),
      workingShapeDistribution(teamId, scope, monday, pool),
    ]);

    // The live insight blocks expect these exact field shapes.
    expect(pulse).toMatchObject({
      weekMonday: monday,
      membersActive: expect.any(Number),
      agentHours: expect.any(Number),
      agentHoursPrev: expect.any(Number),
      sessions: expect.any(Number),
      sessionsPrev: expect.any(Number),
      concurrencyPeak: expect.any(Number),
      parallelHours: expect.any(Number),
      prs: expect.any(Number),
      prsPrev: expect.any(Number),
    });
    expect(projects[0]).toMatchObject({
      project: expect.any(String),
      agentHours: expect.any(Number),
      agentHoursPrev: expect.any(Number),
      sessions: expect.any(Number),
    });
    expect(skills[0]).toMatchObject({
      skill: expect.any(String),
      sessions: expect.any(Number),
      sessionsPrev: expect.any(Number),
    });
    expect(shapes[0]).toMatchObject({
      shape: expect.any(String),
      sessions: expect.any(Number),
      agentHours: expect.any(Number),
    });
  });
});
