import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SessionMeta } from "@claude-lens/parser";
import type { TeamConfig } from "../../src/team/config.js";
import type { LastPushRecord } from "../../src/team/last-push.js";

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
  return { ...actual, latestSnapshot: () => null, latestClaudeCodeSnapshot: () => null };
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

vi.mock("../../src/team/backfill.js", () => ({
  runTeamBackfill: vi.fn(),
}));

// ---------- fixtures ----------

const CONFIG: TeamConfig = {
  serverUrl: "https://team.example.com",
  memberId: "mem_abc",
  bearerToken: "tok_secret",
  teamSlug: "acme",
  pairedAt: "2026-01-01T00:00:00.000Z",
};

describe("runTeamSync", () => {
  let cclensDir: string;
  let prevCclensHome: string | undefined;

  beforeEach(async () => {
    // Redirect cclensHome() to a temp dir so writeLastPush{Success,Failure}
    // don't pollute the user's real ~/.cclens during tests.
    cclensDir = mkdtempSync(join(tmpdir(), "cclens-sync-"));
    prevCclensHome = process.env.CCLENS_HOME;
    process.env.CCLENS_HOME = cclensDir;

    vi.stubGlobal("fetch", vi.fn());
    const { runTeamBackfill } = await import("../../src/team/backfill.js");
    vi.mocked(runTeamBackfill).mockResolvedValue({
      paired: true,
      sentSnapshots: 0,
      insertedSnapshots: 0,
      skippedSnapshots: 0,
      batches: 0,
    });
  });

  afterEach(() => {
    if (prevCclensHome === undefined) delete process.env.CCLENS_HOME;
    else process.env.CCLENS_HOME = prevCclensHome;
    rmSync(cclensDir, { recursive: true, force: true });
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

  it("does not advance lastSyncedDay past an unpushed failed day", async () => {
    const { readTeamConfig, writeTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(CONFIG);

    const { listSessions } = await import("@claude-lens/parser/fs");
    vi.mocked(listSessions).mockResolvedValue([
      makeSession("2026-04-14"),
      makeSession("2026-04-15"),
    ]);

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

    expect(result.failedDay).toBe("2026-04-15");
    expect(writeTeamConfig).toHaveBeenCalledWith(
      expect.objectContaining({ lastSyncedDay: "2026-04-14" }),
    );
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

  it("passes usage-history high-water into the unified sync backfill", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue({
      ...CONFIG,
      lastSyncedUsageSnapshotAt: "2026-04-20T01:00:00.000Z",
    });

    const { listSessions } = await import("@claude-lens/parser/fs");
    vi.mocked(listSessions).mockResolvedValue([]);

    const { runTeamSync } = await import("../../src/team/sync.js");
    await runTeamSync();

    const { runTeamBackfill } = await import("../../src/team/backfill.js");
    expect(runTeamBackfill).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(String),
      expect.any(Object),
      { sinceCapturedAt: "2026-04-20T01:00:00.000Z" },
    );
  });

  it("writes team-last-push.json with ok:true after a successful per-rollup push", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(CONFIG);

    const { listSessions } = await import("@claude-lens/parser/fs");
    vi.mocked(listSessions).mockResolvedValue([makeSession("2026-04-14")]);

    const { dequeuePayloads } = await import("../../src/team/queue.js");
    vi.mocked(dequeuePayloads).mockReturnValue([]);

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ received: true }),
    } as Response);

    const { runTeamSync } = await import("../../src/team/sync.js");
    await runTeamSync();

    const path = join(cclensDir, "team-last-push.json");
    expect(existsSync(path)).toBe(true);
    const record: LastPushRecord = JSON.parse(readFileSync(path, "utf8"));
    expect(record.ok).toBe(true);
    expect(record.error).toBeUndefined();
    expect(record.payload.dailyRollup?.day).toBe("2026-04-14");
    expect(Number.isFinite(Date.parse(record.pushedAt))).toBe(true);
  });

  it("writes team-last-push.json with ok:false and status in error after a 401 failure", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(CONFIG);

    const { listSessions } = await import("@claude-lens/parser/fs");
    vi.mocked(listSessions).mockResolvedValue([makeSession("2026-04-14")]);

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "unauthorized" }),
    } as Response);

    const { runTeamSync } = await import("../../src/team/sync.js");
    await runTeamSync();

    const path = join(cclensDir, "team-last-push.json");
    expect(existsSync(path)).toBe(true);
    const record: LastPushRecord = JSON.parse(readFileSync(path, "utf8"));
    expect(record.ok).toBe(false);
    expect(record.error).toContain("401");
    expect(record.payload.dailyRollup?.day).toBe("2026-04-14");
  });

  it("dispatches server-issued commands and pushes a bare-results payload", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(CONFIG);

    const { listSessions } = await import("@claude-lens/parser/fs");
    // No sessions → no rollups → live-only fast path (with hasLiveData false).
    // But we want the live-only push to fire so the response delivers a
    // command. So we make sure the live-only success branch runs by
    // returning a session so the per-rollup path executes instead — easier
    // to control because we know exactly which fetch call delivers the
    // command response.
    vi.mocked(listSessions).mockResolvedValue([makeSession("2026-04-14")]);

    const { dequeuePayloads } = await import("../../src/team/queue.js");
    vi.mocked(dequeuePayloads).mockReturnValue([]);

    // First fetch: per-rollup push returns a command for the daemon to run.
    // Second fetch: the backfill-activity dispatcher pushes a daily rollup
    //   (listSessions returns the same fixture, so buildRollupsForRange will
    //   produce at least one rollup since the targetDay is `today - 1`).
    // Last fetch: the bare commandResults push.
    // All subsequent fetches succeed without commands so we don't loop forever.
    vi.mocked(fetch).mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as Response;
    });
    // Only the FIRST call returns a command.
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        commands: [
          { id: "cmd_test", type: "backfill-activity", params: { days: 1 } },
        ],
      }),
    } as Response);

    const { runTeamSync } = await import("../../src/team/sync.js");
    await runTeamSync();

    // Find the call whose body contains commandResults — that's the bare
    // results push.
    const calls = vi.mocked(fetch).mock.calls;
    const resultsCall = calls.find((c) => {
      const init = c[1] as RequestInit | undefined;
      if (!init?.body) return false;
      const parsed = JSON.parse(String(init.body));
      return Array.isArray(parsed.commandResults);
    });
    expect(resultsCall).toBeDefined();
    const parsedBody = JSON.parse(String((resultsCall![1] as RequestInit).body));
    expect(parsedBody.commandResults).toHaveLength(1);
    expect(parsedBody.commandResults[0]).toMatchObject({
      id: "cmd_test",
      ok: true,
    });
    // `summary.pushed` should be present from the backfill-activity handler.
    expect(parsedBody.commandResults[0].summary).toBeDefined();
  });

  it("dispatcher push failure does not reverse the main sync outcome", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(CONFIG);

    const { listSessions } = await import("@claude-lens/parser/fs");
    vi.mocked(listSessions).mockResolvedValue([makeSession("2026-04-14")]);

    const { dequeuePayloads } = await import("../../src/team/queue.js");
    vi.mocked(dequeuePayloads).mockReturnValue([]);

    // First call (regular per-rollup push) succeeds and delivers a command.
    // Second call (dispatcher's internal backfill push) REJECTS, simulating a
    // fetch timeout / network error. Any subsequent calls succeed.
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          commands: [
            { id: "cmd_fail", type: "backfill-activity", params: { days: 1 } },
          ],
        }),
      } as Response)
      .mockRejectedValueOnce(new Error("ETIMEDOUT"))
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as Response);

    const { runTeamSync } = await import("../../src/team/sync.js");
    const result = await runTeamSync();

    // The regular per-rollup push succeeded BEFORE the dispatcher failed.
    // The outer try/catch must not have swallowed the throw and reversed the
    // outcome into an error result.
    expect(result.paired).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.pushed).toBeGreaterThan(0);
  });

  it("deduplicates the same command id echoed in multiple push responses within one sync", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(CONFIG);

    // Two sessions on two different days → buildRollupsForRange produces
    // two rollups → the per-rollup loop fires two pushes. Both push responses
    // echo the SAME pending command (server hasn't seen completion yet, so it
    // re-delivers on every ingest). The dispatcher should only run it once.
    const { listSessions } = await import("@claude-lens/parser/fs");
    vi.mocked(listSessions).mockResolvedValue([
      makeSession("2026-04-13"),
      makeSession("2026-04-14"),
    ]);

    const { dequeuePayloads } = await import("../../src/team/queue.js");
    vi.mocked(dequeuePayloads).mockReturnValue([]);

    const DUP_COMMAND = {
      ok: true,
      commands: [{ id: "cmd_dup", type: "backfill-activity", params: { days: 1 } }],
    };
    // Default: every fetch succeeds, no commands.
    vi.mocked(fetch).mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }) as Response);
    // First two fetches (the two per-rollup pushes) BOTH return the same command.
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => DUP_COMMAND } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => DUP_COMMAND } as Response);

    const { runTeamSync } = await import("../../src/team/sync.js");
    await runTeamSync();

    const calls = vi.mocked(fetch).mock.calls;
    const resultsCalls = calls.filter((c) => {
      const init = c[1] as RequestInit | undefined;
      if (!init?.body) return false;
      const parsed = JSON.parse(String(init.body));
      return Array.isArray(parsed.commandResults);
    });
    // Exactly one bare-results push, and it carries exactly one result for
    // cmd_dup — even though the command was delivered twice.
    expect(resultsCalls).toHaveLength(1);
    const parsedBody = JSON.parse(String((resultsCalls[0]![1] as RequestInit).body));
    expect(parsedBody.commandResults).toHaveLength(1);
    expect(parsedBody.commandResults[0]).toMatchObject({ id: "cmd_dup", ok: true });
  });

  it("persists usage-history high-water after successful backfill", async () => {
    const { readTeamConfig, writeTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(CONFIG);

    const { runTeamBackfill } = await import("../../src/team/backfill.js");
    vi.mocked(runTeamBackfill).mockResolvedValueOnce({
      paired: true,
      sentSnapshots: 2,
      insertedSnapshots: 2,
      skippedSnapshots: 0,
      batches: 1,
      lastSnapshotAt: "2026-04-20T02:00:00.000Z",
    });

    const { listSessions } = await import("@claude-lens/parser/fs");
    vi.mocked(listSessions).mockResolvedValue([]);

    const { runTeamSync } = await import("../../src/team/sync.js");
    await runTeamSync();

    expect(writeTeamConfig).toHaveBeenCalledWith(
      expect.objectContaining({ lastSyncedUsageSnapshotAt: "2026-04-20T02:00:00.000Z" }),
    );
  });
});
