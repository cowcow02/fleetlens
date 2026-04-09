import { describe, it, expect } from "vitest";
import { parseTranscript } from "../src/parser.js";
import { buildPresentation, buildMegaRows } from "../src/presentation.js";

const makeUser = (text: string, ts: string, uuid = "u-" + ts) => ({
  type: "user",
  uuid,
  parentUuid: null,
  timestamp: ts,
  sessionId: "sess-1",
  cwd: "/Users/me/Repo/test",
  message: { role: "user", content: text },
});

const makeAssistantText = (text: string, ts: string, opts: {
  messageId?: string;
  model?: string;
  usage?: Record<string, number>;
} = {}) => ({
  type: "assistant",
  uuid: "a-" + ts,
  timestamp: ts,
  sessionId: "sess-1",
  message: {
    id: opts.messageId ?? "msg-" + ts,
    role: "assistant",
    model: opts.model ?? "claude-opus-4-6",
    content: [{ type: "text", text }],
    usage: opts.usage ?? {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 1000,
      cache_creation_input_tokens: 200,
    },
    stop_reason: "end_turn",
  },
});

const makeAssistantTool = (name: string, input: object, ts: string, opts: {
  messageId?: string;
} = {}) => ({
  type: "assistant",
  uuid: "a-t-" + ts,
  timestamp: ts,
  sessionId: "sess-1",
  message: {
    id: opts.messageId ?? "msg-t-" + ts,
    role: "assistant",
    model: "claude-opus-4-6",
    content: [{ type: "tool_use", id: "tu-" + ts, name, input }],
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  },
});

describe("parseTranscript", () => {
  it("parses a basic user → assistant exchange", () => {
    const lines = [
      makeUser("Hello agent", "2026-04-10T10:00:00.000Z"),
      makeAssistantText("Hi!", "2026-04-10T10:00:02.000Z"),
    ];
    const { meta, events } = parseTranscript(lines);
    expect(events).toHaveLength(2);
    expect(events[0]!.role).toBe("user");
    expect(events[0]!.preview).toBe("Hello agent");
    expect(events[1]!.role).toBe("agent");
    expect(events[1]!.preview).toBe("Hi!");
    expect(meta.totalUsage.input).toBe(100);
    expect(meta.totalUsage.output).toBe(50);
    expect(meta.durationMs).toBe(2000);
  });

  it("deduplicates usage across split-block assistant responses", () => {
    const usage = {
      input_tokens: 200,
      output_tokens: 100,
      cache_read_input_tokens: 5000,
      cache_creation_input_tokens: 500,
    };
    // Same message.id split across two JSONL lines — should only count once.
    const lines = [
      makeUser("Hi", "2026-04-10T10:00:00.000Z"),
      makeAssistantText("Thinking...", "2026-04-10T10:00:01.000Z", {
        messageId: "msg-1",
        usage,
      }),
      makeAssistantText("Here you go.", "2026-04-10T10:00:02.000Z", {
        messageId: "msg-1",
        usage,
      }),
    ];
    const { meta } = parseTranscript(lines);
    expect(meta.totalUsage.input).toBe(200);
    expect(meta.totalUsage.output).toBe(100);
    expect(meta.totalUsage.cacheRead).toBe(5000);
  });

  it("computes tOffsetMs relative to earliest timestamp", () => {
    // Attachment comes first in JSONL but has a later timestamp.
    const lines = [
      makeUser("start", "2026-04-10T10:00:00.000Z"),
      makeAssistantText("done", "2026-04-10T10:00:05.000Z"),
    ];
    const { events } = parseTranscript(lines);
    expect(events[0]!.tOffsetMs).toBe(0);
    expect(events[1]!.tOffsetMs).toBe(5000);
  });

  it("derives firstUserPreview and lastAgentPreview skipping slash commands", () => {
    const lines = [
      makeUser("<command-name>/implement</command-name><command-args>AGE-9</command-args>", "2026-04-10T10:00:00.000Z"),
      makeUser("Real first message", "2026-04-10T10:00:01.000Z"),
      makeAssistantText("First agent reply", "2026-04-10T10:00:02.000Z"),
      makeAssistantText("Last agent reply", "2026-04-10T10:00:10.000Z"),
    ];
    const { meta } = parseTranscript(lines);
    expect(meta.firstUserPreview).toBe("Real first message");
    expect(meta.lastAgentPreview).toBe("Last agent reply");
    expect(meta.turnCount).toBe(1); // slash command doesn't count
  });

  it("counts tool calls", () => {
    const lines = [
      makeUser("do stuff", "2026-04-10T10:00:00.000Z"),
      makeAssistantTool("Bash", { command: "ls" }, "2026-04-10T10:00:01.000Z"),
      makeAssistantTool("Read", { file_path: "/a.txt" }, "2026-04-10T10:00:02.000Z"),
      makeAssistantText("done", "2026-04-10T10:00:03.000Z"),
    ];
    const { meta } = parseTranscript(lines);
    expect(meta.toolCallCount).toBe(2);
  });
});

