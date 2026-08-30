/**
 * Server-only reader for the cclens usage metrics JSONL file.
 * The daemon writes to ~/.cclens/usage.jsonl every 5 minutes;
 * the dashboard reads the same file — no API endpoint needed.
 */

import "server-only";
import { cache } from "react";
import { existsSync, readFileSync } from "node:fs";
import type { AgentKind } from "@claude-lens/parser";
import { cclensPath } from "@claude-lens/parser/fs";

export type UsageWindow = {
  utilization: number | null;
  resets_at: string | null;
};

export type UsageSnapshot = {
  captured_at: string;
  /** Source agent. Absent on legacy snapshots written before multi-agent
   *  support — readers MUST treat undefined as "claude-code". */
  agent?: AgentKind;
  five_hour: UsageWindow;
  seven_day: UsageWindow;
  /** Monthly allowance, currently emitted by GitHub Copilot. */
  monthly?: UsageWindow | null;
  monthly_quota?: {
    used: number | null;
    limit: number | null;
    remaining: number | null;
    unit: "ai-credits" | "premium-requests" | "credits" | "usd";
    /** Raw Copilot SDK entitlement flag. It can mean no personal ceiling was
     *  disclosed for an organization pool, not that use is unbounded. */
    unlimited: boolean;
  } | null;
  seven_day_opus: UsageWindow | null;
  seven_day_sonnet: UsageWindow | null;
  seven_day_oauth_apps: UsageWindow | null;
  seven_day_cowork: UsageWindow | null;
  extra_usage: {
    is_enabled: boolean;
    monthly_limit: number | null;
    used_credits: number | null;
    utilization: number | null;
  } | null;
  plan_type?: string | null;
  /** Monthly web-search / web-reader / Zread quota. Z.ai-only. A
   *  percentage meter (used = 0–100, limit = 100), matching Z.ai's
   *  portal display — NOT a raw usage/remaining split. */
  web_search_quota?: { used: number | null; limit: number | null } | null;
};

function usageLogPath(): string {
  return process.env.CCLENS_USAGE_LOG || cclensPath("usage.jsonl");
}

export const readUsageSnapshots = cache((): UsageSnapshot[] => {
  const path = usageLogPath();
  if (!existsSync(path)) return [];
  const content = readFileSync(path, "utf8");
  const snapshots: UsageSnapshot[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      snapshots.push(JSON.parse(line) as UsageSnapshot);
    } catch {
      // Skip corrupt lines
    }
  }
  return snapshots;
});

/** Latest snapshot per agent (last line wins for each agent tag). */
export const latestUsageSnapshotsByAgent = cache((): Partial<Record<AgentKind, UsageSnapshot>> => {
  const all = readUsageSnapshots();
  const byAgent: Partial<Record<AgentKind, UsageSnapshot>> = {};
  for (const s of all) {
    const agent = (s.agent ?? "claude-code") as AgentKind;
    byAgent[agent] = s;
  }
  return byAgent;
});

/** Claude-only latest. Kept for callers that still want the default plan. */
export const latestUsageSnapshot = cache((): UsageSnapshot | null => {
  return latestUsageSnapshotsByAgent()["claude-code"] ?? null;
});

export const latestUsageSnapshotByAgent = cache(
  (agent: AgentKind): UsageSnapshot | null => {
    return latestUsageSnapshotsByAgent()[agent] ?? null;
  },
);

export const readUsageSnapshotsByAgent = cache(
  (agent: AgentKind): UsageSnapshot[] => {
    return readUsageSnapshots().filter((s) => (s.agent ?? "claude-code") === agent);
  },
);

// The CLI's profile cache mirrors what we report to a paired team-server.
// Reading it here keeps personal and team editions consistent — both show
// the same "what tier are we?" answer.
export type CachedPlanTier = {
  planTier: "pro" | "pro-max" | "pro-max-20x" | "custom";
  rateLimitTier: string | null;
  organizationType: string | null;
  fetchedAtMs: number;
};

export const readCachedPlanTier = cache((): CachedPlanTier | null => {
  const path = process.env.CCLENS_PROFILE_CACHE || cclensPath("profile.json");
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      fetchedAtMs?: number;
      profile?: { planTier?: string; rateLimitTier?: string | null; organizationType?: string | null };
    };
    if (!raw.profile?.planTier) return null;
    return {
      planTier: raw.profile.planTier as CachedPlanTier["planTier"],
      rateLimitTier: raw.profile.rateLimitTier ?? null,
      organizationType: raw.profile.organizationType ?? null,
      fetchedAtMs: typeof raw.fetchedAtMs === "number" ? raw.fetchedAtMs : 0,
    };
  } catch {
    return null;
  }
});

export const PLAN_TIER_LABELS: Record<CachedPlanTier["planTier"], { label: string; monthlyPriceUsd: number }> = {
  pro: { label: "Claude Pro", monthlyPriceUsd: 20 },
  "pro-max": { label: "Claude Pro Max", monthlyPriceUsd: 100 },
  "pro-max-20x": { label: "Claude Pro Max 20x", monthlyPriceUsd: 200 },
  custom: { label: "Custom plan", monthlyPriceUsd: 0 },
};
