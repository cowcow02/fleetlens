import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resetDb } from "../helpers/db.js";
import { getPool } from "../../src/db/pool.js";
import { processIngest, processUsageHistory } from "../../src/lib/ingest.js";
import { addClient } from "../../src/lib/sse.js";
import { createUserAccount } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";
let pool: ReturnType<typeof getPool>;
let membershipId: string;
let teamId: string;

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    ingestId: `ingest-${Math.random().toString(36).slice(2)}`,
    observedAt: new Date().toISOString(),
    dailyRollup: {
      day: new Date().toISOString().slice(0, 10),
      agentTimeMs: 3600000,
      sessions: 3,
      toolCalls: 20,
      turns: 8,
      tokens: { input: 500, output: 300, cacheRead: 100, cacheWrite: 50 },
    },
    ...overrides,
  };
}

beforeAll(async () => {
  pool = await resetDb();
  const admin = await createUserAccount("ingest-admin@example.com", "pass1234", null, {}, pool);
  const { team, membership } = await createTeamWithAdmin("Ingest Team", admin.id, pool);
  teamId = team.id;
  membershipId = membership.id;
});

afterAll(async () => {
  await pool.end();
});

describe("processIngest", () => {
  it("returns accepted=true and nextSyncAfter on success", async () => {
    const result = await processIngest(makePayload(), membershipId, teamId, pool);
    expect(result.accepted).toBe(true);
    expect(result.nextSyncAfter).toBeTruthy();
  });

  it("deduplicates: second call with same ingestId returns deduplicated=true", async () => {
    const payload = makePayload();
    await processIngest(payload, membershipId, teamId, pool);
    const result = await processIngest(payload, membershipId, teamId, pool);
    expect(result.accepted).toBe(true);
    expect(result.deduplicated).toBe(true);
  });

  it("upserts daily_rollups (ON CONFLICT updates row)", async () => {
    const day = "2024-06-15";
    const first = makePayload({
      dailyRollup: {
        day,
        agentTimeMs: 1000,
        sessions: 1,
        toolCalls: 5,
        turns: 2,
        tokens: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5 },
      },
    });
    await processIngest(first, membershipId, teamId, pool);

    // Different ingestId, same day → should overwrite
    const second = makePayload({
      dailyRollup: {
        day,
        agentTimeMs: 9000,
        sessions: 10,
        toolCalls: 50,
        turns: 20,
        tokens: { input: 900, output: 500, cacheRead: 90, cacheWrite: 45 },
      },
    });
    await processIngest(second, membershipId, teamId, pool);

    const row = await pool.query(
      "SELECT sessions, agent_time_ms FROM daily_rollups WHERE team_id=$1 AND membership_id=$2 AND day=$3",
      [teamId, membershipId, day]
    );
    expect(row.rows[0].sessions).toBe(10);
    expect(Number(row.rows[0].agent_time_ms)).toBe(9000);
  });

  it("bumps last_seen_at on the membership", async () => {
    await pool.query(
      "UPDATE memberships SET last_seen_at = null WHERE id = $1",
      [membershipId]
    );
    await processIngest(makePayload(), membershipId, teamId, pool);
    const row = await pool.query(
      "SELECT last_seen_at FROM memberships WHERE id = $1",
      [membershipId]
    );
    expect(row.rows[0].last_seen_at).not.toBeNull();
  });

  it("broadcasts an SSE roster-updated event on success", async () => {
    const received: string[] = [];
    const ctrl = {
      enqueue(chunk: Uint8Array) {
        received.push(new TextDecoder().decode(chunk));
      },
    } as unknown as ReadableStreamDefaultController;
    const cleanup = addClient(ctrl, teamId);

    await processIngest(makePayload(), membershipId, teamId, pool);

    expect(received.some((m) => m.includes("roster-updated"))).toBe(true);
    cleanup();
  });

  // Partial-success ingestion (§2 resilience): a single malformed DATA block
  // is skipped — not fatal — so a poison field can't 400 a whole push and
  // starve the other table. Previously this same bad-day payload threw a
  // ZodError; the contract is now 200-with-partial.
  it("skips a data block with a bad field instead of throwing (partial success)", async () => {
    const result = await processIngest(
      {
        ingestId: `partial-badday-${Math.random().toString(36).slice(2)}`,
        observedAt: new Date().toISOString(),
        dailyRollup: {
          day: "not-a-date",
          agentTimeMs: 0,
          sessions: 0,
          toolCalls: 0,
          turns: 0,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      },
      membershipId,
      teamId,
      pool,
    );
    expect(result.accepted).toBe(true);
    expect(result.blocks?.skipped.dailyRollup).toContain("day");
    expect(result.blocks?.accepted).not.toContain("dailyRollup");
  });

  // The ENVELOPE stays strict — a bad ingestId/observedAt is a genuine
  // protocol error and must still 400 (ZodError) rather than partial-succeed.
  it("still throws on a malformed envelope (bad observedAt)", async () => {
    await expect(
      processIngest(
        { ingestId: "bad-env", observedAt: "not-a-date" },
        membershipId,
        teamId,
        pool,
      ),
    ).rejects.toThrow();
  });

  it("ingests valid blocks while skipping one invalid block (200-with-partial)", async () => {
    const day = "2026-07-01";
    const result = await processIngest(
      makePayload({
        ingestId: `partial-mixed-${Math.random().toString(36).slice(2)}`,
        dailyRollup: {
          day,
          agentTimeMs: 1234,
          sessions: 2,
          toolCalls: 3,
          turns: 1,
          tokens: { input: 10, output: 5, cacheRead: 1, cacheWrite: 0 },
        },
        // Invalid cyclePeaks: endsAt isn't a datetime → the whole cyclePeaks
        // block is skipped, but dailyRollup must still land.
        cyclePeaks: {
          fiveHour: [{ endsAt: "nope", peakPct: 5, source: "real", current: false }],
          sevenDay: [],
        },
      }),
      membershipId,
      teamId,
      pool,
    );
    expect(result.accepted).toBe(true);
    expect(result.blocks?.accepted).toContain("dailyRollup");
    expect(result.blocks?.skipped.cyclePeaks).toBeTruthy();

    const row = await pool.query(
      "SELECT sessions FROM daily_rollups WHERE team_id=$1 AND membership_id=$2 AND day=$3",
      [teamId, membershipId, day],
    );
    expect(row.rows[0].sessions).toBe(2);
  });

  // §1b — peakPct legitimately exceeds 200 on overage/predicted peaks; the
  // old `.max(200)` rejected real payloads and (since cyclePeaks rides the
  // daily push) 400'd the whole thing.
  it("accepts cyclePeaks with peakPct over 200 (overage utilization)", async () => {
    const result = await processIngest(
      makePayload({
        ingestId: `overage-${Math.random().toString(36).slice(2)}`,
        cyclePeaks: {
          fiveHour: [
            { endsAt: "2026-07-02T05:00:00+00:00", peakPct: 247.5, source: "predicted", current: true },
          ],
          sevenDay: [],
        },
      }),
      membershipId,
      teamId,
      pool,
    );
    expect(result.accepted).toBe(true);
    expect(result.blocks?.accepted).toContain("cyclePeaks");
    expect(result.blocks?.skipped.cyclePeaks).toBeUndefined();

    const { rows } = await pool.query(
      `SELECT peak_pct FROM membership_cycle_peaks
       WHERE team_id=$1 AND membership_id=$2 AND "window"='5h'`,
      [teamId, membershipId],
    );
    expect(rows.some((r) => Math.abs(Number(r.peak_pct) - 247.5) < 0.01)).toBe(true);
  });

  it("accepts payloads without a dailyRollup (idle-day live-only push)", async () => {
    // dailyRollup is optional so the daemon can push fresh tier/snapshot/
    // cycle-peaks updates even on idle days. The server should accept the
    // payload, skip the daily_rollups upsert, and return ok.
    const result = await processIngest(
      { ingestId: `idle-${Date.now()}`, observedAt: new Date().toISOString() },
      membershipId,
      teamId,
      pool,
    );
    expect(result).toMatchObject({ accepted: true });
  });

  it("inserts plan_utilization row when usageSnapshot present", async () => {
    const capturedAt = new Date("2026-04-22T10:30:00Z").toISOString();
    const payload = makePayload({
      usageSnapshot: {
        capturedAt,
        fiveHour: { utilization: 23.7, resetsAt: "2026-04-22T14:00:00Z" },
        sevenDay: { utilization: 47.2, resetsAt: "2026-04-26T00:00:00Z" },
        sevenDayOpus: { utilization: 61.0, resetsAt: "2026-04-26T00:00:00Z" },
        sevenDaySonnet: { utilization: 31.4, resetsAt: "2026-04-26T00:00:00Z" },
        sevenDayOauthApps: null,
        sevenDayCowork: null,
        extraUsage: null,
      },
    });
    await processIngest(payload, membershipId, teamId, pool);

    const { rows } = await pool.query(
      `SELECT seven_day_utilization, seven_day_opus_utilization, extra_usage_enabled
       FROM plan_utilization WHERE team_id=$1 AND membership_id=$2 AND captured_at=$3`,
      [teamId, membershipId, capturedAt]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].seven_day_utilization).toBeCloseTo(47.2, 4);
    expect(rows[0].seven_day_opus_utilization).toBeCloseTo(61.0, 4);
    expect(rows[0].extra_usage_enabled).toBe(false);
  });

  it("skips plan_utilization insert when usageSnapshot absent", async () => {
    const before = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM plan_utilization WHERE membership_id = $1",
      [membershipId]
    );
    await processIngest(makePayload(), membershipId, teamId, pool);
    const after = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM plan_utilization WHERE membership_id = $1",
      [membershipId]
    );
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it("plan_utilization is idempotent on (team, membership, captured_at)", async () => {
    const capturedAt = new Date("2026-04-23T08:00:00Z").toISOString();
    const snapshot = {
      capturedAt,
      fiveHour: { utilization: 10, resetsAt: "2026-04-23T13:00:00Z" },
      sevenDay: { utilization: 20, resetsAt: "2026-04-27T00:00:00Z" },
      sevenDayOpus: null,
      sevenDaySonnet: null,
      sevenDayOauthApps: null,
      sevenDayCowork: null,
      extraUsage: null,
    };
    // Two distinct ingestIds, same captured_at: only one plan_utilization row.
    await processIngest(makePayload({ usageSnapshot: snapshot }), membershipId, teamId, pool);
    await processIngest(makePayload({ usageSnapshot: snapshot }), membershipId, teamId, pool);

    const { rows } = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM plan_utilization WHERE membership_id=$1 AND captured_at=$2",
      [membershipId, capturedAt]
    );
    expect(rows[0].count).toBe("1");
  });

  it("captures extra_usage credits when present", async () => {
    const capturedAt = new Date("2026-04-24T12:00:00Z").toISOString();
    await processIngest(
      makePayload({
        usageSnapshot: {
          capturedAt,
          fiveHour: { utilization: 15, resetsAt: "2026-04-24T17:00:00Z" },
          sevenDay: { utilization: 88, resetsAt: "2026-04-28T00:00:00Z" },
          sevenDayOpus: null,
          sevenDaySonnet: null,
          sevenDayOauthApps: null,
          sevenDayCowork: null,
          extraUsage: {
            isEnabled: true,
            monthlyLimitUsd: 50,
            usedCreditsUsd: 12.5,
            utilization: 25,
          },
        },
      }),
      membershipId,
      teamId,
      pool,
    );

    const { rows } = await pool.query(
      `SELECT extra_usage_enabled, extra_usage_monthly_limit_usd, extra_usage_used_credits_usd
       FROM plan_utilization WHERE captured_at = $1`,
      [capturedAt],
    );
    expect(rows[0].extra_usage_enabled).toBe(true);
    expect(rows[0].extra_usage_monthly_limit_usd).toBeCloseTo(50, 4);
    expect(rows[0].extra_usage_used_credits_usd).toBeCloseTo(12.5, 4);
  });

  // Anthropic's API serializes `+00:00` rather than `Z`. Without
  // datetime({offset:true}) the schema rejected every real payload, leaving
  // plan_utilization permanently empty. See PR #23 review.
  it("accepts usage timestamps with +00:00 offsets (real Anthropic shape)", async () => {
    const capturedAt = "2026-04-29T03:00:00.000+00:00";
    await processIngest(
      makePayload({
        usageSnapshot: {
          capturedAt,
          fiveHour: { utilization: 19, resetsAt: "2026-04-29T07:10:00.207984+00:00" },
          sevenDay: { utilization: 18, resetsAt: "2026-05-04T12:00:00.208003+00:00" },
          sevenDayOpus: null,
          sevenDaySonnet: null,
          sevenDayOauthApps: null,
          sevenDayCowork: null,
          extraUsage: null,
        },
      }),
      membershipId,
      teamId,
      pool,
    );
    const { rows } = await pool.query(
      "SELECT count(*)::text AS count FROM plan_utilization WHERE membership_id = $1 AND captured_at = $2",
      [membershipId, capturedAt],
    );
    expect(rows[0].count).toBe("1");
  });
  it("UPSERTs rich_daily_rollups on V2 payload with richRollup", async () => {
    const day = "2026-05-12";
    const richRollup = {
      day,
      agentTimeMs: 7_200_000,
      sessions: 4,
      toolCalls: 40,
      turns: 12,
      tokens: { input: 1000, output: 500, cacheRead: 200, cacheWrite: 100 },
      projects: [{ project: "fleetlens", agentTimeMs: 7_200_000, sessions: 4 }],
      workingShapes: [{ shape: "solo-build", sessions: 3, agentTimeMs: 5_400_000 }],
      concurrencyPeak: 3,
      parallelMinutes: 45,
      longAutonomous: { count: 2, totalMin: 180, maxSingleMin: 110 },
      toolErrors: 1,
      skillsLoaded: [{ name: "brainstorming", sessions: 2 }],
      subagentsDispatched: [{ type: "reviewer", count: 3 }],
      brainstormWarmupSessions: 1,
      planModeUsed: 2,
      prs: 1,
      commits: 4,
      pushes: 3,
    };
    await processIngest(
      makePayload({
        ingestId: `rich-${Date.now()}`,
        schemaVersion: 2,
        richRollup,
        enrichedExtras: {
          outcomeMix: { shipped: 1, partial: 2 },
          helpfulnessMix: { essential: 2, helpful: 1 },
          goalMix: { build: 90, debug: 30 },
        },
      }),
      membershipId, teamId, pool,
    );
    const { rows } = await pool.query(
      `SELECT concurrency_peak, prs, projects, working_shapes, skills_loaded, outcome_mix
       FROM rich_daily_rollups WHERE team_id=$1 AND membership_id=$2 AND day=$3`,
      [teamId, membershipId, day],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].concurrency_peak).toBe(3);
    expect(rows[0].prs).toBe(1);
    expect(rows[0].projects).toEqual([{ project: "fleetlens", agentTimeMs: 7_200_000, sessions: 4 }]);
    expect(rows[0].working_shapes[0].shape).toBe("solo-build");
    expect(rows[0].outcome_mix).toEqual({ shipped: 1, partial: 2 });
  });

  it("upserts day_artifact_signals when artifactSignals is in the payload", async () => {
    const day = "2026-02-10";
    const payload = makePayload({
      ingestId: `ingest-art-${Math.random().toString(36).slice(2)}`,
      schemaVersion: 2,
      dailyRollup: {
        day, agentTimeMs: 3_600_000, sessions: 3, toolCalls: 20, turns: 8,
        tokens: { input: 500, output: 300, cacheRead: 100, cacheWrite: 50 },
      },
      richRollup: {
        day, agentTimeMs: 3_600_000, sessions: 3, toolCalls: 20, turns: 8,
        tokens: { input: 500, output: 300, cacheRead: 100, cacheWrite: 50 },
        projects: [], workingShapes: [], concurrencyPeak: 0, parallelMinutes: 0,
        longAutonomous: { count: 0, totalMin: 0, maxSingleMin: 0 },
        toolErrors: 0, skillsLoaded: [], subagentsDispatched: [],
        brainstormWarmupSessions: 0, planModeUsed: 0,
        prs: 0, commits: 0, pushes: 0,
      },
      artifactSignals: {
        skillsAuthored: [
          { pathHash: "a".repeat(32), firstSeenDate: day },
          { pathHash: "b".repeat(32), firstSeenDate: day },
        ],
        skillsEdited: [{ pathHash: "c".repeat(32), lineDelta: 12 }],
        subagentsAuthored: [{ pathHash: "d".repeat(32), firstSeenDate: day }],
        slashCommandsAuthored: [],
        claudemdLineDelta: 7,
      },
    });
    await processIngest(payload, membershipId, teamId, pool);
    const res = await pool.query(
      `SELECT skills_authored, claudemd_line_delta FROM day_artifact_signals
       WHERE team_id = $1 AND membership_id = $2 AND day = $3::date`,
      [teamId, membershipId, day],
    );
    expect(res.rowCount).toBe(1);
    expect(res.rows[0].claudemd_line_delta).toBe(7);
    expect(res.rows[0].skills_authored).toHaveLength(2);
  });

  it("reconciles team_skill_catalog: originator stays monotonic; second member becomes adopter", async () => {
    const day = "2026-02-11";
    const pathHash = "skillhash" + "0".repeat(23);

    // Member B for adopter check
    const memberB = await createUserAccount(`adopter-${Math.random().toString(36).slice(2)}@x.dev`, "pass1234", null, {}, pool);
    const memBRes = await pool.query<{ id: string }>(
      `INSERT INTO memberships (user_account_id, team_id, role) VALUES ($1, $2, 'member') RETURNING id`,
      [memberB.id, teamId],
    );
    const memBId = memBRes.rows[0].id;

    // Member A authors a skill
    await processIngest(
      makePayload({
        ingestId: `ingest-cat-a-${Math.random().toString(36).slice(2)}`,
        schemaVersion: 2,
        dailyRollup: {
          day, agentTimeMs: 100, sessions: 1, toolCalls: 1, turns: 1,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
        richRollup: {
          day, agentTimeMs: 100, sessions: 1, toolCalls: 1, turns: 1,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          projects: [], workingShapes: [], concurrencyPeak: 0, parallelMinutes: 0,
          longAutonomous: { count: 0, totalMin: 0, maxSingleMin: 0 },
          toolErrors: 0, skillsLoaded: [], subagentsDispatched: [],
          brainstormWarmupSessions: 0, planModeUsed: 0,
          prs: 0, commits: 0, pushes: 0,
        },
        artifactSignals: {
          skillsAuthored: [{ pathHash, firstSeenDate: day }],
          skillsEdited: [], subagentsAuthored: [], slashCommandsAuthored: [],
          claudemdLineDelta: 0,
        },
      }),
      membershipId, teamId, pool,
    );

    // Member B "adopts" by authoring the same path_hash later (representing
    // load+commit of the same skill name across the team)
    await processIngest(
      makePayload({
        ingestId: `ingest-cat-b-${Math.random().toString(36).slice(2)}`,
        schemaVersion: 2,
        dailyRollup: {
          day, agentTimeMs: 100, sessions: 1, toolCalls: 1, turns: 1,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
        richRollup: {
          day, agentTimeMs: 100, sessions: 1, toolCalls: 1, turns: 1,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          projects: [], workingShapes: [], concurrencyPeak: 0, parallelMinutes: 0,
          longAutonomous: { count: 0, totalMin: 0, maxSingleMin: 0 },
          toolErrors: 0, skillsLoaded: [], subagentsDispatched: [],
          brainstormWarmupSessions: 0, planModeUsed: 0,
          prs: 0, commits: 0, pushes: 0,
        },
        artifactSignals: {
          skillsAuthored: [{ pathHash, firstSeenDate: day }],
          skillsEdited: [], subagentsAuthored: [], slashCommandsAuthored: [],
          claudemdLineDelta: 0,
        },
      }),
      memBId, teamId, pool,
    );

    const res = await pool.query<{
      originator_membership_id: string;
      adopter_membership_ids: string[];
      loads_total: number;
    }>(
      `SELECT originator_membership_id, adopter_membership_ids, loads_total
       FROM team_skill_catalog WHERE team_id = $1 AND path_hash = $2`,
      [teamId, pathHash],
    );
    expect(res.rowCount).toBe(1);
    expect(res.rows[0].originator_membership_id).toBe(membershipId);
    expect(res.rows[0].adopter_membership_ids).toContain(memBId);
    expect(res.rows[0].loads_total).toBeGreaterThanOrEqual(2);
  });

  it("preserves prior outcome_mix when a later push omits enrichedExtras (opt-out path)", async () => {
    const day = "2026-05-13";
    const richRollup = {
      day,
      agentTimeMs: 0, sessions: 0, toolCalls: 0, turns: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      projects: [], workingShapes: [], concurrencyPeak: 0, parallelMinutes: 0,
      longAutonomous: { count: 0, totalMin: 0, maxSingleMin: 0 },
      toolErrors: 0, skillsLoaded: [], subagentsDispatched: [],
      brainstormWarmupSessions: 0, planModeUsed: 0, prs: 0, commits: 0, pushes: 0,
    };
    await processIngest(
      makePayload({
        ingestId: `opt-in-${Date.now()}`, schemaVersion: 2, richRollup,
        enrichedExtras: { outcomeMix: { shipped: 5 }, helpfulnessMix: {}, goalMix: {} },
      }),
      membershipId, teamId, pool,
    );
    // Re-push without enrichedExtras
    await processIngest(
      makePayload({
        ingestId: `opt-out-${Date.now()}`, schemaVersion: 2, richRollup,
      }),
      membershipId, teamId, pool,
    );
    const { rows } = await pool.query(
      "SELECT outcome_mix FROM rich_daily_rollups WHERE day=$1 AND membership_id=$2",
      [day, membershipId],
    );
    expect(rows[0].outcome_mix).toEqual({ shipped: 5 });
  });

  // The real client (buildEnrichedExtras) ALWAYS sends an enrichedExtras object;
  // when no entry is enrichment-done it sends EMPTY {} mixes, never `undefined`.
  // Enrichment is async, so a day's first push routinely carries empty mixes and
  // a later push lands the real ones — the empty push must not clobber stored
  // enriched data. (Regression: empty {} is truthy, so it used to serialize to
  // '{}' and defeat the COALESCE-preserve.)
  it("preserves prior enriched mixes when a later push carries EMPTY mixes (enrichment-lag / AI-off)", async () => {
    const day = "2026-05-14";
    const richRollup = {
      day,
      agentTimeMs: 0, sessions: 0, toolCalls: 0, turns: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      projects: [], workingShapes: [], concurrencyPeak: 0, parallelMinutes: 0,
      longAutonomous: { count: 0, totalMin: 0, maxSingleMin: 0 },
      toolErrors: 0, skillsLoaded: [], subagentsDispatched: [],
      brainstormWarmupSessions: 0, planModeUsed: 0, prs: 0, commits: 0, pushes: 0,
    };
    await processIngest(
      makePayload({
        ingestId: `enriched-real-${Date.now()}`, schemaVersion: 2, richRollup,
        enrichedExtras: { outcomeMix: { shipped: 5 }, helpfulnessMix: { essential: 2 }, goalMix: { build: 60 } },
      }),
      membershipId, teamId, pool,
    );
    // Re-push WITH empty mixes — exactly what the client sends before enrichment
    // finishes (or with AI off). Must NOT overwrite the stored real mixes.
    await processIngest(
      makePayload({
        ingestId: `enriched-empty-${Date.now()}`, schemaVersion: 2, richRollup,
        enrichedExtras: { outcomeMix: {}, helpfulnessMix: {}, goalMix: {} },
      }),
      membershipId, teamId, pool,
    );
    const { rows } = await pool.query(
      "SELECT outcome_mix, helpfulness_mix, goal_mix FROM rich_daily_rollups WHERE day=$1 AND membership_id=$2",
      [day, membershipId],
    );
    expect(rows[0].outcome_mix).toEqual({ shipped: 5 });
    expect(rows[0].helpfulness_mix).toEqual({ essential: 2 });
    expect(rows[0].goal_mix).toEqual({ build: 60 });
  });
});

