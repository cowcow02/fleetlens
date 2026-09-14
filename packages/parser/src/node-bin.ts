import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type ResolveNodeBinOpts = {
  execPath?: string;
  env?: NodeJS.ProcessEnv;
  exists?: (p: string) => boolean;
  listDir?: (dir: string) => string[];
};

function newestFirst(a: string, b: string): number {
  const pa = a.slice(1).split(".").map(Number);
  const pb = b.slice(1).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** A Node binary that exists right now. Long-lived processes outlive the Node
 *  that launched them: an nvm upgrade deletes process.execPath while the
 *  daemon keeps running from memory, and its next spawn of that path killed
 *  it (2026-09-14). Falls back to `node` on PATH, the newest nvm install of
 *  the same major, then Homebrew / /usr/local — launchd's PATH has no node. */
export function resolveNodeBin(opts: ResolveNodeBinOpts = {}): string {
  const execPath = opts.execPath ?? process.execPath;
  const exists = opts.exists ?? existsSync;
  if (exists(execPath)) return execPath;

  const env = opts.env ?? process.env;
  const bin = process.platform === "win32" ? "node.exe" : "node";
  const candidates = (env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) => path.join(dir, bin));

  const nvmVersions = path.join(env.NVM_DIR || path.join(os.homedir(), ".nvm"), "versions", "node");
  const major = `v${process.versions.node.split(".")[0]}.`;
  let installed: string[] = [];
  try {
    installed = (opts.listDir ?? ((dir) => readdirSync(dir)))(nvmVersions);
  } catch {
    // No nvm.
  }
  for (const version of installed.filter((v) => v.startsWith(major)).sort(newestFirst)) {
    candidates.push(path.join(nvmVersions, version, "bin", bin));
  }
  candidates.push("/opt/homebrew/bin/node", "/usr/local/bin/node");

  return candidates.find((c) => exists(c)) ?? execPath;
}
