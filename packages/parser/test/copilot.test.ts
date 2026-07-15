import { beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearCopilotCaches,
  copilotSessionLocalDay,
  getCopilotSession,
  listCopilotSessions,
} from "../src/copilot.js";
import { agentSources } from "../src/fs.js";
import { agentMetadata, getAgentMetadata } from "../src/agent-metadata.js";

const SESSION_ID = "5c2a9831-df48-41ac-878b-cd5438788786";
const CWD = "/Users/test/Repo/fleetlens";

beforeEach(() => clearCopilotCaches());

async function makeFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-fixture-"));
  const dir = path.join(root, SESSION_ID);
  await fs.mkdir(dir, { recursive: true });
  const lines = [
    {
      type: "session.start",
      timestamp: "2026-07-15T04:31:06.879Z",
      data: {
        sessionId: SESSION_ID,
        producer: "copilot-agent",
        copilotVersion: "1.0.70",
        context: {
          cwd: CWD,
          gitRoot: CWD,
          repository: "cowcow02/fleetlens",
          branch: "master",
        },
      },
    },
    {
      type: "session.model_change",
      timestamp: "2026-07-15T04:31:10.614Z",
      data: { newModel: "auto" },
    },
    {
      type: "session.auto_mode_resolved",
      timestamp: "2026-07-15T04:31:12.053Z",
      data: { chosenModel: "gpt-5-mini", reasoningBucket: "medium" },
    },
    {
      type: "user.message",
      timestamp: "2026-07-15T04:31:12.071Z",
      data: { content: "Read package.json and report its version." },
    },
    {
      type: "assistant.message",
      timestamp: "2026-07-15T04:31:14.748Z",
      data: {
        messageId: "assistant-1",
        model: "gpt-5-mini",
        content: "Reading package.json.",
        outputTokens: 138,
        toolRequests: [{
          toolCallId: "call-view-1",
          name: "view",
          arguments: { path: `${CWD}/package.json` },
        }],
      },
    },
    {
      type: "tool.execution_start",
      timestamp: "2026-07-15T04:31:14.749Z",
      data: {
        toolCallId: "call-view-1",
        toolName: "view",
        arguments: { path: `${CWD}/package.json` },
        model: "gpt-5-mini",
      },
    },
    {
      type: "tool.execution_complete",
      timestamp: "2026-07-15T04:31:14.759Z",
      data: {
        toolCallId: "call-view-1",
        model: "gpt-5-mini",
        success: true,
        result: { content: "{\"name\":\"fleetlens\",\"version\":\"0.16.6\"}" },
      },
    },
    {
      type: "assistant.message",
      timestamp: "2026-07-15T04:31:15.969Z",
      data: {
        messageId: "assistant-2",
        model: "gpt-5-mini",
        content: "The package is fleetlens version 0.16.6.",
        outputTokens: 27,
        toolRequests: [],
      },
    },
    {
      type: "session.shutdown",
      timestamp: "2026-07-15T04:31:15.990Z",
      data: {
        shutdownType: "routine",
        currentModel: "gpt-5-mini",
        tokenDetails: {
          input: { tokenCount: 3511 },
          cache_read: { tokenCount: 2944 },
          cache_write: { tokenCount: 12 },
          output: { tokenCount: 165 },
        },
        codeChanges: {
          linesAdded: 4,
          linesRemoved: 2,
          filesModified: ["a.ts", "b.ts"],
        },
      },
    },
  ];
  await fs.writeFile(
    path.join(dir, "events.jsonl"),
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n{incomplete",
  );
  return root;
}

describe("Copilot metadata", () => {
  it("registers GitHub Copilot CLI in both metadata and filesystem registries", () => {
    expect(getAgentMetadata("copilot")).toMatchObject({
      kind: "copilot",
      displayName: "GitHub Copilot CLI",
      shortLabel: "Copilot",
    });
    expect(agentMetadata.some((metadata) => metadata.kind === "copilot")).toBe(true);
    expect(agentSources.find((source) => source.kind === "copilot")?.defaultRoot)
      .toBe(path.join(os.homedir(), ".copilot", "session-state"));
  });
});

