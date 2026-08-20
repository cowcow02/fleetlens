/**
 * Command Code (cmd) plan utilization via the same alpha billing endpoints
 * the Command Code CLI's `/usage` overlay calls:
 *   GET https://api.commandcode.ai/alpha/billing/credits
 *   GET https://api.commandcode.ai/alpha/billing/subscriptions
 *
 * Auth: `~/.commandcode/auth.json` (or $COMMANDCODE_HOME/auth.json) written
 * by `cmd login`. Fleetlens surfaces the monthly credit pool plus the
 * 5-hour and weekly rolling windows — the same three meters Command Code
 * Studio shows.
 *
 * These endpoints are undocumented (the published Provider API has no usage
 * route). If they change, the parsers should fail closed.
 */

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UsageSnapshot, UsageWindow } from "./api.js";

const DEFAULT_API_BASE = "https://api.commandcode.ai";
const CREDITS_PATH = "/alpha/billing/credits";
const SUBSCRIPTIONS_PATH = "/alpha/billing/subscriptions";

const PLAN_NAMES: Record<string, string> = {
  "individual-go": "Go",
  "individual-goat": "GOAT",
  "individual-pro": "Pro",
  "individual-pro-v1": "Pro",
  "individual-provider": "Provider",
  "individual-max": "Max",
  "individual-ultra": "Ultra",
  "teams-pro": "Teams Pro",
};

/** Monthly credit allocation in plan dollars — same table the cmd CLI uses. */
const PLAN_CREDITS: Record<string, number> = {
  "individual-go": 10,
  "individual-goat": 70,
  "individual-pro": 30,
  "individual-pro-v1": 80,
  "individual-provider": 15,
  "individual-max": 150,
  "individual-ultra": 300,
  "teams-pro": 40,
};

export class CommandCodeApiError extends Error {
  constructor(
    message: string,
    readonly code: "no_auth" | "http" | "parse" | "network",
  ) {
    super(message);
  }
}

type AuthFile = { apiKey?: string };

function commandCodeHome(): string {
  return process.env.COMMANDCODE_HOME || path.join(os.homedir(), ".commandcode");
}

function authPath(): string {
  return path.join(commandCodeHome(), "auth.json");
}

export function loadCommandCodeApiKey(): string {
  const p = authPath();
  if (!existsSync(p)) {
    throw new CommandCodeApiError("Command Code not logged in. Run `cmd login`.", "no_auth");
  }
  let raw: AuthFile;
  try {
    raw = JSON.parse(readFileSync(p, "utf8")) as AuthFile;
  } catch {
    throw new CommandCodeApiError("Command Code auth.json is unreadable. Run `cmd login`.", "no_auth");
  }
  const key = typeof raw.apiKey === "string" ? raw.apiKey.trim() : "";
  if (!key) {
    throw new CommandCodeApiError("Command Code auth has no API key. Run `cmd login`.", "no_auth");
  }
  return key;
}

function apiBase(): string {
  const custom = process.env.COMMANDCODE_API_URL?.trim();
  return custom && custom.length > 0 ? custom.replace(/\/$/, "") : DEFAULT_API_BASE;
}

function authHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
    "User-Agent": "fleetlens",
  };
}

function normalizePlanKey(planId: string): string {
  return planId.trim().toLowerCase().replace(/_/g, "-");
}

function matchPlanKey(planId: string): string | null {
  const key = normalizePlanKey(planId);
  if (PLAN_NAMES[key] || PLAN_CREDITS[key] !== undefined) return key;
  return (
    Object.keys(PLAN_NAMES)
      .sort((a, b) => b.length - a.length)
      .find((p) => key.startsWith(p)) ?? null
  );
}

export function planLabelFromId(planId: unknown): string | null {
  if (typeof planId !== "string" || !planId.trim()) return null;
  const key = matchPlanKey(planId);
  return key ? (PLAN_NAMES[key] ?? planId.trim()) : planId.trim();
}

export function planMonthlyCredits(planId: unknown): number | null {
  if (typeof planId !== "string" || !planId.trim()) return null;
  const key = matchPlanKey(planId);
  if (!key) return null;
  const n = PLAN_CREDITS[key];
  return typeof n === "number" ? n : null;
}

function asCredit(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return raw;
}

function roundCredits(n: number): number {
  return Math.round(n * 100) / 100;
}

