import "server-only";
import { writeFileSync, readFileSync, renameSync, chmodSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { cclensPath } from "@claude-lens/parser/fs";

/**
 * Fleetlens-managed credential store at ~/.cclens/credentials.json.
 * Mirrors settings.ts: atomic write via temp-file rename, 0o600, flat
 * JSON with provider namespaces. Only keys the user enters through the
 * Settings page are stored here — no env-var or shell-config scans.
 *
 * Shape:
 *   { "zai": { "apiKey": "…" } }
 *
 * `readCredentials` returns masked values ("abc…xyz") so the dashboard can
 * show "a key is configured" without leaking the secret into RSC payloads.
 * The plaintext key is read directly from disk only by `fetchZaiUsage` in
 * the CLI daemon (which runs on the same machine with the same user).
 */
export type CredentialStore = {
  zai?: ZaiCredentials;
};

export type ZaiCredentials = {
  apiKey: string;
};

/** Masked view for Settings page display. Never contains plaintext. */
export type CredentialMasked = {
  zai?: ZaiMasked;
};

export type ZaiMasked = {
  configured: boolean;
  /** "abc…xyz" format — first 6 + last 6 chars, enough to distinguish keys. */
  hint: string | null;
};

function credentialsPath(): string {
  return cclensPath("credentials.json");
}

export function readCredentials(): CredentialStore {
  const p = credentialsPath();
  if (!existsSync(p)) return {};
  try {
    const raw = readFileSync(p, "utf8");
    return JSON.parse(raw) as CredentialStore;
  } catch {
    return {};
  }
}

/**
 * Masked view for server components and API responses. Never leaks the
 * plaintext — only tells the UI "a key is present" with a hint.
 */
export function readCredentialsMasked(): CredentialMasked {
  const store = readCredentials();
  if (!store.zai?.apiKey) return {};
  const key = store.zai.apiKey;
  const hint = key.length > 12
    ? `${key.slice(0, 6)}…${key.slice(-6)}`
    : `${key.slice(0, 6)}…`;
  return { zai: { configured: true, hint } };
}

export function writeZaiKey(apiKey: string): void {
  apiKey = apiKey.trim();
  if (!apiKey) {
    deleteZaiKey();
    return;
  }
  const store = readCredentials();
  store.zai = { ...(store.zai ?? {}), apiKey };
  const p = credentialsPath();
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2), { encoding: "utf8" });
  if (process.platform !== "win32") {
    chmodSync(tmp, 0o600);
  }
  renameSync(tmp, p);
}

export function deleteZaiKey(): void {
  const store = readCredentials();
  delete store.zai;
  const p = credentialsPath();
  if (Object.keys(store).length === 0) {
    try { unlinkSync(p); } catch {}
    return;
  }
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2), { encoding: "utf8" });
  if (process.platform !== "win32") {
    chmodSync(tmp, 0o600);
  }
  renameSync(tmp, p);
}

export function hasZaiKey(): boolean {
  return !!(readCredentials().zai?.apiKey);
}
