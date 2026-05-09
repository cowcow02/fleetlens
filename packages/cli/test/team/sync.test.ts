import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SessionMeta } from "@claude-lens/parser";
import type { TeamConfig } from "../../src/team/config.js";

// ---------- helpers ----------

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

// ---------- module mocks ----------

// Mock parser/fs so listSessions returns our fixture. loadCalibrationCurve
// returns null in tests — sync is meant to handle missing JSONL gracefully
// (cold-start, no daemon data) so this also exercises that branch.
vi.mock("@claude-lens/parser/fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@claude-lens/parser/fs")>();
  return {
    ...actual,
    listSessions: vi.fn(),
    loadCalibrationCurve: async () => null,
  };
});

// Stub the daemon's local-state readers to null so "no daily activity"
// tests exercise the truly-empty path (no rollups + no live data → no
// push). Tests that exercise the live-only push path can override these.
vi.mock("../../src/usage/storage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/usage/storage.js")>();
  return { ...actual, latestSnapshot: () => null };
});
vi.mock("../../src/usage/profile.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/usage/profile.js")>();
  return { ...actual, getPlanTier: async () => null };
});

// Mock config module so readTeamConfig / writeTeamConfig don't touch real disk
vi.mock("../../src/team/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/team/config.js")>();
  return {
    ...actual,
    readTeamConfig: vi.fn(),
    writeTeamConfig: vi.fn(),
  };
});

// Mock queue module so enqueuePayload / dequeuePayloads don't touch real disk
vi.mock("../../src/team/queue.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/team/queue.js")>();
  return {
    ...actual,
    enqueuePayload: vi.fn(),
    dequeuePayloads: vi.fn().mockReturnValue([]),
  };
});

// ---------- fixtures ----------

const CONFIG: TeamConfig = {
  serverUrl: "https://team.example.com",
  memberId: "mem_abc",
  bearerToken: "tok_secret",
  teamSlug: "acme",
  pairedAt: "2026-01-01T00:00:00.000Z",
};

