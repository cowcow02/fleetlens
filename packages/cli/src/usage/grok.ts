/**
 * Grok Build plan utilization via the same billing endpoint the Grok CLI
 * and OpenUsage use:
 *   GET https://cli-chat-proxy.grok.com/v1/billing?format=credits
 *
 * Auth: `~/.grok/auth.json` (or $GROK_HOME/auth.json) written by `grok login`.
 * Grok has a **weekly** shared pool only (no 5h window) for unified-billing
 * accounts — we store that percent on `seven_day` and leave `five_hour` null
 * so the menubar strip shows "—" over "44%" like other agents' dual lines.
 *
 * Shape documented by OpenUsage (MIT, robinebers/openusage):
 *   { config: {
 *       creditUsagePercent: 28.0,   // omitted when 0 (proto-JSON)
 *       currentPeriod: {
 *         type: "USAGE_PERIOD_TYPE_WEEKLY",
 *         start: "...", end: "..."
 *       },
 *       onDemandCap: { val: 0 },
 *       isUnifiedBillingUser: true
 *   }}
 */

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UsageSnapshot } from "./api.js";

const CREDITS_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const SETTINGS_URL = "https://cli-chat-proxy.grok.com/v1/settings";
const REFRESH_URL = "https://auth.x.ai/oauth2/token";
const TOKEN_AUTH = "xai-grok-cli";
const DEFAULT_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const WEEKLY_PERIOD = "USAGE_PERIOD_TYPE_WEEKLY";
/** Refresh when within this many ms of expires_at. */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export class GrokApiError extends Error {
  constructor(
    message: string,
    readonly code: "no_auth" | "http" | "parse" | "network" | "not_weekly",
  ) {
    super(message);
  }
}

type GrokAuthEntry = {
  key?: string;
  refresh_token?: string;
  expires_at?: string;
  oidc_client_id?: string;
};

function grokHome(): string {
  return process.env.GROK_HOME || path.join(os.homedir(), ".grok");
}

function authPath(): string {
  return path.join(grokHome(), "auth.json");
}

function loadAuthEntry(): { token: string; entry: GrokAuthEntry; entryKey: string } {
  const p = authPath();
  if (!existsSync(p)) {
    throw new GrokApiError("Grok not logged in. Run `grok login`.", "no_auth");
  }
  let raw: Record<string, GrokAuthEntry>;
  try {
    raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, GrokAuthEntry>;
  } catch {
    throw new GrokApiError("Grok auth.json is unreadable. Run `grok login`.", "no_auth");
  }
  for (const [entryKey, entry] of Object.entries(raw)) {
    const token = typeof entry?.key === "string" ? entry.key.trim() : "";
    if (token) return { token, entry, entryKey };
  }
  throw new GrokApiError("Grok auth has no access token. Run `grok login`.", "no_auth");
}

function needsRefresh(entry: GrokAuthEntry): boolean {
  const exp = entry.expires_at;
  if (!exp) return false;
  const ms = Date.parse(exp);
  if (!Number.isFinite(ms)) return false;
  return Date.now() >= ms - REFRESH_BUFFER_MS;
}

