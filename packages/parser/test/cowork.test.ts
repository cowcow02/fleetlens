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

type FixtureOpts = {
  withSpace?: boolean;
  userSelectedFolders?: string[];
  /** Override the default audit.jsonl lines (for replay-dedup coverage). */
  auditLines?: unknown[];
};

async function makeFixture(opts: FixtureOpts = {}): Promise<string> {
  const withSpace = opts.withSpace ?? true;
  const userSelectedFolders = opts.userSelectedFolders ?? [];
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
      userSelectedFolders,
      createdAt: 1779860761055,
      lastActivityAt: 1779860784199,
      model: "claude-opus-4-7",
      title: "Demo cowork session",
      ...(withSpace ? { spaceId: SPACE_ID } : {}),
    }),
  );

  const sessionDir = path.join(workspaceDir, SESSION_ID);
  await fs.mkdir(sessionDir, { recursive: true });

  const auditLines = opts.auditLines ?? [
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

  it("falls back to userSelectedFolders[0] when no spaceId is set", async () => {
    const folderPath = "/Users/me/Projects/AdHoc";
    const root = await makeFixture({
      withSpace: false,
      userSelectedFolders: [folderPath],
    });
    const list = await listCoworkSessions({ root });
    expect(list).toHaveLength(1);
    expect(list[0]!.projectName).toBe(folderPath);
    expect(list[0]!.cwd).toBe(folderPath);
  });

  it("invalidates cached projectName when spaces.json is rewritten", async () => {
    const root = await makeFixture();
    const first = (await listCoworkSessions({ root }))[0]!;
    expect(first.projectName).toBe(SPACE_PATH);

    // Rewrite spaces.json (Desktop does this on space rename / folder edit)
    // but leave audit.jsonl untouched. The cache must invalidate.
    const newPath = "/Users/me/Documents/Claude/Projects/Renamed";
    const spacesPath = path.join(root, "account-1", "workspace-1", "spaces.json");
    await fs.writeFile(
      spacesPath,
      JSON.stringify({
        spaces: [
          { id: SPACE_ID, name: "Renamed", folders: [{ path: newPath }] },
        ],
      }),
    );
    // mkdtemp gives us 1s+ mtime resolution on macOS, but vitest may run this
    // within the same second — bump the mtime explicitly.
    const future = new Date(Date.now() + 5000);
    await fs.utimes(spacesPath, future, future);

    const second = (await listCoworkSessions({ root }))[0]!;
    expect(second.projectName).toBe(newPath);
    expect(second.cwd).toBe(newPath);
  });

  it("invalidates cached projectName when local_<uuid>.json sidecar is rewritten", async () => {
    const root = await makeFixture({ withSpace: false });
    const first = (await listCoworkSessions({ root }))[0]!;
    expect(first.projectName).toBe("cowork:unspaced");

    // User attaches a folder mid-session: Desktop writes the sidecar JSON
    // but doesn't touch audit.jsonl until the next agent turn.
    const folderPath = "/Users/me/Projects/AttachedLater";
    const metaPath = path.join(root, "account-1", "workspace-1", `${SESSION_ID}.json`);
    const raw = JSON.parse(await fs.readFile(metaPath, "utf8")) as Record<string, unknown>;
    raw.userSelectedFolders = [folderPath];
    await fs.writeFile(metaPath, JSON.stringify(raw));
    const future = new Date(Date.now() + 5000);
    await fs.utimes(metaPath, future, future);

    const second = (await listCoworkSessions({ root }))[0]!;
    expect(second.projectName).toBe(folderPath);
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

  it("collapses cowork's duplicated user lines (raw input + isReplay copy share a uuid)", async () => {
    // Desktop logs the user message twice under one uuid: the raw input (no
    // timestamp) and the isReplay copy fed to the agent (with a timestamp).
    const dup = (extra: Record<string, unknown>) => ({
      type: "user",
      uuid: "u-dup",
      message: { role: "user", content: "from this project name, what do I want?" },
      ...extra,
    });
    const root = await makeFixture({
      auditLines: [
        dup({ session_id: CLI_SESSION, client_platform: "desktop_app" }), // raw input, no timestamp
        { type: "system", subtype: "init", timestamp: "2026-05-01T07:05:01.000Z" },
        dup({ session_id: "inner-replay", timestamp: "2026-05-01T07:05:02.000Z", isReplay: true }),
        {
          type: "assistant",
          uuid: "a-1",
          timestamp: "2026-05-01T07:05:03.000Z",
          requestId: "r-1",
          message: {
            id: "msg-1",
            role: "assistant",
            model: "claude-opus-4-7",
            content: [{ type: "text", text: "Here is my guess." }],
            usage: { input_tokens: 100, output_tokens: 10 },
          },
        },
      ],
    });
    const detail = await getCoworkSession(SESSION_ID, { root });
    expect(detail).not.toBeNull();
    const userEvents = detail!.events.filter((e) => e.role === "user");
    expect(userEvents).toHaveLength(1);
    // The kept copy is the timestamped one, so the turn lands on the timeline.
    expect(userEvents[0]!.preview).toBe("from this project name, what do I want?");
    expect(userEvents[0]!.timestamp).toBe("2026-05-01T07:05:02.000Z");
  });
});
