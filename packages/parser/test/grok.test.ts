import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listGrokSessions,
  getGrokSession,
  getLatestGrokUsage,
  clearGrokCaches,
  DEFAULT_GROK_ROOT,
} from "../src/grok.js";
import { clearCaches, agentSources } from "../src/fs.js";
import { getAgentMetadata, agentMetadata } from "../src/agent-metadata.js";

beforeEach(() => {
  clearGrokCaches();
  clearCaches();
});

const SESSION_ID = "019f4a00-0000-7000-8000-000000000001";
const CWD = "/Users/test/Repo/fleetlens";

function updateLine(opts: {
  sessionUpdate: string;
  text?: string;
  toolCallId?: string;
  title?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  status?: string;
  agentTimestampMs: number;
  promptId?: string;
  modelId?: string;
  totalTokens?: number;
  toolMetaName?: string;
}): string {
  const update: Record<string, unknown> = {
    sessionUpdate: opts.sessionUpdate,
  };
  if (opts.text != null) {
    update.content = { type: "text", text: opts.text };
  }
  if (opts.toolCallId) update.toolCallId = opts.toolCallId;
  if (opts.title) update.title = opts.title;
  if (opts.rawInput !== undefined) update.rawInput = opts.rawInput;
  if (opts.rawOutput !== undefined) update.rawOutput = opts.rawOutput;
  if (opts.status) update.status = opts.status;
  if (opts.toolMetaName) {
    update._meta = {
      "x.ai/tool": { version: 1, name: opts.toolMetaName, kind: "other" },
    };
  }
  if (opts.modelId) {
    update._meta = { ...(update._meta as object), modelId: opts.modelId, promptIndex: 0 };
  }

  const paramsMeta: Record<string, unknown> = {
    eventId: `${SESSION_ID}-1`,
    agentTimestampMs: opts.agentTimestampMs,
  };
  if (opts.promptId) paramsMeta.promptId = opts.promptId;
  if (opts.totalTokens != null) paramsMeta.totalTokens = opts.totalTokens;

  return JSON.stringify({
    timestamp: Math.floor(opts.agentTimestampMs / 1000),
    method: "session/update",
    params: {
      sessionId: SESSION_ID,
      update,
      _meta: paramsMeta,
    },
  });
}

