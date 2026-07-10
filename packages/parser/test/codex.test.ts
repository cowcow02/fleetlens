import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listCodexSessions,
  getCodexSession,
  getLatestCodexUsage,
} from "../src/codex.js";

async function makeFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-fixture-"));
  const dir = path.join(root, "2026", "05", "04");
  await fs.mkdir(dir, { recursive: true });
  const sessionId = "019df14d-e2d5-7f73-b40a-a6160899a093";
  const file = path.join(dir, `rollout-2026-05-04T12-45-06-${sessionId}.jsonl`);

  const lines = [
    {
      timestamp: "2026-05-04T04:45:08.491Z",
      type: "session_meta",
      payload: {
        id: sessionId,
        timestamp: "2026-05-04T04:45:06.684Z",
        cwd: "/Users/me/Repo/example",
        cli_version: "0.122.0",
        model_provider: "openai",
      },
    },
    {
      timestamp: "2026-05-04T04:45:08.495Z",
      type: "turn_context",
      payload: {
        turn_id: "t1",
        cwd: "/Users/me/Repo/example",
        model: "gpt-5.4",
      },
    },
    {
      timestamp: "2026-05-04T04:45:09.000Z",
      type: "event_msg",
      payload: { type: "user_message", message: "hello world" },
    },
    {
      timestamp: "2026-05-04T04:45:11.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        call_id: "c1",
        arguments: "{\"cmd\":\"ls\"}",
      },
    },
    {
      timestamp: "2026-05-04T04:45:12.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "c1",
        output: "file1\nfile2",
      },
    },
    {
      timestamp: "2026-05-04T04:45:13.000Z",
      type: "event_msg",
      payload: {
        type: "agent_message",
        message: "Two files listed.",
      },
    },
    {
      timestamp: "2026-05-04T04:45:14.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 1500,
            cached_input_tokens: 500,
            output_tokens: 80,
            total_tokens: 1580,
          },
        },
      },
    },
  ];

  await fs.writeFile(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return root;
}

describe("codex parser", () => {
  it("lists sessions and stamps agent='codex'", async () => {
    const root = await makeFixture();
    const list = await listCodexSessions({ root });
    expect(list).toHaveLength(1);
    const meta = list[0];
    expect(meta.agent).toBe("codex");
    expect(meta.id).toBe("019df14d-e2d5-7f73-b40a-a6160899a093");
    expect(meta.cwd).toBe("/Users/me/Repo/example");
    expect(meta.projectName).toBe("/Users/me/Repo/example");
    expect(meta.model).toBe("gpt-5.4");
    expect(meta.totalUsage.input).toBe(1500);
    expect(meta.totalUsage.output).toBe(80);
    expect(meta.totalUsage.cacheRead).toBe(500);
    expect(meta.toolCallCount).toBe(1);
    expect(meta.turnCount).toBe(1);
    expect(meta.firstUserPreview).toBe("hello world");
    expect(meta.lastAgentPreview).toBe("Two files listed.");
    expect((meta.activeSegments ?? []).length).toBeGreaterThan(0);
  });

  it("getCodexSession returns full event timeline", async () => {
    const root = await makeFixture();
    const detail = await getCodexSession(
      "019df14d-e2d5-7f73-b40a-a6160899a093",
      { root },
    );
    expect(detail).not.toBeNull();
    expect(detail!.events.length).toBeGreaterThan(0);
    const toolCall = detail!.events.find((e) => e.role === "tool-call");
    expect(toolCall?.toolName).toBe("exec_command");
    const toolResult = detail!.events.find((e) => e.role === "tool-result");
    expect(toolResult?.toolUseId).toBe("c1");
    const userEvent = detail!.events.find((e) => e.role === "user");
    expect(userEvent?.preview).toBe("hello world");
  });

  it("returns empty list when root has no sessions", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-empty-"));
    const list = await listCodexSessions({ root });
    expect(list).toEqual([]);
  });
});

function tokenCount(
  rateLimits: Record<string, unknown>,
  ts = "2026-07-10T04:00:00.000Z",
) {
  return {
    timestamp: ts,
    type: "event_msg",
    payload: { type: "token_count", info: null, rate_limits: rateLimits },
  };
}

