import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export type OAuthCredentials = {
  accessToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
};

/**
 * Read the Claude Code OAuth credentials from the local credential store.
 * Returns null if nothing can be read — caller should tell the user to run
 * `claude` to log in.
 *
 * macOS: reads from the login Keychain under service "Claude Code-credentials".
 * Linux/Windows: falls back to `~/.claude/.credentials.json` if it exists.
 *
 * The JSON shape (on both platforms) is:
 *   { "claudeAiOauth": { "accessToken": "...", "expiresAt": 1776..., ... } }
 *
 * `expiresAt` is surfaced so callers can short-circuit on an expired token
 * instead of pointlessly hitting the usage endpoint with dead credentials
 * (which earns 401s and eventually 429s from Anthropic's rate limiter).
 */
export function readOAuthCredentials(): OAuthCredentials | null {
  if (platform() === "darwin") {
    return readFromMacKeychain() ?? readFromCredentialsFile();
  }
  return readFromCredentialsFile();
}

function readFromMacKeychain(): OAuthCredentials | null {
  try {
    const blob = execFileSync(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" },
    );
    return extractCredentials(blob);
  } catch {
    return null;
  }
}

function readFromCredentialsFile(): OAuthCredentials | null {
  const candidates = [
    join(homedir(), ".claude", ".credentials.json"),
    join(homedir(), ".config", "claude", "credentials.json"),
  ];
  for (const path of candidates) {
    try {
      const blob = readFileSync(path, "utf8");
      const creds = extractCredentials(blob);
      if (creds) return creds;
    } catch {
      // Try the next candidate
    }
  }
  return null;
}

/**
 * True if the access token is still usable at `now`, with a small skew so
 * callers don't fire a request the exact second it dies. Used by the daemon
 * to decide locally whether to attempt a poll or wait for Claude Code to
 * refresh the token — avoids hammering the usage endpoint with a dead token.
 */
export function isUsable(creds: OAuthCredentials, now: number, skewMs = 60_000): boolean {
  return creds.expiresAt - skewMs > now;
}

export function extractCredentials(blob: string): OAuthCredentials | null {
  try {
    const parsed = JSON.parse(blob) as {
      claudeAiOauth?: { accessToken?: unknown; expiresAt?: unknown };
    };
    const oauth = parsed.claudeAiOauth;
    if (!oauth) return null;
    const accessToken = typeof oauth.accessToken === "string" ? oauth.accessToken : null;
    const expiresAt = typeof oauth.expiresAt === "number" ? oauth.expiresAt : null;
    if (!accessToken || expiresAt === null) return null;
    return { accessToken, expiresAt };
  } catch {
    return null;
  }
}
