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

  it("splits dailyBreakdown across local days by each event's timestamp", () => {
    // Built from local-time Date objects so the test is timezone-independent.
    const lateNight = new Date(2026, 5, 1, 23, 30, 0, 0).toISOString(); // Jun 1 23:30 local
    const afterMidnight = new Date(2026, 5, 2, 0, 30, 0, 0).toISOString(); // Jun 2 00:30 local
    const lines = [
      makeUser("night work", lateNight, "u1"),
      makeAssistantTool("Bash", { command: "ls" }, lateNight, { messageId: "mt1" }),
      makeAssistantText("done", lateNight, {
        messageId: "m1",
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 },
      }),
      makeUser("more", afterMidnight, "u2"),
      makeAssistantTool("Read", { file_path: "x" }, afterMidnight, { messageId: "mt2" }),
      makeAssistantText("ok", afterMidnight, {
        messageId: "m2",
        usage: { input_tokens: 50, output_tokens: 25, cache_read_input_tokens: 500, cache_creation_input_tokens: 80 },
      }),
    ];
    const { meta } = parseTranscript(lines);
    const bd = meta.dailyBreakdown!;
    expect(bd.map((d) => d.day)).toEqual(["2026-06-01", "2026-06-02"]);
    const d1 = bd.find((d) => d.day === "2026-06-01")!;
    const d2 = bd.find((d) => d.day === "2026-06-02")!;
    expect(d1).toMatchObject({ toolCalls: 1, turns: 1, tokens: { input: 10, output: 5, cacheRead: 100, cacheWrite: 20 } });
    expect(d2).toMatchObject({ toolCalls: 1, turns: 1, tokens: { input: 50, output: 25, cacheRead: 500, cacheWrite: 80 } });
    // Sum-preserving: the per-day split equals the session totals exactly.
    expect(d1.toolCalls + d2.toolCalls).toBe(meta.toolCallCount);
    expect(d1.turns + d2.turns).toBe(meta.turnCount);
    expect(d1.tokens.input + d2.tokens.input).toBe(meta.totalUsage.input);
    expect(d1.tokens.cacheRead + d2.tokens.cacheRead).toBe(meta.totalUsage.cacheRead);
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

  it("skips framework boilerplate delivered as a block array (skill load)", () => {
    // Real-world case: skill loads arrive as content: [{type:"text", text:"Base directory…"}]
    // The original isHidden check only inspected string content and missed this shape.
    const skillLoad = {
      type: "user",
      uuid: "u-skill",
      parentUuid: null,
      timestamp: "2026-05-08T14:00:00.000Z",
      sessionId: "sess-1",
      cwd: "/Users/me/Repo/test",
      message: {
        role: "user",
        content: [
          { type: "text", text: "Base directory for this skill: /path\n# Skill body" },
        ],
      },
    };
    const lines = [
      skillLoad,
      makeUser("the actual user request", "2026-05-08T14:01:00.000Z"),
      makeAssistantText("ok", "2026-05-08T14:02:00.000Z"),
    ];
    const { meta } = parseTranscript(lines);
    expect(meta.firstUserPreview).toBe("the actual user request");
    expect(meta.turnCount).toBe(1);
  });

  it("strips Conductor's <system_instruction> wrapper but keeps the trailing user prompt (real shape: one combined message)", () => {
    const combined =
      "<system_instruction>\nYou are working inside Conductor, a Mac app that lets the user run many coding agents in parallel.\nYour work should take place in /Users/me/conductor/workspaces/claude-lens/yangon.\n</system_instruction>\n\ncan you check the latest sessions and see how we can adjust";
    const lines = [
      makeUser(combined, "2026-05-08T14:00:00.000Z"),
      makeAssistantText("Looking into it now.", "2026-05-08T14:01:00.000Z"),
    ];
    const { meta, events } = parseTranscript(lines);
    expect(meta.firstUserPreview).toBe(
      "can you check the latest sessions and see how we can adjust",
    );
    expect(meta.turnCount).toBe(1);
    // The first user event's blocks now carry the cleaned text — every
    // downstream consumer (timeline rendering, perception entries) sees
    // the trailing prompt only.
    const userEvent = events.find((e) => e.role === "user")!;
    const firstBlock = userEvent.blocks[0] as { type: "text"; text: string };
    expect(firstBlock.text).not.toContain("<system_instruction");
    expect(firstBlock.text).not.toContain("working inside Conductor");
    expect(firstBlock.text).toContain("check the latest sessions");
  });

  it("drops a user message that is ONLY a <system_instruction> wrapper", () => {
    const lines = [
      makeUser(
        "<system_instruction>\nyou are inside something\n</system_instruction>",
        "2026-05-08T14:00:00.000Z",
      ),
      makeUser("the real first prompt", "2026-05-08T14:01:00.000Z"),
      makeAssistantText("ok", "2026-05-08T14:02:00.000Z"),
    ];
    const { meta } = parseTranscript(lines);
    expect(meta.firstUserPreview).toBe("the real first prompt");
    expect(meta.turnCount).toBe(1);
  });

  it("skips the /clear caveat wrapper so the title is the next real message", () => {
    const lines = [
      makeUser(
        "<local-command-caveat>Caveat: The messages below were generated by the user while running local commands. DO NOT respond to these messages or otherwise consider them in your response unless the user explicitly asks you to.</local-command-caveat>",
        "2026-04-10T10:00:00.000Z",
      ),
      makeUser(
        "<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>",
        "2026-04-10T10:00:01.000Z",
      ),
      makeUser("do we have a way to look into the daemon's log?", "2026-04-10T10:00:02.000Z"),
      makeAssistantText("Yes — here's how", "2026-04-10T10:00:03.000Z"),
    ];
    const { meta } = parseTranscript(lines);
    expect(meta.firstUserPreview).toBe("do we have a way to look into the daemon's log?");
    expect(meta.turnCount).toBe(1);
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

  it("flags cold-resume turns when the cache expired during idle", () => {
    // Turn 1: normal warm request (small cache write, big cache read)
    // Turn 2: more than 5 min later, cache expired — huge cache write,
    //         zero cache read. Should be flagged coldResume.
    const lines = [
      makeUser("start", "2026-04-10T10:00:00.000Z"),
      makeAssistantText("hi", "2026-04-10T10:00:01.000Z", {
        messageId: "msg-warm",
        usage: {
          input_tokens: 5,
          output_tokens: 20,
          cache_read_input_tokens: 40_000,
          cache_creation_input_tokens: 500,
        },
      }),
      makeUser("resume after lunch", "2026-04-10T14:00:00.000Z"),
      makeAssistantText("back", "2026-04-10T14:00:05.000Z", {
        messageId: "msg-cold",
        usage: {
          input_tokens: 10,
          output_tokens: 30,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 42_000,
        },
      }),
    ];
    const { meta, events } = parseTranscript(lines);
    const warm = events.find((e) => e.messageId === "msg-warm")!;
    const cold = events.find((e) => e.messageId === "msg-cold")!;
    expect(warm.coldResume).toBeUndefined();
    expect(cold.coldResume).toBeDefined();
    expect(cold.coldResume!.trigger).toBe("idle");
    expect(cold.coldResume!.writeTokens).toBe(42_000);
    expect(cold.coldResume!.writeRatio).toBeCloseTo(1, 2);
    expect(cold.coldResume!.gapMs).toBe(4 * 60 * 60 * 1000 + 4000);
    expect(meta.coldResumeCount).toBe(1);
    expect(meta.cacheRebuildTokens).toBe(42_000);
  });

  it("flags the first turn after a compact_boundary as a compact rebuild", () => {
    // Two warm turns, then a manual /compact boundary, then a fresh turn
    // that rewrites the summarized prefix into cache. The idle gap here is
    // tiny (5 seconds) so the idle rule alone wouldn't catch it.
    const compactBoundary = {
      type: "system",
      subtype: "compact_boundary",
      content: "Conversation compacted",
      timestamp: "2026-04-10T10:05:00.000Z",
      uuid: "cb-1",
      compactMetadata: { trigger: "manual", preTokens: 500_000 },
      sessionId: "sess-1",
    };
    const lines = [
      makeUser("q1", "2026-04-10T10:00:00.000Z"),
      makeAssistantText("a1", "2026-04-10T10:00:01.000Z", {
        messageId: "m1",
        usage: {
          input_tokens: 5,
          output_tokens: 20,
          cache_read_input_tokens: 50_000,
          cache_creation_input_tokens: 500,
        },
      }),
      compactBoundary,
      makeUser("continue", "2026-04-10T10:05:03.000Z"),
      makeAssistantText("picking up", "2026-04-10T10:05:05.000Z", {
        messageId: "m-compact",
        usage: {
          input_tokens: 10,
          output_tokens: 30,
          cache_read_input_tokens: 12_000,
          cache_creation_input_tokens: 30_000,
        },
      }),
    ];
    const { meta, events } = parseTranscript(lines);
    const warm = events.find((e) => e.messageId === "m1")!;
    const rebuilt = events.find((e) => e.messageId === "m-compact")!;
    expect(warm.coldResume).toBeUndefined();
    expect(rebuilt.coldResume).toBeDefined();
    expect(rebuilt.coldResume!.trigger).toBe("compact");
    expect(rebuilt.coldResume!.compact?.trigger).toBe("manual");
    expect(rebuilt.coldResume!.compact?.preTokens).toBe(500_000);
    expect(rebuilt.coldResume!.writeTokens).toBe(30_000);
    expect(meta.coldResumeCount).toBe(1);
    expect(meta.cacheRebuildTokens).toBe(30_000);
  });

  it("propagates coldResume to thinking/tool-use siblings sharing a messageId", () => {
    // One API response that arrives as three lines in the JSONL: thinking +
    // tool_use + text, all sharing messageId "m-cold". The flag must land
    // on every sibling so the UI can surface it regardless of which row
    // the presentation layer chooses.
    const usage = {
      input_tokens: 5,
      output_tokens: 10,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 50_000,
    };
    const lines = [
      makeUser("warm", "2026-04-10T10:00:00.000Z"),
      makeAssistantText("ok", "2026-04-10T10:00:01.000Z", {
        messageId: "m-warm",
        usage: {
          input_tokens: 5,
          output_tokens: 5,
          cache_read_input_tokens: 40_000,
          cache_creation_input_tokens: 200,
        },
      }),
      makeUser("back after lunch", "2026-04-10T14:00:00.000Z"),
      // three lines, same messageId, different content types
      {
        type: "assistant",
        uuid: "a-think",
        timestamp: "2026-04-10T14:00:01.000Z",
        sessionId: "sess-1",
        message: {
          id: "m-cold",
          role: "assistant",
          model: "claude-opus-4-6",
          content: [{ type: "thinking", thinking: "let me catch up" }],
          usage,
        },
      },
      {
        type: "assistant",
        uuid: "a-tool",
        timestamp: "2026-04-10T14:00:02.000Z",
        sessionId: "sess-1",
        message: {
          id: "m-cold",
          role: "assistant",
          model: "claude-opus-4-6",
          content: [{ type: "tool_use", id: "tu-1", name: "Read", input: {} }],
          usage,
        },
      },
      {
        type: "assistant",
        uuid: "a-text",
        timestamp: "2026-04-10T14:00:03.000Z",
        sessionId: "sess-1",
        message: {
          id: "m-cold",
          role: "assistant",
          model: "claude-opus-4-6",
          content: [{ type: "text", text: "here" }],
          usage,
        },
      },
    ];
    const { events } = parseTranscript(lines);
    const coldEvents = events.filter((e) => e.messageId === "m-cold");
    expect(coldEvents).toHaveLength(3);
    for (const e of coldEvents) {
      expect(e.coldResume).toBeDefined();
      expect(e.coldResume!.trigger).toBe("idle");
      expect(e.coldResume!.writeTokens).toBe(50_000);
    }
  });

  it("does not flag cold-resume when cache read dominates (warm turn)", () => {
    const lines = [
      makeUser("q1", "2026-04-10T10:00:00.000Z"),
      makeAssistantText("a1", "2026-04-10T10:00:01.000Z", {
        messageId: "m1",
        usage: {
          input_tokens: 5,
          output_tokens: 20,
          cache_read_input_tokens: 10_000,
          cache_creation_input_tokens: 200,
        },
      }),
      // 10 min later — past TTL — but cacheRead still dominates (cache hit
      // via 1h extended tier). Should NOT be flagged.
      makeUser("q2", "2026-04-10T10:10:00.000Z"),
      makeAssistantText("a2", "2026-04-10T10:10:05.000Z", {
        messageId: "m2",
        usage: {
          input_tokens: 5,
          output_tokens: 20,
          cache_read_input_tokens: 10_200,
          cache_creation_input_tokens: 200,
        },
      }),
    ];
    const { meta } = parseTranscript(lines);
    expect(meta.coldResumeCount).toBe(0);
    expect(meta.cacheRebuildTokens).toBe(0);
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

  it("renders a Conductor-wrapped user message as the trailing prompt only (wrapper excised)", () => {
    const combined =
      "<system_instruction>\nYou are working inside Conductor.\n</system_instruction>\n\ncan you check the latest sessions";
    const lines = [
      makeUser(combined, "2026-05-08T14:00:00.000Z"),
      makeAssistantText("Looking into it", "2026-05-08T14:01:00.000Z"),
    ];
    const { events } = parseTranscript(lines);
    const rows = buildPresentation(events);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.kind).toBe("user");
    if (rows[0]!.kind === "user") {
      expect(rows[0]!.event.preview).toBe("can you check the latest sessions");
      expect(rows[0]!.event.preview).not.toContain("Conductor");
    }
    expect(rows[1]!.kind).toBe("agent");
  });

  it("hides a user row whose content was entirely a stripped wrapper", () => {
    const lines = [
      makeUser(
        "<system_instruction>\nharness boilerplate\n</system_instruction>",
        "2026-05-08T14:00:00.000Z",
      ),
      makeUser("the real prompt", "2026-05-08T14:01:00.000Z"),
      makeAssistantText("ok", "2026-05-08T14:02:00.000Z"),
    ];
    const { events } = parseTranscript(lines);
    const rows = buildPresentation(events);
    // Empty-after-strip user event is hidden; only the real prompt + agent remain.
    expect(rows).toHaveLength(2);
    expect(rows[0]!.kind).toBe("user");
    if (rows[0]!.kind === "user") {
      expect(rows[0]!.event.preview).toBe("the real prompt");
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

  it("anchors turn duration at the originating user message", () => {
    // Single-row turn used to render as 0ms because durationMs was
    // last-row minus first-row (excluding the user message). Now the
    // turn spans from the user prompt to the last agent row.
    const lines = [
      makeUser("ask", "2026-04-10T10:00:00.000Z"),
      makeAssistantText("answer", "2026-04-10T10:00:15.000Z"),
      makeUser("follow-up", "2026-04-10T10:00:30.000Z"),
    ];
    const { events } = parseTranscript(lines);
    const rows = buildPresentation(events);
    const mega = buildMegaRows(rows);

    const turn = mega.find((r) => r.kind === "turn");
    expect(turn).toBeDefined();
    if (turn?.kind === "turn") {
      expect(turn.durationMs).toBe(15_000);
      expect(turn.tOffsetMs).toBe(0);
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

describe("parseTranscript — team fields", () => {
  it("extracts teamName from top-level event field", () => {
    const lines = [
      { type: "user", sessionId: "s1", teamName: "my-team",
        message: { content: "hi" }, timestamp: "2026-04-15T10:00:00Z", uuid: "u1" },
    ];
    const { meta } = parseTranscript(lines);
    expect(meta.teamName).toBe("my-team");
  });

  it("leaves teamName undefined when absent", () => {
    const lines = [
      { type: "user", sessionId: "s1",
        message: { content: "hi" }, timestamp: "2026-04-15T10:00:00Z", uuid: "u1" },
    ];
    const { meta } = parseTranscript(lines);
    expect(meta.teamName).toBeUndefined();
  });

  it("extracts agentName on member session", () => {
    const lines = [
      { type: "user", sessionId: "s1", teamName: "t", agentName: "kip-127",
        message: { content: "hi" }, timestamp: "2026-04-15T10:00:00Z", uuid: "u1" },
    ];
    const { meta } = parseTranscript(lines);
    expect(meta.agentName).toBe("kip-127");
  });

  it("leaves agentName undefined on lead session", () => {
    const lines = [
      { type: "user", sessionId: "s1", teamName: "t",
        message: { content: "hi" }, timestamp: "2026-04-15T10:00:00Z", uuid: "u1" },
    ];
    const { meta } = parseTranscript(lines);
    expect(meta.agentName).toBeUndefined();
  });

  it("does NOT mark a session as team lead just because it has a teamName tag", () => {
    // Reproduces the bug where a one-off chat opened in an existing team
    // context gets tagged with teamName but is doing zero team work.
    const lines = [
      { type: "user", sessionId: "s1", teamName: "orphan-team",
        message: { content: "explain the harness" },
        timestamp: "2026-04-15T10:00:00Z", uuid: "u1" },
    ];
    const { meta } = parseTranscript(lines);
    expect(meta.teamName).toBe("orphan-team");
    expect(meta.isTeamLead).toBe(false);
  });

  it("marks a session as team lead when it contains TeamCreate", () => {
    const lines = [
      { type: "user", sessionId: "s1", teamName: "t",
        message: { content: "start team" },
        timestamp: "2026-04-15T10:00:00Z", uuid: "u1" },
      { type: "assistant", sessionId: "s1", teamName: "t",
        timestamp: "2026-04-15T10:00:05Z", uuid: "u2", parentUuid: "u1",
        requestId: "r1",
        message: { id: "m1", model: "claude-opus", content: [
          { type: "tool_use", id: "tu1", name: "TeamCreate",
            input: { team_name: "t", agent_type: "orchestrator" } },
        ] } },
    ];
    const { meta } = parseTranscript(lines);
    expect(meta.isTeamLead).toBe(true);
  });

  it("marks a session as team lead when it contains an outbound SendMessage", () => {
    const lines = [
      { type: "user", sessionId: "s1", teamName: "t",
        message: { content: "go" },
        timestamp: "2026-04-15T10:00:00Z", uuid: "u1" },
      { type: "assistant", sessionId: "s1", teamName: "t",
        timestamp: "2026-04-15T10:00:05Z", uuid: "u2", parentUuid: "u1",
        requestId: "r1",
        message: { id: "m1", model: "claude-opus", content: [
          { type: "tool_use", id: "tu1", name: "SendMessage",
            input: { to: "member-a", message: "do task" } },
        ] } },
    ];
    const { meta } = parseTranscript(lines);
    expect(meta.isTeamLead).toBe(true);
  });

  it("does NOT mark a member session as team lead even with SendMessage to team-lead", () => {
    // Members send to "team-lead", not to other agents — that's a reply,
    // not a dispatch, and shouldn't qualify them as a lead.
    const lines = [
      { type: "user", sessionId: "s1", teamName: "t", agentName: "member-a",
        message: { content: "hi" },
        timestamp: "2026-04-15T10:00:00Z", uuid: "u1" },
      { type: "assistant", sessionId: "s1", teamName: "t", agentName: "member-a",
        timestamp: "2026-04-15T10:00:05Z", uuid: "u2", parentUuid: "u1",
        requestId: "r1",
        message: { id: "m1", model: "claude-opus", content: [
          { type: "tool_use", id: "tu1", name: "SendMessage",
            input: { to: "team-lead", message: "done" } },
        ] } },
    ];
    const { meta } = parseTranscript(lines);
    expect(meta.isTeamLead).toBe(false);
    expect(meta.agentName).toBe("member-a");
  });
});

describe("parseTranscript — teammateMessage classification", () => {
  const base = {
    type: "user",
    sessionId: "s1",
    timestamp: "2026-04-15T10:00:00Z",
    uuid: "u1",
    parentUuid: null,
  };

  function withContent(content: unknown) {
    return [{ ...base, message: { content } }];
  }

  it("tags a basic teammate-message wrapper", () => {
    const lines = withContent(
      '<teammate-message teammate_id="team-lead">hello from lead</teammate-message>',
    );
    const { events } = parseTranscript(lines);
    expect(events[0]!.teammateMessage).toEqual({
      teammateId: "team-lead",
      body: "hello from lead",
      kind: "message",
    });
  });

  it("handles attributes like color and summary", () => {
    const lines = withContent(
      '<teammate-message teammate_id="kip-121" color="blue" summary="PR #104 ready">PR merged</teammate-message>',
    );
    const { events } = parseTranscript(lines);
    expect(events[0]!.teammateMessage?.teammateId).toBe("kip-121");
    expect(events[0]!.teammateMessage?.body).toBe("PR merged");
  });

  it("classifies idle notifications by JSON body type", () => {
    const lines = withContent(
      '<teammate-message teammate_id="kip-121">{"type":"idle_notification","from":"kip-121"}</teammate-message>',
    );
    const { events } = parseTranscript(lines);
    expect(events[0]!.teammateMessage?.kind).toBe("idle-notification");
  });

  it("classifies shutdown requests by JSON body type", () => {
    const lines = withContent(
      '<teammate-message teammate_id="team-lead">{"type":"shutdown_request","requestId":"x"}</teammate-message>',
    );
    const { events } = parseTranscript(lines);
    expect(events[0]!.teammateMessage?.kind).toBe("shutdown-request");
  });

  it("leaves teammateMessage undefined on real human user input", () => {
    const lines = withContent("add a new feature please");
    const { events } = parseTranscript(lines);
    expect(events[0]!.teammateMessage).toBeUndefined();
  });

  it("accepts wrapper inside an array content block", () => {
    const lines = withContent([
      { type: "text",
        text: '<teammate-message teammate_id="kip-121">PR merged</teammate-message>' },
    ]);
    const { events } = parseTranscript(lines);
    expect(events[0]!.teammateMessage?.teammateId).toBe("kip-121");
    expect(events[0]!.teammateMessage?.body).toBe("PR merged");
  });

  it("excludes teammate-message events from turnCount / first / last user previews", () => {
    // Simulates a team lead transcript: real human prompt, inbound team
    // reply, human follow-up. turnCount should be 2 (the human messages
    // only), and previews should surface the human text — not the inbound
    // cross-session deliveries.
    const lines = [
      { ...base, uuid: "h1", timestamp: "2026-04-15T10:00:00Z",
        message: { content: "start the team" } },
      { ...base, uuid: "tm1", timestamp: "2026-04-15T10:05:00Z",
        message: { content: '<teammate-message teammate_id="member-a">PR merged</teammate-message>' } },
      { ...base, uuid: "h2", timestamp: "2026-04-15T10:10:00Z",
        message: { content: "good, now do the next one" } },
    ];
    const { meta } = parseTranscript(lines);
    expect(meta.turnCount).toBe(2);
    expect(meta.firstUserPreview).toBe("start the team");
    expect(meta.lastUserPreview).toBe("good, now do the next one");
  });
});