async function refreshAccessToken(entry: GrokAuthEntry): Promise<string | null> {
  const refresh = entry.refresh_token?.trim();
  if (!refresh) return null;
  const clientId = entry.oidc_client_id?.trim() || DEFAULT_CLIENT_ID;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: refresh,
  });
  let res: Response;
  try {
    res = await fetch(REFRESH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    const j = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (typeof j.access_token !== "string" || !j.access_token) return null;
    // Best-effort write-back so subsequent polls use the fresh token.
    try {
      const p = authPath();
      const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, GrokAuthEntry>;
      for (const key of Object.keys(raw)) {
        if (raw[key]?.key === entry.key || raw[key]?.refresh_token === refresh) {
          raw[key] = {
            ...raw[key],
            key: j.access_token,
            refresh_token: j.refresh_token ?? raw[key]!.refresh_token,
            expires_at:
              typeof j.expires_in === "number"
                ? new Date(Date.now() + j.expires_in * 1000).toISOString()
                : raw[key]!.expires_at,
          };
          break;
        }
      }
      const { writeFileSync } = await import("node:fs");
      writeFileSync(p, JSON.stringify(raw, null, 2), "utf8");
    } catch {
      // Non-fatal — in-memory token still works for this poll.
    }
    return j.access_token;
  } catch {
    return null;
  }
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token.trim()}`,
    "X-XAI-Token-Auth": TOKEN_AUTH,
    Accept: "application/json",
    "User-Agent": "fleetlens",
  };
}

/** Pure decoder — unit-tested without network. */
export function parseGrokCreditsConfig(body: unknown): {
  utilization: number;
  resets_at: string | null;
  period_type: string;
  on_demand_cap: number;
} {
  if (!body || typeof body !== "object") {
    throw new GrokApiError("Grok billing response missing body", "parse");
  }
  const config = (body as { config?: Record<string, unknown> }).config;
  if (!config || typeof config !== "object") {
    throw new GrokApiError("Grok billing response missing config", "parse");
  }
  const period = config.currentPeriod as Record<string, unknown> | undefined;
  if (!period || typeof period !== "object") {
    throw new GrokApiError("Grok billing response missing currentPeriod", "parse");
  }
  const periodType =
    typeof period.type === "string" ? period.type.trim() : "";
  if (!periodType) {
    throw new GrokApiError("Grok billing period type missing", "parse");
  }

  let utilization = 0;
  if (config.creditUsagePercent !== undefined && config.creditUsagePercent !== null) {
    const n = Number(config.creditUsagePercent);
    if (!Number.isFinite(n)) {
      throw new GrokApiError("Grok creditUsagePercent is not a number", "parse");
    }
    utilization = Math.min(100, Math.max(0, n));
  }

  const end =
    typeof period.end === "string" && period.end
      ? new Date(period.end).toISOString()
      : null;

  let onDemandCap = 0;
  const cap = config.onDemandCap;
  if (cap && typeof cap === "object" && "val" in (cap as object)) {
    const v = Number((cap as { val?: unknown }).val);
    if (Number.isFinite(v)) onDemandCap = v;
  }

  return {
    utilization,
    resets_at: end && !Number.isNaN(Date.parse(end)) ? end : null,
    period_type: periodType,
    on_demand_cap: onDemandCap,
  };
}

async function fetchJson(
  url: string,
  token: string,
): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, { headers: authHeaders(token) });
  } catch (err) {
    throw new GrokApiError(
      `Network error reaching Grok billing: ${(err as Error).message}`,
      "network",
    );
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // leave null
  }
  return { status: res.status, body };
}

/**
 * Poll Grok's weekly credit pool. five_hour is always null (no 5h window);
 * seven_day carries the weekly shared-pool utilization.
 */
export async function fetchGrokUsage(): Promise<UsageSnapshot> {
  let { token, entry } = loadAuthEntry();
  if (needsRefresh(entry)) {
    const refreshed = await refreshAccessToken(entry);
    if (refreshed) token = refreshed;
  }

  let { status, body } = await fetchJson(CREDITS_URL, token);
  if (status === 401 || status === 403) {
    const refreshed = await refreshAccessToken(entry);
    if (refreshed) {
      token = refreshed;
      ({ status, body } = await fetchJson(CREDITS_URL, token));
    }
  }
  if (status < 200 || status >= 300) {
    throw new GrokApiError(
      `Grok billing returned HTTP ${status}`,
      status === 401 || status === 403 ? "no_auth" : "http",
    );
  }

  const credits = parseGrokCreditsConfig(body);
  if (credits.period_type !== WEEKLY_PERIOD) {
    // Account not on unified weekly billing — don't mislabel monthly %.
    throw new GrokApiError(
      `Grok period is ${credits.period_type}, not weekly`,
      "not_weekly",
    );
  }

  // Plan label is best-effort.
  let planType: string | null = null;
  try {
    const settings = await fetchJson(SETTINGS_URL, token);
    if (settings.status >= 200 && settings.status < 300 && settings.body && typeof settings.body === "object") {
      const tier = (settings.body as { subscription_tier_display?: string })
        .subscription_tier_display;
      if (typeof tier === "string" && tier.trim()) planType = tier.trim();
    }
  } catch {
    // optional
  }

  return {
    captured_at: new Date().toISOString(),
    agent: "grok",
    // No 5-hour window — menubar / strip show "—" on the top line.
    five_hour: { utilization: null, resets_at: null },
    seven_day: {
      utilization: credits.utilization,
      resets_at: credits.resets_at,
    },
    seven_day_opus: null,
    seven_day_sonnet: null,
    seven_day_oauth_apps: null,
    seven_day_cowork: null,
    extra_usage: null,
    plan_type: planType,
  };
}
