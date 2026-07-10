import { describe, expect, test, vi } from "vitest";
import type { IndexDoc } from "./types";

const doc = (over: Partial<IndexDoc>): IndexDoc => ({
  version: 2,
  sessionId: "s1",
  agent: "claude-code",
  project: "/repo/a",
  day: "2026-07-01",
  startIso: "2026-07-01T10:00:00Z",
  title: "t",
  chunks: [],
  mtimeMs: 0,
  sizeBytes: 0,
  ...over,
});

const DOCS: IndexDoc[] = [
  doc({
    sessionId: "aaa",
    project: "/repo/a",
    day: "2026-07-01",
    startIso: "2026-07-01T10:00:00Z",
    title: "fix daemon",
    chunks: [
      { role: "summary", text: "ai brief" },
      { role: "user", text: "hello" },
      { role: "agent", text: "world" },
    ],
  }),
  doc({ sessionId: "bbb", project: "/repo/a", day: "2026-07-03", startIso: "2026-07-03T09:00:00Z", title: "ship PR" }),
  doc({ sessionId: "ccc", project: "/repo/b", day: "2026-07-02", startIso: "2026-07-02T08:00:00Z", title: "other repo" }),
];

vi.mock("./index-store", () => ({
  ensureIndex: async () => DOCS,
  indexStats: () => ({ sessions: DOCS.length, building: false }),
}));
vi.mock("@claude-lens/parser/fs", () => ({
  getAnySession: async (id: string) => (id === "aaa" ? { meta: { sessionId: id } } : null),
}));
vi.mock("@/lib/ai/session-summary", () => ({
  summarizeSessionForAI: () => "STRUCTURED_DIGEST",
}));

import { agentTools } from "./tools";

describe("list_projects", () => {
  test("aggregates session counts and last-activity day, newest project first", async () => {
    const out = JSON.parse(await agentTools.call("list_projects", {}));
    expect(out.projects).toEqual([
      { project: "/repo/a", sessions: 2, lastDay: "2026-07-03" },
      { project: "/repo/b", sessions: 1, lastDay: "2026-07-02" },
    ]);
  });
});

describe("get_session", () => {
  test("full_text returns chunk text with roles, skipping nothing", async () => {
    const out = await agentTools.call("get_session", { session_id: "aaa", mode: "full_text" });
    expect(out).toContain("[user] hello");
    expect(out).toContain("[agent] world");
  });

  test("full_text on an unindexed session errors", async () => {
    await expect(agentTools.call("get_session", { session_id: "zzz", mode: "full_text" })).rejects.toThrow(
      /not found in index/,
    );
  });

  test("summary mode prepends indexed AI summary chunks to the digest", async () => {
    const out = await agentTools.call("get_session", { session_id: "aaa" });
    expect(out).toContain("## AI summary\nai brief");
    expect(out).toContain("STRUCTURED_DIGEST");
  });

  test("summary mode errors when the transcript is gone", async () => {
    await expect(agentTools.call("get_session", { session_id: "bbb" })).rejects.toThrow(/not found/);
  });
});

describe("list_sessions", () => {
  test("filters by project and date bounds, newest first", async () => {
    const out = JSON.parse(await agentTools.call("list_sessions", { project: "/repo/a", after: "2026-07-02" }));
    expect(out.total).toBe(1);
    expect(out.sessions[0]).toMatchObject({ session_id: "bbb", url: "/sessions/bbb" });
  });

  test("unfiltered list is sorted by startIso descending and respects limit", async () => {
    const out = JSON.parse(await agentTools.call("list_sessions", { limit: 2 }));
    expect(out.total).toBe(3);
    expect(out.sessions.map((s: { session_id: string }) => s.session_id)).toEqual(["bbb", "ccc"]);
  });
});

test("unknown tool throws", async () => {
  await expect(agentTools.call("nope", {})).rejects.toThrow(/unknown tool/);
});
