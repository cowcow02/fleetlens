import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/team/push.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/team/push.js")>();
  return {
    ...real,
    pushToTeamServer: vi.fn(async () => ({ ok: true, status: 200, body: null })),
    buildRollupsForRange: vi.fn(() => [
      { day: "2026-07-06", agentTimeMs: 1, sessions: 1, toolCalls: 0, turns: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, uniqueSessions: 1 },
      { day: "2026-07-07", agentTimeMs: 1, sessions: 1, toolCalls: 0, turns: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, uniqueSessions: 1 },
    ]),
    buildRichBlocksForDay: vi.fn(() => null),
    readLatestUsageSnapshotForWire: vi.fn(() => null),
    resetEnsuredSessions: vi.fn(),
    sessionTouchesDay: vi.fn(() => false),
    buildIngestPayload: vi.fn((x: object) => ({ ingestId: "i", observedAt: "now", ...x })),
  };
});
vi.mock("../../src/team/backfill.js", () => ({
  runTeamBackfill: vi.fn(async () => ({ sentSnapshots: 3, insertedSnapshots: 3, skippedSnapshots: 0 })),
}));
vi.mock("../../src/team/queue.js", () => ({ enqueuePayload: vi.fn(), dequeuePayloads: vi.fn(() => []) }));
vi.mock("../../src/team/sync-log.js", () => ({ readPendingSyncLog: vi.fn(() => ({ lines: [], watermark: null })) }));
vi.mock("../../src/team/last-push.js", () => ({ writeLastPushSuccess: vi.fn(), writeLastPushFailure: vi.fn() }));
vi.mock("../../src/team/commands.js", () => ({ dispatchCommand: vi.fn() }));
vi.mock("../../src/team/git-remote.js", () => ({ createRepoResolver: vi.fn(() => () => null) }));
vi.mock("../../src/usage/profile.js", () => ({ getPlanTier: vi.fn(async () => null) }));
vi.mock("../../src/perception/file-probe.js", () => ({ probeArtifactSignals: vi.fn(() => null) }));
vi.mock("@claude-lens/parser/fs", async (importOriginal) => {
  const real = await importOriginal<object>();
  return {
    ...real,
    listSessions: vi.fn(async () => []),
    loadCalibrationCurve: vi.fn(async () => null),
  };
});
// team.json writes: point CCLENS_HOME at a tmp dir (config module resolves per call)
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.CCLENS_HOME = mkdtempSync(join(tmpdir(), "cclens-progress-"));

import { runTeamSync, type SyncProgressEvent } from "../../src/team/sync.js";
import { pushToTeamServer } from "../../src/team/push.js";
import { dequeuePayloads } from "../../src/team/queue.js";
import { writeTeamConfig, readTeamConfig, type TeamConfig } from "@claude-lens/parser/fs";

describe("runTeamSync onProgress", () => {
  it("emits phase → usage → phase(activity) → day×2 → done, in order", async () => {
    const events: SyncProgressEvent[] = [];
    const outcome = await runTeamSync(
      () => {},
      { serverUrl: "http://mocked", memberId: "m", bearerToken: "t", teamSlug: "s", pairedAt: "x" },
      { onProgress: (ev) => events.push(ev) },
    );
    expect(outcome.pushed).toBe(2);
    expect(events.map((e) => e.type)).toEqual(["phase", "usage", "phase", "day", "day", "done"]);
    const days = events.filter((e): e is Extract<SyncProgressEvent, { type: "day" }> => e.type === "day");
    expect(days[0]).toMatchObject({ day: "2026-07-06", index: 1, total: 2, outcome: "pushed" });
    expect(days[1]).toMatchObject({ day: "2026-07-07", index: 2, total: 2, outcome: "pushed" });
    const done = events.at(-1) as Extract<SyncProgressEvent, { type: "done" }>;
    expect(done).toMatchObject({ pushed: 2, queued: 0 });
  });

  it("persistConfig merges watermarks onto fresh disk state (concurrent web write survives)", async () => {
    const base: TeamConfig = { serverUrl: "http://mocked", memberId: "m", bearerToken: "t", teamSlug: "s", pairedAt: "x" };
    // A web write (Settings selection) landed AFTER the daemon snapshotted its
    // config — the run's watermark writes must not clobber it.
    const selection = { autoIncludeNew: false, included: ["work"], excluded: ["personal"] };
    writeTeamConfig({ ...base, syncProjects: selection });
    const outcome = await runTeamSync(() => {}, base, {});
    expect(outcome.pushed).toBe(2);
    const onDisk = readTeamConfig();
    expect(onDisk?.syncProjects).toEqual(selection);
    expect(onDisk?.lastSyncedDay).toBeTruthy();
  });

  it("drainBacklog drops queued payloads containing now-excluded projects", async () => {
    vi.mocked(pushToTeamServer).mockClear();
    vi.mocked(dequeuePayloads).mockReturnValueOnce([
      { ingestId: "q1", observedAt: "x", richRollup: { day: "2026-07-05", projects: [{ project: "personal", agentTimeMs: 1, sessions: 1 }] } },
      { ingestId: "q2", observedAt: "x", richRollup: { day: "2026-07-05", projects: [{ project: "work", agentTimeMs: 1, sessions: 1 }] } },
    ] as never);
    const outcome = await runTeamSync(
      () => {},
      {
        serverUrl: "http://mocked", memberId: "m", bearerToken: "t", teamSlug: "s", pairedAt: "x",
        syncProjects: { autoIncludeNew: true, included: [], excluded: ["personal"] },
      },
      {},
    );
    expect(outcome.queuedDrained).toBe(1);
    const pushedIds = vi.mocked(pushToTeamServer).mock.calls.map((c) => (c[1] as { ingestId?: string }).ingestId);
    expect(pushedIds).toContain("q2");
    expect(pushedIds).not.toContain("q1");
  });
});
