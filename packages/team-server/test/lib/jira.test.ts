import { describe, it, expect, vi, afterEach } from "vitest";
import {
  deriveStartedAt,
  deriveCompletedAt,
  isSafeIdentifier,
  isSafeProjectKey,
  normalizeSite,
  toIssueRow,
  validateJiraCredentials,
  listJiraProjects,
  fetchStatusCategories,
  fetchJiraIssues,
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
    expect(isSafeProjectKey('x" OR project = "OPS')).toBe(false);
    expect(isSafeProjectKey("ENG,OPS")).toBe(false);
    expect(isSafeProjectKey("has space")).toBe(false);
    expect(isSafeProjectKey("2ENG")).toBe(false);
    expect(isSafeProjectKey("")).toBe(false);
  });
  it("rejects underscores so the charset matches isSafeIdentifier's key portion", () => {
    // A key like "My_Proj" would pass here but its issues "My_Proj-5" fail
    // isSafeIdentifier (no underscore), silently dropping every issue.
    expect(isSafeProjectKey("My_Proj")).toBe(false);
    expect(isSafeProjectKey("My_Proj-1")).toBe(false);
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

  it("uses the LAST done-transition for a reopened-then-redone issue (no resolution)", () => {
    const node: JiraIssueNode = {
      key: "ENG-60",
      fields: {
        summary: "Reopened then redone",
        created: "2026-06-01T08:00:00.000Z",
        resolutiondate: null,
        status: { name: "Done", statusCategory: { key: "done" } },
        project: { key: "ENG" },
      },
      changelog: { histories: [
        { created: "2026-06-03T10:00:00.000Z", items: [{ field: "status", from: "10001", to: "10002", fromString: "In Progress", toString: "Done" }] },
        { created: "2026-06-04T09:00:00.000Z", items: [{ field: "status", from: "10002", to: "10001", fromString: "Done", toString: "In Progress" }] },
        { created: "2026-06-07T15:00:00.000Z", items: [{ field: "status", from: "10001", to: "10002", fromString: "In Progress", toString: "Done" }] },
      ] },
    };
    // final completion, not the first
    expect(deriveCompletedAt(node, categories)).toBe("2026-06-07T15:00:00.000Z");
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

  it("treats 'Won't Fix' / 'Rejected' / 'Cannot Reproduce' resolutions as canceled", () => {
    const base: JiraIssueNode = {
      key: "ENG-8",
      fields: {
        summary: "x",
        created: "2026-06-01T08:00:00.000Z",
        resolutiondate: "2026-06-03T08:00:00.000Z",
        status: { name: "Done", statusCategory: { key: "done" } },
        project: { key: "ENG" },
      },
    };
    for (const name of ["Won't Fix", "Rejected", "Cannot Reproduce", "Duplicate"]) {
      const row = toIssueRow({ ...base, fields: { ...base.fields, resolution: { name } } }, categories, SITE, SP);
      expect(row.stateType, name).toBe("canceled");
    }
    // a genuine completion resolution stays completed
    const done = toIssueRow({ ...base, fields: { ...base.fields, resolution: { name: "Fixed" } } }, categories, SITE, SP);
    expect(done.stateType).toBe("completed");
  });

  it("coerces a numeric-string story-point estimate", () => {
    const node: JiraIssueNode = {
      key: "ENG-12",
      fields: {
        summary: "string points",
        created: "2026-06-01T08:00:00.000Z",
        resolutiondate: "2026-06-03T08:00:00.000Z",
        status: { name: "Done", statusCategory: { key: "done" } },
        project: { key: "ENG" },
        customfield_10016: "5",
      },
    };
    expect(toIssueRow(node, categories, SITE, SP).estimate).toBe(5);
    // non-numeric string → null
    const bad = toIssueRow({ ...node, fields: { ...node.fields, customfield_10016: "n/a" } }, categories, SITE, SP);
    expect(bad.estimate).toBeNull();
    // negative estimate (misconfigured custom field) → null, so it can't bucket as size S
    const neg = toIssueRow({ ...node, fields: { ...node.fields, customfield_10016: -3 } }, categories, SITE, SP);
    expect(neg.estimate).toBeNull();
    const negStr = toIssueRow({ ...node, fields: { ...node.fields, customfield_10016: "-3" } }, categories, SITE, SP);
    expect(negStr.estimate).toBeNull();
  });

  it("matches the no-space 'Won'tFix' resolution variant as canceled", () => {
    const base: JiraIssueNode = {
      key: "ENG-13",
      fields: {
        summary: "x", created: "2026-06-01T08:00:00.000Z", resolutiondate: "2026-06-03T08:00:00.000Z",
        status: { name: "Done", statusCategory: { key: "done" } }, resolution: { name: "Won'tFix" }, project: { key: "ENG" },
      },
    };
    expect(toIssueRow(base, categories, SITE, SP).stateType).toBe("canceled");
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

// ── network functions (fetch mocked) ────────────────────────────────────────

type MockRoute = (url: string, init: { method?: string; body?: string } | undefined) => unknown;

// Route fetch by URL fragment; first match wins. A route returning {__status}
// simulates a non-2xx response.
function stubFetch(routes: Array<[string, MockRoute | unknown]>) {
  const fn = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    for (const [frag, payload] of routes) {
      if (url.includes(frag)) {
        const body = typeof payload === "function" ? (payload as MockRoute)(url, init) : payload;
        const status = (body as { __status?: number })?.__status ?? 200;
        return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
      }
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

const CREDS = ["https://acme.atlassian.net", "me@acme.dev", "tok"] as const;

describe("validateJiraCredentials", () => {
  it("returns the viewer name/email from /myself", async () => {
    stubFetch([["/rest/api/3/myself", { displayName: "Charlie Mak", emailAddress: "c@acme.dev" }]]);
    expect(await validateJiraCredentials(...CREDS)).toEqual({ name: "Charlie Mak", email: "c@acme.dev" });
  });

  it("throws a credentials error on 401", async () => {
    stubFetch([["/rest/api/3/myself", { __status: 401 }]]);
    await expect(validateJiraCredentials(...CREDS)).rejects.toThrow(/credentials \(HTTP 401\)/);
  });

  it("throws a generic error on 500", async () => {
    stubFetch([["/rest/api/3/myself", { __status: 500 }]]);
    await expect(validateJiraCredentials(...CREDS)).rejects.toThrow(/HTTP 500/);
  });
});

describe("listJiraProjects", () => {
  it("pages through /project/search advancing startAt until isLast", async () => {
    const startAts: string[] = [];
    stubFetch([["/rest/api/3/project/search", (url) => {
      startAts.push(new URL(url).searchParams.get("startAt") ?? "");
      return startAts.length === 1
        ? { values: [{ id: "1", key: "KAN", name: "Kanban" }, { id: "2", key: "ENG", name: "Eng" }], isLast: false }
        : { values: [{ id: "3", key: "OPS", name: "Ops" }], isLast: true };
    }]]);
    const projects = await listJiraProjects(...CREDS);
    expect(projects.map((p) => p.key)).toEqual(["KAN", "ENG", "OPS"]);
    // second page must request startAt advanced by the first page's length (2)
    expect(startAts).toEqual(["0", "2"]);
  });
});

describe("fetchStatusCategories", () => {
  it("indexes statuses by id and lowercased name", async () => {
    stubFetch([["/rest/api/3/status", [
      { id: "10001", name: "In Progress", statusCategory: { key: "indeterminate" } },
      { id: "10002", name: "Done", statusCategory: { key: "done" } },
      { id: "9", name: "Weird", statusCategory: { key: "bogus" } },
    ]]]);
    const cats = await fetchStatusCategories(...CREDS);
    expect(cats.get("10001")).toBe("indeterminate");
    expect(cats.get("in progress")).toBe("indeterminate");
    expect(cats.get("done")).toBe("done");
    expect(cats.has("9")).toBe(false); // unknown category skipped
  });
});

describe("fetchJiraIssues", () => {
  const statuses = [
    { id: "10000", name: "To Do", statusCategory: { key: "new" } },
    { id: "10001", name: "In Progress", statusCategory: { key: "indeterminate" } },
    { id: "10002", name: "Done", statusCategory: { key: "done" } },
  ];
  const issue = (key: string, extra: Record<string, unknown> = {}) => ({
    key,
    fields: {
      summary: key, created: "2026-06-01T08:00:00.000Z", resolutiondate: "2026-06-05T08:00:00.000Z",
      status: { name: "Done", statusCategory: { key: "done" } }, project: { key: "KAN" },
    },
    changelog: { histories: [
      { created: "2026-06-02T09:00:00.000Z", items: [{ field: "status", from: "10000", to: "10001", fromString: "To Do", toString: "In Progress" }] },
    ], total: 1, maxResults: 1 },
    ...extra,
  });

  it("returns [] without any network call when no key is JQL-safe", async () => {
    const fn = stubFetch([["x", {}]]);
    expect(await fetchJiraIssues(...CREDS, ['bad" OR 1=1', "2bad"], 60)).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("fetches, derives pickup time, and pages by nextPageToken", async () => {
    let page = 0;
    stubFetch([
      ["/rest/api/3/status", statuses],
      ["/rest/api/3/search/jql", () => (page++ === 0
        ? { issues: [issue("KAN-1")], isLast: false, nextPageToken: "t1" }
        : { issues: [issue("KAN-2")], isLast: true })],
    ]);
    const rows = await fetchJiraIssues(...CREDS, ["KAN"], 60);
    expect(rows.map((r) => r.identifier)).toEqual(["KAN-1", "KAN-2"]);
    expect(rows[0].startedAt).toBe("2026-06-02T09:00:00.000Z");
    expect(rows[0].stateType).toBe("completed");
  });

  it("refetches the full changelog when the inline copy is truncated", async () => {
    const truncated = issue("KAN-9", {
      changelog: { histories: [
        // inline only has the most-recent (Done) transition; total>returned
        { created: "2026-06-05T08:00:00.000Z", items: [{ field: "status", from: "10001", to: "10002", fromString: "In Progress", toString: "Done" }] },
      ], total: 3, maxResults: 1 },
    });
    stubFetch([
      ["/rest/api/3/status", statuses],
      ["/rest/api/3/search/jql", { issues: [truncated], isLast: true }],
      ["/rest/api/3/issue/KAN-9/changelog", { values: [
        { created: "2026-06-02T09:00:00.000Z", items: [{ field: "status", from: "10000", to: "10001", fromString: "To Do", toString: "In Progress" }] },
        { created: "2026-06-05T08:00:00.000Z", items: [{ field: "status", from: "10001", to: "10002", fromString: "In Progress", toString: "Done" }] },
      ], isLast: true }],
    ]);
    const rows = await fetchJiraIssues(...CREDS, ["KAN"], 60);
    // pickup time comes from the refetched full history, not the truncated inline copy
    expect(rows[0].startedAt).toBe("2026-06-02T09:00:00.000Z");
  });

  it("keeps the inline changelog when a truncated issue's refetch returns empty", async () => {
    // inline carries the In-Progress transition; total>returned flags truncation
    const truncated = issue("KAN-13", {
      changelog: { histories: [
        { created: "2026-06-02T09:00:00.000Z", items: [{ field: "status", from: "10000", to: "10001", fromString: "To Do", toString: "In Progress" }] },
      ], total: 5, maxResults: 1 },
    });
    stubFetch([
      ["/rest/api/3/status", statuses],
      ["/rest/api/3/search/jql", { issues: [truncated], isLast: true }],
      // refetch comes back empty (transient) — must NOT wipe the inline copy
      ["/rest/api/3/issue/KAN-13/changelog", { values: [], isLast: true }],
    ]);
    const rows = await fetchJiraIssues(...CREDS, ["KAN"], 60);
    expect(rows[0].startedAt).toBe("2026-06-02T09:00:00.000Z");
  });
});
