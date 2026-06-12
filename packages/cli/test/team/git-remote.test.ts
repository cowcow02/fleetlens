import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepoResolver } from "../../src/team/git-remote.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "fleetlens-gitremote-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeClone(dir: string, url: string): void {
  mkdirSync(join(dir, ".git"), { recursive: true });
  writeFileSync(join(dir, ".git", "config"), `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`);
}

describe("createRepoResolver", () => {
  it("resolves an https remote to lowercase owner/name", () => {
    const repo = join(root, "claude-lens");
    makeClone(repo, "https://github.com/CowCow02/Fleetlens.git");
    expect(createRepoResolver()(repo)).toBe("cowcow02/fleetlens");
  });

  it("resolves an ssh remote", () => {
    const repo = join(root, "api");
    makeClone(repo, "git@github.com:acme/platform-api.git");
    expect(createRepoResolver()(repo)).toBe("acme/platform-api");
  });

  it("walks up from a subdirectory (and through deleted leaf dirs)", () => {
    const repo = join(root, "web-app");
    makeClone(repo, "https://github.com/acme/web-app");
    expect(createRepoResolver()(join(repo, "src", "components"))).toBe("acme/web-app");
    // leaf doesn't exist on disk — walk-up still lands on the repo
    expect(createRepoResolver()(join(repo, "gone", "deeper"))).toBe("acme/web-app");
  });

  it("follows a .git pointer file (linked worktree) to the shared config", () => {
    const main = join(root, "main");
    makeClone(main, "https://github.com/acme/web-app.git");
    const wtGitDir = join(main, ".git", "worktrees", "feature");
    mkdirSync(wtGitDir, { recursive: true });
    writeFileSync(join(wtGitDir, "commondir"), "../..\n");
    const wt = join(root, "feature-checkout");
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, ".git"), `gitdir: ${wtGitDir}\n`);
    expect(createRepoResolver()(wt)).toBe("acme/web-app");
  });

  it("returns null for non-GitHub remotes, repos without origin, and non-repos", () => {
    const gitlab = join(root, "gl");
    makeClone(gitlab, "https://gitlab.com/acme/thing.git");
    const bare = join(root, "no-remote");
    mkdirSync(join(bare, ".git"), { recursive: true });
    writeFileSync(join(bare, ".git", "config"), "[core]\n\tbare = false\n");
    const plain = join(root, "plain-dir");
    mkdirSync(plain, { recursive: true });
    const r = createRepoResolver();
    expect(r(gitlab)).toBeNull();
    expect(r(bare)).toBeNull();
    expect(r(plain)).toBeNull();
    expect(r("relative/path")).toBeNull();
  });
});
