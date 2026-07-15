/**
 * Codex plan utilization via ChatGPT's live WHAM usage API — same path as
 * OpenUsage (MIT, robinebers/openusage) and the Codex desktop client:
 *   GET https://chatgpt.com/backend-api/wham/usage
 *   POST https://auth.openai.com/oauth/token  (refresh)
 *
 * Auth: `~/.codex/auth.json` (or $CODEX_HOME/auth.json) written by `codex login`.
 * API-key-only auth cannot read subscription usage.
 *
 * Why not session JSONL: token_count.rate_limits in rollouts only update when
 * Codex runs a turn. After a weekly reset (or claimed reset credit) the last
 * rollout can stay stuck at the pre-reset % until the next session — which is
 * how Fleetlens previously showed 53% while the live account was ~0–2%.
 *
 * Window classification follows OpenUsage: prefer limit_window_seconds (or
 * window_minutes) over primary/secondary slot order, because Codex can put a
 * sole weekly window in primary when the 5h limit is absent.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UsageSnapshot, UsageWindow } from "./api.js";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const REFRESH_URL = "https://auth.openai.com/oauth/token";
/** Public OAuth client id used by Codex CLI / OpenUsage. */
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const FIVE_HOUR_SECONDS = 5 * 60 * 60;
const SEVEN_DAY_SECONDS = 7 * 24 * 60 * 60;
/** Refresh when access JWT is within this many ms of exp (OpenUsage / codex CLI). */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export class CodexApiError extends Error {
  constructor(
    message: string,
    readonly code: "no_auth" | "http" | "parse" | "network" | "api_key_only",
  ) {
    super(message);
  }
}

type CodexTokens = {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  account_id?: string;
};

type CodexAuthFile = {
  tokens?: CodexTokens;
  last_refresh?: string;
  OPENAI_API_KEY?: string;
};

function codexHome(): string {
  const env = process.env.CODEX_HOME?.trim();
  if (env) return env;
  return path.join(os.homedir(), ".codex");
}

function authPath(): string {
  return path.join(codexHome(), "auth.json");
}

function loadAuth(): { auth: CodexAuthFile; path: string } {
  const p = authPath();
  if (!existsSync(p)) {
    throw new CodexApiError(
      "Codex not logged in. Run `codex` to authenticate.",
      "no_auth",
    );
  }
  let auth: CodexAuthFile;
  try {
    auth = JSON.parse(readFileSync(p, "utf8")) as CodexAuthFile;
  } catch {
    throw new CodexApiError(
      "Codex auth.json is unreadable. Run `codex` to log in again.",
      "no_auth",
    );
  }
  const access = auth.tokens?.access_token?.trim();
  if (!access) {
    if (auth.OPENAI_API_KEY?.trim()) {
      throw new CodexApiError(
        "Codex usage is not available for API-key-only auth. Sign in with a ChatGPT account via `codex`.",
        "api_key_only",
      );
    }
    throw new CodexApiError(
      "Codex auth has no access token. Run `codex` to log in.",
      "no_auth",
    );
  }
  return { auth, path: p };
}

/** JWT exp claim in ms, or null when not a decodable JWT. */
export function accessTokenExpiresAtMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const pad = "=".repeat((4 - (parts[1]!.length % 4)) % 4);
    const json = Buffer.from(parts[1]! + pad, "base64url").toString("utf8");
    const payload = JSON.parse(json) as { exp?: unknown };
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
      return null;
    }
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

/**
 * Whether the access token should be proactively refreshed.
 * Prefers JWT `exp` (with a 5-minute buffer); falls back to an 8-day
 * wall-clock age on `last_refresh` only when the token isn't a decodable JWT.
 * Exported for unit tests.
 */
export function needsRefresh(
  accessToken: string,
  lastRefresh?: string,
  nowMs: number = Date.now(),
): boolean {
  const expMs = accessTokenExpiresAtMs(accessToken);
  if (expMs !== null) {
    return nowMs >= expMs - REFRESH_BUFFER_MS;
  }
  // Fallback when JWT exp is unreadable: only refresh if last_refresh is >8d old
  // (OpenUsage's wall-clock fallback). Brand-new login without last_refresh: no.
  if (!lastRefresh) return false;
  const ms = Date.parse(lastRefresh);
  if (!Number.isFinite(ms)) return false;
  return nowMs - ms > 8 * 24 * 60 * 60 * 1000;
}

