import { describe, expect, test } from "vitest";
import { buildUserPrompt, type ChatMessage } from "./prompt";

const user = (text: string): ChatMessage => ({ role: "user", text });
const assistant = (text: string): ChatMessage => ({ role: "assistant", text });

describe("buildUserPrompt", () => {
  test("a single message passes through verbatim with no history framing", () => {
    expect(buildUserPrompt([user("find my daemon work")])).toBe("find my daemon work");
  });

  test("prior turns are framed as conversation history before the new message", () => {
    const out = buildUserPrompt([user("first question"), assistant("first answer"), user("follow-up")]);
    expect(out).toContain("Conversation so far:");
    expect(out).toContain("User: first question");
    expect(out).toContain("You (assistant): first answer");
    expect(out.endsWith("User's new message: follow-up")).toBe(true);
  });

  test("history is trimmed to the most recent 12 messages", () => {
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 20; i++) messages.push(user(`message ${i}`));
    const out = buildUserPrompt(messages);
    expect(out).not.toContain("message 7");
    expect(out).toContain("message 8");
    expect(out.endsWith("User's new message: message 19")).toBe(true);
  });

  test("overlong messages are truncated with an ellipsis", () => {
    const out = buildUserPrompt([user("x".repeat(5000)), user("short")]);
    expect(out).toContain("x".repeat(4000) + "…");
    expect(out).not.toContain("x".repeat(4001));
  });

  test("empty input yields an empty prompt", () => {
    expect(buildUserPrompt([])).toBe("");
  });
});