async function makeFixture(opts: {
  emptyUpdates?: boolean;
  sessionId?: string;
  cwd?: string;
} = {}): Promise<{ root: string; sessionId: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grok-fixture-"));
  const sessionId = opts.sessionId ?? SESSION_ID;
  const cwd = opts.cwd ?? CWD;
  const encoded = encodeURIComponent(cwd);
  const dir = path.join(root, encoded, sessionId);
  await fs.mkdir(dir, { recursive: true });

  const summary = {
    info: { id: sessionId, cwd },
    session_summary: "Investigate the menu bar widget",
    generated_title: "Investigate the menu bar widget",
    created_at: "2026-07-10T04:50:42.735524Z",
    updated_at: "2026-07-10T05:00:00.000000Z",
    last_active_at: "2026-07-10T05:00:00.000000Z",
    current_model_id: "grok-4.5",
    head_branch: "master",
    agent_name: "grok-build",
    num_messages: 12,
    num_chat_messages: 4,
  };
  await fs.writeFile(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2));

  const signals = {
    turnCount: 1,
    toolCallCount: 1,
    contextTokensUsed: 19383,
    contextWindowTokens: 500000,
    agentLinesAdded: 10,
    agentLinesRemoved: 2,
    primaryModelId: "grok-4.5",
    modelsUsed: ["grok-4.5"],
  };
  await fs.writeFile(path.join(dir, "signals.json"), JSON.stringify(signals, null, 2));

  if (opts.emptyUpdates) {
    await fs.writeFile(path.join(dir, "updates.jsonl"), "");
  } else {
    const t0 = Date.parse("2026-07-10T04:50:56.512Z");
    const lines = [
      updateLine({
        sessionUpdate: "user_message_chunk",
        text: "Hey can you investigate the menu bar widget?",
        agentTimestampMs: t0,
        modelId: "grok-4.5",
        promptId: "prompt-1",
      }),
      updateLine({
        sessionUpdate: "agent_thought_chunk",
        text: "The user wants a diagnosis of the blank widget. ",
        agentTimestampMs: t0 + 1000,
        promptId: "prompt-1",
        totalTokens: 19000,
      }),
      updateLine({
        sessionUpdate: "agent_thought_chunk",
        text: "I should inspect the menubar sources.",
        agentTimestampMs: t0 + 1500,
        promptId: "prompt-1",
        totalTokens: 19100,
      }),
      updateLine({
        sessionUpdate: "agent_message_chunk",
        text: "I'll dig into the menubar usage path. ",
        agentTimestampMs: t0 + 2000,
        promptId: "prompt-1",
        totalTokens: 19200,
      }),
      updateLine({
        sessionUpdate: "agent_message_chunk",
        text: "Starting with list_dir.",
        agentTimestampMs: t0 + 2500,
        promptId: "prompt-1",
        totalTokens: 19300,
      }),
      updateLine({
        sessionUpdate: "tool_call",
        toolCallId: "call-list-1",
        title: "list_dir",
        toolMetaName: "list_dir",
        rawInput: { target_directory: "." },
        agentTimestampMs: t0 + 3000,
        promptId: "prompt-1",
        totalTokens: 19400,
      }),
      updateLine({
        sessionUpdate: "tool_call_update",
        toolCallId: "call-list-1",
        status: "in_progress",
        agentTimestampMs: t0 + 3200,
        promptId: "prompt-1",
      }),
      updateLine({
        sessionUpdate: "tool_call_update",
        toolCallId: "call-list-1",
        status: "completed",
        rawOutput: {
          type: "ListDir",
          Content: { content: "- apps/\n- packages/\n" },
        },
        agentTimestampMs: t0 + 4000,
        promptId: "prompt-1",
        totalTokens: 19500,
      }),
      // xAI extension — should not break the conversational path
      JSON.stringify({
        timestamp: Math.floor((t0 + 5000) / 1000),
        method: "_x.ai/session/update",
        params: {
          sessionId,
          update: { sessionUpdate: "turn_completed", prompt_id: "prompt-1", stop_reason: "end_turn" },
          _meta: { eventId: `${sessionId}-end`, agentTimestampMs: t0 + 5000 },
        },
      }),
    ];
    await fs.writeFile(path.join(dir, "updates.jsonl"), lines.join("\n") + "\n");
  }

  // Non-session noise at the root — must be ignored.
  await fs.writeFile(path.join(root, "session_search.sqlite"), "not-a-db");
  await fs.writeFile(path.join(root, encoded, "prompt_history.jsonl"), "{}\n");

  return { root, sessionId };
}

describe("grok metadata", () => {
  it("registers grok in browser-safe agentMetadata", () => {
    const meta = getAgentMetadata("grok");
    expect(meta).toBeDefined();
    expect(meta!.kind).toBe("grok");
    expect(meta!.displayName).toBe("Grok Build");
    expect(meta!.shortLabel).toBe("Grok");
    expect(meta!.accentColor).toBeTruthy();
    expect(meta!.iconChar).toBeTruthy();
    expect(agentMetadata.some((m) => m.kind === "grok")).toBe(true);
  });

  it("exposes grok on the multi-agent registry with a usage poller", () => {
    const src = agentSources.find((s) => s.kind === "grok");
    expect(src).toBeDefined();
    expect(src!.displayName).toBe("Grok Build");
    expect(src!.defaultRoot).toBe(DEFAULT_GROK_ROOT);
    expect(typeof src!.usagePoller).toBe("function");
  });
});