function isoFromUnknown(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function parseCommandCodeCredits(body: unknown): {
  remaining: number | null;
  purchased: number;
  free: number;
  planId: string | null;
} {
  if (!body || typeof body !== "object") {
    throw new CommandCodeApiError("Command Code credits response missing body", "parse");
  }
  const credits = (body as { credits?: unknown }).credits;
  if (!credits || typeof credits !== "object") {
    throw new CommandCodeApiError("Command Code credits response missing credits", "parse");
  }
  const c = credits as {
    monthlyCredits?: unknown;
    purchasedCredits?: unknown;
    freeCredits?: unknown;
    planId?: unknown;
  };
  return {
    remaining: asCredit(c.monthlyCredits),
    purchased: asCredit(c.purchasedCredits) ?? 0,
    free: asCredit(c.freeCredits) ?? 0,
    planId: typeof c.planId === "string" && c.planId.trim() ? c.planId.trim() : null,
  };
}

/** Pure decoder for the 5-hour / weekly rate-limit windows. */
export function parseCommandCodeWindow(raw: unknown): UsageWindow {
  if (!raw || typeof raw !== "object") {
    return { utilization: null, resets_at: null };
  }
  const w = raw as { used?: unknown; cap?: unknown; resetAt?: unknown };
  const used = Number(w.used);
  const cap = Number(w.cap);
  let utilization: number | null = null;
  if (Number.isFinite(used) && Number.isFinite(cap) && cap > 0) {
    utilization = Math.min(100, Math.max(0, (used / cap) * 100));
  }
  let resets_at: string | null = null;
  const resetAt = Number(w.resetAt);
  if (Number.isFinite(resetAt) && resetAt > 0) {
    const iso = new Date(resetAt).toISOString();
    if (!Number.isNaN(Date.parse(iso))) resets_at = iso;
  }
  return { utilization, resets_at };
}

export function parseCommandCodeWindows(body: unknown): {
  five_hour: UsageWindow;
  seven_day: UsageWindow;
} {
  const empty = { utilization: null, resets_at: null };
  if (!body || typeof body !== "object") return { five_hour: empty, seven_day: empty };
  const limits = (body as { windowLimits?: unknown }).windowLimits;
  if (!limits || typeof limits !== "object") return { five_hour: empty, seven_day: empty };
  const l = limits as { fiveHour?: unknown; weekly?: unknown };
  return {
    five_hour: parseCommandCodeWindow(l.fiveHour),
    seven_day: parseCommandCodeWindow(l.weekly),
  };
}

export function parseCommandCodeSubscription(body: unknown): {
  plan_type: string | null;
  planId: string | null;
  currentPeriodEnd: string | null;
} {
  if (!body || typeof body !== "object") {
    return { plan_type: null, planId: null, currentPeriodEnd: null };
  }
  const data = (body as { data?: { planId?: unknown; currentPeriodEnd?: unknown } }).data;
  const planId = typeof data?.planId === "string" && data.planId.trim() ? data.planId.trim() : null;
  return {
    plan_type: planLabelFromId(planId),
    planId,
    currentPeriodEnd: isoFromUnknown(data?.currentPeriodEnd),
  };
}

/** Pure decoder — unit-tested without network. */
export function parseCommandCodeMonthly(opts: {
  credits: ReturnType<typeof parseCommandCodeCredits>;
  subscription: ReturnType<typeof parseCommandCodeSubscription>;
}): {
  monthly: UsageWindow;
  monthly_quota: NonNullable<import("./api.js").UsageSnapshot["monthly_quota"]>;
  plan_type: string | null;
} {
  const planId = opts.subscription.planId ?? opts.credits.planId;
  const limit = planMonthlyCredits(planId);
  const remaining = opts.credits.remaining;
  let used: number | null = null;
  let utilization: number | null = null;
  if (limit != null && limit > 0 && remaining != null) {
    used = roundCredits(Math.max(0, limit - remaining));
    utilization = Math.min(100, Math.max(0, (used / limit) * 100));
  }
  return {
    monthly: {
      utilization,
      resets_at: opts.subscription.currentPeriodEnd,
    },
    monthly_quota: {
      used,
      limit,
      remaining: remaining == null ? null : roundCredits(Math.max(0, remaining)),
      unit: "credits",
      unlimited: false,
    },
    plan_type: opts.subscription.plan_type ?? planLabelFromId(planId),
  };
}

async function fetchJson(
  url: string,
  key: string,
): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, { headers: authHeaders(key) });
  } catch (err) {
    throw new CommandCodeApiError(
      `Network error reaching Command Code billing: ${(err as Error).message}`,
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
 * Poll Command Code's monthly credits plus 5-hour and weekly windows.
 */
export async function fetchCommandCodeUsage(): Promise<UsageSnapshot> {
  const key = loadCommandCodeApiKey();
  const base = apiBase();

  const creditsRes = await fetchJson(`${base}${CREDITS_PATH}`, key);
  if (creditsRes.status === 401 || creditsRes.status === 403) {
    throw new CommandCodeApiError(
      `Command Code credits returned HTTP ${creditsRes.status}`,
      "no_auth",
    );
  }
  if (creditsRes.status < 200 || creditsRes.status >= 300) {
    throw new CommandCodeApiError(
      `Command Code credits returned HTTP ${creditsRes.status}`,
      "http",
    );
  }
  const credits = parseCommandCodeCredits(creditsRes.body);
  const windows = parseCommandCodeWindows(creditsRes.body);

  let subscription = parseCommandCodeSubscription(null);
  try {
    const subRes = await fetchJson(`${base}${SUBSCRIPTIONS_PATH}`, key);
    if (subRes.status >= 200 && subRes.status < 300) {
      subscription = parseCommandCodeSubscription(subRes.body);
    }
  } catch {
    // Plan / period end is best-effort; remaining credits still stand alone.
  }

  const monthly = parseCommandCodeMonthly({ credits, subscription });

  return {
    captured_at: new Date().toISOString(),
    agent: "command-code",
    five_hour: windows.five_hour,
    seven_day: windows.seven_day,
    monthly: monthly.monthly,
    monthly_quota: monthly.monthly_quota,
    seven_day_opus: null,
    seven_day_sonnet: null,
    seven_day_oauth_apps: null,
    seven_day_cowork: null,
    extra_usage: null,
    plan_type: monthly.plan_type,
  };
}
