/**
 * Discover every Claude Code login on this machine.
 *
 * Claude Code stores one account per config directory (`~/.claude` by default,
 * or whatever `CLAUDE_CONFIG_DIR` points at). Extra homes typically live next
 * to the default as `~/.claude-<slug>` (e.g. `~/.claude-work`).
 *
 * Credentials:
 *   macOS Keychain service `Claude Code-credentials` for `~/.claude`, and
 *   `Claude Code-credentials-<sha256(absPath)[:8]>` for any other home.
 *   Every home may also have `.credentials.json` (Linux/Windows, and a
 *   macOS fallback).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  DEFAULT_KEYCHAIN_SERVICE,
  isUsable,
  readCredentialsFile,
  readFromMacKeychain,
  type OAuthCredentials,
} from "./token.js";

export type ClaudeAccount = {
  /** Absolute config dir (the CLAUDE_CONFIG_DIR value). */
  configDir: string;
  /**
   * Compact id fragment. `null` means the default `~/.claude` home, which
   * keeps the historical `claude` / `claude-code` tags. `work` from
   * `~/.claude-work` becomes `claude-work` in `usage --compact`.
   */
  slug: string | null;
  creds: OAuthCredentials;
  source: "keychain" | "file";
};

const CLAUDE_HOME_MARKERS = [".credentials.json", ".claude.json", "settings.json", "projects"];

export function defaultClaudeHome(homeDir: string = homedir()): string {
  return resolve(join(homeDir, ".claude"));
}

/** Keychain service Claude Code uses for this config dir on macOS. */
export function keychainServiceForConfigDir(
  configDir: string,
  homeDir: string = homedir(),
): string {
  const resolved = resolve(configDir);
  if (resolved === defaultClaudeHome(homeDir)) return DEFAULT_KEYCHAIN_SERVICE;
  const hash = createHash("sha256").update(resolved).digest("hex").slice(0, 8);
  return `${DEFAULT_KEYCHAIN_SERVICE}-${hash}`;
}

/** `~/.claude-work` → `work`. Default `~/.claude` → `null`. */
export function accountSlugForConfigDir(
  configDir: string,
  homeDir: string = homedir(),
): string | null {
  const resolved = resolve(configDir);
  if (resolved === defaultClaudeHome(homeDir)) return null;
  const base = basename(resolved);
  if (base.startsWith(".claude-")) {
    const slug = base.slice(".claude-".length);
    return slug.length > 0 ? slug : "alt";
  }
  if (base.startsWith(".claude")) {
    const rest = base.slice(".claude".length).replace(/^-+/, "");
    return rest.length > 0 ? rest : "alt";
  }
  return base || "alt";
}

export function snapshotAgentKey(slug: string | null): string {
  return slug ? `claude-code:${slug}` : "claude-code";
}

export function looksLikeClaudeHome(dir: string): boolean {
  try {
    if (!statSync(dir).isDirectory()) return false;
  } catch {
    return false;
  }
  return CLAUDE_HOME_MARKERS.some((name) => existsSync(join(dir, name)));
}

/**
 * Config dirs that look like Claude Code homes. Default `~/.claude` first,
 * then `~/.claude-*`, then `$CLAUDE_CONFIG_DIR` if it isn't already listed.
 */
export function discoverClaudeConfigDirs(opts: {
  homeDir?: string;
  envConfigDir?: string | undefined;
} = {}): string[] {
  const homeDir = opts.homeDir ?? homedir();
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (dir: string) => {
    const resolved = resolve(dir);
    if (seen.has(resolved)) return;
    if (!looksLikeClaudeHome(resolved)) return;
    seen.add(resolved);
    found.push(resolved);
  };

  add(join(homeDir, ".claude"));
  try {
    for (const name of readdirSync(homeDir)) {
      if (!name.startsWith(".claude-")) continue;
      add(join(homeDir, name));
    }
  } catch {
    // unreadable home — still try the default + env override below
  }
  const envDir = opts.envConfigDir ?? process.env.CLAUDE_CONFIG_DIR;
  if (envDir && envDir.trim()) add(envDir.trim());
  return found;
}