describe("Copilot parser", () => {
  it("normalizes session context, usage, code changes, and active time", async () => {
    const root = await makeFixture();
    const sessions = await listCopilotSessions({ root });
    expect(sessions).toHaveLength(1);
    const meta = sessions[0]!;
    expect(meta.agent).toBe("copilot");
    expect(meta.id).toBe(SESSION_ID);
    expect(meta.cwd).toBe(CWD);
    expect(meta.projectName).toBe(CWD);
    expect(meta.repoName).toBe("fleetlens");
    expect(meta.gitBranch).toBe("master");
    expect(meta.model).toBe("gpt-5-mini");
    expect(meta.totalUsage).toEqual({ input: 3511, output: 165, cacheRead: 2944, cacheWrite: 12 });
    expect(meta.toolCallCount).toBe(1);
    expect(meta.turnCount).toBe(1);
    expect(meta.firstUserPreview).toBe("Read package.json and report its version.");
    expect(meta.lastAgentPreview).toBe("The package is fleetlens version 0.16.6.");
    expect(meta.linesAdded).toBe(4);
    expect(meta.linesRemoved).toBe(2);
    expect(meta.filesEdited).toBe(2);
    expect(meta.status).toBe("idle");
    expect(meta.durationMs).toBe(9_111);
    expect(meta.airTimeMs).toBe(9_111);
    expect(meta.activeSegments).toHaveLength(1);
    expect(copilotSessionLocalDay(meta)).toBe("2026-07-15");
  });

  it("returns a tool-linked detail timeline without duplicating tool requests", async () => {
    const root = await makeFixture();
    const detail = await getCopilotSession(SESSION_ID, { root });
    expect(detail).not.toBeNull();
    expect(detail!.events.filter((event) => event.role === "tool-call")).toHaveLength(1);
    const toolCall = detail!.events.find((event) => event.role === "tool-call");
    expect(toolCall).toMatchObject({ toolName: "view", toolUseId: "call-view-1" });
    const toolResult = detail!.events.find((event) => event.role === "tool-result");
    expect(toolResult?.toolUseId).toBe("call-view-1");
    expect(toolResult?.blocks[0]).toMatchObject({ type: "tool_result", is_error: false });
    expect(detail!.events.find((event) => event.usage)?.usage).toEqual(detail!.totalUsage);
  });

  it("uses the final cumulative shutdown totals after a resumed session", async () => {
    const root = await makeFixture();
    const file = path.join(root, SESSION_ID, "events.jsonl");
    await fs.appendFile(file, "\n" + [
      {
        type: "session.resume",
        timestamp: "2026-07-15T04:32:00.000Z",
        data: { context: { cwd: CWD }, eventCount: 9 },
      },
      {
        type: "user.message",
        timestamp: "2026-07-15T04:32:01.000Z",
        data: { content: "Now add a regression test." },
      },
      {
        type: "assistant.message",
        timestamp: "2026-07-15T04:32:03.000Z",
        data: {
          messageId: "assistant-3",
          model: "gpt-5-mini",
          content: "Added the regression test.",
          outputTokens: 20,
          toolRequests: [],
        },
      },
      {
        type: "session.shutdown",
        timestamp: "2026-07-15T04:32:04.000Z",
        data: {
          currentModel: "gpt-5-mini",
          tokenDetails: {
            input: { tokenCount: 5000 },
            cache_read: { tokenCount: 7000 },
            cache_write: { tokenCount: 0 },
            output: { tokenCount: 300 },
          },
          codeChanges: {
            linesAdded: 40,
            linesRemoved: 5,
            filesModified: ["a.ts", "b.ts", "a.test.ts"],
          },
        },
      },
    ].map((line) => JSON.stringify(line)).join("\n") + "\n");

    const meta = (await listCopilotSessions({ root }))[0]!;
    expect(meta.turnCount).toBe(2);
    expect(meta.lastUserPreview).toBe("Now add a regression test.");
    expect(meta.lastAgentPreview).toBe("Added the regression test.");
    expect(meta.totalUsage).toEqual({ input: 5000, output: 300, cacheRead: 7000, cacheWrite: 0 });
    expect(meta.linesAdded).toBe(40);
    expect(meta.linesRemoved).toBe(5);
    expect(meta.filesEdited).toBe(3);
  });

  it("returns an empty list for a missing source root", async () => {
    const root = path.join(os.tmpdir(), `copilot-missing-${Date.now()}`);
    await expect(listCopilotSessions({ root })).resolves.toEqual([]);
  });
});
