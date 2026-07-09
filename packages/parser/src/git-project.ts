import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { canonicalProjectName, worktreeName as pathWorktreeName } from "./analytics.js";

export type ProjectIdentity = {
  projectName: string;
  worktreeName?: string;
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

function nearestDotGit(start: string): DotGitInfo | null {
  if (!start || !isAbsolute(start)) return null;
  for (let dir = start.replace(/\/+$/, "") || start; ; dir = dirname(dir)) {
    const info = dotGitInfoFor(dir);
    if (info) return info;
    const parent = dirname(dir);
    if (parent === dir) return null;
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
      return wt
        ? { projectName: projectRoot, worktreeName: wt }
        : { projectName: projectRoot };
    }
  } catch {
    // Fall through to path heuristics when Git metadata is unreadable.
  }

  const projectName = canonicalProjectName(normalized);
  const wt = pathWorktreeName(normalized) ?? undefined;
  return wt ? { projectName, worktreeName: wt } : { projectName };
}
