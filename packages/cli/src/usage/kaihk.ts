import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { UsageSnapshot } from "./api.js";

/**
 * KaiHK (api.kaihk.com) spend via OpenCode provider keys.
 *
 * The console wallet page is an HTML app and needs a user session.
 * API keys (`sk-…`) call:
 *   GET /api/usage/token                     token grant / used / unlimited_quota
 *   GET /v1/dashboard/billing/usage          total_usage in $0.01 units (÷ 100 = USD)
 *   GET /v1/dashboard/billing/subscription   access_until (unix; 0 = none)
 *
 * Keys are discovered from ~/.config/opencode/opencode.json providers whose
 * baseURL is api.kaihk.com. One snapshot per provider (`kaihk`, `kaihk-2`, …).
 *
 * Tokens often have unlimited_quota:true and spend the parent $50 welcome
 * wallet. Monthly % is spend vs KAIHK_PLAN_USD (default 50).
 */
const USAGE_TOKEN = "https://api.kaihk.com/api/usage/token";
const BILLING_USAGE = "https://api.kaihk.com/v1/dashboard/billing/usage";
const BILLING_SUB = "https://api.kaihk.com/v1/dashboard/billing/subscription";
const UA = "Mozilla/5.0 (compatible; fleetlens-kaihk-meter)";
const KAIHK_HOST = "api.kaihk.com";
const QUOTA_PER_USD = 500_000;

export class KaihkApiError extends Error {
  constructor(
    message: string,
    readonly code: "no_key" | "http" | "parse" | "network",
  ) {
    super(message);
  }
}

export type KaihkProvider = {
  id: string;
  apiKey: string;
  name: string;
};

export function opencodeConfigPath(): string {
  return process.env.OPENCODE_CONFIG ?? join(homedir(), ".config", "opencode", "opencode.json");
}

export function discoverKaihkProviders(configPath: string = opencodeConfigPath()): KaihkProvider[] {
  if (!existsSync(configPath)) return [];
  let parsed: { provider?: Record<string, { name?: string; options?: { baseURL?: string; apiKey?: string } }> };
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8")) as typeof parsed;
  } catch {
    return [];
  }
  const providers = parsed.provider;
  if (!providers || typeof providers !== "object") return [];
  const found: KaihkProvider[] = [];
  for (const [id, spec] of Object.entries(providers)) {
    const baseURL = spec?.options?.baseURL;
    const apiKey = spec?.options?.apiKey;
    if (typeof baseURL !== "string" || typeof apiKey !== "string") continue;
    try {
      if (new URL(baseURL).hostname !== KAIHK_HOST) continue;
    } catch {
      continue;
    }
    if (!apiKey.startsWith("sk-")) continue;
    found.push({
      id,
      apiKey,
      name: typeof spec.name === "string" ? spec.name : id,
    });
  }
  found.sort((a, b) => {
    if (a.id === "kaihk") return -1;
    if (b.id === "kaihk") return 1;
    return a.id.localeCompare(b.id);
  });
  return found;
}

export function isKaihkAgent(kind: string): boolean {
  return kind === "kaihk" || kind.startsWith("kaihk-");
}

export function kaihkTitle(kind: string): string {
  if (kind === "kaihk") return "KaiHK";
  if (kind.startsWith("kaihk-")) return `KaiHK (${kind.slice("kaihk-".length)})`;
  return kind;
}

export function planUsd(): number {
  const n = Number(process.env.KAIHK_PLAN_USD ?? 50);
  return Number.isFinite(n) && n > 0 ? n : 50;
}

/** Sub-cent spend keeps extra digits so $0.0009 is not rounded to $0.00. */
export function formatKaihkUsd(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  if (Math.abs(n) >= 0.01) return `$${n.toFixed(2)}`;
  const trimmed = n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `$${trimmed || "0"}`;
}