describe("runTeamSync", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("returns paired:false when no team config", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(null);

    const { runTeamSync } = await import("../../src/team/sync.js");
    const result = await runTeamSync();

    expect(result).toEqual({ paired: false, pushed: 0, queued: 0, queuedDrained: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns pushed:0 when there are no sessions", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(CONFIG);

    const { listSessions } = await import("@claude-lens/parser/fs");
    vi.mocked(listSessions).mockResolvedValue([]);

    const { runTeamSync } = await import("../../src/team/sync.js");
    const result = await runTeamSync();

    expect(result.paired).toBe(true);
    expect(result.pushed).toBe(0);
    expect(result.queued).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("pushes each rollup day and updates lastSyncedDay on success", async () => {
    const { readTeamConfig, writeTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(CONFIG);

    const { listSessions } = await import("@claude-lens/parser/fs");
    vi.mocked(listSessions).mockResolvedValue([
      makeSession("2026-04-14"),
      makeSession("2026-04-15"),
    ]);

    const { dequeuePayloads } = await import("../../src/team/queue.js");
    vi.mocked(dequeuePayloads).mockReturnValue([]);

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ received: true }),
    } as Response);

    const { runTeamSync } = await import("../../src/team/sync.js");
    const result = await runTeamSync();

    expect(result.paired).toBe(true);
    expect(result.pushed).toBeGreaterThanOrEqual(1);
    expect(result.queued).toBe(0);
    // writeTeamConfig should have been called to advance lastSyncedDay
    expect(writeTeamConfig).toHaveBeenCalledOnce();
  });

  it("queues payload and stops on push failure", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(CONFIG);

    const { listSessions } = await import("@claude-lens/parser/fs");
    vi.mocked(listSessions).mockResolvedValue([
      makeSession("2026-04-14"),
      makeSession("2026-04-15"),
    ]);

    // First fetch fails
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: "unavailable" }),
    } as Response);

    const { enqueuePayload } = await import("../../src/team/queue.js");

    const { runTeamSync } = await import("../../src/team/sync.js");
    const result = await runTeamSync();

    expect(result.queued).toBeGreaterThanOrEqual(1);
    expect(enqueuePayload).toHaveBeenCalledOnce();
    expect(result.failedDay).toBeDefined();
  });

  it("drains queue after successful push", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(CONFIG);

    const { listSessions } = await import("@claude-lens/parser/fs");
    vi.mocked(listSessions).mockResolvedValue([makeSession("2026-04-14")]);

    // Provide a backlog payload that looks like a real IngestPayload
    const backlogPayload = {
      ingestId: "backlog-id",
      observedAt: new Date().toISOString(),
      dailyRollup: {
        day: "2026-04-13",
        agentTimeMs: 1000,
        sessions: 1,
        toolCalls: 0,
        turns: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    };

    const { dequeuePayloads } = await import("../../src/team/queue.js");
    vi.mocked(dequeuePayloads).mockReturnValueOnce([backlogPayload]);

    // All fetches succeed
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ received: true }),
    } as Response);

    const { runTeamSync } = await import("../../src/team/sync.js");
    const result = await runTeamSync();

    expect(result.queuedDrained).toBe(1);
  });

  it("re-enqueues remaining backlog on partial drain failure", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(CONFIG);

    const { listSessions } = await import("@claude-lens/parser/fs");
    vi.mocked(listSessions).mockResolvedValue([makeSession("2026-04-14")]);

    const makeBacklog = (id: string) => ({
      ingestId: id,
      observedAt: new Date().toISOString(),
      dailyRollup: {
        day: "2026-04-13",
        agentTimeMs: 1000,
        sessions: 1,
        toolCalls: 0,
        turns: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    });

    const { dequeuePayloads, enqueuePayload } = await import("../../src/team/queue.js");
    vi.mocked(dequeuePayloads).mockReturnValueOnce([
      makeBacklog("id-1"),
      makeBacklog("id-2"),
    ]);

    // First fetch (main push) succeeds; second (drain) fails
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({}),
      } as Response);

    const { runTeamSync } = await import("../../src/team/sync.js");
    const result = await runTeamSync();

    // Both remaining backlog items should be re-enqueued (starting at i=0, the failed one + remainder)
    expect(enqueuePayload).toHaveBeenCalledTimes(2);
    expect(result.queuedDrained).toBe(0);
  });

  it("returns error field when an exception is thrown", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(CONFIG);

    const { listSessions } = await import("@claude-lens/parser/fs");
    vi.mocked(listSessions).mockRejectedValueOnce(new Error("disk full"));

    const { runTeamSync } = await import("../../src/team/sync.js");
    const result = await runTeamSync();

    expect(result.paired).toBe(true);
    expect(result.error).toBe("disk full");
  });

  it("accepts a custom log function", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(CONFIG);

    const { listSessions } = await import("@claude-lens/parser/fs");
    vi.mocked(listSessions).mockResolvedValue([makeSession("2026-04-14")]);

    const { dequeuePayloads } = await import("../../src/team/queue.js");
    vi.mocked(dequeuePayloads).mockReturnValue([]);

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);

    const logMessages: Array<[string, string]> = [];
    const log = (level: "info" | "warn" | "error", msg: string) => {
      logMessages.push([level, msg]);
    };

    const { runTeamSync } = await import("../../src/team/sync.js");
    await runTeamSync(log);

    // At least one log entry should have been emitted (the push ok message)
    expect(logMessages.length).toBeGreaterThanOrEqual(1);
    const [, msg] = logMessages[0]!;
    expect(msg).toContain("team push");
  });

  it("respects sinceDay via config.lastSyncedDay — skips older data", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue({
      ...CONFIG,
      lastSyncedDay: "2026-04-15",
    });

    const { listSessions } = await import("@claude-lens/parser/fs");
    // Session from before the last sync
    vi.mocked(listSessions).mockResolvedValue([makeSession("2026-04-14")]);

    const { dequeuePayloads } = await import("../../src/team/queue.js");
    vi.mocked(dequeuePayloads).mockReturnValue([]);

    const { runTeamSync } = await import("../../src/team/sync.js");
    const result = await runTeamSync();

    // 2026-04-14 is before lastSyncedDay 2026-04-15, so nothing to push
    expect(result.pushed).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});
