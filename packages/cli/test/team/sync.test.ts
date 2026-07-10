import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SessionMeta } from "@claude-lens/parser";
import type {
  CalibrationCurve,
  CalibrationCurvePoint,
} from "@claude-lens/parser/fs";
import { __setEntriesDirForTest } from "@claude-lens/entries/fs";
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
    // Pin the entries cache per-test — entriesDir() caches on first access, so
    // without this the first test to touch it would lock every later test onto
    // an already-removed temp dir. Also isolates the on-the-spot entry builds.
    __setEntriesDirForTest(join(cclensDir, "entries"));

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

  it("keeps the watermark when an older day fails after newer days pushed", async () => {
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

    // Newest-first: 2026-04-15 pushed, then 2026-04-14 failed. The watermark
    // must not advance — 04-14 (and anything older) is still owed; the pushed
    // newer day re-uploads next tick via idempotent upserts.
    expect(result.failedDay).toBe("2026-04-14");
    expect(result.pushed).toBe(1);
    const writes = vi.mocked(writeTeamConfig).mock.calls.map((c) => c[0]);
    expect(writes.every((w) => w.lastSyncedDay === undefined)).toBe(true);
  });

  it("tombstones a day whose only activity is excluded (empty rollup overwrites stale row)", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue({
      ...CONFIG,
      syncProjects: { autoIncludeNew: true, included: [], excluded: ["personal"] },
    });

    const { listSessions } = await import("@claude-lens/parser/fs");
    vi.mocked(listSessions).mockResolvedValue([
      makeSession("2026-04-14", { projectName: "/u/x/Repo/work" }),
      makeSession("2026-04-15", { id: "sess_p", projectName: "/u/x/Repo/personal" }),
    ]);

    const { dequeuePayloads } = await import("../../src/team/queue.js");
    vi.mocked(dequeuePayloads).mockReturnValue([]);

    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    const { runTeamSync } = await import("../../src/team/sync.js");
    const result = await runTeamSync();
    expect(result.error).toBeUndefined();
    expect(result.pushed).toBe(2);

    const payloads = vi.mocked(fetch).mock.calls
      .map((c) => JSON.parse((c[1] as RequestInit).body as string))
      .filter((p) => p.dailyRollup);
    const tombstone = payloads.find((p) => p.dailyRollup.day === "2026-04-15");
    expect(tombstone.dailyRollup.sessions).toBe(0);
    expect(tombstone.dailyRollup.agentTimeMs).toBe(0);
    expect(tombstone.richRollup.projects).toEqual([]);
    expect(tombstone.enrichedExtras.outcomeMix).toEqual({});
    const workDay = payloads.find((p) => p.dailyRollup.day === "2026-04-14");
    expect(workDay.dailyRollup.sessions).toBe(1);
  });

  it("advances past a validation-poisoned (4xx) day without queueing it", async () => {
    const { readTeamConfig, writeTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(CONFIG);

    const { listSessions } = await import("@claude-lens/parser/fs");
    vi.mocked(listSessions).mockResolvedValue([
      makeSession("2026-04-14"),
      makeSession("2026-04-15"),
    ]);

    const { dequeuePayloads, enqueuePayload } = await import("../../src/team/queue.js");
    vi.mocked(dequeuePayloads).mockReturnValue([]);

    // First day 400 (unrecoverable validation error), second day 200.
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: "Validation failed" }),
      } as Response)
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response);

    const logs: Array<[string, string]> = [];
    const { runTeamSync } = await import("../../src/team/sync.js");
    const result = await runTeamSync((level, msg) => logs.push([level, msg]));

    // The poisoned day was skipped and the later day still pushed — the loop
    // made progress instead of wedging on the bad day.
    expect(result.pushed).toBe(1);
    expect(result.failedDay).toBeUndefined();
    // A validation-poisoned day is never queued (it would fail forever).
    expect(enqueuePayload).not.toHaveBeenCalled();
    // lastSyncedDay advances to today, past the poisoned day.
    const { toLocalDay } = await import("@claude-lens/parser");
    expect(writeTeamConfig).toHaveBeenCalledWith(
      expect.objectContaining({ lastSyncedDay: toLocalDay(Date.now()) }),
    );
    // The skip is surfaced in the one-per-run [sync] summary, never silent.
    expect(
      logs.some(([, m]) => m.startsWith("[sync] ") && m.includes("dropped 1 unrecoverable")),
    ).toBe(true);
  });

  it("advances the sync-log watermark ONLY when the server accepted the syncLog block", async () => {
    const { readTeamConfig, writeTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(CONFIG);

    const { listSessions } = await import("@claude-lens/parser/fs");
    vi.mocked(listSessions).mockResolvedValue([makeSession("2026-04-14")]);

    // A pending [sync] line on daemon.log (CCLENS_HOME) that the push carries.
    writeFileSync(
      join(cclensDir, "daemon.log"),
      "2026-04-10T00:00:00.000Z INFO [sync] ok · auto · pushed 1 day (2026-04-10)\n",
    );

    // Server ingests the day but SKIPS the syncLog block.
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ blocks: { accepted: ["dailyRollup"], skipped: {} } }),
    } as Response);

    const { runTeamSync } = await import("../../src/team/sync.js");
    await runTeamSync();

    const advanced = vi
      .mocked(writeTeamConfig)
      .mock.calls.some((c) => (c[0] as TeamConfig).lastSyncedLogAt === "2026-04-10T00:00:00.000Z");
    expect(advanced).toBe(false);
  });

  it("advances the sync-log watermark when the server accepts the syncLog block", async () => {
    const { readTeamConfig, writeTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(CONFIG);

    const { listSessions } = await import("@claude-lens/parser/fs");
    vi.mocked(listSessions).mockResolvedValue([makeSession("2026-04-14")]);

    writeFileSync(
      join(cclensDir, "daemon.log"),
      "2026-04-10T00:00:00.000Z INFO [sync] ok · auto · pushed 1 day (2026-04-10)\n",
    );

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ blocks: { accepted: ["dailyRollup", "syncLog"], skipped: {} } }),
    } as Response);

    const { runTeamSync } = await import("../../src/team/sync.js");
    await runTeamSync();

    const advanced = vi
      .mocked(writeTeamConfig)
      .mock.calls.some((c) => (c[0] as TeamConfig).lastSyncedLogAt === "2026-04-10T00:00:00.000Z");
    expect(advanced).toBe(true);
  });

  it("heals a dropped day whose sessions became excluded by retrying it as a tombstone", async () => {
    const { readTeamConfig, writeTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue({
      ...CONFIG,
      lastSyncedDay: "2026-04-14",
      droppedDays: ["2026-04-01"],
      syncProjects: { autoIncludeNew: true, included: [], excluded: ["personal"] },
    });

    const { listSessions } = await import("@claude-lens/parser/fs");
    // The dropped day's only session is now-excluded — no filtered rollup can
    // be rebuilt for it; without the tombstone retry it would zombie forever.
    vi.mocked(listSessions).mockResolvedValue([
      makeSession("2026-04-14", { projectName: "/u/x/Repo/work" }),
      makeSession("2026-04-01", { id: "sess_p", projectName: "/u/x/Repo/personal" }),
    ]);

    const { dequeuePayloads } = await import("../../src/team/queue.js");
    vi.mocked(dequeuePayloads).mockReturnValue([]);

    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    const { runTeamSync } = await import("../../src/team/sync.js");
    const result = await runTeamSync();
    expect(result.error).toBeUndefined();

    const payloads = vi.mocked(fetch).mock.calls
      .map((c) => JSON.parse((c[1] as RequestInit).body as string))
      .filter((p) => p.dailyRollup?.day === "2026-04-01");
    expect(payloads).toHaveLength(1);
    expect(payloads[0].dailyRollup.sessions).toBe(0);
    expect(payloads[0].richRollup.projects).toEqual([]);
    const clearedCall = vi
      .mocked(writeTeamConfig)
      .mock.calls.find((c) => Array.isArray((c[0] as TeamConfig).droppedDays));
    expect(clearedCall).toBeDefined();
    expect((clearedCall![0] as TeamConfig).droppedDays).toEqual([]);
  });

  it("retries the oldest dropped day and clears it from config on success", async () => {
    const { readTeamConfig, writeTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue({
      ...CONFIG,
      lastSyncedDay: "2026-04-14",
      droppedDays: ["2026-04-01"],
    });

    const { listSessions } = await import("@claude-lens/parser/fs");
    // The new day AND the previously-dropped day both have local sessions so
    // allRollups can rebuild the dropped day's full payload.
    vi.mocked(listSessions).mockResolvedValue([
      makeSession("2026-04-14"),
      makeSession("2026-04-01"),
    ]);

    // Main-loop day + retry day both 200.
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);

    const logs: Array<[string, string]> = [];
    const { runTeamSync } = await import("../../src/team/sync.js");
    await runTeamSync((level, msg) => logs.push([level, msg]));

    // Two pushes: the new day and the recovered day.
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(2);
    // Recovered day surfaced in the [sync] line.
    expect(
      logs.some(([, m]) => m.startsWith("[sync] ") && m.includes("recovered 1 dropped day (2026-04-01)")),
    ).toBe(true);
    // The dropped day is cleared from the persisted config.
    const clearedCall = vi
      .mocked(writeTeamConfig)
      .mock.calls.find((c) => Array.isArray((c[0] as TeamConfig).droppedDays));
    expect(clearedCall).toBeDefined();
    expect((clearedCall![0] as TeamConfig).droppedDays).toEqual([]);
  });

  it("leaves a dropped day in config when its retry still 400s", async () => {
    const { readTeamConfig, writeTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue({
      ...CONFIG,
      lastSyncedDay: "2026-04-14",
      droppedDays: ["2026-04-01"],
    });

    const { listSessions } = await import("@claude-lens/parser/fs");
    vi.mocked(listSessions).mockResolvedValue([
      makeSession("2026-04-14"),
      makeSession("2026-04-01"),
    ]);

    // Main-loop day 200, retry day still 400 (old server not yet upgraded).
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: "bad" }) } as Response)
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    const { runTeamSync } = await import("../../src/team/sync.js");
    await runTeamSync();

    // The day is NOT cleared — no config write drops it from droppedDays.
    const clearedCall = vi
      .mocked(writeTeamConfig)
      .mock.calls.find(
        (c) =>
          Array.isArray((c[0] as TeamConfig).droppedDays) &&
          !(c[0] as TeamConfig).droppedDays!.includes("2026-04-01"),
      );
    expect(clearedCall).toBeUndefined();
  });

  it("drops a 4xx-poison item during the queue drain instead of re-enqueueing it forever", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(CONFIG);

    const { listSessions } = await import("@claude-lens/parser/fs");
    vi.mocked(listSessions).mockResolvedValue([makeSession("2026-04-14")]);

    const { dequeuePayloads, enqueuePayload } = await import("../../src/team/queue.js");
    vi.mocked(dequeuePayloads).mockReturnValue([
      { ingestId: "queued-poison", observedAt: "2026-04-13T00:00:00.000Z" } as never,
    ]);

    // Fresh-day push OK, then the queued item 422s on drain (validation poison).
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ error: "Validation failed" }) } as Response)
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    const logs: Array<[string, string]> = [];
    const { runTeamSync } = await import("../../src/team/sync.js");
    const result = await runTeamSync((level, msg) => logs.push([level, msg]));

    expect(result.pushed).toBe(1);
    // The poison item was dropped: not counted as drained, and NOT re-enqueued
    // (the whole point — a queued poison used to loop forever and block the rest).
    expect(result.queuedDrained).toBe(0);
    expect(enqueuePayload).not.toHaveBeenCalled();
    expect(logs.some(([, m]) => m.includes("dropping unrecoverable item"))).toBe(true);
  });

  it("re-enqueues a transient (5xx) queued item during the drain", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(CONFIG);

    const { listSessions } = await import("@claude-lens/parser/fs");
    vi.mocked(listSessions).mockResolvedValue([makeSession("2026-04-14")]);

    const { dequeuePayloads, enqueuePayload } = await import("../../src/team/queue.js");
    vi.mocked(dequeuePayloads).mockReturnValue([
      { ingestId: "queued-transient", observedAt: "2026-04-13T00:00:00.000Z" } as never,
    ]);

    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) } as Response)
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    const { runTeamSync } = await import("../../src/team/sync.js");
    const result = await runTeamSync();

    expect(result.pushed).toBe(1);
    expect(result.queuedDrained).toBe(0);
    // Transient failure → the item is put back for a later retry, not dropped.
    expect(enqueuePayload).toHaveBeenCalledOnce();
  });

  it("does NOT advance past a 5xx day — queues for retry instead", async () => {
    const { readTeamConfig, writeTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(CONFIG);

    const { listSessions } = await import("@claude-lens/parser/fs");
    vi.mocked(listSessions).mockResolvedValue([makeSession("2026-04-14")]);

    const { enqueuePayload } = await import("../../src/team/queue.js");

    // Transient server error — must be retried, not skipped past.
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as Response);

    const { runTeamSync } = await import("../../src/team/sync.js");
    const result = await runTeamSync();

    expect(result.failedDay).toBe("2026-04-14");
    expect(enqueuePayload).toHaveBeenCalledOnce();
    // lastSyncedDay is NOT advanced — the day will be retried next tick.
    expect(writeTeamConfig).not.toHaveBeenCalledWith(
      expect.objectContaining({ lastSyncedDay: expect.anything() }),
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

    // At least one log entry should have been emitted (the [sync] summary line)
    expect(logMessages.length).toBeGreaterThanOrEqual(1);
    const summaryLine = logMessages.find(([, m]) => m.startsWith("[sync] "));
    expect(summaryLine).toBeDefined();
    expect(summaryLine![1]).toMatch(/^\[sync\] (ok|idle|degraded|failed|error) /);
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

  it("builds entries on the spot so a day with sessions but no cached entries still pushes richRollup", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(CONFIG);

    // A real, parseable claude-code transcript on disk — the fresh-pair case:
    // sessions exist but the perception sweep hasn't built any entries yet.
    const day = "2026-04-14";
    const sessionId = "ensure-entries-fixture-session";
    const filePath = join(cclensDir, `${sessionId}.jsonl`);
    writeFileSync(
      filePath,
      [
        JSON.stringify({
          type: "user",
          timestamp: `${day}T10:00:00.000Z`,
          cwd: "/Users/test/repo/foo",
          message: { role: "user", content: [{ type: "text", text: "hi" }] },
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: `${day}T10:00:30.000Z`,
          cwd: "/Users/test/repo/foo",
          message: {
            role: "assistant",
            model: "claude-sonnet-4-6",
            content: [{ type: "text", text: "hello" }],
          },
        }),
      ].join("\n"),
    );

    const startMs = Date.parse(`${day}T10:00:00.000Z`);
    const { listSessions } = await import("@claude-lens/parser/fs");
    vi.mocked(listSessions).mockResolvedValue([
      makeSession(day, { id: sessionId, filePath, projectName: "/Users/test/repo/foo",
        projectDir: "-Users-test-repo-foo", activeSegments: [{ startMs, endMs: startMs + 60_000 }] }),
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

    expect(result.pushed).toBeGreaterThanOrEqual(1);

    // The push carrying this day's rollup must include a richRollup block —
    // the whole point: rich blocks ride along even when no entry was cached.
    const dayPush = vi.mocked(fetch).mock.calls
      .map((c) => JSON.parse(String((c[1] as RequestInit).body)))
      .find((b) => b.dailyRollup?.day === day);
    expect(dayPush).toBeDefined();
    expect(dayPush.richRollup).toBeDefined();
    expect(dayPush.richRollup.day).toBe(day);
    expect(dayPush.richRollup.projects.length).toBeGreaterThanOrEqual(1);
    expect(dayPush.enrichedExtras).toBeDefined();
  });
});

describe("buildCyclePeaksForPush — ongoing-cycle reset rebaselining", () => {
  // The team sync pushes pre-computed cycle peaks; the server stores them
  // as-is. This is the parallel copy of previousCyclesTrend, so the same
  // mid-cycle-reset bug would push a stale 88% peak to the team dashboard.
  // These tests pin the rebaselining behavior that keeps the two copies
  // aligned (there is no shared lib — the web copy pulls `server-only`).

  function fakeCurve(
    curve: CalibrationCurvePoint[],
  ): typeof import("@claude-lens/parser/fs").loadCalibrationCurve {
    const dump: CalibrationCurve = {
      model: "test",
      tier: "pro-max-20x",
      rate_per_pct: 0,
      rate_per_pct_5h: 0,
      rate_per_pct_7d: 0,
      rate_source_5h: "tier_default",
      rate_source_7d: "tier_default",
      cycles_used_5h: 0,
      cycles_used_7d: 0,
      granularity_min: 30,
      curve,
      first_snapshot_ts: null,
      real_count: curve.length,
      total_count: curve.length,
    };
    return async () => dump;
  }

  function pt(ts: string, real7d: number | null, cycleEnd: string, pred7d = 0): CalibrationCurvePoint {
    return { ts, real_5h: null, pred_5h: 0, real_7d: real7d, pred_7d: pred7d, cycle_end_5h: null, cycle_end_7d: cycleEnd };
  }

  it("re-baselines the ongoing cycle past a mid-cycle limit reset", async () => {
    // Mirror of the live bug: same resets_at window, util 88 → 0 (reset) →
    // climbing back. The pushed peak must reflect post-reset reality.
    const past = "2024-06-01T00:00:00.000Z"; // completed (before real now)
    const future = "2099-01-10T00:00:00.000Z"; // ongoing (after real now)
    const { buildCyclePeaksForPush } = await import("../../src/team/sync.js");
    const result = await buildCyclePeaksForPush(
      "pro-max-20x",
      fakeCurve([
        pt("2024-05-20T00:00:00.000Z", 55, past),
        pt("2099-01-05T12:00:00.000Z", 88, future),
        pt("2099-01-05T13:00:00.000Z", 0, future),
        pt("2099-01-05T18:00:00.000Z", 30, future),
      ]),
    );
    expect(result).toBeDefined();
    const ongoing = result!.sevenDay.find((c) => c.current);
    expect(ongoing).toBeDefined();
    expect(ongoing!.peakPct).toBe(30);
    expect(ongoing!.source).toBe("real");
    // Completed cycle keeps its all-time max.
    const completed = result!.sevenDay.find((c) => !c.current);
    expect(completed!.peakPct).toBe(55);
  });

  it("does not cap a >100 predicted peak (team wire path passes overage through)", async () => {
    // Predicted overage is intentionally forwarded >100 (legit extra-usage)
    // — the team schema allows it. Regression guard that we did NOT port
    // the web copy's Math.min(...,100) cap.
    const past = "2024-06-01T00:00:00.000Z";
    const { buildCyclePeaksForPush } = await import("../../src/team/sync.js");
    const result = await buildCyclePeaksForPush(
      "pro-max-20x",
      fakeCurve([pt("2024-05-20T00:00:00.000Z", null, past, 148)]),
    );
    const completed = result!.sevenDay.find((c) => !c.current);
    expect(completed!.peakPct).toBe(148);
    expect(completed!.source).toBe("predicted");
  });

  it("returns undefined when the calibration curve is empty", async () => {
    const { buildCyclePeaksForPush } = await import("../../src/team/sync.js");
    const result = await buildCyclePeaksForPush(
      "pro-max-20x",
      (async () => null) as typeof import("@claude-lens/parser/fs").loadCalibrationCurve,
    );
    expect(result).toBeUndefined();
  });
});
