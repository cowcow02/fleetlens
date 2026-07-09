import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { canonicalProjectName, worktreeName as pathWorktreeName } from "./analytics.js";

export type GitRemote = {
  host: string;
  owner: string;
  name: string;
  url: string;
  webUrl: string;
};

export type ProjectIdentity = {
  projectName: string;
  worktreeName?: string;
  /** Repo name from the origin remote, when there is one. The repo is the
   *  project's real identity; the checkout folder is just where it lives. */
  repoName?: string;
  remote?: GitRemote;
};

/** What one checkout folder looks like right now on disk. */
export type GitFolderInfo = {
  exists: boolean;
  isWorktree: boolean;
  branch?: string;
  defaultBranch?: string;
  remote?: GitRemote;
};

type DotGitInfo = {
  root: string;
  gitDir?: string;
  commonDir?: string;
};

function resolveGitDir(root: string, dotGitText: string): string | undefined {
  const m = dotGitText.match(/^gitdir:\s*(.+)\s*$/m);
  if (!m) return undefined;
  const gitDir = m[1]!.trim();
  return isAbsolute(gitDir) ? gitDir : resolve(root, gitDir);
}

function resolveCommonDir(gitDir: string): string | undefined {
  const file = join(gitDir, "commondir");
  if (!existsSync(file)) return undefined;
  const common = readFileSync(file, "utf8").trim();
  if (!common) return undefined;
  return isAbsolute(common) ? common : resolve(gitDir, common);
}

function dotGitInfoFor(root: string): DotGitInfo | null {
  const dotGit = join(root, ".git");
  const st = statSync(dotGit, { throwIfNoEntry: false });
  if (!st) return null;
  if (st.isDirectory()) return { root, gitDir: dotGit, commonDir: dotGit };

  const gitDir = resolveGitDir(root, readFileSync(dotGit, "utf8"));
  if (!gitDir) return { root };
  return { root, gitDir, commonDir: resolveCommonDir(gitDir) };
}

/** A dotfiles repo at $HOME would otherwise make every non-git folder beneath
 *  it resolve to one project. Stop before testing $HOME itself. Paths outside
 *  the home directory keep walking to the filesystem root. */
function walkBoundary(start: string): string | undefined {
  const home = realpathOrSelf(homedir());
  return start === home || start.startsWith(`${home}/`) ? home : undefined;
}

function nearestDotGit(start: string): DotGitInfo | null {
  if (!start || !isAbsolute(start)) return null;
  const boundary = walkBoundary(start);
  for (let dir = start.replace(/\/+$/, "") || start; ; dir = dirname(dir)) {
    if (dir === boundary) return null;
    const info = dotGitInfoFor(dir);
    if (info) return info;
    const parent = dirname(dir);
    if (parent === dir) return null;
  }
}

// Any host, both syntaxes: git@host:owner/repo.git and https://host/owner/repo
const REMOTE_URL_RE = /^(?:(?:https?|ssh|git):\/\/)?(?:[^@/]+@)?([^/:]+)[:/](.+?)(?:\.git)?\/?$/;

function originUrl(configText: string): string | undefined {
  let inOrigin = false;
  for (const line of configText.split("\n")) {
    const t = line.trim();
    if (t.startsWith("[")) {
      inOrigin = /^\[remote\s+"origin"\]/.test(t);
      continue;
    }
    if (!inOrigin) continue;
    const m = t.match(/^url\s*=\s*(.+)$/);
    if (m) return m[1]!.trim();
  }
  return undefined;
}

function parseRemote(url: string): GitRemote | undefined {
  const m = url.match(REMOTE_URL_RE);
  if (!m) return undefined;
  const host = m[1]!;
  const segs = m[2]!.split("/").filter(Boolean);
  if (segs.length < 2) return undefined;
  const name = segs[segs.length - 1]!;
  const owner = segs.slice(0, -1).join("/");
  return { host, owner, name, url, webUrl: `https://${host}/${owner}/${name}` };
}

