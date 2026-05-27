import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listCoworkSessions,
  getCoworkSession,
  clearCoworkCaches,
} from "../src/cowork.js";

const SPACE_ID = "fc959c4e-06b9-472a-b3bc-f481cdc223d5";
const SPACE_PATH = "/Users/me/Documents/Claude/Projects/Demo";
const SESSION_ID = "local_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const CLI_SESSION = "ca90acc3-950e-4f4d-b785-e1af14cce3f9";

async function makeFixture(opts: { withSpace: boolean } = { withSpace: true }): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-fixture-"));
  const workspaceDir = path.join(root, "account-1", "workspace-1");
  await fs.mkdir(workspaceDir, { recursive: true });

  await fs.writeFile(
    path.join(workspaceDir, "spaces.json"),
    JSON.stringify({
      spaces: [
        {
          id: SPACE_ID,
          name: "Demo Space",
          folders: [{ path: SPACE_PATH }],
          projects: [],
          links: [],
        },
      ],
    }),
  );

  await fs.writeFile(
    path.join(workspaceDir, `${SESSION_ID}.json`),
    JSON.stringify({
      sessionId: SESSION_ID,
      cliSessionId: CLI_SESSION,
      cwd: "/sessions/practical-eager-newton",
      userSelectedFolders: [],
      createdAt: 1779860761055,
      lastActivityAt: 1779860784199,
      model: "claude-opus-4-7",
      title: "Demo cowork session",
      ...(opts.withSpace ? { spaceId: SPACE_ID } : {}),
    }),
  );

  const sessionDir = path.join(workspaceDir, SESSION_ID);
  await fs.mkdir(sessionDir, { recursive: true });

  const auditLines = [
    {
      type: "user",
      uuid: "u-1",
      session_id: CLI_SESSION,
      parent_tool_use_id: null,
      message: { role: "user", content: "Help me sort my screenshots." },
      timestamp: "2026-05-01T07:05:18.000Z",
    },
    {
      type: "system",
      subtype: "init",
      session_id: CLI_SESSION,
      timestamp: "2026-05-01T07:05:19.000Z",
    },
    {
      type: "assistant",
      uuid: "a-1",
      timestamp: "2026-05-01T07:05:20.500Z",
      requestId: "r-1",
      message: {
        id: "msg-1",
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "thinking", thinking: "Plan the file scan." }],
        usage: {
          input_tokens: 1200,
          output_tokens: 50,
          cache_read_input_tokens: 800,
          cache_creation_input_tokens: 0,
        },
      },
    },
    {
      type: "assistant",
      uuid: "a-2",
      timestamp: "2026-05-01T07:05:21.000Z",
      requestId: "r-1",
      message: {
        id: "msg-1",
        role: "assistant",
        model: "claude-opus-4-7",
        content: [
          { type: "tool_use", id: "tu-1", name: "Bash", input: { command: "ls" } },
        ],
        usage: {
          input_tokens: 1200,
          output_tokens: 50,
          cache_read_input_tokens: 800,
          cache_creation_input_tokens: 0,
        },
      },
    },
    {
      type: "user",
      uuid: "u-2",
      timestamp: "2026-05-01T07:05:22.000Z",
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tu-1", content: "screenshot-1.png" },
        ],
      },
    },
    {
      type: "assistant",
      uuid: "a-3",
      timestamp: "2026-05-01T07:05:23.000Z",
      requestId: "r-2",
      message: {
        id: "msg-2",
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "Found one screenshot." }],
        usage: {
          input_tokens: 1300,
          output_tokens: 60,
          cache_read_input_tokens: 900,
          cache_creation_input_tokens: 0,
        },
      },
    },
  ];

  await fs.writeFile(
    path.join(sessionDir, "audit.jsonl"),
    auditLines.map((l) => JSON.stringify(l)).join("\n") + "\n",
  );
  return root;
}

describe("cowork parser", () => {
  beforeEach(() => clearCoworkCaches());

  it("lists sessions, stamps agent='cowork', resolves project via spaces.json", async () => {
    const root = await makeFixture();
    const list = await listCoworkSessions({ root });
    expect(list).toHaveLength(1);
    const meta = list[0]!;
    expect(meta.agent).toBe("cowork");
    expect(meta.id).toBe(SESSION_ID);
    expect(meta.sessionId).toBe(SESSION_ID);
    expect(meta.projectName).toBe(SPACE_PATH);
    expect(meta.cwd).toBe(SPACE_PATH);
    expect(meta.model).toBe("claude-opus-4-7");
    expect(meta.totalUsage.input).toBeGreaterThan(0);
    expect(meta.toolCallCount).toBe(1);
    expect(meta.firstUserPreview).toBe("Help me sort my screenshots.");
    expect(meta.lastAgentPreview).toBe("Found one screenshot.");
    expect((meta.activeSegments ?? []).length).toBeGreaterThan(0);
  });

  it("falls back to cowork:unspaced when neither spaceId nor userSelectedFolders is set", async () => {
    const root = await makeFixture({ withSpace: false });
    const list = await listCoworkSessions({ root });
    expect(list).toHaveLength(1);
    expect(list[0]!.projectName).toBe("cowork:unspaced");
  });

  it("getCoworkSession returns the full event timeline", async () => {
    const root = await makeFixture();
    const detail = await getCoworkSession(SESSION_ID, { root });
    expect(detail).not.toBeNull();
    expect(detail!.events.length).toBeGreaterThan(0);
    const toolCall = detail!.events.find((e) => e.role === "tool-call");
    expect(toolCall?.toolName).toBe("Bash");
    const toolResult = detail!.events.find((e) => e.role === "tool-result");
    expect(toolResult?.toolUseId).toBe("tu-1");
    const userEvent = detail!.events.find((e) => e.role === "user");
    expect(userEvent?.preview).toBe("Help me sort my screenshots.");
  });

  it("returns empty list when root has no sessions", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-empty-"));
    const list = await listCoworkSessions({ root });
    expect(list).toEqual([]);
  });
});
