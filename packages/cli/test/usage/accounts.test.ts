import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  accountSlugForConfigDir,
  discoverClaudeAccounts,
  discoverClaudeConfigDirs,
  keychainServiceForConfigDir,
  looksLikeClaudeHome,
  snapshotAgentKey,
} from "../../src/usage/accounts.js";
import type { OAuthCredentials } from "../../src/usage/token.js";

const futureCreds = (token: string): OAuthCredentials => ({
  accessToken: token,
  expiresAt: Date.now() + 60 * 60 * 1000,
});

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), "fleetlens-claude-homes-"));
}

function touchClaudeHome(dir: string, extras: Record<string, string> = {}): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "settings.json"), "{}\n");
  for (const [name, body] of Object.entries(extras)) {
    writeFileSync(join(dir, name), body);
  }
}

describe("keychainServiceForConfigDir", () => {
  it("uses the unsuffixed service for ~/.claude", () => {
    expect(keychainServiceForConfigDir("/Users/me/.claude", "/Users/me")).toBe(
      "Claude Code-credentials",
    );
  });

  it("suffixes extra homes with sha256(absPath)[:8]", () => {
    expect(keychainServiceForConfigDir("/Users/me/.claude-work", "/Users/me")).toBe(
      "Claude Code-credentials-1e91dd84",
    );
  });
});

describe("accountSlugForConfigDir / snapshotAgentKey", () => {
  it("treats ~/.claude as the default (no slug)", () => {
    expect(accountSlugForConfigDir("/Users/me/.claude", "/Users/me")).toBeNull();
    expect(snapshotAgentKey(null)).toBe("claude-code");
  });

  it("strips the .claude- prefix for extra homes", () => {
    expect(accountSlugForConfigDir("/Users/me/.claude-work", "/Users/me")).toBe("work");
    expect(snapshotAgentKey("work")).toBe("claude-code:work");
  });
});

describe("discoverClaudeConfigDirs", () => {
  let home: string;
  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it("skips lookalike dirs that are not Claude Code homes", () => {
    home = makeHome();
    mkdirSync(join(home, ".claude-harness"), { recursive: true });
    mkdirSync(join(home, ".claude-monitor", "logs"), { recursive: true });
    writeFileSync(join(home, ".claude-harness", "HARNESS-PLAN.md"), "x");
    expect(discoverClaudeConfigDirs({ homeDir: home, envConfigDir: "" })).toEqual([]);
  });

  it("finds ~/.claude and ~/.claude-* plus CLAUDE_CONFIG_DIR", () => {
    home = makeHome();
    touchClaudeHome(join(home, ".claude"));
    touchClaudeHome(join(home, ".claude-work"));
    const elsewhere = join(home, "other-claude");
    touchClaudeHome(elsewhere);
    mkdirSync(join(home, ".claude-harness"), { recursive: true });

    const dirs = discoverClaudeConfigDirs({ homeDir: home, envConfigDir: elsewhere });
    expect(dirs).toEqual([
      resolve(join(home, ".claude")),
      resolve(join(home, ".claude-work")),
      resolve(elsewhere),
    ]);
    expect(looksLikeClaudeHome(join(home, ".claude-harness"))).toBe(false);
  });
});

describe("discoverClaudeAccounts", () => {
  let home: string;
  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it("reads per-dir credentials files and skips expired tokens", () => {
    home = makeHome();
    const def = join(home, ".claude");
    const work = join(home, ".claude-work");
    touchClaudeHome(def, {
      ".credentials.json": JSON.stringify({
        claudeAiOauth: { accessToken: "sk-default", expiresAt: Date.now() + 3_600_000 },
      }),
    });
    touchClaudeHome(work, {
      ".credentials.json": JSON.stringify({
        claudeAiOauth: { accessToken: "sk-work", expiresAt: Date.now() + 3_600_000 },
      }),
    });

    const accounts = discoverClaudeAccounts({
      homeDir: home,
      platform: "linux",
      nowMs: Date.now(),
    });
    expect(accounts.map((a) => a.slug)).toEqual([null, "work"]);
    expect(accounts.map((a) => a.creds.accessToken)).toEqual(["sk-default", "sk-work"]);
    expect(accounts.every((a) => a.source === "file")).toBe(true);
  });

  it("collapses two dirs that share one token", () => {
    home = makeHome();
    const blob = JSON.stringify({
      claudeAiOauth: { accessToken: "sk-same", expiresAt: Date.now() + 3_600_000 },
    });
    touchClaudeHome(join(home, ".claude"), { ".credentials.json": blob });
    touchClaudeHome(join(home, ".claude-work"), { ".credentials.json": blob });

    const accounts = discoverClaudeAccounts({ homeDir: home, platform: "linux" });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.slug).toBeNull();
  });

  it("prefers the hashed Keychain item for an extra home on macOS", () => {
    home = makeHome();
    const work = join(home, ".claude-work");
    touchClaudeHome(work);
    const service = keychainServiceForConfigDir(work, home);
    const accounts = discoverClaudeAccounts({
      homeDir: home,
      platform: "darwin",
      readKeychain: (svc) => (svc === service ? futureCreds("sk-keychain-work") : null),
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.slug).toBe("work");
    expect(accounts[0]!.source).toBe("keychain");
    expect(accounts[0]!.creds.accessToken).toBe("sk-keychain-work");
  });
});