export function parseKaihkSnapshot(opts: {
  agent: string;
  token: {
    data?: {
      expires_at?: number;
      name?: string;
      total_used?: number;
      unlimited_quota?: boolean;
    };
  };
  billingUsage?: { total_usage?: number };
  billingSub?: { access_until?: number };
  includedUsd?: number;
  capturedAt?: string;
}): UsageSnapshot {
  const data = opts.token.data ?? {};
  const usedUsdFromBilling =
    typeof opts.billingUsage?.total_usage === "number" ? opts.billingUsage.total_usage / 100 : null;
  const usedUsdFromQuota =
    typeof data.total_used === "number" ? data.total_used / QUOTA_PER_USD : null;
  const usedUsd = usedUsdFromBilling ?? usedUsdFromQuota;
  const expiresAtSec = Number(data.expires_at ?? opts.billingSub?.access_until ?? 0);
  const resetsAt = expiresAtSec > 0 ? new Date(expiresAtSec * 1000).toISOString() : null;
  const included = opts.includedUsd ?? planUsd();
  const utilization =
    usedUsd != null && included > 0 ? Math.max(0, Math.min(100, (usedUsd / included) * 100)) : null;
  const remaining = usedUsd != null ? Math.max(0, included - usedUsd) : null;

  return {
    captured_at: opts.capturedAt ?? new Date().toISOString(),
    agent: opts.agent,
    five_hour: { utilization: null, resets_at: null },
    seven_day: { utilization: null, resets_at: null },
    monthly: utilization == null ? null : { utilization, resets_at: resetsAt },
    monthly_quota: {
      used: usedUsd,
      limit: included,
      remaining,
      unit: "usd",
      unlimited: false,
    },
    seven_day_opus: null,
    seven_day_sonnet: null,
    seven_day_oauth_apps: null,
    seven_day_cowork: null,
    extra_usage: null,
    plan_type: typeof data.name === "string" && data.name ? data.name : "kaihk",
  };
}

async function getJson(url: string, apiKey: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "User-Agent": UA,
      },
    });
  } catch (err) {
    throw new KaihkApiError(`Network error reaching KaiHK: ${(err as Error).message}`, "network");
  }
  if (!res.ok) {
    throw new KaihkApiError(`KaiHK ${url.split("kaihk.com")[1] ?? url} returned ${res.status}`, "http");
  }
  try {
    return await res.json();
  } catch (err) {
    throw new KaihkApiError(`Failed to parse KaiHK response: ${(err as Error).message}`, "parse");
  }
}

export async function fetchKaihkUsageForKey(
  provider: KaihkProvider,
  includedUsd: number = planUsd(),
): Promise<UsageSnapshot> {
  const [token, billingUsage, billingSub] = await Promise.all([
    getJson(USAGE_TOKEN, provider.apiKey),
    getJson(BILLING_USAGE, provider.apiKey),
    getJson(BILLING_SUB, provider.apiKey),
  ]);
  return parseKaihkSnapshot({
    agent: provider.id,
    token: token as { data?: { expires_at?: number; name?: string; total_used?: number; unlimited_quota?: boolean } },
    billingUsage: billingUsage as { total_usage?: number },
    billingSub: billingSub as { access_until?: number },
    includedUsd,
  });
}

export async function fetchAllKaihkUsage(): Promise<UsageSnapshot[]> {
  const providers = discoverKaihkProviders();
  if (providers.length === 0) {
    throw new KaihkApiError(
      "No KaiHK keys in OpenCode config (~/.config/opencode/opencode.json).",
      "no_key",
    );
  }
  const included = planUsd();
  const out: UsageSnapshot[] = [];
  const errors: Error[] = [];
  for (const provider of providers) {
    try {
      out.push(await fetchKaihkUsageForKey(provider, included));
    } catch (err) {
      errors.push(err as Error);
    }
  }
  if (out.length === 0) {
    throw errors[0] ?? new KaihkApiError("KaiHK usage poll failed.", "http");
  }
  return out;
}
