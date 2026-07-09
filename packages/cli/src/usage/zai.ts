import { existsSync, readFileSync } from "node:fs";
import { cclensPath } from "@claude-lens/parser/fs";
import type { UsageSnapshot } from "./api.js";

/**
 * Z.ai (Zhipu AI) GLM Coding Plan usage. Unlike Claude (OAuth + Keychain)
 * and Codex (local rollout files), Z.ai has no on-disk credential and no
 * local session transcripts — it exposes plan utilization only through its
 * own subscription UI's internal HTTP endpoints, gated by an API key the
 * user supplies. This mirrors Claude's `api.ts`: a network poller that
 * lives in the CLI (the parser stays no-network) and is driven by the
 * daemon's tick() rather than the parser's agentSources registry.
 *
 * Two stable-but-undocumented endpoints (the same ones Z.ai's own
 * subscription UI calls):
 *   GET https://api.z.ai/api/monitor/usage/quota/limit
 *       → `limits` array; each TOKENS_LIMIT entry is a token window whose
 *         window length decides the meter (sub-daily → 5h, multi-day → 7d);
 *         a TIME_LIMIT entry is the monthly web-search count. Reset times
 *         come back as epoch milliseconds.
 *   GET https://api.z.ai/api/biz/subscription/list
 *       → plan name (best-effort; a failure here must not blank meters).
 *
 * Auth: `Authorization: <token>` WITHOUT a Bearer prefix, plus
 * `Accept-Language: en-US,en`.
 */
const ZAI_QUOTA_ENDPOINT = "https://api.z.ai/api/monitor/usage/quota/limit";
const ZAI_SUBSCRIPTION_ENDPOINT = "https://api.z.ai/api/biz/subscription/list";

/** A monthly web-search / web-reader / Zread quota (the TIME_LIMIT entry). */
export type WebSearchQuota = {
  used: number | null;
  limit: number | null;
};

export class ZaiApiError extends Error {
  constructor(
    message: string,
    readonly code: "no_key" | "http" | "parse" | "network",
  ) {
    super(message);
  }
}

function resolveApiKey(): string | null {
  // The Fleetlens credential store (~/.cclens/credentials.json, 0o600) is the
  // single source of truth, set via the Settings page. Env vars and legacy
  // ~/.config key files are intentionally not consulted: the security policy
  // mandates a dedicated store, and an old ZAI_API_KEY or stale config file
  // must not silently keep Z.ai polling after the user removes it in Settings.
  // If the store is absent the user simply hasn't configured Z.ai yet.
  try {
    const p = cclensPath("credentials.json");
    if (existsSync(p)) {
      const store = JSON.parse(readFileSync(p, "utf8")) as {
        zai?: { apiKey?: string };
      };
      return store.zai?.apiKey ?? null;
    }
  } catch {
    // Corrupt store — treat as unconfigured rather than throwing.
  }
  return null;
}

type ZaiUsageDetail = {
  modelCode?: string;
  usage?: number;
};

type ZaiLimit = {
  /** "TOKENS_LIMIT" (token window) or "TIME_LIMIT" (web-search count). */
  type?: string;
  /** Window unit. Per Z.ai's subscription UI (and openusage): 3 = 5-hour
   *  session window, 6 = 7-day weekly window. Other values are treated as
   *  5h by default since that's the most common rolling window. */
  unit?: number;
  /** Utilization percent (0–100) for the window. */
  percentage?: number;
  /** Epoch ms when this window resets. */
  nextResetTime?: number;
  /** Web-search (TIME_LIMIT) counters. */
  usage?: number;
  remaining?: number;
  /** Per-tool breakdown for web-search (search-prime / web-reader / zread). */
  usageDetails?: ZaiUsageDetail[];
};

function epochMsToIso(ms: unknown): string | null {
  if (typeof ms !== "number" || Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

function windowFromLimit(limit: ZaiLimit): { utilization: number | null; resets_at: string | null } {
  return {
    utilization: typeof limit.percentage === "number" ? limit.percentage : null,
    resets_at: epochMsToIso(limit.nextResetTime),
  };
}

function zaiHeaders(key: string): Record<string, string> {
  // Z.ai's internal endpoints expect the raw token, not a Bearer scheme.
  return { Authorization: key, "Accept-Language": "en-US,en" };
}

export async function fetchZaiUsage(): Promise<UsageSnapshot> {
  const key = resolveApiKey();
  if (!key) {
    throw new ZaiApiError(
      "No Z.ai API key found. Set ZAI_API_KEY (or GLM_API_KEY), or write ~/.config/zai/key.json.",
      "no_key",
    );
  }

  let res: Response;
  try {
    res = await fetch(ZAI_QUOTA_ENDPOINT, { headers: zaiHeaders(key) });
  } catch (err) {
    throw new ZaiApiError(`Network error reaching Z.ai: ${(err as Error).message}`, "network");
  }
  if (!res.ok) {
    throw new ZaiApiError(`Z.ai quota endpoint returned ${res.status} ${res.statusText}`, "http");
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    throw new ZaiApiError(`Failed to parse Z.ai quota response: ${(err as Error).message}`, "parse");
  }

  const b = body as { data?: { limits?: ZaiLimit[]; level?: string } };
  const limits = b.data?.limits ?? [];

  let fiveHour: { utilization: number | null; resets_at: string | null } | null = null;
  let sevenDay: { utilization: number | null; resets_at: string | null } | null = null;
  let webSearch: WebSearchQuota | null = null;

  for (const limit of limits) {
    if (limit.type === "TIME_LIMIT") {
      // Monthly web-search / web-reader / Zread count. Z.ai reports the used
      // share as `percentage` (0–100) — the same field the portal displays
      // ("0%"), NOT as a raw usage/remaining split. We mirror the portal and
      // store it as a percentage meter so the widget agrees with Z.ai's UI.
      // `usageDetails` breaks the count down per tool (search-prime /
      // web-reader / zread) if needed later.
      const percentage = typeof limit.percentage === "number" ? limit.percentage : null;
      webSearch = {
        used: percentage,
        limit: percentage !== null ? 100 : null,
      };
      continue;
    }
    // TOKENS_LIMIT — classify by `unit`. 3 = 5-hour session window,
    // 6 = 7-day weekly window. Other/unknown units fold into 5h (most common).
    const window = windowFromLimit(limit);
    if (limit.unit === 6) {
      sevenDay = sevenDay ?? window;
    } else {
      fiveHour = fiveHour ?? window;
    }
  }

  // Plan name is best-effort; a failure here must not blank the meters.
  // It lives in the subscription list under data[].productName (e.g.
  // "GLM Coding Lite"), not in the quota response.
  let planType: string | null = null;
  try {
    const subRes = await fetch(ZAI_SUBSCRIPTION_ENDPOINT, { headers: zaiHeaders(key) });
    if (subRes.ok) {
      const sub = (await subRes.json()) as {
        data?: Array<{ productName?: string; planName?: string; name?: string }>;
      };
      const entry = sub.data?.[0];
      planType = entry?.productName || entry?.planName || entry?.name || null;
    }
  } catch {
    // Non-fatal — plan label is optional in the UI.
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
    plan_type: planType,
    web_search_quota: webSearch ?? null,
  };
}
