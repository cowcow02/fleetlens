import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSession, clearClaudeCodeCaches } from "../src/claude-code.js";

beforeEach(() => clearClaudeCodeCaches());

const SESSION_ID = "11111111-2222-3333-4444-555555555555";
const PROJECT_DIR = "-Users-me-Repo-demo";
const DISPATCH_TS = "2026-06-13T13:12:45.000Z";
const dispatchMs = Date.parse(DISPATCH_TS);

/** Build a root with a parent session that dispatched two Workflow tool
 *  calls, plus a `workflows/` dir holding three journals (one matches each
 *  dispatch by time; a third — a resumed run — falls back to nearest). A
 *  `scripts/` subdir and a stray non-`wf_` file are present to confirm they're
 *  ignored. */
async function makeFixture(): Promise<{ root: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wf-fixture-"));
  const projDir = path.join(root, PROJECT_DIR);
  const sessionFile = path.join(projDir, `${SESSION_ID}.jsonl`);

  const lines = [
    {
      type: "user",
      uuid: "u0",
      parentUuid: null,
      timestamp: "2026-06-13T13:12:40.000Z",
      sessionId: SESSION_ID,
      cwd: "/Users/me/Repo/demo",
      message: { role: "user", content: "build the thing with a workflow" },
    },
    {
      type: "assistant",
      uuid: "a1",
      parentUuid: "u0",
      timestamp: DISPATCH_TS,
      sessionId: SESSION_ID,
      requestId: "req1",
      message: {
        id: "msg1",
        model: "claude-opus-4-8[1m]",
        role: "assistant",
        usage: { input_tokens: 100, output_tokens: 50 },
        content: [
          { type: "tool_use", id: "toolu_wf_alpha", name: "Workflow", input: { script: "…" } },
        ],
      },
    },
    {
      type: "assistant",
      uuid: "a2",
      parentUuid: "a1",
      timestamp: "2026-06-13T14:00:00.000Z",
      sessionId: SESSION_ID,
      requestId: "req2",
      message: {
        id: "msg2",
        model: "claude-opus-4-8[1m]",
        role: "assistant",
        usage: { input_tokens: 80, output_tokens: 40 },
        content: [
          { type: "tool_use", id: "toolu_wf_beta", name: "Workflow", input: { script: "…" } },
        ],
      },
    },
  ];
  await fs.mkdir(projDir, { recursive: true });
  await fs.writeFile(sessionFile, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

  const wfDir = path.join(projDir, SESSION_ID, "workflows");
  await fs.mkdir(path.join(wfDir, "scripts"), { recursive: true });
  await fs.writeFile(path.join(wfDir, "scripts", "ignored.mjs"), "// not a journal");
  await fs.writeFile(path.join(wfDir, "notes.json"), JSON.stringify({ agentCount: 999 }));

  // Journal alpha — matches toolu_wf_alpha (startTime = dispatch + 3s).
  await fs.writeFile(
    path.join(wfDir, "wf_alpha.json"),
    JSON.stringify({
      runId: "wf_alpha",
      workflowName: "build-foundation",
      summary: "Lay the foundation",
      status: "completed",
      agentCount: 21,
      totalToolCalls: 343,
      totalTokens: 831329,
      durationMs: 2_220_000,
      startTime: dispatchMs + 3_000,
      defaultModel: "claude-opus-4-8[1m]",
      phases: [
        { title: "A", detail: "scaffold" },
        { title: "B", detail: "wire" },
        { title: "no-detail" },
      ],
      logs: ["▶ Task A1", "✓ Task A1 done"],
    }),
  );

  // Journal beta — matches toolu_wf_beta.
  await fs.writeFile(
    path.join(wfDir, "wf_beta.json"),
    JSON.stringify({
      runId: "wf_beta",
      workflowName: "ship-it",
      status: "completed",
      agentCount: 30,
      totalToolCalls: 582,
      totalTokens: 1_343_380,
      durationMs: 600_000,
      startTime: Date.parse("2026-06-13T14:00:02.000Z"),
    }),
  );

  return { root };
}

describe("workflow journals", () => {
  it("surfaces workflow runs and the spawned-agent aggregate", async () => {
    const { root } = await makeFixture();
    const s = await getSession(SESSION_ID, { root });
    expect(s).not.toBeNull();

    expect(s!.workflowCount).toBe(2);
    expect(s!.spawnedAgentCount).toBe(51); // 21 + 30 — the stray notes.json is ignored
    expect(s!.workflows).toHaveLength(2);
  });

  it("parses journal fields and sorts by start time", async () => {
    const { root } = await makeFixture();
    const s = await getSession(SESSION_ID, { root });
    const [alpha, beta] = s!.workflows!;

    expect(alpha.name).toBe("build-foundation");
    expect(alpha.description).toBe("Lay the foundation");
    expect(alpha.status).toBe("completed");
    expect(alpha.agentCount).toBe(21);
    expect(alpha.toolCallCount).toBe(343);
    expect(alpha.totalTokens).toBe(831329);
    expect(alpha.model).toBe("claude-opus-4-8[1m]");
    expect(alpha.phases).toHaveLength(3);
    expect(alpha.phases[2]).toEqual({ title: "no-detail", detail: undefined });
    expect(alpha.logs).toEqual(["▶ Task A1", "✓ Task A1 done"]);

    // Sorted by startMs: alpha (13:12) before beta (14:00).
    expect(beta.name).toBe("ship-it");
    expect(alpha.startMs!).toBeLessThan(beta.startMs!);
  });

  it("matches each run to its parent Workflow tool_use by dispatch time", async () => {
    const { root } = await makeFixture();
    const s = await getSession(SESSION_ID, { root });
    const alpha = s!.workflows!.find((w) => w.runId === "wf_alpha")!;
    const beta = s!.workflows!.find((w) => w.runId === "wf_beta")!;
    expect(alpha.parentToolUseId).toBe("toolu_wf_alpha");
    expect(beta.parentToolUseId).toBe("toolu_wf_beta");
  });

  it("computes session-relative offsets from the first event", async () => {
    const { root } = await makeFixture();
    const s = await getSession(SESSION_ID, { root });
    const alpha = s!.workflows!.find((w) => w.runId === "wf_alpha")!;
    // session start = 13:12:40; alpha start = 13:12:48 → 8s offset.
    expect(alpha.startTOffsetMs).toBe(8_000);
    expect(alpha.endTOffsetMs).toBe(8_000 + 2_220_000);
  });

  it("returns no workflow fields for a session without a workflows dir", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "wf-empty-"));
    const projDir = path.join(root, PROJECT_DIR);
    await fs.mkdir(projDir, { recursive: true });
    const id = "99999999-0000-0000-0000-000000000000";
    await fs.writeFile(
      path.join(projDir, `${id}.jsonl`),
      JSON.stringify({
        type: "user",
        uuid: "u0",
        parentUuid: null,
        timestamp: "2026-06-13T13:12:40.000Z",
        sessionId: id,
        cwd: "/Users/me/Repo/demo",
        message: { role: "user", content: "hi" },
      }) + "\n",
    );
    const s = await getSession(id, { root });
    expect(s!.workflows).toEqual([]);
    expect(s!.workflowCount).toBeUndefined();
    expect(s!.spawnedAgentCount).toBeUndefined();
  });
});