export function readAccountCredentials(
  configDir: string,
  opts: {
    homeDir?: string;
    platform?: NodeJS.Platform;
    readKeychain?: (service: string) => OAuthCredentials | null;
    nowMs?: number;
    /** When false, return a token even if it is past `expiresAt`. */
    usableOnly?: boolean;
  } = {},
): { creds: OAuthCredentials; source: "keychain" | "file" } | null {
  const homeDir = opts.homeDir ?? homedir();
  const nowMs = opts.nowMs ?? Date.now();
  const os = opts.platform ?? platform();
  const keychainRead = opts.readKeychain ?? readFromMacKeychain;
  const usableOnly = opts.usableOnly !== false;

  const fileCreds = readCredentialsFile(join(configDir, ".credentials.json"));
  let keychainCreds: OAuthCredentials | null = null;
  if (os === "darwin") {
    keychainCreds = keychainRead(keychainServiceForConfigDir(configDir, homeDir));
  }
  // Default home also has the historical ~/.config/claude/credentials.json fallback.
  const extraFile =
    resolve(configDir) === defaultClaudeHome(homeDir)
      ? readCredentialsFile(join(homeDir, ".config", "claude", "credentials.json"))
      : null;

  const candidates: Array<{ creds: OAuthCredentials; source: "keychain" | "file" }> = [];
  if (keychainCreds) candidates.push({ creds: keychainCreds, source: "keychain" });
  if (fileCreds) candidates.push({ creds: fileCreds, source: "file" });
  if (extraFile) candidates.push({ creds: extraFile, source: "file" });

  for (const c of candidates) {
    if (!usableOnly || isUsable(c.creds, nowMs)) return c;
  }
  return null;
}

/**
 * Usable Claude logins, default home first, then slug A–Z.
 * Duplicate tokens (two dirs pointing at the same OAuth login) collapse to
 * one account, preferring the default home.
 */
export function discoverClaudeAccounts(opts: {
  homeDir?: string;
  envConfigDir?: string | undefined;
  platform?: NodeJS.Platform;
  readKeychain?: (service: string) => OAuthCredentials | null;
  nowMs?: number;
  usableOnly?: boolean;
} = {}): ClaudeAccount[] {
  const homeDir = opts.homeDir ?? homedir();
  const dirs = discoverClaudeConfigDirs({
    homeDir,
    envConfigDir: opts.envConfigDir,
  });
  const accounts: ClaudeAccount[] = [];
  const seenTokens = new Set<string>();

  for (const configDir of dirs) {
    const got = readAccountCredentials(configDir, opts);
    if (!got) continue;
    if (seenTokens.has(got.creds.accessToken)) continue;
    seenTokens.add(got.creds.accessToken);
    accounts.push({
      configDir,
      slug: accountSlugForConfigDir(configDir, homeDir),
      creds: got.creds,
      source: got.source,
    });
  }

  accounts.sort((a, b) => {
    if (a.slug === null) return -1;
    if (b.slug === null) return 1;
    return a.slug.localeCompare(b.slug);
  });
  return accounts;
}

/** Best-effort email/org from the config dir's `.claude.json` (no network). */
export function readLocalClaudeIdentity(configDir: string): {
  email: string | null;
  org: string | null;
} {
  try {
    const raw = JSON.parse(readFileSync(join(configDir, ".claude.json"), "utf8")) as {
      oauthAccount?: { emailAddress?: unknown; organizationName?: unknown };
    };
    const oa = raw.oauthAccount ?? {};
    return {
      email: typeof oa.emailAddress === "string" ? oa.emailAddress : null,
      org: typeof oa.organizationName === "string" ? oa.organizationName : null,
    };
  } catch {
    return { email: null, org: null };
  }
}
