import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSession, listSessions, clearClaudeCodeCaches } from "../src/claude-code.js";

beforeEach(() => clearClaudeCodeCaches());

const SESSION_ID = "11111111-2222-3333-4444-555555555555";
const PROJECT_DIR = "-Users-me-Repo-demo";
const DISPATCH_TS = "2026-06-13T13:12:45.000Z";
const dispatchMs = Date.parse(DISPATCH_TS);

/** Build a root with a parent session that dispatched two Workflow tool
 *  calls, plus a `workflows/` dir holding two journals (one per dispatch,
 *  matched by time). A `scripts/` subdir and a stray non-`wf_` file are
 *  present to confirm they're ignored. */
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
      workflowProgress: [
        { type: "workflow_phase", index: 1, title: "A" },
        { type: "workflow_phase", index: 2, title: "B" },
        {
          type: "workflow_agent", index: 2, label: "build:two", phaseIndex: 1, phaseTitle: "A",
          agentId: "ag2", model: "claude-opus-4-8[1m]", state: "done",
          startedAt: dispatchMs + 5_000, durationMs: 120_000, tokens: 5000, toolCalls: 12,
          lastToolSummary: "done two", promptPreview: "do two", resultPreview: "ok two",
        },
        {
          type: "workflow_agent", index: 1, label: "build:one", phaseIndex: 1, phaseTitle: "A",
          agentId: "ag1", model: "claude-opus-4-8[1m]", state: "done",
          startedAt: dispatchMs + 4_000, durationMs: 60_000, tokens: 3000, toolCalls: 7,
          lastToolSummary: "done one", promptPreview: "do one", resultPreview: "ok one",
        },
        {
          type: "workflow_agent", index: 3, label: "wire:three", phaseIndex: 2, phaseTitle: "B",
          agentId: "ag3", model: "claude-haiku-4-5-20251001", state: "error",
          startedAt: dispatchMs + 8_000, durationMs: 30_000, tokens: 1000, toolCalls: 2,
        },
      ],
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

  it("list and detail paths agree on workflowCount when a journal is malformed", async () => {
    const { root } = await makeFixture();
    const wfDir = path.join(root, PROJECT_DIR, SESSION_ID, "workflows");
    // truncated mid-append → invalid JSON; both paths must ignore it identically.
    await fs.writeFile(path.join(wfDir, "wf_truncated.json"), '{"runId":"wf_truncated","agentCount":7,');
    clearClaudeCodeCaches();

    const list = await listSessions({ root });
    const meta = list.find((m) => m.sessionId === SESSION_ID)!;
    const detail = await getSession(SESSION_ID, { root });

    expect(meta.workflowCount).toBe(2); // not 3 — the unparseable file is dropped
    expect(detail!.workflowCount).toBe(2);
    expect(meta.spawnedAgentCount).toBe(detail!.spawnedAgentCount);
    expect(meta.spawnedAgentCount).toBe(51);
  });

  it("matches a run to the dispatch at-or-before its start, not a nearer one after", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "wf-bracket-"));
    const projDir = path.join(root, PROJECT_DIR);
    const id = "22222222-3333-4444-5555-666666666666";
    const startMs = Date.parse("2026-06-13T13:12:50.000Z");
    const mkWf = (uuid: string, id2: string, ts: string) => ({
      type: "assistant", uuid, parentUuid: "u0", timestamp: ts, sessionId: id, requestId: uuid,
      message: { id: "m" + uuid, model: "claude-opus-4-8[1m]", role: "assistant",
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: "tool_use", id: id2, name: "Workflow", input: { script: "…" } }] },
    });
    const lines = [
      { type: "user", uuid: "u0", parentUuid: null, timestamp: "2026-06-13T13:12:40.000Z",
        sessionId: id, cwd: "/Users/me/Repo/demo", message: { role: "user", content: "go" } },
      mkWf("a_before", "toolu_before", "2026-06-13T13:12:45.000Z"), // 5s before start
      mkWf("a_after", "toolu_after", "2026-06-13T13:12:52.000Z"),   // 2s after start (nearer)
    ];
    await fs.mkdir(projDir, { recursive: true });
    await fs.writeFile(path.join(projDir, `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const wfDir = path.join(projDir, id, "workflows");
    await fs.mkdir(wfDir, { recursive: true });
    await fs.writeFile(path.join(wfDir, "wf_x.json"), JSON.stringify({
      runId: "wf_x", workflowName: "x", status: "completed", agentCount: 3,
      totalToolCalls: 1, totalTokens: 1, durationMs: 1000, startTime: startMs,
    }));

    const s = await getSession(id, { root });
    // toolu_after is closer in absolute time, but only toolu_before could have
    // launched a run that started at 13:12:50.
    expect(s!.workflows![0].parentToolUseId).toBe("toolu_before");
  });

  it("parses workflowProgress agents (sorted by spawn index, with phase tags)", async () => {
    const { root } = await makeFixture();
    const s = await getSession(SESSION_ID, { root });
    const alpha = s!.workflows!.find((w) => w.runId === "wf_alpha")!;
    expect(alpha.agents).toHaveLength(3);
    // sorted by index → one, two, three
    expect(alpha.agents.map((a) => a.label)).toEqual(["build:one", "build:two", "wire:three"]);
    const one = alpha.agents[0];
    expect(one.phaseIndex).toBe(1);
    expect(one.phaseTitle).toBe("A");
    expect(one.state).toBe("done");
    expect(one.tokens).toBe(3000);
    expect(one.toolCalls).toBe(7);
    expect(one.promptPreview).toBe("do one");
    expect(one.resultPreview).toBe("ok one");
    // phase grouping: phase A (index 1) has 2 agents, phase B has 1
    expect(alpha.agents.filter((a) => a.phaseIndex === 1)).toHaveLength(2);
    expect(alpha.agents.filter((a) => a.phaseIndex === 2)).toHaveLength(1);
    // beta has no workflowProgress → empty agents, not undefined
    const beta = s!.workflows!.find((w) => w.runId === "wf_beta")!;
    expect(beta.agents).toEqual([]);
  });

  it("folds workflow execution spans into the session's agent time", async () => {
    const { root } = await makeFixture();
    const s = await getSession(SESSION_ID, { root });
    // Parent transcript alone is ~idle (a 47-min gap between dispatch and the
    // last event). After folding the two workflow spans (37m + 10m) the agent
    // time must reflect that wall-clock work.
    expect(s!.airTimeMs!).toBeGreaterThan(2_700_000); // > 45 min, not ~5 s
    // The merged active segments include the workflow spans.
    const total = (s!.activeSegments ?? []).reduce((n, seg) => n + (seg.endMs - seg.startMs), 0);
    expect(total).toBe(s!.airTimeMs);
  });
});
