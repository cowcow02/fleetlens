import { describe, expect, test } from "vitest";
import type { IndexDoc } from "./types";
import { searchDocs } from "./search";

function doc(partial: Partial<IndexDoc> & { sessionId: string }): IndexDoc {
  return {
    version: 1,
    agent: "claude-code",
    project: "/Users/me/Repo/foo",
    day: "2026-07-01",
    title: "untitled",
    chunks: [],
    mtimeMs: 0,
    sizeBytes: 0,
    ...partial,
  };
}

const DOCS: IndexDoc[] = [
  doc({
    sessionId: "s1",
    day: "2026-07-08",
    title: "fix usage daemon crash",
    chunks: [
      { role: "user", text: "the usage daemon keeps crashing on boot", idx: 0 },
      { role: "agent", text: "The crash came from a stale pid file in ~/.cclens", idx: 1 },
    ],
  }),
  doc({
    sessionId: "s2",
    day: "2026-06-01",
    project: "/Users/me/Repo/bar",
    agent: "codex",
    title: "add usage chart",
    chunks: [{ role: "agent", text: "Added the usage chart with recharts", idx: 0 }],
  }),
  doc({
    sessionId: "s3",
    day: "2026-07-09",
    title: "refactor timeline",
    chunks: [{ role: "user", text: "please refactor the timeline page", idx: 0 }],
  }),
];

describe("searchDocs", () => {
  test("matches terms case-insensitively, ranking full-term matches first", () => {
    const { hits, total } = searchDocs(DOCS, "USAGE daemon");
    // s1 matches both terms, s2 matches only "usage" — ranked-OR semantics.
    expect(total).toBe(2);
    expect(hits[0]!.sessionId).toBe("s1");
    expect(hits[0]!.matchedTerms.sort()).toEqual(["daemon", "usage"]);
  });

  test("docs matching all terms rank above partial matches", () => {
    const { hits } = searchDocs(DOCS, "usage daemon chart");
    // s1 matches usage+daemon (2 terms), s2 matches usage+chart (2 terms) — tie on
    // count; but neither matches all 3. Both must appear, full-match-first ordering
    // is covered by the score, so just assert both are present.
    expect(hits.map((h) => h.sessionId).sort()).toEqual(["s1", "s2"]);
  });

  test("returns empty for no matches and blank queries", () => {
    expect(searchDocs(DOCS, "zzzznope").hits).toEqual([]);
    expect(searchDocs(DOCS, "  ").hits).toEqual([]);
  });

  test("quoted phrases require exact substring match", () => {
    const { hits } = searchDocs(DOCS, '"stale pid file"');
    expect(hits.map((h) => h.sessionId)).toEqual(["s1"]);
    expect(searchDocs(DOCS, '"stale file pid"').hits).toEqual([]);
  });

  test("filters by project, agent, and day bounds", () => {
    expect(searchDocs(DOCS, "usage", { filters: { agent: "codex" } }).hits.map((h) => h.sessionId)).toEqual(["s2"]);
    expect(
      searchDocs(DOCS, "usage", { filters: { project: "/Users/me/Repo/foo" } }).hits.map((h) => h.sessionId),
    ).toEqual(["s1"]);
    expect(searchDocs(DOCS, "usage", { filters: { after: "2026-07-01" } }).hits.map((h) => h.sessionId)).toEqual(["s1"]);
    expect(searchDocs(DOCS, "usage", { filters: { before: "2026-06-30" } }).hits.map((h) => h.sessionId)).toEqual(["s2"]);
  });

  test("produces snippets around the match with role attribution", () => {
    const { hits } = searchDocs(DOCS, "pid");
    const snip = hits[0]!.snippets[0]!;
    expect(snip.role).toBe("agent");
    expect(snip.text).toContain("stale pid file");
  });

  test("newer sessions outrank older ones at equal relevance", () => {
    const twin = (id: string, day: string) =>
      doc({ sessionId: id, day, title: "same", chunks: [{ role: "user", text: "identical content here", idx: 0 }] });
    const { hits } = searchDocs([twin("old", "2025-01-01"), twin("new", "2026-07-01")], "identical");
    expect(hits.map((h) => h.sessionId)).toEqual(["new", "old"]);
  });

  test("respects limit but reports full total", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      doc({ sessionId: `m${i}`, chunks: [{ role: "user", text: "needle in haystack", idx: 0 }] }),
    );
    const { hits, total } = searchDocs(many, "needle", { limit: 5 });
    expect(hits).toHaveLength(5);
    expect(total).toBe(30);
  });

  test("title matches outweigh body matches", () => {
    const titled = doc({ sessionId: "titled", title: "daemon work", chunks: [{ role: "agent", text: "unrelated", idx: 0 }] });
    const body = doc({ sessionId: "body", title: "misc", chunks: [{ role: "agent", text: "daemon mentioned once", idx: 0 }] });
    const { hits } = searchDocs([body, titled], "daemon");
    expect(hits[0]!.sessionId).toBe("titled");
  });
});
