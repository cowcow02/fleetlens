import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { groupByProject } from "../src/analytics.js";
import { clearCaches, listSessions } from "../src/fs.js";
import { resolveProjectIdentity } from "../src/git-project.js";

let root: string;

beforeEach(() => {
  clearCaches();
  root = join(tmpdir(), `fleetlens-git-project-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
});

afterEach(() => {
  clearCaches();
  rmSync(root, { recursive: true, force: true });
});

function makeRepo(dir: string): void {
  mkdirSync(join(dir, ".git"), { recursive: true });
  writeFileSync(join(dir, ".git", "config"), "[core]\n\trepositoryformatversion = 0\n");
}

function makeLinkedWorktree(main: string, wt: string, name: string): void {
  const wtGitDir = join(main, ".git", "worktrees", name);
  mkdirSync(wtGitDir, { recursive: true });
  writeFileSync(join(wtGitDir, "commondir"), "../..\n");
  mkdirSync(wt, { recursive: true });
  writeFileSync(join(wt, ".git"), `gitdir: ${wtGitDir}\n`);
}

function writeSession(projectsRoot: string, dir: string, id: string, cwd: string, ts: string): void {
  const projectDir = join(projectsRoot, dir);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(projectDir, `${id}.jsonl`),
    JSON.stringify({
      type: "assistant",
      cwd,
      timestamp: ts,
      message: {
        id: `msg_${id}`,
        model: "claude-sonnet-4-5-20250929",
        usage: { input_tokens: 10, output_tokens: 1 },
      },
    }) + "\n",
  );
}

describe("resolveProjectIdentity", () => {
  it("uses the nearest .git directory as the project root", () => {
    const repo = join(root, "main-repo");
    makeRepo(repo);

    expect(resolveProjectIdentity(join(repo, "packages", "web"))).toEqual({
      projectName: realpathSync(repo),
    });
  });

  it("follows linked-worktree .git files back to the main repo", () => {
    const main = join(root, "main-repo");
    const wt = join(root, "anywhere", "feature-one");
    makeRepo(main);
    makeLinkedWorktree(main, wt, "feature-one");

    expect(resolveProjectIdentity(join(wt, "apps", "web"))).toEqual({
      projectName: realpathSync(main),
      worktreeName: "feature-one",
    });
  });

  it("normalizes symlinked cwd paths before walking Git metadata", () => {
    const repo = join(root, "main-repo");
    const link = join(root, "main-repo-link");
    makeRepo(repo);
    symlinkSync(repo, link);

    expect(resolveProjectIdentity(join(link, "packages", "web"))).toEqual({
      projectName: realpathSync(repo),
    });
  });

  it("falls back to path heuristics when no .git metadata exists", () => {
    expect(resolveProjectIdentity("/Users/me/Repo/foo/.worktrees/feat-x/src")).toEqual({
      projectName: "/Users/me/Repo/foo",
      worktreeName: "feat-x",
    });
  });
});

describe("Claude Code project aggregation from .git metadata", () => {
  it("aggregates custom linked worktree folders with the main repo", async () => {
    const main = join(root, "main-repo");
    const wt = join(root, "scratch", "not-under-dot-worktrees");
    const projectsRoot = join(root, "projects");
    makeRepo(main);
    makeLinkedWorktree(main, wt, "not-under-dot-worktrees");

    writeSession(projectsRoot, "main", "main-session", main, "2026-05-01T00:00:00.000Z");
    writeSession(projectsRoot, "custom", "wt-session", wt, "2026-05-01T00:01:00.000Z");

    const sessions = await listSessions({ root: projectsRoot });
    const projects = groupByProject(sessions);

    expect(projects).toHaveLength(1);
    expect(projects[0]!.projectDir).toBe("main-repo");
    expect(projects[0]!.sessions).toHaveLength(2);
    expect(projects[0]!.worktreeCount).toBe(1);
  });
});
