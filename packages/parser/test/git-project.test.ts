import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { groupByProject } from "../src/analytics.js";
import { clearCaches, listSessions } from "../src/fs.js";
import { parseRemote, readGitFolder, resolveProjectIdentity } from "../src/git-project.js";

let root: string;

beforeEach(() => {
  clearCaches();
  root = join(tmpdir(), `fleetlens-git-project-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  // macOS /var -> /private/var: canonicalize up front so the home boundary
  // compares equal against realpath'd walk segments.
  root = realpathSync(root);
});

afterEach(() => {
  clearCaches();
  rmSync(root, { recursive: true, force: true });
});

function withHome<T>(home: string, fn: () => T): T {
  const prev = process.env.HOME;
  process.env.HOME = home;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.HOME;
    else process.env.HOME = prev;
  }
}

function makeRepo(dir: string, remoteUrl?: string): void {
  mkdirSync(join(dir, ".git"), { recursive: true });
  mkdirSync(join(dir, ".git", "refs", "heads"), { recursive: true });
  mkdirSync(join(dir, ".git", "refs", "remotes", "origin"), { recursive: true });
  writeFileSync(
    join(dir, ".git", "config"),
    "[core]\n\trepositoryformatversion = 0\n" +
      (remoteUrl ? `[remote "origin"]\n\turl = ${remoteUrl}\n` : ""),
  );
  writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(dir, ".git", "refs", "heads", "main"), "abc123\n");
  writeFileSync(join(dir, ".git", "refs", "remotes", "origin", "HEAD"), "ref: refs/remotes/origin/main\n");
}

function makeLinkedWorktree(main: string, wt: string, name: string, branch = name): void {
  const wtGitDir = join(main, ".git", "worktrees", name);
  mkdirSync(wtGitDir, { recursive: true });
  writeFileSync(join(wtGitDir, "commondir"), "../..\n");
  writeFileSync(join(wtGitDir, "HEAD"), `ref: refs/heads/${branch}\n`);
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

describe("parseRemote", () => {
  it("normalizes GitHub HTTPS and SSH origin URLs", () => {
    expect(parseRemote("https://github.com/cowcow02/fleetlens.git")).toEqual({
      host: "github.com",
      owner: "cowcow02",
      name: "fleetlens",
      url: "https://github.com/cowcow02/fleetlens.git",
      webUrl: "https://github.com/cowcow02/fleetlens",
    });
    expect(parseRemote("git@github.com:cowcow02/fleetlens.git")).toEqual({
      host: "github.com",
      owner: "cowcow02",
      name: "fleetlens",
      url: "git@github.com:cowcow02/fleetlens.git",
      webUrl: "https://github.com/cowcow02/fleetlens",
    });
  });

  it("supports nested owners on non-GitHub remotes", () => {
    expect(parseRemote("ssh://git@example.com/org/platform/repo.git")).toEqual({
      host: "example.com",
      owner: "org/platform",
      name: "repo",
      url: "ssh://git@example.com/org/platform/repo.git",
      webUrl: "https://example.com/org/platform/repo",
    });
  });

  it("ignores origin URLs without an owner and repo name", () => {
    expect(parseRemote("github.com/fleetlens")).toBeUndefined();
  });
});

describe("readGitFolder", () => {
  it("reports missing folders without throwing", () => {
    expect(readGitFolder(join(root, "already-deleted"))).toEqual({
      exists: false,
      isWorktree: false,
    });
  });

  it("reads branch, default branch, and remote for a live repo checkout", () => {
    const repo = join(root, "claude-lens");
    makeRepo(repo, "git@github.com:cowcow02/fleetlens.git");
    mkdirSync(join(repo, "apps", "web"), { recursive: true });

    expect(readGitFolder(join(repo, "apps", "web"))).toEqual({
      exists: true,
      isWorktree: false,
      branch: "main",
      defaultBranch: "main",
      remote: {
        host: "github.com",
        owner: "cowcow02",
        name: "fleetlens",
        url: "git@github.com:cowcow02/fleetlens.git",
        webUrl: "https://github.com/cowcow02/fleetlens",
      },
    });
  });

  it("reads branch state from a linked worktree and repo state from the common git dir", () => {
    const main = join(root, "claude-lens");
    const wt = join(root, "scratch", "feature-one");
    makeRepo(main, "https://github.com/cowcow02/fleetlens.git");
    makeLinkedWorktree(main, wt, "feature-one", "feature/one");
    mkdirSync(join(wt, "packages", "parser"), { recursive: true });

    expect(readGitFolder(join(wt, "packages", "parser"))).toEqual({
      exists: true,
      isWorktree: true,
      branch: "feature/one",
      defaultBranch: "main",
      remote: {
        host: "github.com",
        owner: "cowcow02",
        name: "fleetlens",
        url: "https://github.com/cowcow02/fleetlens.git",
        webUrl: "https://github.com/cowcow02/fleetlens",
      },
    });
  });
});

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

  it("never adopts a git'd home directory as the project root", () => {
    const home = join(root, "fakehome");
    const scratch = join(home, "scratch-project");
    makeRepo(home);
    mkdirSync(scratch, { recursive: true });

    withHome(home, () => {
      expect(resolveProjectIdentity(scratch)).toEqual({
        projectName: realpathSync(scratch),
      });
    });
  });

  it("keeps unrelated non-git folders under a git'd home separate", () => {
    const home = join(root, "fakehome");
    const a = join(home, "project-a");
    const b = join(home, "project-b");
    makeRepo(home);
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });

    withHome(home, () => {
      expect(resolveProjectIdentity(a).projectName).not.toBe(
        resolveProjectIdentity(b).projectName,
      );
    });
  });

  it("does not attribute a deleted checkout to a git'd home", () => {
    const home = join(root, "fakehome");
    makeRepo(home);
    const gone = join(home, "repo-deleted-last-year", "src");

    withHome(home, () => {
      expect(resolveProjectIdentity(gone)).toEqual({ projectName: gone });
    });
  });

  it("still resolves a real repo nested under a git'd home", () => {
    const home = join(root, "fakehome");
    const repo = join(home, "code", "myapp");
    makeRepo(home);
    makeRepo(repo);

    withHome(home, () => {
      expect(resolveProjectIdentity(join(repo, "packages", "web"))).toEqual({
        projectName: realpathSync(repo),
      });
    });
  });

  it("still walks past the boundary for paths outside the home directory", () => {
    const home = join(root, "fakehome");
    const repo = join(root, "elsewhere", "myapp");
    mkdirSync(home, { recursive: true });
    makeRepo(repo);

    withHome(home, () => {
      expect(resolveProjectIdentity(join(repo, "src"))).toEqual({
        projectName: realpathSync(repo),
      });
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
