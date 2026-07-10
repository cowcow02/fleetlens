
export type TextSegment = { kind: "text"; text: string };
export type ToolSegment = {
  kind: "tool";
  id: string;
  name: string;
  input: unknown;
  brief?: string;
  isError?: boolean;
  done: boolean;
};
export type Segment = TextSegment | ToolSegment;

export type StoredMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; segments: Segment[] };

export type ChatStatus = "idle" | "running" | "error";

export type Chat = {
  version: 1;
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  status: ChatStatus;
  /** Highest run-event seq folded into this chat — SSE clients resume after it. */
  lastSeq: number;
  messages: StoredMessage[];
};

export type ChatListItem = {
  id: string;
  title: string;
  updated_at: string;
  status: ChatStatus;
  messageCount: number;
};

/** Normalized event emitted by a run. seq is per-run, starting at 1. */
export type RunEvent =
  | { seq: number; type: "delta"; text: string }
  | { seq: number; type: "tool"; id: string; name: string; input: unknown }
  | { seq: number; type: "tool_result"; id: string; name: string; brief: string; isError: boolean }
  | { seq: number; type: "done"; totalTokens?: number }
  | { seq: number; type: "error"; message: string };

/** Omit<union, K> collapses to the common keys; this distributes instead so
 *  emit sites can pass any variant sans seq. */
export type RunEventBody = RunEvent extends infer E ? (E extends RunEvent ? Omit<E, "seq"> : never) : never;

const TITLE_MAX = 80;

export function chatTitle(firstUserText: string): string {
  return firstUserText.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
}

export function createChat(): Chat {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: crypto.randomUUID(),
    title: "New conversation",
    created_at: now,
    updated_at: now,
    status: "idle",
    lastSeq: 0,
    messages: [],
  };
}

export function newAssistantMessage(): StoredMessage {
  return { role: "assistant", segments: [] };
}

/** Fold one run event into the chat. Pure; the same reducer runs on the
 *  server (persistence) and could run client-side, so restore and live
 *  rendering can never drift apart. Events at or below lastSeq are replays
 *  and ignored. */
export function applyRunEvent(chat: Chat, event: RunEvent): Chat {
  if (event.seq <= chat.lastSeq) return chat;
  const messages = [...chat.messages];
  let last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") {
    last = newAssistantMessage();
    messages.push(last);
  }
  const assistant = { ...last, segments: [...(last as { segments: Segment[] }).segments] } as Extract<
    StoredMessage,
    { role: "assistant" }
  >;
  messages[messages.length - 1] = assistant;

  let status: ChatStatus = chat.status;
  switch (event.type) {
    case "delta": {
      const tail = assistant.segments[assistant.segments.length - 1];
      if (tail?.kind === "text") {
        assistant.segments[assistant.segments.length - 1] = { kind: "text", text: tail.text + event.text };
      } else {
        assistant.segments.push({ kind: "text", text: event.text });
      }
      break;
    }
    case "tool":
      assistant.segments.push({ kind: "tool", id: event.id, name: event.name, input: event.input, done: false });
      break;
    case "tool_result":
      assistant.segments = assistant.segments.map((s) =>
        s.kind === "tool" && s.id === event.id ? { ...s, brief: event.brief, isError: event.isError, done: true } : s,
      );
      break;
    case "done":
      status = "idle";
      assistant.segments = assistant.segments.map((s) => (s.kind === "tool" && !s.done ? { ...s, done: true } : s));
      break;
    case "error":
      status = "error";
      assistant.segments = assistant.segments.map((s) => (s.kind === "tool" && !s.done ? { ...s, done: true } : s));
      assistant.segments.push({ kind: "text", text: `\n\n**Error:** ${event.message}` });
      break;
  }

  return { ...chat, messages, status, lastSeq: event.seq, updated_at: new Date().toISOString() };
}