describe("grok parser", () => {
  it("lists sessions and stamps agent='grok' with cwd/model/segments", async () => {
    const { root, sessionId } = await makeFixture();
    const list = await listGrokSessions({ root });
    expect(list).toHaveLength(1);
    const meta = list[0]!;
    expect(meta.agent).toBe("grok");
    expect(meta.id).toBe(sessionId);
    expect(meta.sessionId).toBe(sessionId);
    expect(meta.model).toBe("grok-4.5");
    expect(meta.cwd).toBe(CWD);
    expect(meta.projectName).toContain("fleetlens");
    // Raw URL-encoded group dir — matches Grok's on-disk layout under sessions/.
    expect(meta.projectDir).toBe(encodeURIComponent(CWD));
    expect(meta.firstUserPreview).toContain("menu bar widget");
    expect(meta.toolCallCount).toBeGreaterThanOrEqual(1);
    expect(meta.turnCount).toBeGreaterThanOrEqual(1);
    expect(meta.totalUsage.input).toBe(19383);
    expect((meta.activeSegments ?? []).length).toBeGreaterThan(0);
    expect((meta.airTimeMs ?? 0)).toBeGreaterThan(0);
    expect(meta.filePath).toContain("updates.jsonl");
    expect(meta.gitBranch).toBe("master");
  });

  it("maps updates into user/agent/thinking/tool events and coalesces chunks", async () => {
    const { root, sessionId } = await makeFixture();
    const detail = await getGrokSession(sessionId, { root });
    expect(detail).not.toBeNull();
    expect(detail!.agent).toBe("grok");
    expect(detail!.events.length).toBeGreaterThan(0);

    const roles = detail!.events.map((e) => e.role);
    expect(roles).toContain("user");
    expect(roles).toContain("agent");
    expect(roles).toContain("agent-thinking");
    expect(roles).toContain("tool-call");
    expect(roles).toContain("tool-result");

    const user = detail!.events.find((e) => e.role === "user")!;
    expect(user.preview).toContain("menu bar widget");

    // Two thought chunks + two agent chunks coalesced into one each.
    const thoughts = detail!.events.filter((e) => e.role === "agent-thinking");
    expect(thoughts).toHaveLength(1);
    expect(thoughts[0]!.blocks[0]).toMatchObject({ type: "thinking" });
    expect(String((thoughts[0]!.blocks[0] as { thinking: string }).thinking)).toContain(
      "menubar sources",
    );

    const agents = detail!.events.filter((e) => e.role === "agent");
    expect(agents).toHaveLength(1);
    expect(agents[0]!.preview).toContain("list_dir");
    expect(agents[0]!.preview).toContain("menubar usage");

    const toolCalls = detail!.events.filter((e) => e.role === "tool-call");
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.toolName).toBe("list_dir");
    expect(toolCalls[0]!.toolUseId).toBe("call-list-1");

    const results = detail!.events.filter((e) => e.role === "tool-result");
    expect(results).toHaveLength(1);
    expect(String(results[0]!.toolResult)).toContain("packages/");
  });

  it("returns [] for missing root without throwing", async () => {
    const missing = path.join(os.tmpdir(), `grok-missing-${Date.now()}-nope`);
    const list = await listGrokSessions({ root: missing });
    expect(list).toEqual([]);
  });

  it("returns null for unknown session id", async () => {
    const { root } = await makeFixture();
    const detail = await getGrokSession("does-not-exist", { root });
    expect(detail).toBeNull();
  });

  it("handles empty updates.jsonl using summary meta only", async () => {
    const { root, sessionId } = await makeFixture({ emptyUpdates: true });
    const list = await listGrokSessions({ root });
    expect(list).toHaveLength(1);
    expect(list[0]!.agent).toBe("grok");
    expect(list[0]!.model).toBe("grok-4.5");
    expect(list[0]!.firstUserPreview).toContain("menu bar");

    const detail = await getGrokSession(sessionId, { root });
    expect(detail).not.toBeNull();
    expect(detail!.events).toEqual([]);
  });

  it("excludes session_kind=subagent from the top-level list and attaches them on the parent", async () => {
    const { root, sessionId } = await makeFixture();
    const encoded = encodeURIComponent(CWD);
    const childId = "019f4a00-0000-7000-8000-000000000099";
    const childDir = path.join(root, encoded, childId);
    await fs.mkdir(path.join(root, encoded, sessionId, "subagents", childId), {
      recursive: true,
    });
    await fs.mkdir(childDir, { recursive: true });
    await fs.writeFile(
      path.join(root, encoded, sessionId, "subagents", childId, "meta.json"),
      JSON.stringify({
        subagent_id: childId,
        parent_session_id: sessionId,
        child_session_id: childId,
        subagent_type: "general-purpose",
        description: "goal plan writer",
        prompt: "Write the plan",
      }),
    );
    await fs.writeFile(
      path.join(childDir, "summary.json"),
      JSON.stringify({
        info: { id: childId, cwd: CWD },
        session_kind: "subagent",
        agent_name: "general-purpose",
        generated_title: "Write the plan",
        created_at: "2026-07-10T04:51:00.000Z",
        updated_at: "2026-07-10T04:52:00.000Z",
        last_active_at: "2026-07-10T04:52:00.000Z",
        current_model_id: "grok-4.5",
        num_messages: 12,
      }),
    );
    await fs.writeFile(path.join(childDir, "updates.jsonl"), "");
    await fs.writeFile(
      path.join(childDir, "signals.json"),
      JSON.stringify({ toolCallCount: 3, contextTokensUsed: 1000, contextWindowUsage: 12 }),
    );

    const list = await listGrokSessions({ root });
    expect(list.map((s) => s.id)).toEqual([sessionId]);
    expect(list.some((s) => s.id === childId)).toBe(false);
    expect(list[0]!.spawnedAgentCount).toBe(1);

    const detail = await getGrokSession(sessionId, { root });
    expect(detail!.subagents).toHaveLength(1);
    expect(detail!.subagents![0]!.agentId).toBe(childId);
    expect(detail!.subagents![0]!.agentType).toBe("general-purpose");
    expect(detail!.subagents![0]!.description).toBe("goal plan writer");
    expect(detail!.spawnedAgentCount).toBe(1);
  });

  it("getLatestGrokUsage reads context window from main session signals", async () => {
    const { root } = await makeFixture();
    // Enrich signals with an explicit contextWindowUsage percent.
    const encoded = encodeURIComponent(CWD);
    const signalsPath = path.join(root, encoded, SESSION_ID, "signals.json");
    await fs.writeFile(
      signalsPath,
      JSON.stringify({
        contextWindowUsage: 34,
        contextTokensUsed: 170000,
        contextWindowTokens: 500000,
        primaryModelId: "grok-4.5",
      }),
    );
    clearGrokCaches();
    const u = await getLatestGrokUsage({ root });
    expect(u).not.toBeNull();
    expect(u!.five_hour.utilization).toBe(34);
    expect(u!.seven_day.utilization).toBeNull();
    expect(u!.plan_type).toBe("grok-4.5");

    // Subagent signals must not win over the main session.
    const childId = "019f4a00-subagent-usage-only";
    const childDir = path.join(root, encoded, childId);
    await fs.mkdir(childDir, { recursive: true });
    await fs.writeFile(
      path.join(childDir, "summary.json"),
      JSON.stringify({
        info: { id: childId, cwd: CWD },
        session_kind: "subagent",
        last_active_at: "2099-01-01T00:00:00.000Z",
        current_model_id: "grok-sub",
      }),
    );
    await fs.writeFile(
      path.join(childDir, "signals.json"),
      JSON.stringify({ contextWindowUsage: 99, primaryModelId: "grok-sub" }),
    );
    clearGrokCaches();
    const u2 = await getLatestGrokUsage({ root });
    expect(u2!.five_hour.utilization).toBe(34);
    expect(u2!.plan_type).toBe("grok-4.5");
  });
});