type RefreshResult = {
  accessToken: string;
  /** Updated auth (in-memory + best-effort on disk) so a later retry uses the rotated refresh_token. */
  auth: CodexAuthFile;
};

async function refreshAccessToken(
  auth: CodexAuthFile,
  filePath: string,
): Promise<RefreshResult | null> {
  const refresh = auth.tokens?.refresh_token?.trim();
  if (!refresh) return null;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
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
      id_token?: string;
    };
    if (typeof j.access_token !== "string" || !j.access_token) return null;
    const next: CodexAuthFile = {
      ...auth,
      tokens: {
        ...auth.tokens,
        access_token: j.access_token,
        refresh_token: j.refresh_token ?? auth.tokens?.refresh_token,
        id_token: j.id_token ?? auth.tokens?.id_token,
      },
      last_refresh: new Date().toISOString(),
    };
    // Best-effort write-back so subsequent polls (and Codex CLI) share the rotation.
    try {
      writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
    } catch {
      // Non-fatal — in-memory token still works for this poll.
    }
    return { accessToken: j.access_token, auth: next };
  } catch {
    return null;
  }
}

function authHeaders(accessToken: string, accountId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "User-Agent": "fleetlens",
  };
  if (accountId?.trim()) {
    headers["ChatGPT-Account-Id"] = accountId.trim();
  }
  return headers;
}

type WindowRaw = {
  used_percent?: unknown;
  limit_window_seconds?: unknown;
  window_minutes?: unknown;
  reset_at?: unknown;
  reset_after_seconds?: unknown;
  resets_at?: unknown;
};

function numberOf(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function windowSeconds(raw: WindowRaw | null | undefined): number | undefined {
  if (!raw) return undefined;
  const sec = numberOf(raw.limit_window_seconds);
  if (sec !== undefined) return sec;
  const minutes = numberOf(raw.window_minutes);
  if (minutes !== undefined) return minutes * 60;
  return undefined;
}

function normalizeWindow(
  raw: WindowRaw | null | undefined,
  headerPercent: number | undefined,
  nowMs: number,
): UsageWindow | null {
  const used = numberOf(raw?.used_percent) ?? headerPercent;
  if (used === undefined) return null;

  let resetsAt: string | null = null;
  const resetUnix = numberOf(raw?.reset_at) ?? numberOf(raw?.resets_at);
  if (resetUnix !== undefined) {
    resetsAt = new Date(resetUnix * 1000).toISOString();
  } else {
    const after = numberOf(raw?.reset_after_seconds);
    if (after !== undefined) {
      resetsAt = new Date(nowMs + after * 1000).toISOString();
    }
  }

  return {
    utilization: Math.min(100, Math.max(0, used)),
    resets_at: resetsAt,
  };
}

type ClassifiedWindows = {
  five_hour: UsageWindow;
  seven_day: UsageWindow;
  plan_type: string | null;
};

/**
 * Pure decoder for the WHAM usage body (+ optional response headers).
 * Unit-tested without network.
 */
export function parseCodexWhamUsage(
  body: unknown,
  headers: Record<string, string | null | undefined> = {},
  nowMs: number = Date.now(),
): ClassifiedWindows {
  if (!body || typeof body !== "object") {
    throw new CodexApiError("Codex usage response missing body", "parse");
  }
  const b = body as Record<string, unknown>;
  const rateLimit =
    b.rate_limit && typeof b.rate_limit === "object"
      ? (b.rate_limit as Record<string, unknown>)
      : {};

  const headerPrimary = numberOf(headers["x-codex-primary-used-percent"]);
  const headerSecondary = numberOf(headers["x-codex-secondary-used-percent"]);

  const primary =
    rateLimit.primary_window && typeof rateLimit.primary_window === "object"
      ? (rateLimit.primary_window as WindowRaw)
      : null;
  const secondary =
    rateLimit.secondary_window && typeof rateLimit.secondary_window === "object"
      ? (rateLimit.secondary_window as WindowRaw)
      : null;

  type Candidate = {
    raw: WindowRaw | null;
    headerPercent: number | undefined;
    fallback: "five_hour" | "seven_day";
  };
  const candidates: Candidate[] = [
    { raw: primary, headerPercent: headerPrimary, fallback: "five_hour" },
    { raw: secondary, headerPercent: headerSecondary, fallback: "seven_day" },
  ];

  let fiveHour: UsageWindow | null = null;
  let sevenDay: UsageWindow | null = null;

  // First pass: exact duration classification (OpenUsage's primary contract).
  for (const c of candidates) {
    const secs = windowSeconds(c.raw);
    const window = normalizeWindow(c.raw, c.headerPercent, nowMs);
    if (!window) continue;
    if (secs === FIVE_HOUR_SECONDS) fiveHour = window;
    else if (secs === SEVEN_DAY_SECONDS) sevenDay = window;
  }

  // Second pass: unknown duration → historical primary=5h / secondary=7d slots.
  if (!fiveHour || !sevenDay) {
    for (const c of candidates) {
      const secs = windowSeconds(c.raw);
      if (secs === FIVE_HOUR_SECONDS || secs === SEVEN_DAY_SECONDS) continue;
      const window = normalizeWindow(c.raw, c.headerPercent, nowMs);
      if (!window) continue;
      if (c.fallback === "five_hour" && !fiveHour) fiveHour = window;
      else if (c.fallback === "seven_day" && !sevenDay) sevenDay = window;
    }
  }

  const planRaw = b.plan_type;
  const planType =
    typeof planRaw === "string" && planRaw.trim() ? planRaw.trim() : null;

  return {
    five_hour: fiveHour ?? { utilization: null, resets_at: null },
    seven_day: sevenDay ?? { utilization: null, resets_at: null },
    plan_type: planType,
  };
}

async function fetchUsageResponse(
  accessToken: string,
  accountId?: string,
): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
  let res: Response;
  try {
    res = await fetch(USAGE_URL, {
      headers: authHeaders(accessToken, accountId),
    });
  } catch (err) {
    throw new CodexApiError(
      `Network error reaching Codex usage: ${(err as Error).message}`,
      "network",
    );
  }
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // leave null — parse layer will error if needed
  }
  return { status: res.status, body, headers };
}

