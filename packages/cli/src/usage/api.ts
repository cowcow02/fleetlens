import { readOAuthCredentials } from "./token.js";

/**
 * Treat a token as already-expired this many ms before its nominal expiry.
 * Small skew so we don't fire a request the exact second it dies.
 */
const EXPIRY_SKEW_MS = 60 * 1000;

/**
 * Claude Code's internal usage endpoint. Same data source as the `/usage`
 * slash command. Requires the OAuth token (user:profile scope) issued by
 * modern Claude Code versions and an explicit beta header.
 */
const USAGE_ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const BETA_HEADER = "oauth-2025-04-20";

export type UsageWindow = {
  utilization: number | null;
  resets_at: string | null;
};

export type ExtraUsage = {
  is_enabled: boolean;
  monthly_limit: number | null;
  used_credits: number | null;
  utilization: number | null;
};

export type UsageSnapshot = {
  /** When we captured this snapshot (client-side ISO timestamp) */
  captured_at: string;
  five_hour: UsageWindow;
  seven_day: UsageWindow;
  seven_day_opus: UsageWindow | null;
  seven_day_sonnet: UsageWindow | null;
  seven_day_oauth_apps: UsageWindow | null;
  seven_day_cowork: UsageWindow | null;
  extra_usage: ExtraUsage | null;
};

export class UsageApiError extends Error {
  constructor(
    message: string,
    readonly code: "no_token" | "expired" | "http" | "parse" | "network",
  ) {
    super(message);
  }
}

export async function fetchUsage(): Promise<UsageSnapshot> {
  const creds = readOAuthCredentials();
  if (!creds) {
    throw new UsageApiError(
      "No Claude Code OAuth token found. Run `claude` to log in first.",
      "no_token",
    );
  }

  if (creds.expiresAt - EXPIRY_SKEW_MS <= Date.now()) {
    throw new UsageApiError(
      "Claude Code OAuth token expired. Open Claude Code to refresh it.",
      "expired",
    );
  }

  let res: Response;
  try {
    res = await fetch(USAGE_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "anthropic-beta": BETA_HEADER,
      },
    });
  } catch (err) {
    throw new UsageApiError(
      `Network error reaching Anthropic: ${(err as Error).message}`,
      "network",
    );
  }

  if (!res.ok) {
    throw new UsageApiError(
      `Usage endpoint returned ${res.status} ${res.statusText}`,
      "http",
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    throw new UsageApiError(`Failed to parse usage response: ${(err as Error).message}`, "parse");
  }

  const b = body as Record<string, unknown>;
  return {
    captured_at: new Date().toISOString(),
    five_hour: normalizeWindow(b.five_hour) ?? { utilization: null, resets_at: null },
    seven_day: normalizeWindow(b.seven_day) ?? { utilization: null, resets_at: null },
    seven_day_opus: normalizeWindow(b.seven_day_opus),
    seven_day_sonnet: normalizeWindow(b.seven_day_sonnet),
    seven_day_oauth_apps: normalizeWindow(b.seven_day_oauth_apps),
    seven_day_cowork: normalizeWindow(b.seven_day_cowork),
    extra_usage: normalizeExtra(b.extra_usage),
  };
}

function normalizeWindow(raw: unknown): UsageWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    utilization: typeof r.utilization === "number" ? r.utilization : null,
    resets_at: typeof r.resets_at === "string" ? r.resets_at : null,
  };
}

function normalizeExtra(raw: unknown): ExtraUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    is_enabled: r.is_enabled === true,
    monthly_limit: typeof r.monthly_limit === "number" ? r.monthly_limit : null,
    used_credits: typeof r.used_credits === "number" ? r.used_credits : null,
    utilization: typeof r.utilization === "number" ? r.utilization : null,
  };
}
