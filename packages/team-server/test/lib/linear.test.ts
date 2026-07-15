import { describe, it, expect } from "vitest";
import { toIssueRow, type LinearIssueNode } from "../../src/lib/linear.js";

const node: LinearIssueNode = {
  identifier: "ORB-315",
  title: "M14 — ignore outcome, end-to-end",
  url: "https://linear.app/orbit/issue/ORB-315",
  estimate: 3,
  createdAt: "2026-06-01T08:00:00.000Z",
  startedAt: "2026-06-05T09:00:00.000Z",
  completedAt: "2026-06-08T08:48:58.000Z",
  canceledAt: null,
  state: { name: "Done", type: "completed" },
  team: { key: "ORB" },
  assignee: { displayName: "Sam" },
};

describe("toIssueRow", () => {
  it("maps a completed issue", () => {
    const row = toIssueRow(node);
    expect(row.identifier).toBe("ORB-315");
    expect(row.stateType).toBe("completed");
    expect(row.linearTeamKey).toBe("ORB");
    expect(row.assignee).toBe("Sam");
    expect(row.startedAt).toBe("2026-06-05T09:00:00.000Z");
  });

  it("handles unassigned, unstarted issues", () => {
    const open = {
      ...node,
      startedAt: null,
      completedAt: null,
      assignee: null,
      estimate: null,
      state: { name: "Backlog", type: "backlog" },
    };
    const row = toIssueRow(open);
    expect(row.assignee).toBeNull();
    expect(row.startedAt).toBeNull();
    expect(row.stateType).toBe("backlog");
  });
});