describe("processUsageHistory", () => {
  function makeSnap(capturedAt: string, fiveHourPct = 25, sevenDayPct = 40) {
    return {
      capturedAt,
      fiveHour: { utilization: fiveHourPct, resetsAt: "2026-05-04T12:00:00+00:00" },
      sevenDay: { utilization: sevenDayPct, resetsAt: "2026-05-04T12:00:00+00:00" },
      sevenDayOpus: null,
      sevenDaySonnet: null,
      sevenDayOauthApps: null,
      sevenDayCowork: null,
      extraUsage: null,
    };
  }

  it("bulk-inserts snapshots and reports counts", async () => {
    const result = await processUsageHistory(
      {
        snapshots: [
          makeSnap("2026-04-20T01:00:00+00:00", 10, 20),
          makeSnap("2026-04-20T02:00:00+00:00", 15, 22),
          makeSnap("2026-04-20T03:00:00+00:00", 17, 25),
        ],
      },
      membershipId,
      teamId,
      pool,
    );
    expect(result.received).toBe(3);
    expect(result.inserted).toBe(3);
    expect(result.skipped).toBe(0);
  });

  it("is idempotent on (team, membership, captured_at)", async () => {
    const snap = makeSnap("2026-04-21T01:00:00+00:00");
    const first = await processUsageHistory({ snapshots: [snap] }, membershipId, teamId, pool);
    expect(first.inserted).toBe(1);
    const again = await processUsageHistory({ snapshots: [snap] }, membershipId, teamId, pool);
    expect(again.inserted).toBe(0);
    expect(again.skipped).toBe(1);
  });

  it("rejects empty snapshot arrays", async () => {
    await expect(
      processUsageHistory({ snapshots: [] }, membershipId, teamId, pool),
    ).rejects.toThrow();
  });

  it("rejects oversized batches above the 1000-row cap", async () => {
    const big = Array.from({ length: 1001 }, (_, i) =>
      makeSnap(`2026-04-22T${String(i % 24).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00+00:00`),
    );
    await expect(
      processUsageHistory({ snapshots: big }, membershipId, teamId, pool),
    ).rejects.toThrow();
  });

  it("upserts memberships.plan_tier and audit-logs when planTier accompanies the batch", async () => {
    await pool.query("UPDATE memberships SET plan_tier = 'pro-max' WHERE id = $1", [membershipId]);
    await processUsageHistory(
      {
        snapshots: [makeSnap("2026-04-23T01:00:00+00:00")],
        planTier: "pro-max-20x",
      },
      membershipId,
      teamId,
      pool,
    );
    const { rows } = await pool.query(
      "SELECT plan_tier FROM memberships WHERE id = $1",
      [membershipId],
    );
    expect(rows[0].plan_tier).toBe("pro-max-20x");

    const events = await pool.query(
      "SELECT payload FROM events WHERE action = 'members.plan_tier_auto_detected' AND team_id = $1 ORDER BY id DESC LIMIT 1",
      [teamId],
    );
    expect(events.rows[0].payload.previousTier).toBe("pro-max");
    expect(events.rows[0].payload.newTier).toBe("pro-max-20x");
    expect(events.rows[0].payload.source).toBe("anthropic_profile");
  });

  it("does not audit-log when daemon-reported tier matches existing", async () => {
    await pool.query("UPDATE memberships SET plan_tier = 'pro-max-20x' WHERE id = $1", [membershipId]);
    const beforeCount = await pool.query<{ c: string }>(
      "SELECT COUNT(*)::text AS c FROM events WHERE action = 'members.plan_tier_auto_detected' AND team_id = $1",
      [teamId],
    );
    await processUsageHistory(
      { snapshots: [makeSnap("2026-04-24T01:00:00+00:00")], planTier: "pro-max-20x" },
      membershipId,
      teamId,
      pool,
    );
    const afterCount = await pool.query<{ c: string }>(
      "SELECT COUNT(*)::text AS c FROM events WHERE action = 'members.plan_tier_auto_detected' AND team_id = $1",
      [teamId],
    );
    expect(afterCount.rows[0].c).toBe(beforeCount.rows[0].c);
  });
});

describe("processIngest planTier auto-upsert", () => {
  it("updates memberships.plan_tier when ingest payload carries planTier", async () => {
    await pool.query("UPDATE memberships SET plan_tier = 'pro-max' WHERE id = $1", [membershipId]);
    const day = "2025-09-09";
    await processIngest(
      makePayload({
        dailyRollup: {
          day,
          agentTimeMs: 100,
          sessions: 1,
          toolCalls: 1,
          turns: 1,
          tokens: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
        },
        planTier: "pro-max-20x",
      }),
      membershipId,
      teamId,
      pool,
    );
    const { rows } = await pool.query(
      "SELECT plan_tier FROM memberships WHERE id = $1",
      [membershipId],
    );
    expect(rows[0].plan_tier).toBe("pro-max-20x");
  });
});