/** A linked worktree has no config of its own — the shared one lives at the
 *  commondir, which is exactly what dotGitInfoFor already resolved. */
function remoteFor(git: DotGitInfo): GitRemote | undefined {
  const dir = git.commonDir ?? git.gitDir;
  if (!dir) return undefined;
  const config = join(dir, "config");
  if (!existsSync(config)) return undefined;
  const url = originUrl(readFileSync(config, "utf8"));
  return url ? parseRemote(url) : undefined;
}

function headBranch(gitDir: string | undefined): string | undefined {
  if (!gitDir) return undefined;
  const head = join(gitDir, "HEAD");
  if (!existsSync(head)) return undefined;
  const t = readFileSync(head, "utf8").trim();
  const m = t.match(/^ref:\s*refs\/heads\/(.+)$/);
  return m ? m[1] : `detached @ ${t.slice(0, 7)}`;
}

function defaultBranch(commonDir: string | undefined): string | undefined {
  if (!commonDir) return undefined;
  const head = join(commonDir, "refs", "remotes", "origin", "HEAD");
  if (existsSync(head)) {
    const m = readFileSync(head, "utf8").trim().match(/refs\/remotes\/origin\/(.+)$/);
    if (m) return m[1];
  }
  const packed = join(commonDir, "packed-refs");
  if (existsSync(packed)) {
    const m = readFileSync(packed, "utf8").match(/refs\/remotes\/origin\/(\S+)/);
    if (m && m[1] !== "HEAD") return m[1];
  }
  return undefined;
}

/** Live git state for one checkout folder. Folders from a pruned worktree no
 *  longer exist — the caller renders them as history, not as something to open. */
export function readGitFolder(path: string): GitFolderInfo {
  if (!existsSync(path)) return { exists: false, isWorktree: false };
  try {
    const git = nearestDotGit(realpathOrSelf(path));
    if (!git) return { exists: true, isWorktree: false };
    const projectRoot = projectRootFromCommonDir(git.commonDir);
    const isWorktree = !!projectRoot && realpathOrSelf(projectRoot) !== realpathOrSelf(git.root);
    return {
      exists: true,
      isWorktree,
      branch: headBranch(git.gitDir),
      defaultBranch: defaultBranch(git.commonDir),
      remote: remoteFor(git),
    };
  } catch {
    return { exists: true, isWorktree: false };
  }
}

function projectRootFromCommonDir(commonDir: string | undefined): string | undefined {
  if (!commonDir) return undefined;
  return basename(commonDir) === ".git" ? dirname(commonDir) : undefined;
}

function realpathOrSelf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

export function resolveProjectIdentity(cwd: string): ProjectIdentity {
  const normalized = realpathOrSelf(cwd.replace(/\/{2,}/g, "/"));
  try {
    const git = nearestDotGit(normalized);
    if (git) {
      const projectRoot = realpathOrSelf(projectRootFromCommonDir(git.commonDir) ?? git.root);
      const gitRoot = realpathOrSelf(git.root);
      // nearestDotGit stops at the checkout root, so its basename is the
      // user-visible worktree folder for arbitrary linked-worktree layouts.
      const wt = projectRoot !== gitRoot
        ? pathWorktreeName(normalized) ?? basename(git.root)
        : undefined;
      const identity: ProjectIdentity = { projectName: projectRoot };
      if (wt) identity.worktreeName = wt;
      const remote = remoteFor(git);
      if (remote) {
        identity.remote = remote;
        identity.repoName = remote.name;
      }
      return identity;
    }
  } catch {
    // Fall through to path heuristics when Git metadata is unreadable.
  }

  const projectName = canonicalProjectName(normalized);
  const wt = pathWorktreeName(normalized) ?? undefined;
  return wt ? { projectName, worktreeName: wt } : { projectName };
}
