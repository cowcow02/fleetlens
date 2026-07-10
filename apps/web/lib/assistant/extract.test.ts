import { describe, expect, test } from "vitest";
import type { SessionDetail, SessionEvent } from "@claude-lens/parser";
import { extractIndexDoc } from "./extract";

function ev(partial: Partial<SessionEvent> & { role: SessionEvent["role"] }): SessionEvent {
  return {
    index: 0,
    rawType: partial.role,
    preview: "",
    blocks: [],
    raw: null,
    ...partial,
  };
}

function session(events: SessionEvent[], meta: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: "abc-123",
    filePath: "/tmp/abc-123.jsonl",
    projectName: "/Users/me/Repo/foo",
    projectDir: "-Users-me-Repo-foo",
    sessionId: "abc-123",
    eventCount: events.length,
    totalUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    status: "idle",
    firstTimestamp: "2026-07-01T10:00:00.000Z",
    lastTimestamp: "2026-07-01T11:00:00.000Z",
    events,
    ...meta,
  } as SessionDetail;
}

const FILE = { mtimeMs: 1000, sizeBytes: 2000 };

describe("extractIndexDoc", () => {
  test("extracts user and agent text blocks as chunks", () => {
    const doc = extractIndexDoc(
      session([
        ev({ index: 0, role: "user", blocks: [{ type: "text", text: "fix the daemon crash" }] }),
        ev({ index: 1, role: "agent", blocks: [{ type: "text", text: "Found the crash in pid.ts" }] }),
        ev({ index: 2, role: "tool-call", blocks: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls secret" } }] }),
        ev({ index: 3, role: "agent-thinking", blocks: [{ type: "thinking", thinking: "hmm private" }] }),
      ]),
      FILE,
    );
    expect(doc.chunks).toEqual([
      { role: "user", text: "fix the daemon crash", idx: 0 },
      { role: "agent", text: "Found the crash in pid.ts", idx: 1 },
    ]);
  });

  test("fills metadata: canonical project, start day, title, agent default", () => {
    const doc = extractIndexDoc(
      session(
        [ev({ index: 0, role: "user", blocks: [{ type: "text", text: "hello world" }] })],
        { projectName: "/Users/me/Repo/foo/.worktrees/kip-1", firstUserPreview: "hello world" },
      ),
      FILE,
    );
    expect(doc.sessionId).toBe("abc-123");
    expect(doc.agent).toBe("claude-code");
    expect(doc.project).toBe("/Users/me/Repo/foo");
    expect(doc.day).toBe("2026-07-01");
    expect(doc.title).toBe("hello world");
    expect(doc.mtimeMs).toBe(1000);
    expect(doc.sizeBytes).toBe(2000);
  });

  test("skips command wrappers, skill loads, and teammate deliveries", () => {
    const doc = extractIndexDoc(
      session([
        ev({ index: 0, role: "user", blocks: [{ type: "text", text: "<command-name>/clear</command-name>" }] }),
        ev({ index: 1, role: "user", blocks: [{ type: "text", text: "Base directory for this skill: /x\n# Skill" }] }),
        ev({
          index: 2,
          role: "user",
          blocks: [{ type: "text", text: "ignore me" }],
          teammateMessage: { teammateId: "t", body: "ignore me", kind: "message" },
        }),
        ev({ index: 3, role: "user", blocks: [{ type: "text", text: "real question" }] }),
      ]),
      FILE,
    );
    expect(doc.chunks).toEqual([{ role: "user", text: "real question", idx: 3 }]);
  });

  test("strips system-reminder spans inside user text", () => {
    const doc = extractIndexDoc(
      session([
        ev({
          index: 0,
          role: "user",
          blocks: [{ type: "text", text: "before <system-reminder>injected</system-reminder> after" }],
        }),
      ]),
      FILE,
    );
    expect(doc.chunks[0]!.text).toBe("before  after");
  });

  test("caps chunk length and total text, marking truncation", () => {
    const long = "x".repeat(10_000);
    const events: SessionEvent[] = [];
    for (let i = 0; i < 200; i++) {
      events.push(ev({ index: i, role: "agent", blocks: [{ type: "text", text: long }] }));
    }
    const doc = extractIndexDoc(session(events), FILE);
    expect(Math.max(...doc.chunks.map((c) => c.text.length))).toBeLessThanOrEqual(4000);
    const total = doc.chunks.reduce((s, c) => s + c.text.length, 0);
    expect(total).toBeLessThanOrEqual(300_000);
    expect(doc.truncated).toBe(true);
  });

  test("drops empty and whitespace-only text", () => {
    const doc = extractIndexDoc(
      session([
        ev({ index: 0, role: "user", blocks: [{ type: "text", text: "  " }] }),
        ev({ index: 1, role: "agent", blocks: [{ type: "text", text: "" }] }),
      ]),
      FILE,
    );
    expect(doc.chunks).toEqual([]);
  });

  test("title falls back to first user chunk when firstUserPreview is absent", () => {
    const doc = extractIndexDoc(
      session([ev({ index: 0, role: "user", blocks: [{ type: "text", text: "the actual ask" }] })]),
      FILE,
    );
    expect(doc.title).toBe("the actual ask");
  });
});
