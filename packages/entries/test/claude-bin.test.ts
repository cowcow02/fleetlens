import { describe, it, expect } from "vitest";
import { resolveClaudeBin, claudeSpawnEnv } from "../src/claude-bin.js";

/** Build an `exists` predicate over a fixed set of present paths. */
function existsIn(...present: string[]) {
  const set = new Set(present);
  return (p: string) => set.has(p);
}

const HOME = "/home/tester";
const NODE = "/opt/nvm/versions/node/v22.17.0/bin/node";

describe("resolveClaudeBin", () => {
  it("returns the PATH hit when claude is on PATH", () => {
    const bin = resolveClaudeBin({
      env: { PATH: "/usr/bin:/home/tester/.local/bin" },
      home: HOME,
      execPath: NODE,
      exists: existsIn("/home/tester/.local/bin/claude"),
    });
    expect(bin).toBe("/home/tester/.local/bin/claude");
  });

  it("finds the native install when PATH is the bare launchd default", () => {
    const bin = resolveClaudeBin({
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
      home: HOME,
      execPath: NODE,
      exists: existsIn("/home/tester/.local/bin/claude"),
    });
    expect(bin).toBe("/home/tester/.local/bin/claude");
  });

  it("finds the legacy ~/.claude/local install", () => {
    const bin = resolveClaudeBin({
      env: { PATH: "/usr/bin:/bin" },
      home: HOME,
      execPath: NODE,
      exists: existsIn("/home/tester/.claude/local/claude"),
    });
    expect(bin).toBe("/home/tester/.claude/local/claude");
  });

  it("finds a npm-global install beside the running node binary", () => {
    const bin = resolveClaudeBin({
      env: { PATH: "/usr/bin:/bin" },
      home: HOME,
      execPath: NODE,
      exists: existsIn("/opt/nvm/versions/node/v22.17.0/bin/claude"),
    });
    expect(bin).toBe("/opt/nvm/versions/node/v22.17.0/bin/claude");
  });

  it("prefers a PATH hit over a fallback location", () => {
    const bin = resolveClaudeBin({
      env: { PATH: "/custom/bin" },
      home: HOME,
      execPath: NODE,
      exists: existsIn("/custom/bin/claude", "/home/tester/.local/bin/claude"),
    });
    expect(bin).toBe("/custom/bin/claude");
  });

  it("returns undefined when claude is nowhere to be found", () => {
    const bin = resolveClaudeBin({
      env: { PATH: "/usr/bin:/bin" },
      home: HOME,
      execPath: NODE,
      exists: existsIn("/usr/bin/node"),
    });
    expect(bin).toBeUndefined();
  });

  it("tolerates a missing PATH entirely", () => {
    const bin = resolveClaudeBin({
      env: {},
      home: HOME,
      execPath: NODE,
      exists: existsIn("/home/tester/.local/bin/claude"),
    });
    expect(bin).toBe("/home/tester/.local/bin/claude");
  });
});

describe("claudeSpawnEnv", () => {
  const NODE_DIR = "/opt/nvm/versions/node/v22.17.0/bin";

  it("prepends the resolved binary's directory to PATH", () => {
    const env = claudeSpawnEnv("/home/tester/.local/bin/claude", { PATH: "/usr/bin:/bin" }, NODE);
    expect(env.PATH).toBe(`/home/tester/.local/bin:${NODE_DIR}:/usr/bin:/bin`);
  });

  // claude's own hooks shell out to `node`; under the launchd PATH that fails
  // with "/bin/sh: node: command not found" even once claude itself resolves.
  it("puts the running node binary's directory on PATH for claude's hooks", () => {
    const env = claudeSpawnEnv("/home/tester/.local/bin/claude", { PATH: "/usr/bin:/bin" }, NODE);
    expect(env.PATH!.split(":")).toContain(NODE_DIR);
  });

  it("does not duplicate a directory already on PATH", () => {
    const env = claudeSpawnEnv("/usr/bin/claude", { PATH: `/usr/bin:${NODE_DIR}` }, NODE);
    expect(env.PATH).toBe(`/usr/bin:${NODE_DIR}`);
  });

  it("preserves other environment variables", () => {
    const env = claudeSpawnEnv("/home/tester/.local/bin/claude", { PATH: "/usr/bin", HOME: HOME }, NODE);
    expect(env.HOME).toBe(HOME);
  });

  it("builds a PATH even when the source env has none", () => {
    const env = claudeSpawnEnv("/home/tester/.local/bin/claude", {}, NODE);
    expect(env.PATH).toBe(`/home/tester/.local/bin:${NODE_DIR}`);
  });
});
