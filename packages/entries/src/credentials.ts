import "server-only";
import { writeFileSync, readFileSync, renameSync, chmodSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { cclensPath, appendUsageSnapshot, pruneUsageAgent } from "@claude-lens/parser/fs";

/**
 * Z.ai (Zhipu AI) GLM Coding Plan usage endpoint. Undocumented but
 * stable — the same one Z.ai's own subscription UI calls. The credential
 * store holds the raw key; we send it without a Bearer prefix per
 * Z.ai's contract. Returns the parsed snapshot (5h/7d/web-search
 * meters + plan label) so the caller can persist it immediately.
 */
const ZAI_QUOTA_ENDPOINT = "https://api.z.ai/api/monitor/usage/quota/limit";

export type WebSearchQuota = { used: number | null; limit: number | null };

export type ZaiSnapshot = {
  captured_at: string;
  agent: "zai";
  five_hour: { utilization: number | null; resets_at: string | null };
  seven_day: { utilization: number | null; resets_at: string | null };
  seven_day_opus: null;
  seven_day_sonnet: null;
  seven_day_oauth_apps: null;
  seven_day_cowork: null;
  extra_usage: null;
  plan_type: string | null;
  web_search_quota: WebSearchQuota | null;
};

/** Fetch + parse a Z.ai usage snapshot for a candidate key.
 *  Throws on any failure (bad/expired key, network, unparseable) so
 *  the caller can reject a key that can't actually fetch usage. */
export async function fetchZaiUsage(candidate: string): Promise<ZaiSnapshot> {
  const key = candidate.trim();
  if (!key) throw new Error("empty key");
  const res = await fetch(ZAI_QUOTA_ENDPOINT, {
    headers: { Authorization: key, "Accept-Language": "en-US,en" },
  });
  if (!res.ok) {
    throw new Error(`Z.ai rejected the key (${res.status} ${res.statusText})`);
  }
  const body = (await res.json().catch(() => {
    throw new Error("Z.ai returned an unparseable response");
  })) as { code?: number; success?: boolean; data?: { limits?: Array<Record<string, unknown>>; level?: string } };
  // Z.ai returns HTTP 200 even for a bad/expired key — the error
  // lives in the body ({"code":401,"msg":"token expired or
  // incorrect"}). Without this check a bogus key would validate.
  if (body.code !== undefined && body.code !== 200) {
    throw new Error(`Z.ai rejected the key (code ${body.code})`);
  }
  if (body.success === false) {
    throw new Error("Z.ai rejected the key");
  }
  const limits = body.data?.limits ?? [];

  let fiveHour: { utilization: number | null; resets_at: string | null } | null = null;
  let sevenDay: { utilization: number | null; resets_at: string | null } | null = null;
  let webSearch: WebSearchQuota | null = null;

  for (const limit of limits) {
    const type = limit.type as string | undefined;
    if (type === "TIME_LIMIT") {
      const pct = typeof limit.percentage === "number" ? limit.percentage : null;
      webSearch = { used: pct, limit: pct !== null ? 100 : null };
      continue;
    }
    if (type !== "TOKENS_LIMIT") continue;
    const unit = limit.unit as number | undefined;
    const pct = typeof limit.percentage === "number" ? limit.percentage : null;
    const resetsAt =
      typeof limit.nextResetTime === "number"
        ? new Date(limit.nextResetTime).toISOString()
        : null;
    const window = { utilization: pct, resets_at: resetsAt };
    if (unit === 6) sevenDay = sevenDay ?? window;
    else fiveHour = fiveHour ?? window;
  }

  return {
    captured_at: new Date().toISOString(),
    agent: "zai",
    five_hour: fiveHour ?? { utilization: null, resets_at: null },
    seven_day: sevenDay ?? { utilization: null, resets_at: null },
    seven_day_opus: null,
    seven_day_sonnet: null,
    seven_day_oauth_apps: null,
    seven_day_cowork: null,
    extra_usage: null,
    plan_type: (body.data?.level as string | undefined) ?? null,
    web_search_quota: webSearch ?? null,
  };
}

/** Validate a candidate key: can it actually fetch usage? On success,
 *  persist the fetched snapshot so the /usage tab + menu-bar widget are
 *  populated the instant the user saves — independent of the daemon's
 *  next 5-min tick. Throws on any failure so the route can reject. */
export async function validateAndSnapshotZaiKey(key: string): Promise<ZaiSnapshot> {
  const snap = await fetchZaiUsage(key);
  appendUsageSnapshot(snap);
  return snap;
}

/** Remove the stored key and immediately prune the zai line from
 *  usage.jsonl, so the /usage tab + widget drop Z.ai the instant
 *  the user removes it (no waiting for the daemon's next tick). */
export function deleteZaiKeyAndPrune(): void {
  deleteZaiKey();
  pruneUsageAgent("zai");
}

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
