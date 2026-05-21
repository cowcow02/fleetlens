import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resetDb } from "../helpers/db.js";
import { NextRequest } from "next/server";
import { getPool } from "../../src/db/pool.js";
import { POST } from "../../src/app/api/ingest/metrics/route.js";
import { createUserAccount } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";
let pool: ReturnType<typeof getPool>;
let bearerToken: string;
let membershipId: string;
let teamId: string;
let adminUserId: string;

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

function makeSnap(capturedAt: string) {
  return {
    capturedAt,
    fiveHour: { utilization: 30, resetsAt: "2026-06-01T07:10:00+00:00" },
    sevenDay: { utilization: 40, resetsAt: "2026-06-05T12:00:00+00:00" },
    sevenDayOpus: null,
    sevenDaySonnet: null,
    sevenDayOauthApps: null,
    sevenDayCowork: null,
    extraUsage: null,
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
  const { membership, team } = await createTeamWithAdmin("Ingest Route Team", admin.id, pool);
  bearerToken = membership.bearerToken;
  membershipId = membership.id;
  teamId = team.id;
  adminUserId = admin.id;
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
    // Headline ingest_log dedup MUST NOT short-circuit snapshotHistory —
    // row-level dedup via captured_at owns the idempotency for the bulk path.
    const sharedIngestId = `ingest-shared-${Math.random().toString(36).slice(2)}`;
    const first = await POST(makeReq({
      ingestId: sharedIngestId,
      observedAt: new Date().toISOString(),
      snapshotHistory: [makeSnap("2026-06-01T01:00:00+00:00"), makeSnap("2026-06-01T01:05:00+00:00")],
    }, `Bearer ${bearerToken}`));
    expect(first.status).toBe(200);
    expect((await first.json()).snapshotHistory).toEqual({ received: 2, inserted: 2, skipped: 0 });

    const second = await POST(makeReq({
      ingestId: sharedIngestId,
      observedAt: new Date().toISOString(),
      snapshotHistory: [makeSnap("2026-06-01T01:10:00+00:00"), makeSnap("2026-06-01T01:15:00+00:00")],
    }, `Bearer ${bearerToken}`));
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.deduplicated).toBe(true);
    expect(secondBody.snapshotHistory).toEqual({ received: 2, inserted: 2, skipped: 0 });
  });

  it("accepts snapshotHistory and reports inserted/skipped counts", async () => {
    const payload = {
      ingestId: `ingest-${Math.random().toString(36).slice(2)}`,
      observedAt: new Date().toISOString(),
      snapshotHistory: [
        makeSnap("2026-05-21T01:00:00+00:00"),
        makeSnap("2026-05-21T01:05:00+00:00"),
        makeSnap("2026-05-21T01:10:00+00:00"),
      ],
    };
    const res = await POST(makeReq(payload, `Bearer ${bearerToken}`));
    expect(res.status).toBe(200);
    expect((await res.json()).snapshotHistory).toEqual({ received: 3, inserted: 3, skipped: 0 });

    // Re-send the same batch with a fresh ingestId — captured_at unique key
    // dedups all three rows.
    const replay = await POST(makeReq({ ...payload, ingestId: `ingest-${Math.random().toString(36).slice(2)}` }, `Bearer ${bearerToken}`));
    expect((await replay.json()).snapshotHistory).toEqual({ received: 3, inserted: 0, skipped: 3 });
  });

  it("collapses intra-batch duplicate captured_at values", async () => {
    // PG raises a cardinality violation if a single INSERT ... ON CONFLICT
    // proposes two rows for the same conflict target. The multi-row insert
    // helper has to dedupe by captured_at before sending.
    const dupTs = "2026-06-15T03:00:00+00:00";
    const payload = {
      ingestId: `ingest-dup-${Math.random().toString(36).slice(2)}`,
      observedAt: new Date().toISOString(),
      snapshotHistory: [makeSnap(dupTs), makeSnap(dupTs), makeSnap("2026-06-15T03:05:00+00:00")],
    };
    const res = await POST(makeReq(payload, `Bearer ${bearerToken}`));
    expect(res.status).toBe(200);
    // received counts what the caller sent; inserted is unique rows that
    // actually landed (2 unique captured_at, both new).
    expect((await res.json()).snapshotHistory).toEqual({ received: 3, inserted: 2, skipped: 1 });
  });
});

