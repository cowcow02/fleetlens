import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

// Resolve a directory to the `owner/name` of its enclosing repo's GitHub
// remote by reading .git metadata directly — no `git` subprocess, so it's
// cheap enough to run per project per sync. Handles the shapes on disk:
//   - `.git/` directory (plain clone) — config at .git/config
//   - `.git` file (linked worktree / Conductor checkout) — a one-line
//     `gitdir:` pointer; the shared config lives at the commondir
//   - deleted leaf directories — walk up until an existing ancestor has .git

const GITHUB_URL_RE = /github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/;

function parseGithubRemote(url: string): string | null {
  const m = url.trim().match(GITHUB_URL_RE);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

function originUrl(configText: string): string | null {
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
  return null;
}

function gitConfigPathFor(dir: string): string | null {
  const dotGit = join(dir, ".git");
  const st = statSync(dotGit, { throwIfNoEntry: false });
  if (!st) return null;
  if (st.isDirectory()) return join(dotGit, "config");
  // worktree pointer file: `gitdir: <path>` (possibly relative to dir)
  const m = readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+)\s*$/m);
  if (!m) return null;
  const gd = isAbsolute(m[1]!) ? m[1]! : resolve(dir, m[1]!);
  const commondirFile = join(gd, "commondir");
  if (existsSync(commondirFile)) {
    const common = readFileSync(commondirFile, "utf8").trim();
    return join(isAbsolute(common) ? common : resolve(gd, common), "config");
  }
  return join(gd, "config");
}

/** Walks up from `dir` (which may no longer exist) to the nearest .git and
 *  returns the lowercase `owner/name` of its GitHub origin remote, or null
 *  when there's no repo / no remote / a non-GitHub remote. Memoized per
 *  resolver instance — create one per sync run. */
export function createRepoResolver(): (dir: string) => string | null {
  const cache = new Map<string, string | null>();
  return (dir: string): string | null => {
    if (!dir || !isAbsolute(dir)) return null;
    const hit = cache.get(dir);
    if (hit !== undefined) return hit;
    let repo: string | null = null;
    try {
      for (let d = dir; ; d = dirname(d)) {
        const config = gitConfigPathFor(d);
        if (config && existsSync(config)) {
          const url = originUrl(readFileSync(config, "utf8"));
          repo = url ? parseGithubRemote(url) : null;
          break;
        }
        if (d === dirname(d)) break;
      }
    } catch {
      repo = null;
    }
    cache.set(dir, repo);
    return repo;
  };
}
