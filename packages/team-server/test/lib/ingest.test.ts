import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { runMigrations } from "../../src/db/migrate.js";
import { processIngest } from "../../src/lib/ingest.js";
import { sha256 } from "../../src/lib/crypto.js";

const TEST_DB = process.env.DATABASE_URL || "postgres://localhost:5432/fleetlens_test";

let pool: pg.Pool;
let teamId: string;
let memberId: string;

const validPayload = {
  ingestId: "test-ingest-001",
  observedAt: "2024-01-15T10:00:00.000Z",
  dailyRollup: {
    day: "2024-01-15",
    agentTimeMs: 3600000,
    sessions: 5,
    toolCalls: 42,
    turns: 10,
    tokens: {
      input: 1000,
      output: 500,
      cacheRead: 200,
      cacheWrite: 100,
    },
  },
};

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: TEST_DB, max: 5 });
  process.env.DATABASE_URL = TEST_DB;
  await runMigrations();

  const teamRes = await pool.query(
    `INSERT INTO teams (slug, name) VALUES ('test-team', 'Test Team') RETURNING id`
  );
  teamId = teamRes.rows[0].id;

  const memberRes = await pool.query(
    `INSERT INTO members (team_id, email, role, bearer_token_hash) VALUES ($1, 'test@example.com', 'member', $2) RETURNING id`,
    [teamId, sha256("test-token")]
  );
  memberId = memberRes.rows[0].id;
});

afterAll(async () => {
  await pool.query("DELETE FROM ingest_log WHERE team_id = $1", [teamId]);
  await pool.query("DELETE FROM daily_rollups WHERE team_id = $1", [teamId]);
  await pool.query("DELETE FROM members WHERE team_id = $1", [teamId]);
  await pool.query("DELETE FROM teams WHERE id = $1", [teamId]);
  await pool.end();
});

describe("processIngest", () => {
  it("valid payload inserts ingest_log + daily_rollups, returns accepted + nextSyncAfter", async () => {
    const result = await processIngest(validPayload, memberId, teamId, pool);
    expect(result).toMatchObject({ accepted: true });
    expect("nextSyncAfter" in result).toBe(true);

    const log = await pool.query("SELECT * FROM ingest_log WHERE ingest_id = $1", [validPayload.ingestId]);
    expect(log.rowCount).toBe(1);
    expect(log.rows[0].member_id).toBe(memberId);

    const rollup = await pool.query(
      "SELECT * FROM daily_rollups WHERE team_id = $1 AND member_id = $2 AND day = $3",
      [teamId, memberId, validPayload.dailyRollup.day]
    );
    expect(rollup.rowCount).toBe(1);
    expect(Number(rollup.rows[0].sessions)).toBe(5);
    expect(Number(rollup.rows[0].tool_calls)).toBe(42);
  });

  it("duplicate ingestId returns deduplicated: true, no new rows", async () => {
    const countBefore = await pool.query("SELECT COUNT(*) FROM ingest_log WHERE ingest_id = $1", [validPayload.ingestId]);

    const result = await processIngest(validPayload, memberId, teamId, pool);
    expect(result).toMatchObject({ accepted: true, deduplicated: true });

    const countAfter = await pool.query("SELECT COUNT(*) FROM ingest_log WHERE ingest_id = $1", [validPayload.ingestId]);
    expect(countAfter.rows[0].count).toBe(countBefore.rows[0].count);
  });

  it("invalid payload (missing dailyRollup) throws ZodError", async () => {
    await expect(
      processIngest({ ingestId: "bad-001", observedAt: "2024-01-15T10:00:00.000Z" }, memberId, teamId, pool)
    ).rejects.toThrow();
  });

  it("second ingest for same day replaces (not accumulates) daily_rollups", async () => {
    const updatedPayload = {
      ingestId: "test-ingest-002",
      observedAt: "2024-01-15T12:00:00.000Z",
      dailyRollup: {
        day: "2024-01-15",
        agentTimeMs: 7200000,
        sessions: 10,
        toolCalls: 99,
        turns: 20,
        tokens: { input: 2000, output: 1000, cacheRead: 400, cacheWrite: 200 },
      },
    };

    await processIngest(updatedPayload, memberId, teamId, pool);

    const rollup = await pool.query(
      "SELECT * FROM daily_rollups WHERE team_id = $1 AND member_id = $2 AND day = $3",
      [teamId, memberId, "2024-01-15"]
    );
    expect(rollup.rowCount).toBe(1);
    expect(Number(rollup.rows[0].sessions)).toBe(10);
    expect(Number(rollup.rows[0].tool_calls)).toBe(99);
    expect(Number(rollup.rows[0].agent_time_ms)).toBe(7200000);
  });
});