describe("POST /api/ingest/metrics — member command channel", () => {
  async function enqueueCommand(id: string, type: string, params: Record<string, unknown>) {
    await pool.query(
      `INSERT INTO member_commands (id, team_id, membership_id, command_type, params, issued_by_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, teamId, membershipId, type, params, adminUserId],
    );
  }

  it("delivers pending commands, marks delivered_at, processes results, and stops re-delivering completed", async () => {
    // Wipe any rows from prior tests so this describe is self-contained.
    await pool.query("DELETE FROM member_commands WHERE membership_id = $1", [membershipId]);

    const cmdId = `cmd-${Math.random().toString(36).slice(2)}`;
    await enqueueCommand(cmdId, "backfill_history", { days: 90 });

    // 1) First ingest: command is delivered in response.
    const first = await POST(makeReq(makePayload(), `Bearer ${bearerToken}`));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.commands).toBeDefined();
    expect(firstBody.commands).toHaveLength(1);
    expect(firstBody.commands[0]).toEqual({
      id: cmdId,
      type: "backfill_history",
      params: { days: 90 },
    });

    // 2) delivered_at is stamped on first delivery.
    const delivered = await pool.query<{ delivered_at: Date | null; completed_at: Date | null }>(
      "SELECT delivered_at, completed_at FROM member_commands WHERE id = $1",
      [cmdId],
    );
    expect(delivered.rows[0].delivered_at).not.toBeNull();
    expect(delivered.rows[0].completed_at).toBeNull();

    // 3) Follow-up ingest with a commandResult marks the command complete.
    const completedAt = new Date().toISOString();
    const second = await POST(makeReq(makePayload({
      commandResults: [{ id: cmdId, ok: true, completedAt, summary: { inserted: 42 } }],
    }), `Bearer ${bearerToken}`));
    expect(second.status).toBe(200);

    const afterResult = await pool.query<{ completed_at: Date | null; result: unknown }>(
      "SELECT completed_at, result FROM member_commands WHERE id = $1",
      [cmdId],
    );
    expect(afterResult.rows[0].completed_at).not.toBeNull();
    expect(afterResult.rows[0].result).toEqual({ ok: true, summary: { inserted: 42 } });

    // 4) Third ingest: completed command must not be re-delivered.
    const third = await POST(makeReq(makePayload(), `Bearer ${bearerToken}`));
    expect(third.status).toBe(200);
    const thirdBody = await third.json();
    expect(thirdBody.commands).toBeUndefined();
  });

  it("does not overwrite a previously-completed command if a stale result is replayed", async () => {
    await pool.query("DELETE FROM member_commands WHERE membership_id = $1", [membershipId]);
    const cmdId = `cmd-${Math.random().toString(36).slice(2)}`;
    await enqueueCommand(cmdId, "backfill_history", {});

    // Pre-complete the row with a success record.
    const firstCompletedAt = "2026-05-20T10:00:00.000Z";
    await pool.query(
      `UPDATE member_commands SET delivered_at = now(), completed_at = $1, result = $2 WHERE id = $3`,
      [firstCompletedAt, { ok: true, summary: { inserted: 7 } }, cmdId],
    );

    // Send a stale "this failed" result — the completed_at IS NULL guard
    // should prevent any clobber.
    const res = await POST(makeReq(makePayload({
      commandResults: [{ id: cmdId, ok: false, completedAt: "2026-05-20T11:00:00.000Z", error: "stale" }],
    }), `Bearer ${bearerToken}`));
    expect(res.status).toBe(200);

    const row = await pool.query<{ completed_at: Date; result: { ok: boolean; summary?: { inserted: number } } }>(
      "SELECT completed_at, result FROM member_commands WHERE id = $1",
      [cmdId],
    );
    expect(row.rows[0].result).toEqual({ ok: true, summary: { inserted: 7 } });
    expect(row.rows[0].completed_at.toISOString()).toBe(firstCompletedAt);
  });

  it("delivers pending commands even when the ingest body is a dedupe replay", async () => {
    await pool.query("DELETE FROM member_commands WHERE membership_id = $1", [membershipId]);

    // Send a payload once to populate ingest_log.
    const payload = makePayload();
    const initial = await POST(makeReq(payload, `Bearer ${bearerToken}`));
    expect(initial.status).toBe(200);

    // Now enqueue a command and replay the same ingestId.
    const cmdId = `cmd-${Math.random().toString(36).slice(2)}`;
    await enqueueCommand(cmdId, "backfill_history", { days: 7 });

    const replay = await POST(makeReq(payload, `Bearer ${bearerToken}`));
    // Dedup replay returns 202; commands should still ride along.
    expect(replay.status).toBe(202);
    const body = await replay.json();
    expect(body.deduplicated).toBe(true);
    expect(body.commands).toHaveLength(1);
    expect(body.commands[0].id).toBe(cmdId);
  });
});
