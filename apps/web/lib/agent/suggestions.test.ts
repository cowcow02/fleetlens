import { describe, expect, test } from "vitest";
import type { IndexDoc } from "./types";
import {
  FALLBACK_SUGGESTIONS,
  buildSuggestionContext,
  deterministicSuggestions,
  parseSuggestions,
  suggestionInputKey,
} from "./suggestions";

function doc(partial: Partial<IndexDoc> & { sessionId: string }): IndexDoc {
  return {
    version: 1,
    agent: "claude-code",
    project: "/Users/me/Repo/foo",
    day: "2026-07-08",
    startIso: "2026-07-08T10:00:00.000Z",
    title: "untitled",
    chunks: [],
    mtimeMs: 0,
    sizeBytes: 0,
    ...partial,
  };
}

const NOW = Date.parse("2026-07-10T12:00:00.000Z");

describe("deterministicSuggestions", () => {
  test("steers labels toward the most recently active project", () => {
    const docs = [
      doc({ sessionId: "a", project: "/Users/me/Repo/workhub", day: "2026-07-09", startIso: "2026-07-09T10:00:00.000Z" }),
      doc({ sessionId: "b", project: "/Users/me/Repo/workhub", day: "2026-07-08", startIso: "2026-07-08T10:00:00.000Z" }),
      doc({ sessionId: "c", project: "/Users/me/Repo/old", day: "2026-06-01", startIso: "2026-06-01T10:00:00.000Z" }),
    ];
    const suggestions = deterministicSuggestions(docs, NOW);
    expect(suggestions).toHaveLength(4);
    expect(suggestions.map((s) => s.category).sort()).toEqual(["find", "handoff", "recap", "synthesize"]);
    // the active project's short name appears in at least two labels
    const mentioning = suggestions.filter((s) => s.label.includes("workhub"));
    expect(mentioning.length).toBeGreaterThanOrEqual(2);
  });

  test("falls back to the static set when there are no docs", () => {
    expect(deterministicSuggestions([], NOW)).toEqual(FALLBACK_SUGGESTIONS);
  });

  test("prefers the git repo name over the folder basename", () => {
    const docs = [
      doc({
        sessionId: "a",
        project: "/Users/me/Repo/claude-lens",
        repoName: "fleetlens",
        day: "2026-07-09",
        startIso: "2026-07-09T10:00:00.000Z",
      }),
    ];
    const labels = deterministicSuggestions(docs, NOW).map((s) => s.label).join(" | ");
    expect(labels).toContain("fleetlens");
    expect(labels).not.toContain("claude-lens");
  });

  test("spreads across projects: find uses the second most active project", () => {
    const docs = [
      doc({ sessionId: "a", project: "/Users/me/Repo/workhub", day: "2026-07-09", startIso: "2026-07-09T10:00:00.000Z" }),
      doc({ sessionId: "b", project: "/Users/me/Repo/workhub", day: "2026-07-09", startIso: "2026-07-09T11:00:00.000Z" }),
      doc({ sessionId: "c", project: "/Users/me/Repo/sidegig", day: "2026-07-08", startIso: "2026-07-08T10:00:00.000Z" }),
    ];
    const suggestions = deterministicSuggestions(docs, NOW);
    const find = suggestions.find((s) => s.category === "find")!;
    expect(find.label).toContain("sidegig");
    // the top project shows up at most twice so the set doesn't read as a broken record
    const workhubMentions = suggestions.filter((s) => s.label.includes("workhub"));
    expect(workhubMentions.length).toBeLessThanOrEqual(2);
  });
});

describe("suggestionInputKey", () => {
  test("changes when the newest session changes, stable otherwise", () => {
    const docs = [doc({ sessionId: "a", startIso: "2026-07-09T10:00:00.000Z" })];
    const k1 = suggestionInputKey(docs);
    expect(suggestionInputKey([...docs])).toBe(k1);
    const k2 = suggestionInputKey([...docs, doc({ sessionId: "b", startIso: "2026-07-10T09:00:00.000Z" })]);
    expect(k2).not.toBe(k1);
  });
});

describe("buildSuggestionContext", () => {
  test("includes active projects, recent titles, and summary chunks", () => {
    const docs = [
      doc({
        sessionId: "a",
        project: "/Users/me/Repo/workhub",
        day: "2026-07-09",
        startIso: "2026-07-09T10:00:00.000Z",
        title: "wire the billing webhook",
        chunks: [{ role: "summary", text: "Shipped the webhook retry queue." }],
      }),
      doc({ sessionId: "c", project: "/Users/me/Repo/old", day: "2026-06-01", startIso: "2026-06-01T10:00:00.000Z", title: "legacy cleanup" }),
    ];
    const ctx = buildSuggestionContext(docs, NOW);
    expect(ctx).toContain("workhub");
    expect(ctx).toContain("wire the billing webhook");
    expect(ctx).toContain("Shipped the webhook retry queue.");
  });
});

describe("parseSuggestions", () => {
  const good = JSON.stringify([
    { label: "What did I ship in workhub yesterday?", category: "recap" },
    { label: "Find the webhook retry sessions", category: "find" },
    { label: "Summarize this week's workhub arc", category: "synthesize" },
    { label: "Draft a prompt to continue the billing work", category: "handoff" },
  ]);

  test("accepts a valid four-item array, with or without a code fence", () => {
    expect(parseSuggestions(good)).toHaveLength(4);
    expect(parseSuggestions("```json\n" + good + "\n```")).toHaveLength(4);
  });

  test("extracts the array from surrounding prose (haiku loves preambles)", () => {
    const wrapped = `Here are the four suggestion chips based on the digest:\n\n${good}\n\nLet me know if you'd like different ones!`;
    expect(parseSuggestions(wrapped)).toHaveLength(4);
  });

  test("rejects wrong categories, wrong counts, and non-JSON", () => {
    expect(parseSuggestions(JSON.stringify([{ label: "x", category: "nope" }]))).toBeNull();
    expect(parseSuggestions(JSON.stringify([]))).toBeNull();
    expect(parseSuggestions("not json at all")).toBeNull();
  });

  test("survives trailing prose containing a stray closing bracket", () => {
    expect(parseSuggestions(`${good}\n\nThese cover [recap] and more!`)).toHaveLength(4);
  });

  test("rejects duplicate categories", () => {
    const dup = JSON.stringify([
      { label: "a", category: "find" },
      { label: "b", category: "find" },
      { label: "c", category: "synthesize" },
      { label: "d", category: "handoff" },
    ]);
    expect(parseSuggestions(dup)).toBeNull();
  });

  test("clamps overlong labels", () => {
    const long = JSON.stringify([
      { label: "x".repeat(300), category: "recap" },
      { label: "b", category: "find" },
      { label: "c", category: "synthesize" },
      { label: "d", category: "handoff" },
    ]);
    const parsed = parseSuggestions(long);
    expect(parsed).not.toBeNull();
    expect(parsed![0]!.label.length).toBeLessThanOrEqual(120);
  });
});
