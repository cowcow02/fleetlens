import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listAntigravitySessions,
  getAntigravitySession,
  clearAntigravityCaches,
} from "../src/antigravity.js";

beforeEach(() => clearAntigravityCaches());

async function writeJsonl(filePath: string, lines: unknown[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

async function writeRaw(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

async function makeBasicFixture(): Promise<{ root: string; sessionId: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "antigravity-fixture-"));
  const sessionId = "ctx-antigravity-12345678abcdef";
  
  // 1. Write history.jsonl
  const historyFile = path.join(root, "history.jsonl");
  await writeJsonl(historyFile, [
    {
      display: "hello",
      timestamp: 1779355960639,
      workspace: "/Users/cowcow02/Repo/antigravity-app",
      conversationId: sessionId,
    }
  ]);

  // 2. Write brain/<uuid>/.system_generated/logs/transcript.jsonl
  const transcriptFile = path.join(
    root,
    "brain",
    sessionId,
    ".system_generated",
    "logs",
    "transcript.jsonl"
  );
  
  const lines = [
    {
      step_index: 0,
      source: "USER_EXPLICIT",
      type: "USER_INPUT",
      status: "DONE",
      created_at: "2026-05-21T09:32:40Z",
      content: "<USER_REQUEST>\nlist files in this directory\n</USER_REQUEST>\n<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from None to Gemini 3.5 Flash (High).\n</USER_SETTINGS_CHANGE>",
    },
    {
      step_index: 1,
      source: "SYSTEM",
      type: "CONVERSATION_HISTORY",
      status: "DONE",
      created_at: "2026-05-21T09:32:40Z",
    },
    {
      step_index: 2,
      source: "MODEL",
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-05-21T09:32:41Z",
      content: "I'll look at the files.",
      thinking: "I need to run a command to list directories.",
      tool_calls: [
        {
          name: "list_dir",
          args: { DirectoryPath: "/Users/cowcow02/Repo/antigravity-app" },
        }
      ],
    },
    {
      step_index: 3,
      source: "MODEL",
      type: "LIST_DIRECTORY",
      status: "DONE",
      created_at: "2026-05-21T09:32:42Z",
      content: '{"name":"package.json","isDir":false}',
    }
  ];
  
  await writeJsonl(transcriptFile, lines);
  return { root, sessionId };
}

describe("antigravity parser", () => {
  it("lists sessions and stamps agent='antigravity'", async () => {
    const { root, sessionId } = await makeBasicFixture();
    const list = await listAntigravitySessions({ root });
    expect(list).toHaveLength(1);
    
    const meta = list[0]!;
    expect(meta.agent).toBe("antigravity");
    expect(meta.id).toBe(sessionId);
    expect(meta.model).toBe("Gemini 3.5 Flash");
    expect(meta.cwd).toBe("/Users/cowcow02/Repo/antigravity-app");
    expect(meta.projectName).toBe("/Users/cowcow02/Repo/antigravity-app");
    expect(meta.toolCallCount).toBe(1);
    expect(meta.turnCount).toBe(1);
    expect(meta.firstUserPreview).toBe("list files in this directory");
  });

  it("handles thinking blocks and sequential tool matches correctly in getSession", async () => {
    const { root, sessionId } = await makeBasicFixture();
    const detail = await getAntigravitySession(sessionId, { root });
    expect(detail).not.toBeNull();
    
    const events = detail!.events;
    
    // User event
    const userEvent = events.find((e) => e.role === "user");
    expect(userEvent).toBeDefined();
    expect(userEvent!.preview).toBe("list files in this directory");
    expect(userEvent!.blocks[0]).toEqual({ type: "text", text: "list files in this directory" });

    // Thinking event
    const thinkingEvent = events.find((e) => e.role === "agent-thinking");
    expect(thinkingEvent).toBeDefined();
    expect(thinkingEvent!.blocks[0]).toEqual({
      type: "thinking",
      thinking: "I need to run a command to list directories.",
    });

    // Agent event
    const agentEvent = events.find((e) => e.role === "agent");
    expect(agentEvent).toBeDefined();
    expect(agentEvent!.preview).toBe("I'll look at the files.");
    expect(agentEvent!.blocks[0]).toEqual({ type: "text", text: "I'll look at the files." });

    // Tool call event
    const toolCallEvent = events.find((e) => e.role === "tool-call");
    expect(toolCallEvent).toBeDefined();
    expect(toolCallEvent!.toolName).toBe("list_dir");
    expect(toolCallEvent!.toolUseId).toBe("tool-2-0");

    // Tool result event
    const toolResultEvent = events.find((e) => e.role === "tool-result");
    expect(toolResultEvent).toBeDefined();
    expect(toolResultEvent!.toolUseId).toBe("tool-2-0");
    expect(toolResultEvent!.toolResult).toBe('{"name":"package.json","isDir":false}');
  });

  it("deduplicates replayed records by step_index with last-write-wins", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "antigravity-dedup-"));
    const sessionId = "ctx-dedup-123";
    
    // Write history
    const historyFile = path.join(root, "history.jsonl");
    await writeJsonl(historyFile, [{ conversationId: sessionId, workspace: "/Users/cowcow02/Repo/app" }]);

    // Write transcript with duplicate step_index
    const transcriptFile = path.join(root, "brain", sessionId, ".system_generated", "logs", "transcript.jsonl");
    const lines = [
      {
        step_index: 0,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "RUNNING",
        created_at: "2026-05-21T09:30:00Z",
        content: "Drafting response...",
      },
      {
        step_index: 0, // Duplicate step_index with later status and final content
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-05-21T09:30:01Z",
        content: "Final response content.",
      }
    ];
    await writeJsonl(transcriptFile, lines);

    const detail = await getAntigravitySession(sessionId, { root });
    expect(detail).not.toBeNull();
    const agentEvents = detail!.events.filter((e) => e.role === "agent");
    // Should be exactly 1 agent event due to deduplication, not 2
    expect(agentEvents).toHaveLength(1);
    expect(agentEvents[0]!.preview).toBe("Final response content.");
  });

  it("handles status: CANCELED as an error in tool result events", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "antigravity-canceled-"));
    const sessionId = "ctx-canceled-123";
    
    // Write history
    const historyFile = path.join(root, "history.jsonl");
    await writeJsonl(historyFile, [{ conversationId: sessionId, workspace: "/Users/cowcow02/Repo/app" }]);

    // Write transcript with a canceled tool run
    const transcriptFile = path.join(root, "brain", sessionId, ".system_generated", "logs", "transcript.jsonl");
    const lines = [
      {
        step_index: 0,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-05-21T09:30:00Z",
        tool_calls: [{ name: "run_command", args: { CommandLine: "sleep 10" } }],
      },
      {
        step_index: 1,
        source: "MODEL",
        type: "RUN_COMMAND",
        status: "CANCELED",
        created_at: "2026-05-21T09:30:02Z",
        content: "Command was aborted by user",
      }
    ];
    await writeJsonl(transcriptFile, lines);

    const detail = await getAntigravitySession(sessionId, { root });
    expect(detail).not.toBeNull();
    const toolResults = detail!.events.filter((e) => e.role === "tool-result");
    expect(toolResults).toHaveLength(1);
    const block = toolResults[0]!.blocks[0];
    expect(block.type).toBe("tool_result");
    if (block.type === "tool_result") {
      expect(block.is_error).toBe(true);
    }
  });

  it("invalidates cache when CWD changes in history.jsonl", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "antigravity-cache-"));
    const sessionId = "ctx-cache-123";
    
    const historyFile = path.join(root, "history.jsonl");
    // Initially, no CWD mapping written
    await writeJsonl(historyFile, []);

    const transcriptFile = path.join(root, "brain", sessionId, ".system_generated", "logs", "transcript.jsonl");
    await writeJsonl(transcriptFile, [
      {
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-05-21T09:30:00Z",
        content: "hello",
      }
    ]);

    // 1. Read first time — should fall back to uuid as project name and undefined cwd
    const firstList = await listAntigravitySessions({ root });
    expect(firstList[0]!.cwd).toBeUndefined();
    expect(firstList[0]!.projectName).toBe(sessionId);

    // 2. Write CWD mapping to history.jsonl
    await writeJsonl(historyFile, [{ conversationId: sessionId, workspace: "/Users/cowcow02/Repo/app-fixed" }]);

    // 3. Read second time — cache must invalidate and fetch the updated mapping
    const secondList = await listAntigravitySessions({ root });
    expect(secondList[0]!.cwd).toBe("/Users/cowcow02/Repo/app-fixed");
    expect(secondList[0]!.projectName).toBe("/Users/cowcow02/Repo/app-fixed");
  });

  it("handles missing history.jsonl entry correctly", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "antigravity-no-history-"));
    const sessionId = "ctx-no-history-123";
    const transcriptFile = path.join(root, "brain", sessionId, ".system_generated", "logs", "transcript.jsonl");
    await writeJsonl(transcriptFile, [
      {
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-05-21T09:30:00Z",
        content: "test session",
      }
    ]);

    const list = await listAntigravitySessions({ root });
    expect(list).toHaveLength(1);
    expect(list[0]!.cwd).toBeUndefined();
    expect(list[0]!.projectName).toBe(sessionId);
  });

  it("handles empty or malformed transcript files gracefully", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "antigravity-malformed-"));
    const sessionId = "ctx-malformed-123";
    const transcriptFile = path.join(root, "brain", sessionId, ".system_generated", "logs", "transcript.jsonl");
    
    await writeRaw(transcriptFile, "malformed-json-line-1\n{invalid: true}\n");

    const list = await listAntigravitySessions({ root });
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(sessionId);
    expect(list[0]!.eventCount).toBe(0);
    expect(list[0]!.model).toBeUndefined();
  });

  it("handles multiple model changes with last-write-wins behavior", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "antigravity-multi-model-"));
    const sessionId = "ctx-multi-model-123";
    const transcriptFile = path.join(root, "brain", sessionId, ".system_generated", "logs", "transcript.jsonl");
    await writeJsonl(transcriptFile, [
      {
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-05-21T09:30:00Z",
        content: "change model setting\n<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from None to Gemini 3.5 Flash.\n</USER_SETTINGS_CHANGE>",
      },
      {
        step_index: 1,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-05-21T09:31:00Z",
        content: "change model setting again\n<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from Gemini 3.5 Flash to Claude 3.5 Sonnet.\n</USER_SETTINGS_CHANGE>",
      }
    ]);

    const list = await listAntigravitySessions({ root });
    expect(list).toHaveLength(1);
    expect(list[0]!.model).toBe("Claude 3.5 Sonnet");
  });

  it("extracts USER_INPUT text directly if no USER_REQUEST tag exists", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "antigravity-no-tag-"));
    const sessionId = "ctx-no-tag-123";
    const transcriptFile = path.join(root, "brain", sessionId, ".system_generated", "logs", "transcript.jsonl");
    await writeJsonl(transcriptFile, [
      {
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-05-21T09:30:00Z",
        content: "this is raw user prompt content directly",
      }
    ]);

    const detail = await getAntigravitySession(sessionId, { root });
    expect(detail).not.toBeNull();
    const userEvent = detail!.events.find((e) => e.role === "user");
    expect(userEvent).toBeDefined();
    expect(userEvent!.preview).toBe("this is raw user prompt content directly");
    expect(userEvent!.blocks[0]!.text).toBe("this is raw user prompt content directly");
  });

  it("does not consume pending tool calls when encountering ERROR_MESSAGE events", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "antigravity-error-msg-"));
    const sessionId = "ctx-error-msg-123";
    const transcriptFile = path.join(root, "brain", sessionId, ".system_generated", "logs", "transcript.jsonl");
    await writeJsonl(transcriptFile, [
      {
        step_index: 0,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-05-21T09:30:00Z",
        tool_calls: [{ name: "run_command", args: { CommandLine: "echo test" } }],
      },
      {
        step_index: 1,
        source: "MODEL",
        type: "ERROR_MESSAGE",
        status: "DONE",
        created_at: "2026-05-21T09:30:01Z",
        error: "Rate limit reached for the current model session",
      },
      {
        step_index: 2,
        source: "MODEL",
        type: "RUN_COMMAND",
        status: "DONE",
        created_at: "2026-05-21T09:30:02Z",
        content: "Command ran successfully output",
      }
    ]);

    const detail = await getAntigravitySession(sessionId, { root });
    expect(detail).not.toBeNull();
    
    const errorEvent = detail!.events.find((e) => e.rawType === "antigravity/error_message");
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.role).toBe("meta");

    const resultEvent = detail!.events.find((e) => e.role === "tool-result");
    expect(resultEvent).toBeDefined();
    expect(resultEvent!.toolUseId).toBe("tool-0-0");
    expect(resultEvent!.toolResult).toBe("Command ran successfully output");
  });
});
