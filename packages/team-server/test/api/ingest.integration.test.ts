import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { getPool } from "../../src/db/pool.js";
import { runMigrations } from "../../src/db/migrate.js";
import { POST } from "../../src/app/api/ingest/metrics/route.js";
import { createUserAccount } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost:5432/fleetlens_dev";

let pool: ReturnType<typeof getPool>;
let bearerToken: string;

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

function makeReq(body: unknown, authHeader?: string): NextRequest {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authHeader !== undefined) headers["authorization"] = authHeader;
  return new NextRequest("http://localhost/api/ingest/metrics", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
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

  const admin = await createUserAccount("ingest-route-admin@example.com", "pass1234", null, {}, pool);
  const { membership } = await createTeamWithAdmin("Ingest Route Team", admin.id, pool);
  bearerToken = membership.bearerToken;
});

afterAll(async () => {
  await pool.end();
});

describe("POST /api/ingest/metrics", () => {
  it("returns 401 when authorization header is missing", async () => {
    const req = makeReq(makePayload());
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 when bearer token is invalid", async () => {
    const req = makeReq(makePayload(), "Bearer bt_totally_invalid_token");
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 when authorization header lacks 'Bearer ' prefix", async () => {
    const req = makeReq(makePayload(), bearerToken); // no "Bearer " prefix
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 200 on valid payload and bearer", async () => {
    const req = makeReq(makePayload(), `Bearer ${bearerToken}`);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accepted).toBe(true);
    expect(body.nextSyncAfter).toBeTruthy();
  });

  it("returns 202 for deduplicated payload", async () => {
    const payload = makePayload();
    // First submission
    const req1 = makeReq(payload, `Bearer ${bearerToken}`);
    await POST(req1);
    // Second submission with same ingestId
    const req2 = makeReq(payload, `Bearer ${bearerToken}`);
    const res = await POST(req2);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.deduplicated).toBe(true);
  });

  it("returns 400 for invalid/malformed payload (missing required fields)", async () => {
    const badPayload = { ingestId: "bad-id" }; // missing observedAt and dailyRollup
    const req = makeReq(badPayload, `Bearer ${bearerToken}`);
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for bad dailyRollup.day format", async () => {
    const req = makeReq(makePayload({
      dailyRollup: {
        day: "not-a-date",
        agentTimeMs: 0,
        sessions: 0,
        toolCalls: 0,
        turns: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    }), `Bearer ${bearerToken}`);
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
