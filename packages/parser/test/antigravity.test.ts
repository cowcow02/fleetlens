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
});