const usableCodexLimits = {
  limit_id: "codex",
  plan_type: "plus",
  primary: {
    used_percent: 54,
    window_minutes: 300,
    // Far-future reset so the expired-window branch does not force 0.
    resets_at: 4_000_000_000,
  },
  secondary: {
    used_percent: 17,
    window_minutes: 10080,
    resets_at: 4_000_100_000,
  },
  credits: null,
  individual_limit: null,
  limit_name: null,
  rate_limit_reached_type: null,
};

const emptyPremiumLimits = {
  limit_id: "premium",
  plan_type: null,
  primary: null,
  secondary: null,
  credits: { has_credits: false, unlimited: false, balance: "0" },
  individual_limit: null,
  limit_name: null,
  rate_limit_reached_type: null,
};

async function writeRollout(
  root: string,
  day: string,
  sessionId: string,
  lines: unknown[],
  mtimeMs: number,
): Promise<string> {
  const [y, m, d] = day.split("-");
  const dir = path.join(root, y!, m!, d!);
  await fs.mkdir(dir, { recursive: true });
  // Filename timestamp is cosmetic; mtime drives getLatestCodexUsage order.
  const file = path.join(dir, `rollout-${day}T12-00-00-${sessionId}.jsonl`);
  await fs.writeFile(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const t = new Date(mtimeMs);
  await fs.utimes(file, t, t);
  return file;
}

describe("getLatestCodexUsage", () => {
  it("reads usable primary/secondary windows from the newest rollout", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-usage-"));
    await writeRollout(
      root,
      "2026-07-10",
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      [tokenCount(usableCodexLimits)],
      Date.now(),
    );
    const w = await getLatestCodexUsage({ root });
    expect(w).not.toBeNull();
    expect(w!.five_hour.utilization).toBe(54);
    expect(w!.seven_day.utilization).toBe(17);
    expect(w!.plan_type).toBe("plus");
  });

  it("skips trailing empty premium and keeps earlier usable codex in the same file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-usage-"));
    await writeRollout(
      root,
      "2026-07-10",
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      [
        tokenCount(usableCodexLimits, "2026-07-10T04:00:00.000Z"),
        tokenCount(emptyPremiumLimits, "2026-07-10T04:30:00.000Z"),
      ],
      Date.now(),
    );
    const w = await getLatestCodexUsage({ root });
    expect(w).not.toBeNull();
    expect(w!.five_hour.utilization).toBe(54);
    expect(w!.seven_day.utilization).toBe(17);
    expect(w!.plan_type).toBe("plus");
  });

  it("falls back past a newest-only empty premium rollout to an older usable one", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-usage-"));
    const older = await writeRollout(
      root,
      "2026-07-10",
      "cccccccc-cccc-cccc-cccc-cccccccccccc",
      [tokenCount(usableCodexLimits)],
      Date.now() - 60_000,
    );
    await writeRollout(
      root,
      "2026-07-10",
      "dddddddd-dddd-dddd-dddd-dddddddddddd",
      [tokenCount(emptyPremiumLimits)],
      Date.now(),
    );
    const w = await getLatestCodexUsage({ root });
    expect(w).not.toBeNull();
    expect(w!.five_hour.utilization).toBe(54);
    expect(w!.seven_day.utilization).toBe(17);
    expect(w!.source_path).toBe(older);
  });

  it("returns null when every rate_limits shell is empty", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-usage-"));
    await writeRollout(
      root,
      "2026-07-10",
      "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      [tokenCount(emptyPremiumLimits)],
      Date.now(),
    );
    const w = await getLatestCodexUsage({ root });
    expect(w).toBeNull();
  });

  it("treats expired windows as 0% while still counting them usable", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-usage-"));
    await writeRollout(
      root,
      "2026-07-10",
      "ffffffff-ffff-ffff-ffff-ffffffffffff",
      [
        tokenCount({
          ...usableCodexLimits,
          primary: {
            used_percent: 88,
            window_minutes: 300,
            resets_at: 1_700_000_000, // long past
          },
          secondary: {
            used_percent: 12,
            window_minutes: 10080,
            resets_at: 4_000_100_000,
          },
        }),
      ],
      Date.now(),
    );
    const w = await getLatestCodexUsage({ root });
    expect(w).not.toBeNull();
    expect(w!.five_hour.utilization).toBe(0);
    expect(w!.seven_day.utilization).toBe(12);
  });
});
