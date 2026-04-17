import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SessionMeta } from "@claude-lens/parser";
import {
  bucketToRollup,
  buildRollupsForRange,
  buildIngestPayload,
  pushToTeamServer,
} from "../../src/team/push.js";
import type { TeamConfig } from "../../src/team/config.js";

function makeSession(dayISO: string, overrides: Partial<SessionMeta> = {}): SessionMeta {
  const startMs = Date.parse(`${dayISO}T10:00:00.000Z`);
  return {
    id: `sess_${dayISO}`,
    filePath: `/tmp/${dayISO}.jsonl`,
    projectName: "/tmp/project",
    projectDir: "tmp-project",
    sessionId: `sess_${dayISO}`,
    eventCount: 10,
    totalUsage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5 },
    status: "idle",
    airTimeMs: 60_000,
    toolCallCount: 5,
    turnCount: 3,
    firstTimestamp: new Date(startMs).toISOString(),
    activeSegments: [{ startMs, endMs: startMs + 60_000 }],
    ...overrides,
  };
}

const CONFIG: TeamConfig = {
  serverUrl: "https://team.example.com",
  memberId: "mem_abc",
  bearerToken: "tok_secret",
  teamSlug: "acme",
  pairedAt: "2026-01-01T00:00:00.000Z",
};

describe("bucketToRollup", () => {
  it("maps airTimeMs → agentTimeMs and date → day", () => {
    const rollup = bucketToRollup({
      date: "2026-04-16",
      sessions: 3,
      toolCalls: 10,
      turns: 5,
      tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
      durationMs: 500,
      airTimeMs: 120_000,
      peakParallelism: 1,
    });
    expect(rollup).toEqual({
      day: "2026-04-16",
      agentTimeMs: 120_000,
      sessions: 3,
      toolCalls: 10,
      turns: 5,
      tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
    });
  });
});

describe("buildRollupsForRange", () => {
  it("returns empty array for no sessions", () => {
    expect(buildRollupsForRange([])).toEqual([]);
  });

  it("returns one rollup per local day the sessions touched", () => {
    const rollups = buildRollupsForRange([
      makeSession("2026-04-14"),
      makeSession("2026-04-16"),
    ]);
    const days = rollups.map((r) => r.day);
    expect(days).toContain("2026-04-14");
    expect(days).toContain("2026-04-16");
  });

  it("attributes sessions to start-day only (no multi-day double count)", () => {
    // Two sessions that started the same day
    const day = "2026-04-14";
    const startMs = Date.parse(`${day}T10:00:00.000Z`);
    const longSession = makeSession(day, {
      id: "long",
      activeSegments: [{ startMs, endMs: startMs + 3 * 24 * 3600 * 1000 }], // 3-day span
    });
    const rollups = buildRollupsForRange([longSession]);
    const totalSessions = rollups.reduce((sum, r) => sum + r.sessions, 0);
    expect(totalSessions).toBe(1);
    expect(rollups.find((r) => r.day === day)?.sessions).toBe(1);
  });

  it("respects sinceDay filter", () => {
    const rollups = buildRollupsForRange(
      [makeSession("2026-04-14"), makeSession("2026-04-15"), makeSession("2026-04-16")],
      "2026-04-15",
    );
    const days = rollups.map((r) => r.day);
    expect(days).not.toContain("2026-04-14");
    expect(days).toContain("2026-04-15");
    expect(days).toContain("2026-04-16");
  });
});

describe("buildIngestPayload", () => {
  it("wraps rollup with UUID ingestId and ISO observedAt", () => {
    const rollup = bucketToRollup({
      date: "2026-04-16", sessions: 0, toolCalls: 0, turns: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      durationMs: 0, airTimeMs: 0, peakParallelism: 0,
    });
    const before = Date.now();
    const payload = buildIngestPayload(rollup);
    const after = Date.now();

    expect(payload.dailyRollup).toEqual(rollup);
    expect(payload.ingestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const ts = Date.parse(payload.observedAt);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("generates a unique ingestId on each call", () => {
    const rollup = bucketToRollup({
      date: "2026-04-16", sessions: 0, toolCalls: 0, turns: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      durationMs: 0, airTimeMs: 0, peakParallelism: 0,
    });
    const a = buildIngestPayload(rollup);
    const b = buildIngestPayload(rollup);
    expect(a.ingestId).not.toBe(b.ingestId);
  });
});

describe("pushToTeamServer", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls fetch with correct URL, headers, and body", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ received: true }),
    } as Response);

    const rollup = bucketToRollup({
      date: "2026-04-16", sessions: 0, toolCalls: 0, turns: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      durationMs: 0, airTimeMs: 0, peakParallelism: 0,
    });
    const payload = buildIngestPayload(rollup);
    const result = await pushToTeamServer(CONFIG, payload);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://team.example.com/api/ingest/metrics");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer tok_secret",
    });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(payload);
    expect(result).toEqual({ ok: true, status: 200, body: { received: true } });
  });

  it("returns ok:false on server error", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "unauthorized" }),
    } as Response);

    const rollup = bucketToRollup({
      date: "2026-04-16", sessions: 0, toolCalls: 0, turns: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      durationMs: 0, airTimeMs: 0, peakParallelism: 0,
    });
    const payload = buildIngestPayload(rollup);
    const result = await pushToTeamServer(CONFIG, payload);
    expect(result).toEqual({ ok: false, status: 401, body: { error: "unauthorized" } });
  });
});
