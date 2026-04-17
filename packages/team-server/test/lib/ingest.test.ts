import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getPool } from "../../src/db/pool.js";
import { runMigrations } from "../../src/db/migrate.js";
import { processIngest } from "../../src/lib/ingest.js";
import { addClient } from "../../src/lib/sse.js";
import { createUserAccount } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost:5432/fleetlens_dev";

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
  pool = getPool();
  await runMigrations();
  await pool.query("DELETE FROM events");
  await pool.query("DELETE FROM daily_rollups");
  await pool.query("DELETE FROM ingest_log");
  await pool.query("DELETE FROM invites");
  await pool.query("DELETE FROM memberships");
  await pool.query("DELETE FROM sessions");
  await pool.query("DELETE FROM server_config");
  await pool.query("DELETE FROM teams");
  await pool.query("DELETE FROM user_accounts");

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

  it("throws ZodError for invalid payload (bad day format)", async () => {
    const bad = {
      ingestId: "bad-ingest",
      observedAt: new Date().toISOString(),
      dailyRollup: {
        day: "not-a-date",
        agentTimeMs: 0,
        sessions: 0,
        toolCalls: 0,
        turns: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    };
    await expect(processIngest(bad, membershipId, teamId, pool)).rejects.toThrow();
  });

  it("throws ZodError when dailyRollup is missing", async () => {
    await expect(
      processIngest({ ingestId: "x", observedAt: new Date().toISOString() }, membershipId, teamId, pool)
    ).rejects.toThrow();
  });
});
