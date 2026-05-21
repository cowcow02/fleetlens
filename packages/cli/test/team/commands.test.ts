import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { TeamConfig } from "@claude-lens/parser/fs";
import type { ServerCommand } from "../../src/team/commands.js";

const noopLog = () => {};

const SAMPLE_CONFIG: TeamConfig = {
  serverUrl: "https://team.example.com",
  memberId: "mem_test",
  bearerToken: "tok_test",
  teamSlug: "acme",
  teamName: "Acme",
  pairedAt: "2026-05-01T00:00:00.000Z",
};

let testHome: string;
let prevCclensHome: string | undefined;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), "cclens-commands-"));
  prevCclensHome = process.env.CCLENS_HOME;
  process.env.CCLENS_HOME = testHome;
  vi.resetModules();
});

afterEach(() => {
  if (prevCclensHome === undefined) delete process.env.CCLENS_HOME;
  else process.env.CCLENS_HOME = prevCclensHome;
  rmSync(testHome, { recursive: true, force: true });
  vi.doUnmock("@claude-lens/parser/fs");
});

describe("dispatchCommand", () => {
  it("returns ok:false for an unknown command type", async () => {
    const { dispatchCommand } = await import("../../src/team/commands.js");
    const cmd = { id: "cmd_x", type: "unknown-type", params: {} } as unknown as ServerCommand;
    const result = await dispatchCommand(cmd, SAMPLE_CONFIG, noopLog);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("Unknown command type");
    expect(result.id).toBe("cmd_x");
    expect(typeof result.completedAt).toBe("string");
  });

  it("backfill-activity returns ok:true with pushed:0 when no sessions exist", async () => {
    // Mock listSessions to [] so the dispatcher exercises its empty-rollups
    // branch independent of whatever JSONL files exist on the test machine.
    vi.doMock("@claude-lens/parser/fs", async (orig) => {
      const actual = (await orig()) as Record<string, unknown>;
      return { ...actual, listSessions: async () => [] };
    });
    const { dispatchCommand } = await import("../../src/team/commands.js");
    const cmd: ServerCommand = { id: "cmd_b", type: "backfill-activity", params: { days: 30 } };
    const result = await dispatchCommand(cmd, SAMPLE_CONFIG, noopLog);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.summary).toMatchObject({ pushed: 0 });
    expect(result.id).toBe("cmd_b");
  });

  it("backfill-activity returns ok:false with 'Failed to read sessions' when listSessions throws", async () => {
    vi.doMock("@claude-lens/parser/fs", async (orig) => {
      const actual = (await orig()) as Record<string, unknown>;
      return {
        ...actual,
        listSessions: async () => {
          throw new Error("disk I/O failure");
        },
      };
    });
    const { dispatchCommand } = await import("../../src/team/commands.js");
    const cmd: ServerCommand = { id: "cmd_err", type: "backfill-activity", params: { days: 30 } };
    const result = await dispatchCommand(cmd, SAMPLE_CONFIG, noopLog);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("Failed to read sessions");
    expect(result.error).toContain("disk I/O failure");
    expect(result.id).toBe("cmd_err");
  });

  it("backfill-activity returns ok:true with pushed:N when rollups push successfully", async () => {
    // Mock the push module so the dispatcher walks the rollup loop without
    // needing to construct real SessionMeta fixtures. Returning 2 fake rollups
    // exercises both the loop body and the success-after-loop return.
    const pushSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, body: { ok: true } });
    vi.doMock("../../src/team/push.js", async (orig) => {
      const actual = (await orig()) as Record<string, unknown>;
      return {
        ...actual,
        buildRollupsForRange: () => [
          { day: "2026-05-20", agentTimeMs: 1, sessions: 1, toolCalls: 1, turns: 1, tokens: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } },
          { day: "2026-05-21", agentTimeMs: 1, sessions: 1, toolCalls: 1, turns: 1, tokens: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } },
        ],
        buildIngestPayload: (rollup: unknown) => ({ ingestId: "test", observedAt: "x", dailyRollup: rollup }),
        pushToTeamServer: pushSpy,
      };
    });
    // Also mock listSessions so the disk read doesn't happen.
    vi.doMock("@claude-lens/parser/fs", async (orig) => {
      const actual = (await orig()) as Record<string, unknown>;
      return { ...actual, listSessions: async () => [] };
    });
    const { dispatchCommand } = await import("../../src/team/commands.js");
    const cmd: ServerCommand = { id: "cmd_ok", type: "backfill-activity", params: { days: 30 } };
    const result = await dispatchCommand(cmd, SAMPLE_CONFIG, noopLog);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.summary).toMatchObject({ pushed: 2 });
    expect(pushSpy).toHaveBeenCalledTimes(2);
    vi.doUnmock("../../src/team/push.js");
  });

  it("backfill-activity returns ok:false with 'pushed N/M before failing' when a mid-stream push fails", async () => {
    const pushSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, body: { ok: true } })
      .mockResolvedValueOnce({ ok: false, status: 500, body: null });
    vi.doMock("../../src/team/push.js", async (orig) => {
      const actual = (await orig()) as Record<string, unknown>;
      return {
        ...actual,
        buildRollupsForRange: () => [
          { day: "2026-05-19", agentTimeMs: 1, sessions: 1, toolCalls: 1, turns: 1, tokens: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } },
          { day: "2026-05-20", agentTimeMs: 1, sessions: 1, toolCalls: 1, turns: 1, tokens: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } },
          { day: "2026-05-21", agentTimeMs: 1, sessions: 1, toolCalls: 1, turns: 1, tokens: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } },
        ],
        buildIngestPayload: (rollup: unknown) => ({ ingestId: "test", observedAt: "x", dailyRollup: rollup }),
        pushToTeamServer: pushSpy,
      };
    });
    vi.doMock("@claude-lens/parser/fs", async (orig) => {
      const actual = (await orig()) as Record<string, unknown>;
      return { ...actual, listSessions: async () => [] };
    });
    const { dispatchCommand } = await import("../../src/team/commands.js");
    const cmd: ServerCommand = { id: "cmd_fail", type: "backfill-activity", params: { days: 30 } };
    const result = await dispatchCommand(cmd, SAMPLE_CONFIG, noopLog);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("Push failed on 2026-05-20");
    expect(result.error).toContain("HTTP 500");
    expect(result.error).toContain("pushed 1/3 before failing");
    vi.doUnmock("../../src/team/push.js");
  });
});