describe("buildPresentation", () => {
  it("merges consecutive tool calls into a single tool-group", () => {
    const lines = [
      makeUser("do stuff", "2026-04-10T10:00:00.000Z"),
      makeAssistantTool("Bash", { command: "ls" }, "2026-04-10T10:00:01.000Z"),
      makeAssistantTool("Bash", { command: "pwd" }, "2026-04-10T10:00:02.000Z"),
      makeAssistantTool("Read", { file_path: "/a.txt" }, "2026-04-10T10:00:03.000Z"),
      makeAssistantText("done", "2026-04-10T10:00:04.000Z"),
    ];
    const { events } = parseTranscript(lines);
    const rows = buildPresentation(events);
    expect(rows).toHaveLength(3); // user, tool-group, agent
    const toolGroup = rows[1]!;
    expect(toolGroup.kind).toBe("tool-group");
    if (toolGroup.kind === "tool-group") {
      expect(toolGroup.count).toBe(3);
      expect(toolGroup.toolNames).toEqual([
        { name: "Bash", count: 2 },
        { name: "Read", count: 1 },
      ]);
    }
  });

  it("detects slash commands and pretty-prints", () => {
    const lines = [
      makeUser(
        "<command-name>/implement</command-name>\n<command-args>AGE-9</command-args>",
        "2026-04-10T10:00:00.000Z",
      ),
      makeAssistantText("working on AGE-9", "2026-04-10T10:00:01.000Z"),
    ];
    const { events } = parseTranscript(lines);
    const rows = buildPresentation(events);
    const userRow = rows[0]!;
    expect(userRow.kind).toBe("user");
    if (userRow.kind === "user") {
      expect(userRow.displayPreview).toBe("/implement AGE-9");
    }
  });

  it("detects task-notifications", () => {
    const lines = [
      makeUser("kick off", "2026-04-10T10:00:00.000Z"),
      makeAssistantText("working", "2026-04-10T10:00:01.000Z"),
      makeUser(
        "<task-notification><status>completed</status><summary>tests passed</summary></task-notification>",
        "2026-04-10T10:00:10.000Z",
      ),
    ];
    const { events } = parseTranscript(lines);
    const rows = buildPresentation(events);
    const notif = rows.find((r) => r.kind === "task-notification");
    expect(notif).toBeDefined();
    if (notif?.kind === "task-notification") {
      expect(notif.status).toBe("success");
      expect(notif.summary).toBe("tests passed");
    }
  });
});

describe("buildMegaRows", () => {
  it("collapses agent messages between user inputs into a turn", () => {
    const lines = [
      makeUser("first", "2026-04-10T10:00:00.000Z"),
      makeAssistantText("plan", "2026-04-10T10:00:01.000Z"),
      makeAssistantTool("Bash", { command: "ls" }, "2026-04-10T10:00:02.000Z"),
      makeAssistantText("conclusion", "2026-04-10T10:00:03.000Z"),
      makeUser("second", "2026-04-10T10:00:10.000Z"),
    ];
    const { events } = parseTranscript(lines);
    const rows = buildPresentation(events);
    const mega = buildMegaRows(rows);

    // [user, turn, user]
    expect(mega).toHaveLength(3);
    expect(mega[0]!.kind).toBe("user");
    expect(mega[1]!.kind).toBe("turn");
    expect(mega[2]!.kind).toBe("user");

    if (mega[1]!.kind === "turn") {
      expect(mega[1]!.summary.agentMessages).toBe(2);
      expect(mega[1]!.summary.toolCalls).toBe(1);
      expect(mega[1]!.summary.firstAgentPreview).toBe("plan");
      expect(mega[1]!.summary.finalAgentPreview).toBe("conclusion");
    }
  });

  it("skips task-notification coda when picking conclusion", () => {
    const lines = [
      makeUser("first", "2026-04-10T10:00:00.000Z"),
      makeAssistantText("The real conclusion is here", "2026-04-10T10:00:01.000Z"),
      // Background task notification arrives later
      makeUser(
        "<task-notification><status>completed</status><summary>bg task done</summary></task-notification>",
        "2026-04-10T10:00:05.000Z",
      ),
      makeAssistantText("Acknowledged", "2026-04-10T10:00:06.000Z"),
    ];
    const { events } = parseTranscript(lines);
    const rows = buildPresentation(events);
    const mega = buildMegaRows(rows);

    // Find the turn mega row. It should pick "The real conclusion" as finalAgentPreview.
    const turn = mega.find((r) => r.kind === "turn");
    expect(turn).toBeDefined();
    if (turn?.kind === "turn") {
      expect(turn.summary.finalAgentPreview).toBe("The real conclusion is here");
    }
  });
});
