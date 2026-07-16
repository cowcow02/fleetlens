import { describe, it, expect } from "vitest";
import { isAiCommitMessage, medianHours, toPullRow, type PullNode } from "../../src/lib/github.js";

describe("isAiCommitMessage", () => {
  it("detects Claude co-author trailer", () => {
    expect(isAiCommitMessage("fix: thing\n\nCo-Authored-By: Claude <noreply@anthropic.com>")).toBe(true);
  });

  it("detects named Claude model co-author", () => {
    expect(isAiCommitMessage("feat: x\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>")).toBe(true);
  });

  it("is case-insensitive and tolerates co-authored-by spelling", () => {
    expect(isAiCommitMessage("y\n\nco-authored-by: claude <noreply@anthropic.com>")).toBe(true);
  });

  it("detects Copilot, Cursor, Codex, Gemini agents", () => {
    expect(isAiCommitMessage("z\n\nCo-Authored-By: GitHub Copilot <copilot@github.com>")).toBe(true);
    expect(isAiCommitMessage("z\n\nCo-Authored-By: Cursor Agent <agent@cursor.com>")).toBe(true);
    expect(isAiCommitMessage("z\n\nCo-Authored-By: Codex <codex@openai.com>")).toBe(true);
    expect(isAiCommitMessage("z\n\nCo-authored-by: gemini-cli <gemini@google.com>")).toBe(true);
  });

  it("detects generated-with markers without trailers", () => {
    expect(isAiCommitMessage("feat: y\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)")).toBe(true);
  });

  it("does not flag human co-authors or mentions in prose", () => {
    expect(isAiCommitMessage("fix\n\nCo-Authored-By: Jane Doe <jane@example.com>")).toBe(false);
    expect(isAiCommitMessage("docs: explain how claude code sessions are parsed")).toBe(false);
    expect(isAiCommitMessage("plain commit")).toBe(false);
  });
});

describe("medianHours", () => {
  it("returns null on empty input", () => {
    expect(medianHours([])).toBeNull();
  });

  it("computes median of odd-length list in hours", () => {
    const h = 3_600_000;
    expect(medianHours([1 * h, 5 * h, 2 * h])).toBe(2);
  });

  it("averages middle pair for even-length list", () => {
    const h = 3_600_000;
    expect(medianHours([1 * h, 2 * h, 3 * h, 10 * h])).toBe(2.5);
  });
});

const node: PullNode = {
  number: 42,
  title: "feat: thing",
  state: "MERGED",
  createdAt: "2026-06-01T10:00:00Z",
  mergedAt: "2026-06-02T10:00:00Z",
  closedAt: "2026-06-02T10:00:00Z",
  updatedAt: "2026-06-02T10:00:00Z",
  additions: 100,
  deletions: 20,
  author: { login: "cowcow02" },
  commits: {
    totalCount: 3,
    nodes: [
      { commit: { message: "a\n\nCo-Authored-By: Claude <noreply@anthropic.com>", authoredDate: "2026-06-01T09:00:00Z" } },
      { commit: { message: "b", authoredDate: "2026-06-01T11:00:00Z" } },
      { commit: { message: "c\n\nCo-Authored-By: Claude <noreply@anthropic.com>", authoredDate: "2026-06-01T12:00:00Z" } },
    ],
  },
  reviews: { nodes: [{ submittedAt: "2026-06-01T15:00:00Z" }] },
};

describe("toPullRow", () => {
  it("maps a GraphQL node to a row with AI detection", () => {
    const row = toPullRow(node);
    expect(row.number).toBe(42);
    expect(row.state).toBe("merged");
    expect(row.authorLogin).toBe("cowcow02");
    expect(row.firstCommitAt).toBe("2026-06-01T09:00:00Z");
    expect(row.firstReviewAt).toBe("2026-06-01T15:00:00Z");
    expect(row.commitsTotal).toBe(3);
    expect(row.commitsAi).toBe(2);
    expect(row.aiAssisted).toBe(true);
  });

  it("handles open PRs without reviews or merge", () => {
    const open = { ...node, state: "OPEN" as const, mergedAt: null, closedAt: null, reviews: { nodes: [] } };
    const row = toPullRow(open);
    expect(row.state).toBe("open");
    expect(row.mergedAt).toBeNull();
    expect(row.firstReviewAt).toBeNull();
  });

  it("treats CLOSED unmerged as closed", () => {
    const closed = { ...node, state: "CLOSED" as const, mergedAt: null };
    expect(toPullRow(closed).state).toBe("closed");
  });
});
