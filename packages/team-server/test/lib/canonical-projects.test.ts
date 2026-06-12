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

  it("trusts a reported repo even when it isn't in the connected list", () => {
    // The member's machine read it from .git — ground truth regardless of
    // which repos the team chose to sync PRs from.
    const out = canonicalizeProjects(
      [{ ...row("side-project", 5), githubRepos: ["personal/other-repo"] }],
      ["acme/web-app"],
    );
    expect(out[0].repo).toBe("personal/other-repo");
    expect(out[0].project).toBe("personal/other-repo");
  });

  it("trusts only the FIRST reported repo — harvested extras never relabel the row", () => {
    // Position 0 is the .git-derived identity; "ACME/Web-App" here is just a
    // URL this session printed (e.g. reviewing another repo's PR). Scanning
    // the list for a connected match would swallow this row into web-app.
    const out = canonicalizeProjects(
      [{ ...row("side-project", 5), githubRepos: ["personal/scratch", "ACME/Web-App"] }],
      ["acme/web-app"],
    );
    expect(out[0].repo).toBe("personal/scratch");
  });

  it("normalizes the first reported repo's casing via the connected list", () => {
    const out = canonicalizeProjects(
      [{ ...row("web-app", 5), githubRepos: ["ACME/Web-App", "personal/scratch"] }],
      ["acme/web-app"],
    );
    expect(out[0].repo).toBe("acme/web-app");
  });

  it("folds repo-less rows into a single 'others' bucket rendered last, without local names", () => {
    const out = canonicalizeProjects(
      [row("scratch", 1, 1, 2), row("web-app", 5), row("notes", 7, 2, 3)],
      ["acme/web-app"],
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ project: "acme/web-app", repo: "acme/web-app" });
    expect(out[1]).toMatchObject({
      project: "others",
      unlinked: true,
      agentHours: 8,
      agentHoursPrev: 3,
      sessions: 5,
    });
    // Local directory names must not leak through the bucket.
    expect(JSON.stringify(out[1])).not.toMatch(/scratch|notes/);
  });
});
