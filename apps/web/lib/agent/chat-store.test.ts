import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyRunEvent,
  chatTitle,
  createChat,
  deleteChat,
  listChats,
  newAssistantMessage,
  readChat,
  writeChat,
  type Chat,
  type RunEvent,
  type RunEventBody,
} from "./chat-store";

let dir: string;
let prevHome: string | undefined;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "cclens-chat-test-"));
  prevHome = process.env.CCLENS_HOME;
  process.env.CCLENS_HOME = dir;
});

afterAll(() => {
  if (prevHome === undefined) delete process.env.CCLENS_HOME;
  else process.env.CCLENS_HOME = prevHome;
  rmSync(dir, { recursive: true, force: true });
});

function running(): Chat {
  const chat = createChat();
  chat.messages.push({ role: "user", text: "find my daemon work" });
  chat.messages.push(newAssistantMessage());
  chat.status = "running";
  return chat;
}

const ev = (e: RunEventBody, seq = 1): RunEvent => ({ seq, ...e }) as RunEvent;

describe("applyRunEvent", () => {
  test("delta appends to the trailing text segment, creating one if needed", () => {
    let chat = running();
    chat = applyRunEvent(chat, ev({ type: "delta", text: "Hello" }));
    chat = applyRunEvent(chat, ev({ type: "delta", text: " world" }, 2));
    const last = chat.messages[chat.messages.length - 1]!;
    expect(last.role).toBe("assistant");
    expect(last.role === "assistant" && last.segments).toEqual([{ kind: "text", text: "Hello world" }]);
  });

  test("tool events add tool segments; results resolve them by id", () => {
    let chat = running();
    chat = applyRunEvent(chat, ev({ type: "delta", text: "Searching. " }));
    chat = applyRunEvent(chat, ev({ type: "tool", id: "t1", name: "search_sessions", input: { query: "x" } }, 2));
    chat = applyRunEvent(chat, ev({ type: "tool_result", id: "t1", name: "search_sessions", brief: "3 matching sessions", isError: false }, 3));
    chat = applyRunEvent(chat, ev({ type: "delta", text: "Found it." }, 4));
    const last = chat.messages[chat.messages.length - 1]!;
    expect(last.role === "assistant" && last.segments).toEqual([
      { kind: "text", text: "Searching. " },
      { kind: "tool", id: "t1", name: "search_sessions", input: { query: "x" }, brief: "3 matching sessions", isError: false, done: true },
      { kind: "text", text: "Found it." },
    ]);
  });

  test("done marks the chat idle and finalizes dangling tools", () => {
    let chat = running();
    chat = applyRunEvent(chat, ev({ type: "tool", id: "t1", name: "get_session", input: {} }));
    chat = applyRunEvent(chat, ev({ type: "done", totalTokens: 123 }, 2));
    expect(chat.status).toBe("idle");
    const last = chat.messages[chat.messages.length - 1]!;
    expect(last.role === "assistant" && last.segments[0]).toMatchObject({ kind: "tool", done: true });
    expect(chat.lastSeq).toBe(2);
  });

  test("error appends an error text segment and marks the chat error", () => {
    let chat = running();
    chat = applyRunEvent(chat, ev({ type: "error", message: "timed out" }));
    expect(chat.status).toBe("error");
    const last = chat.messages[chat.messages.length - 1]!;
    expect(last.role === "assistant" && last.segments.some((s) => s.kind === "text" && s.text.includes("timed out"))).toBe(true);
  });

  test("stale events (seq <= lastSeq) are ignored", () => {
    let chat = running();
    chat = applyRunEvent(chat, ev({ type: "delta", text: "a" }, 5));
    chat = applyRunEvent(chat, ev({ type: "delta", text: "b" }, 5));
    const last = chat.messages[chat.messages.length - 1]!;
    expect(last.role === "assistant" && last.segments).toEqual([{ kind: "text", text: "a" }]);
  });
});

describe("chatTitle", () => {
  test("derives from the first user message, collapsed and clamped", () => {
    expect(chatTitle("  find   my\ndaemon work  ")).toBe("find my daemon work");
    expect(chatTitle("x".repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe("fs round-trip", () => {
  test("create, write, read, list, delete", () => {
    const a = createChat();
    a.messages.push({ role: "user", text: "first chat" });
    a.title = chatTitle("first chat");
    writeChat(a);
    const b = createChat();
    b.messages.push({ role: "user", text: "second chat" });
    b.title = chatTitle("second chat");
    b.updated_at = new Date(Date.now() + 1000).toISOString();
    writeChat(b);

    expect(readChat(a.id)?.messages[0]).toEqual({ role: "user", text: "first chat" });
    expect(readChat("nope")).toBeNull();

    const listed = listChats();
    expect(listed.map((c) => c.id)).toEqual([b.id, a.id]); // newest first
    expect(listed[0]).toMatchObject({ title: "second chat", status: "idle", messageCount: 1 });

    deleteChat(a.id);
    expect(readChat(a.id)).toBeNull();
    expect(listChats().map((c) => c.id)).toEqual([b.id]);
  });
});
