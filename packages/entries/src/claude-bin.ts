import { existsSync } from "node:fs";
import { join, dirname, delimiter } from "node:path";
import { homedir } from "node:os";

export type ResolveClaudeBinOpts = {
  env?: NodeJS.ProcessEnv;
  home?: string;
  execPath?: string;
  exists?: (p: string) => boolean;
};

/** Absolute path to the user's `claude` CLI, or undefined if it isn't installed.
 *  PATH first, then the known install locations. The autostart daemon runs under
 *  launchd with a bare `/usr/bin:/bin:/usr/sbin:/sbin` PATH and passes it to the
 *  web server it spawns, so a plain `spawn("claude")` dies with ENOENT there even
 *  though claude is installed — every LLM run silently failed this way for days. */
export function resolveClaudeBin(opts: ResolveClaudeBinOpts = {}): string | undefined {
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();
  const execPath = opts.execPath ?? process.execPath;
  const exists = opts.exists ?? existsSync;

  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const onPath = join(dir, "claude");
    if (exists(onPath)) return onPath;
  }

  return [
    join(home, ".local", "bin", "claude"), // native installer
    join(home, ".claude", "local", "claude"), // legacy local install
    join(dirname(execPath), "claude"), // npm -g, beside the node running us
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ].find(exists);
}

/** Child env with claude's directory and our own node's directory on PATH. node
 *  matters because claude's hooks shell out to it — under the launchd PATH they
 *  die with "/bin/sh: node: command not found" even once claude itself resolves. */
export function claudeSpawnEnv(
  bin: string,
  env: NodeJS.ProcessEnv = process.env,
  execPath: string = process.execPath,
): NodeJS.ProcessEnv {
  const parts = (env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of [dirname(execPath), dirname(bin)]) {
    if (!parts.includes(dir)) parts.unshift(dir);
  }
  return { ...env, PATH: parts.join(delimiter) };
}

export class ClaudeBinNotFoundError extends Error {
  constructor() {
    super(
      "claude CLI not found. Looked on PATH and in ~/.local/bin, ~/.claude/local, " +
        "the npm global bin, and homebrew. Install it, or if Fleetlens was started " +
        "by the autostart LaunchAgent, restart it from a terminal: fleetlens stop && fleetlens start",
    );
    this.name = "ClaudeBinNotFoundError";
  }
}
