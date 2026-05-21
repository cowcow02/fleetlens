import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resetDb } from "../helpers/db.js";
import { NextRequest } from "next/server";
import { getPool } from "../../src/db/pool.js";
import { POST } from "../../src/app/api/ingest/metrics/route.js";
import { createUserAccount } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";
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
  pool = await resetDb();
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

  it("processes snapshotHistory even when ingestId is deduplicated", async () => {
    // The headline-payload dedup gate (ingest_log) MUST NOT short-circuit
    // snapshotHistory processing — row-level dedup via captured_at handles
    // the idempotency for the bulk path. This test is the load-bearing one
    // for the "retried batch with same ingestId still applies new rows"
    // invariant in IngestPayload's schema comment.
    const snap = (capturedAt: string) => ({
      capturedAt,
      fiveHour: { utilization: 30, resetsAt: "2026-06-01T07:10:00+00:00" },
      sevenDay: { utilization: 40, resetsAt: "2026-06-05T12:00:00+00:00" },
      sevenDayOpus: null,
      sevenDaySonnet: null,
      sevenDayOauthApps: null,
      sevenDayCowork: null,
      extraUsage: null,
    });
    const sharedIngestId = `ingest-shared-${Math.random().toString(36).slice(2)}`;
    const first = await POST(makeReq({
      ingestId: sharedIngestId,
      observedAt: new Date().toISOString(),
      snapshotHistory: [snap("2026-06-01T01:00:00+00:00"), snap("2026-06-01T01:05:00+00:00")],
    }, `Bearer ${bearerToken}`));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.snapshotHistory).toEqual({ received: 2, inserted: 2, skipped: 0 });

    // Replay with the SAME ingestId but DIFFERENT captured_at values. The
    // headline ingest_log gate dedups (response carries deduplicated: true)
    // but the new snapshots must still land.
    const second = await POST(makeReq({
      ingestId: sharedIngestId,
      observedAt: new Date().toISOString(),
      snapshotHistory: [snap("2026-06-01T01:10:00+00:00"), snap("2026-06-01T01:15:00+00:00")],
    }, `Bearer ${bearerToken}`));
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.deduplicated).toBe(true);
    expect(secondBody.snapshotHistory).toEqual({ received: 2, inserted: 2, skipped: 0 });
  });

  it("accepts snapshotHistory and reports inserted/skipped counts", async () => {
    const snap = (capturedAt: string) => ({
      capturedAt,
      fiveHour: { utilization: 30, resetsAt: "2026-05-21T07:10:00+00:00" },
      sevenDay: { utilization: 40, resetsAt: "2026-05-25T12:00:00+00:00" },
      sevenDayOpus: null,
      sevenDaySonnet: null,
      sevenDayOauthApps: null,
      sevenDayCowork: null,
      extraUsage: null,
    });
    const payload = {
      ingestId: `ingest-${Math.random().toString(36).slice(2)}`,
      observedAt: new Date().toISOString(),
      snapshotHistory: [
        snap("2026-05-21T01:00:00+00:00"),
        snap("2026-05-21T01:05:00+00:00"),
        snap("2026-05-21T01:10:00+00:00"),
      ],
    };
    const req = makeReq(payload, `Bearer ${bearerToken}`);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.snapshotHistory).toEqual({ received: 3, inserted: 3, skipped: 0 });

    // Re-send the same batch — captured_at unique key dedups all three rows.
    const replay = await POST(makeReq({ ...payload, ingestId: `ingest-${Math.random().toString(36).slice(2)}` }, `Bearer ${bearerToken}`));
    const replayBody = await replay.json();
    expect(replayBody.snapshotHistory).toEqual({ received: 3, inserted: 0, skipped: 3 });
  });
});
