import { describe, it, expect } from "vitest";
import { canonicalizeProjects } from "../../src/lib/team-report-aggregate.js";

const row = (project: string, agentHours: number, agentHoursPrev = 0, sessions = 1) => ({
  project,
  agentHours,
  agentHoursPrev,
  sessions,
});

describe("canonicalizeProjects", () => {
  it("passes rows through untouched when no repos are connected", () => {
    const rows = [row("web-app", 5)];
    expect(canonicalizeProjects(rows, [])).toBe(rows);
  });

  it("folds a directory-name match onto the repo identity", () => {
    const out = canonicalizeProjects([row("web-app", 5)], ["acme/web-app"]);
    expect(out).toEqual([{ ...row("acme/web-app", 5), repo: "acme/web-app" }]);
  });

  it("matches case-insensitively and merges members' copies of the same repo", () => {
    const out = canonicalizeProjects(
      [row("Web-App", 5, 2, 3), row("web-app", 4, 1, 2)],
      ["acme/web-app"],
    );
    expect(out).toEqual([
      { project: "acme/web-app", repo: "acme/web-app", agentHours: 9, agentHoursPrev: 3, sessions: 5 },
    ]);
  });

  it("prefers the member-reported repo identity over the directory-name guess", () => {
    // Renamed clone dir — basename matching would miss it entirely.
    const out = canonicalizeProjects(
      [{ ...row("my-fork-dir", 5), githubRepos: ["ACME/Web-App"] }],
      ["acme/web-app"],
    );
    expect(out[0].repo).toBe("acme/web-app");
    expect(out[0].project).toBe("acme/web-app");
  });

  it("merges a reported-identity row with a basename-matched row for the same repo", () => {
    const out = canonicalizeProjects(
      [
        { ...row("renamed-checkout", 3, 1, 2), githubRepos: ["acme/web-app"] },
        row("web-app", 4, 2, 3),
      ],
      ["acme/web-app"],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ project: "acme/web-app", repo: "acme/web-app", agentHours: 7, sessions: 5 });
  });

  it("ignores reported repos that aren't connected to the team", () => {
    const out = canonicalizeProjects(
      [{ ...row("side-project", 5), githubRepos: ["personal/secret-repo"] }],
      ["acme/web-app"],
    );
    expect(out[0].repo).toBeUndefined();
    expect(out[0].project).toBe("side-project");
  });

  it("leaves unmatched local names alone and re-sorts by hours", () => {
    const out = canonicalizeProjects(
      [row("scratch", 1), row("web-app", 5), row("notes", 7)],
      ["acme/web-app"],
    );
    expect(out.map((r) => [r.project, r.repo ?? null])).toEqual([
      ["notes", null],
      ["acme/web-app", "acme/web-app"],
      ["scratch", null],
    ]);
  });
});
