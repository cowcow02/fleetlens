import { describe, it, expect } from "vitest";
import {
  deriveStartedAt,
  deriveCompletedAt,
  isSafeIdentifier,
  isSafeProjectKey,
  normalizeSite,
  toIssueRow,
  type JiraIssueNode,
  type JiraStatusCategory,
} from "../../src/lib/jira.js";

const categories = new Map<string, JiraStatusCategory>([
  ["10000", "new"],
  ["to do", "new"],
  ["10001", "indeterminate"],
  ["in progress", "indeterminate"],
  ["10002", "done"],
  ["done", "done"],
]);

const SITE = "https://acme.atlassian.net";
const SP = "customfield_10016";

const completed: JiraIssueNode = {
  key: "ENG-315",
  fields: {
    summary: "Ship the thing end-to-end",
    created: "2026-06-01T08:00:00.000Z",
    resolutiondate: "2026-06-08T08:48:58.000Z",
    status: { name: "Done", statusCategory: { key: "done" } },
    assignee: { displayName: "Sam" },
    resolution: { name: "Done" },
    project: { key: "ENG" },
    customfield_10016: 3,
  },
  changelog: {
    histories: [
      { created: "2026-06-02T09:00:00.000Z", items: [{ field: "summary", from: null, to: null, fromString: "a", toString: "b" }] },
      { created: "2026-06-05T09:00:00.000Z", items: [{ field: "status", from: "10000", to: "10001", fromString: "To Do", toString: "In Progress" }] },
      { created: "2026-06-08T08:48:00.000Z", items: [{ field: "status", from: "10001", to: "10002", fromString: "In Progress", toString: "Done" }] },
    ],
  },
};

describe("normalizeSite", () => {
  it("adds https and strips path/trailing slash", () => {
    expect(normalizeSite("acme.atlassian.net")).toBe("https://acme.atlassian.net");
    expect(normalizeSite("https://acme.atlassian.net/jira/")).toBe("https://acme.atlassian.net");
  });
});

describe("isSafeIdentifier", () => {
  it("accepts KEY-NUMBER and rejects anything else", () => {
    expect(isSafeIdentifier("ENG-315")).toBe(true);
    expect(isSafeIdentifier("ENG-315; DROP")).toBe(false);
    expect(isSafeIdentifier("ENG")).toBe(false);
  });
});

describe("isSafeProjectKey", () => {
  it("accepts letter-led alphanumeric keys, rejects JQL-breaking input", () => {
    expect(isSafeProjectKey("KAN")).toBe(true);
    expect(isSafeProjectKey("ENG2")).toBe(true);
    expect(isSafeProjectKey("My_Proj")).toBe(true);
    expect(isSafeProjectKey('x" OR project = "OPS')).toBe(false);
    expect(isSafeProjectKey("ENG,OPS")).toBe(false);
    expect(isSafeProjectKey("has space")).toBe(false);
    expect(isSafeProjectKey("2ENG")).toBe(false);
    expect(isSafeProjectKey("")).toBe(false);
  });
});

describe("deriveCompletedAt", () => {
  it("prefers resolutiondate", () => {
    expect(deriveCompletedAt(completed, categories)).toBe("2026-06-08T08:48:58.000Z");
  });

  it("falls back to the changelog's first done-transition when no resolution is set", () => {
    const node: JiraIssueNode = {
      key: "ENG-50",
      fields: {
        summary: "Done, no resolution",
        created: "2026-06-01T08:00:00.000Z",
        resolutiondate: null,
        statuscategorychangedate: "2026-06-09T10:00:00.000Z",
        status: { name: "Done", statusCategory: { key: "done" } },
        project: { key: "ENG" },
      },
      changelog: { histories: [
        { created: "2026-06-05T09:00:00.000Z", items: [{ field: "status", from: "10000", to: "10001", fromString: "To Do", toString: "In Progress" }] },
        { created: "2026-06-08T17:00:00.000Z", items: [{ field: "status", from: "10001", to: "10002", fromString: "In Progress", toString: "Done" }] },
      ] },
    };
    expect(deriveCompletedAt(node, categories)).toBe("2026-06-08T17:00:00.000Z");
    // and toIssueRow uses it so the issue isn't dropped from the velocity window
    expect(toIssueRow(node, categories, SITE, SP).completedAt).toBe("2026-06-08T17:00:00.000Z");
  });

  it("falls back to statuscategorychangedate when neither resolution nor a done-transition is present", () => {
    const node: JiraIssueNode = {
      key: "ENG-51",
      fields: {
        summary: "Done via bulk import, no changelog",
        created: "2026-06-01T08:00:00.000Z",
        resolutiondate: null,
        statuscategorychangedate: "2026-06-09T10:00:00.000Z",
        status: { name: "Done", statusCategory: { key: "done" } },
        project: { key: "ENG" },
      },
    };
    expect(deriveCompletedAt(node, categories)).toBe("2026-06-09T10:00:00.000Z");
  });
});

