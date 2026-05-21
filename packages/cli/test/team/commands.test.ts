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
});