describe("grok multi-agent registry integration", () => {
  it("listGrokSessions is stable across two runs and is wired into the registry", async () => {
    // Registry listAllSessions uses default roots; exercise the public list
    // surface that the registry wraps, then double-run for stability.
    const { root, sessionId } = await makeFixture();
    const a = await listGrokSessions({ root });
    const b = await listGrokSessions({ root });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]!.id).toBe(sessionId);
    expect(b[0]!.id).toBe(sessionId);
    expect(a[0]!.agent).toBe("grok");
    expect(JSON.stringify(a[0])).toBe(JSON.stringify(b[0]));

    // Registry entry is wired and callable.
    const src = agentSources.find((s) => s.kind === "grok")!;
    const viaRegistry = await src.listSessions({ root });
    expect(viaRegistry.some((s) => s.agent === "grok" && s.id === sessionId)).toBe(true);
  });

  it("getSession via registry returns consistent detail twice", async () => {
    const { root, sessionId } = await makeFixture();
    const src = agentSources.find((s) => s.kind === "grok")!;
    const d1 = await src.getSession(sessionId, { root });
    const d2 = await src.getSession(sessionId, { root });
    expect(d1).not.toBeNull();
    expect(d2).not.toBeNull();
    expect(d1!.events.length).toBeGreaterThan(0);
    expect(d1!.events.some((e) => e.role === "user")).toBe(true);
    expect(d1!.events.some((e) => e.role === "agent" || e.role === "tool-call")).toBe(true);
    expect(d1!.filePath).toContain("updates.jsonl");
    expect(d1!.events.length).toBe(d2!.events.length);
    expect(d1!.id).toBe(d2!.id);
  });
});