/**
 * Poll Codex live plan windows. Prefer this over transcript scraping so
 * weekly resets and claimed reset credits show up without a new Codex turn.
 */
export async function fetchCodexUsage(): Promise<UsageSnapshot> {
  const loaded = loadAuth();
  // Keep auth in memory so a rotated refresh_token from the first refresh
  // is used if we need a second refresh on 401/403 (disk write alone isn't enough).
  let auth = loaded.auth;
  let access = auth.tokens!.access_token!.trim();
  const accountId = auth.tokens?.account_id;

  if (needsRefresh(access, auth.last_refresh)) {
    const refreshed = await refreshAccessToken(auth, loaded.path);
    if (refreshed) {
      access = refreshed.accessToken;
      auth = refreshed.auth;
    }
  }

  let { status, body, headers } = await fetchUsageResponse(access, accountId);
  if (status === 401 || status === 403) {
    // One refresh-and-retry, matching OpenUsage's ProviderAuthRetry.
    const refreshed = await refreshAccessToken(auth, loaded.path);
    if (refreshed) {
      access = refreshed.accessToken;
      auth = refreshed.auth;
      ({ status, body, headers } = await fetchUsageResponse(access, accountId));
    }
  }
  if (status < 200 || status >= 300) {
    throw new CodexApiError(
      `Codex usage returned HTTP ${status}`,
      status === 401 || status === 403 ? "no_auth" : "http",
    );
  }

  const windows = parseCodexWhamUsage(body, headers);
  return {
    captured_at: new Date().toISOString(),
    agent: "codex",
    five_hour: windows.five_hour,
    seven_day: windows.seven_day,
    seven_day_opus: null,
    seven_day_sonnet: null,
    seven_day_oauth_apps: null,
    seven_day_cowork: null,
    extra_usage: null,
    plan_type: windows.plan_type,
  };
}