describe("deriveStartedAt", () => {
  it("returns the first transition into an In-Progress (indeterminate) status", () => {
    expect(deriveStartedAt(completed, categories)).toBe("2026-06-05T09:00:00.000Z");
  });

  it("is null when the issue never entered an In-Progress status", () => {
    const node = { ...completed, changelog: { histories: [
      { created: "2026-06-02T09:00:00.000Z", items: [{ field: "assignee", from: null, to: "u1", fromString: null, toString: "Sam" }] },
    ] } };
    expect(deriveStartedAt(node, categories)).toBeNull();
  });

  it("resolves status category by name when the id isn't catalogued", () => {
    const node = { ...completed, changelog: { histories: [
      { created: "2026-06-05T10:00:00.000Z", items: [{ field: "status", from: "x", to: "y", fromString: "To Do", toString: "In Progress" }] },
    ] } };
    expect(deriveStartedAt(node, categories)).toBe("2026-06-05T10:00:00.000Z");
  });
});

describe("toIssueRow", () => {
  it("maps a completed issue with derived started/completed and story points", () => {
    const row = toIssueRow(completed, categories, SITE, SP);
    expect(row.identifier).toBe("ENG-315");
    expect(row.stateType).toBe("completed");
    expect(row.projectKey).toBe("ENG");
    expect(row.assignee).toBe("Sam");
    expect(row.estimate).toBe(3);
    expect(row.startedAt).toBe("2026-06-05T09:00:00.000Z");
    expect(row.completedAt).toBe("2026-06-08T08:48:58.000Z");
    expect(row.canceledAt).toBeNull();
    expect(row.url).toBe("https://acme.atlassian.net/browse/ENG-315");
  });

  it("classifies an In-Progress issue as started with no completion", () => {
    const node: JiraIssueNode = {
      key: "ENG-9",
      fields: {
        summary: "WIP",
        created: "2026-06-01T08:00:00.000Z",
        resolutiondate: null,
        status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
        assignee: null,
        project: { key: "ENG" },
      },
      changelog: { histories: [
        { created: "2026-06-04T09:00:00.000Z", items: [{ field: "status", from: "10000", to: "10001", fromString: "To Do", toString: "In Progress" }] },
      ] },
    };
    const row = toIssueRow(node, categories, SITE, SP);
    expect(row.stateType).toBe("started");
    expect(row.assignee).toBeNull();
    expect(row.estimate).toBeNull();
    expect(row.completedAt).toBeNull();
    expect(row.startedAt).toBe("2026-06-04T09:00:00.000Z");
  });

  it("treats a 'Won't Do' resolution in the done category as canceled", () => {
    const node: JiraIssueNode = {
      key: "ENG-7",
      fields: {
        summary: "Dropped",
        created: "2026-06-01T08:00:00.000Z",
        resolutiondate: "2026-06-03T08:00:00.000Z",
        status: { name: "Done", statusCategory: { key: "done" } },
        resolution: { name: "Won't Do" },
        project: { key: "ENG" },
      },
    };
    const row = toIssueRow(node, categories, SITE, SP);
    expect(row.stateType).toBe("canceled");
    expect(row.canceledAt).toBe("2026-06-03T08:00:00.000Z");
    expect(row.completedAt).toBeNull();
  });
});
