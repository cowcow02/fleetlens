import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listGeminiSessions,
  getGeminiSession,
  clearGeminiCaches,
} from "../src/gemini.js";

beforeEach(() => clearGeminiCaches());

async function writeJsonl(filePath: string, lines: unknown[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

async function makeBasicFixture(slug = "example"): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gemini-fixture-"));
  const sessionId = "ctx-prompt-abcd1234efgh5678";
  const file = path.join(
    root,
    slug,
    "chats",
    `session-2026-05-07T08-30-${sessionId.slice(0, 8)}.jsonl`,
  );
  const lines = [
    {
      sessionId,
      projectHash: "deadbeef",
      startTime: "2026-05-07T08:30:00.000Z",
      lastUpdated: "2026-05-07T08:31:00.000Z",
    },
    {
      id: "u1",
      type: "user",
      timestamp: "2026-05-07T08:30:05.000Z",
      content: "list files in this directory",
    },
    {
      id: "g1",
      type: "gemini",
      timestamp: "2026-05-07T08:30:08.000Z",
      content: [{ text: "I'll list them now." }],
      model: "gemini-3-pro",
      toolCalls: [
        {
          id: "tc1",
          name: "list_files",
          args: { path: "." },
          status: "scheduled",
          timestamp: "2026-05-07T08:30:09.000Z",
        },
      ],
    },
    // Same id g1 — replay collapses; tool now executing.
    {
      id: "g1",
      type: "gemini",
      timestamp: "2026-05-07T08:30:08.000Z",
      content: [{ text: "I'll list them now." }],
      model: "gemini-3-pro",
      toolCalls: [
        {
          id: "tc1",
          name: "list_files",
          args: { path: "." },
          status: "executing",
          timestamp: "2026-05-07T08:30:09.000Z",
        },
      ],
    },
    // Final state — success with result and tokens attached.
    {
      id: "g1",
      type: "gemini",
      timestamp: "2026-05-07T08:30:08.000Z",
      content: [{ text: "I'll list them now." }],
      model: "gemini-3-pro",
      toolCalls: [
        {
          id: "tc1",
          name: "list_files",
          args: { path: "." },
          status: "success",
          result: [{ text: "a.txt\nb.txt\nc.txt" }],
          timestamp: "2026-05-07T08:30:11.000Z",
        },
      ],
      tokens: { input: 4200, output: 80, cached: 1200, total: 5480 },
    },
  ];
  await writeJsonl(file, lines);

  // projects.json is per-process global, but tests don't share temp roots —
  // skip it here so cwd resolution falls back to the slug.
  return root;
}

describe("gemini parser", () => {
  it("lists sessions and stamps agent='gemini'", async () => {
    const root = await makeBasicFixture("fleetlens");
    const list = await listGeminiSessions({ root });
    expect(list).toHaveLength(1);
    const meta = list[0]!;
    expect(meta.agent).toBe("gemini");
    expect(meta.id).toBe("ctx-prompt-abcd1234efgh5678");
    expect(meta.model).toBe("gemini-3-pro");
    expect(meta.totalUsage.input).toBe(4200);
    expect(meta.totalUsage.output).toBe(80);
    expect(meta.totalUsage.cacheRead).toBe(1200);
    expect(meta.toolCallCount).toBe(1);
    expect(meta.turnCount).toBe(1);
    expect(meta.firstUserPreview).toBe("list files in this directory");
    expect(meta.projectName).toBe("fleetlens");
    expect((meta.activeSegments ?? []).length).toBeGreaterThan(0);
  });

  it("collapses multi-write tool-call status to terminal state", async () => {
    const root = await makeBasicFixture("fleetlens");
    const detail = await getGeminiSession("ctx-prompt-abcd1234efgh5678", { root });
    expect(detail).not.toBeNull();
    const toolCalls = detail!.events.filter((e) => e.role === "tool-call");
    const toolResults = detail!.events.filter((e) => e.role === "tool-result");
    expect(toolCalls).toHaveLength(1);
    expect(toolResults).toHaveLength(1);
    expect(toolCalls[0]!.toolName).toBe("list_files");
    expect(toolResults[0]!.toolUseId).toBe("tc1");
    expect(String(toolResults[0]!.toolResult)).toContain("a.txt");
  });

  it("unwraps native tool results from functionResponse.response.output", async () => {
    // Real Gemini CLI tools (read_file, list_directory, glob, grep,
    // run_shell_command, …) wrap their payloads as
    // [{ functionResponse: { response: { output: "..." } } }]
    // — a layer my flattener missed in the first cut.
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "gemini-toolresult-"));
    const sessionId = "ctx-toolresult-abcdef12";
    const file = path.join(
      root,
      "demo",
      "chats",
      `session-2026-05-07T07-00-${sessionId.slice(0, 8)}.jsonl`,
    );
    await writeJsonl(file, [
      { sessionId, startTime: "2026-05-07T07:00:00.000Z", lastUpdated: "2026-05-07T07:00:30.000Z" },
      { id: "u1", type: "user", timestamp: "2026-05-07T07:00:01.000Z", content: "what's in /tmp?" },
      {
        id: "g1",
        type: "gemini",
        timestamp: "2026-05-07T07:00:02.000Z",
        content: "I'll list it.",
        model: "gemini-3-flash-preview",
        toolCalls: [
          {
            id: "tc1",
            name: "list_directory",
            args: { dir_path: "/tmp" },
            status: "success",
            timestamp: "2026-05-07T07:00:03.000Z",
            result: [
              {
                functionResponse: {
                  id: "tc1",
                  name: "list_directory",
                  response: {
                    output: "Directory listing for /tmp:\n[DIR] subdir\n[FILE] file.txt",
                  },
                },
              },
            ],
          },
        ],
      },
    ]);
    const detail = await getGeminiSession(sessionId, { root });
    expect(detail).not.toBeNull();
    const result = detail!.events.find((e) => e.role === "tool-result");
    expect(result).toBeDefined();
    expect(String(result!.toolResult)).toContain("Directory listing for /tmp");
    expect(String(result!.toolResult)).toContain("[DIR] subdir");
    expect(result!.preview.length).toBeGreaterThan(0);
  });

  it("respects $rewindTo by trimming everything from that id forward", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "gemini-rewind-"));
    const sessionId = "ctx-rewind-12345678";
    const file = path.join(
      root,
      "demo",
      "chats",
      `session-2026-05-07T09-00-${sessionId.slice(0, 8)}.jsonl`,
    );
    const lines = [
      {
        sessionId,
        startTime: "2026-05-07T09:00:00.000Z",
        lastUpdated: "2026-05-07T09:00:30.000Z",
      },
      { id: "u1", type: "user", timestamp: "2026-05-07T09:00:01.000Z", content: "first" },
      { id: "g1", type: "gemini", timestamp: "2026-05-07T09:00:02.000Z", content: "ok" },
      { id: "u2", type: "user", timestamp: "2026-05-07T09:00:03.000Z", content: "second" },
      { id: "g2", type: "gemini", timestamp: "2026-05-07T09:00:04.000Z", content: "noo" },
      // Rewind to u2 — drops u2 and g2.
      { $rewindTo: "u2" },
      { id: "u3", type: "user", timestamp: "2026-05-07T09:00:05.000Z", content: "redo" },
      { id: "g3", type: "gemini", timestamp: "2026-05-07T09:00:06.000Z", content: "yes" },
    ];
    await writeJsonl(file, lines);
    const detail = await getGeminiSession(sessionId, { root });
    expect(detail).not.toBeNull();
    const userPreviews = detail!.events
      .filter((e) => e.role === "user")
      .map((e) => e.preview);
    expect(userPreviews).toEqual(["first", "redo"]);
    const agentPreviews = detail!.events
      .filter((e) => e.role === "agent")
      .map((e) => e.preview);
    expect(agentPreviews).toEqual(["ok", "yes"]);
  });

  it("merges $set patches into metadata", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "gemini-set-"));
    const file = path.join(
      root,
      "demo",
      "chats",
      "session-2026-05-07T10-00-aaaaaaaa.jsonl",
    );
    const lines = [
      {
        sessionId: "session-with-late-summary",
        startTime: "2026-05-07T10:00:00.000Z",
        lastUpdated: "2026-05-07T10:00:30.000Z",
      },
      { id: "u1", type: "user", timestamp: "2026-05-07T10:00:01.000Z", content: "hi" },
      { id: "g1", type: "gemini", timestamp: "2026-05-07T10:00:02.000Z", content: "hey" },
      { $set: { summary: "Quick greeting" } },
    ];
    await writeJsonl(file, lines);
    const list = await listGeminiSessions({ root });
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe("session-with-late-summary");
  });

  it("parses legacy single-JSON file shape", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "gemini-legacy-"));
    const sessionId = "ctx-legacy-99999999";
    const file = path.join(
      root,
      "demo",
      "chats",
      `session-2026-05-07T11-00-${sessionId.slice(0, 8)}.json`,
    );
    await fs.mkdir(path.dirname(file), { recursive: true });
    const blob = {
      sessionId,
      startTime: "2026-05-07T11:00:00.000Z",
      lastUpdated: "2026-05-07T11:00:30.000Z",
      messages: [
        {
          id: "u1",
          type: "user",
          timestamp: "2026-05-07T11:00:01.000Z",
          content: "legacy hello",
        },
        {
          id: "g1",
          type: "gemini",
          timestamp: "2026-05-07T11:00:02.000Z",
          content: "legacy reply",
          tokens: { input: 100, output: 20, cached: 0, total: 120 },
        },
      ],
    };
    await fs.writeFile(file, JSON.stringify(blob, null, 2));
    const list = await listGeminiSessions({ root });
    expect(list).toHaveLength(1);
    const meta = list[0]!;
    expect(meta.id).toBe(sessionId);
    expect(meta.totalUsage.input).toBe(100);
    expect(meta.firstUserPreview).toBe("legacy hello");
  });

  it("returns empty list when root has no sessions", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "gemini-empty-"));
    const list = await listGeminiSessions({ root });
    expect(list).toEqual([]);
  });

  it("anchors firstTimestamp on first conversational event, not leading info events", async () => {
    // Reproduces the OAuth-prefix scenario: Gemini CLI logs ~20 info
    // records during login before the user can send their first prompt.
    // The session bar must not stretch back to that pre-conversation
    // window or every Gemini session looks like 4 minutes of idle time.
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "gemini-oauth-"));
    const sessionId = "ctx-oauth-77777777";
    const file = path.join(
      root,
      "demo",
      "chats",
      `session-2026-05-07T03-54-${sessionId.slice(0, 8)}.jsonl`,
    );
    const lines = [
      {
        sessionId,
        startTime: "2026-05-07T03:54:33.000Z",
        lastUpdated: "2026-05-07T03:58:36.000Z",
      },
      {
        id: "i1",
        type: "info",
        timestamp: "2026-05-07T03:54:38.000Z",
        content: "Attempting to open authentication page in your browser…",
      },
      {
        id: "i2",
        type: "info",
        timestamp: "2026-05-07T03:54:50.000Z",
        content: "OAuth callback received.",
      },
      {
        id: "u1",
        type: "user",
        timestamp: "2026-05-07T03:58:02.000Z",
        content: "hello!",
      },
      {
        id: "g1",
        type: "gemini",
        timestamp: "2026-05-07T03:58:36.000Z",
        content: "hi there",
        model: "gemini-3-flash-preview",
      },
    ];
    await writeJsonl(file, lines);
    const list = await listGeminiSessions({ root });
    expect(list).toHaveLength(1);
    const meta = list[0]!;
    expect(meta.firstTimestamp).toBe("2026-05-07T03:58:02.000Z");
    expect(meta.lastTimestamp).toBe("2026-05-07T03:58:36.000Z");
    // 34s conversational window, not 4m 3s.
    expect(meta.durationMs).toBe(34_000);
    // activeSegments must reflect only the conversational portion.
    const span = (meta.activeSegments ?? []).reduce(
      (acc, s) => acc + (s.endMs - s.startMs),
      0,
    );
    expect(span).toBeLessThan(60_000);
  });
});
