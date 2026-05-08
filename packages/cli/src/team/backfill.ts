import { homedir } from "node:os";
import { join } from "node:path";
import { readSnapshots } from "../usage/storage.js";
import type { UsageSnapshot } from "../usage/api.js";
import { readTeamConfig, type TeamConfig } from "./config.js";
import type { WireUsageSnapshot, WireUsageWindow } from "./push.js";
import { getPlanTier } from "../usage/profile.js";

const USAGE_LOG = join(homedir(), ".cclens", "usage.jsonl");
const PROFILE_CACHE = join(homedir(), ".cclens", "profile.json");

// Server caps each batch (zod schema). Stay safely under so a few extra
// header bytes don't tip a payload over.
const BATCH_SIZE = 500;

type LogFn = (level: "info" | "warn", message: string) => void;
const noopLog: LogFn = () => {};

export type BackfillOutcome = {
  paired: boolean;
  sentSnapshots: number;
  insertedSnapshots: number;
  skippedSnapshots: number;
  batches: number;
  error?: string;
};

function rawToWire(raw: UsageSnapshot): WireUsageSnapshot {
  const win = (
    w: { utilization: number | null; resets_at: string | null } | null,
  ): WireUsageWindow | null => (w ? { utilization: w.utilization, resetsAt: w.resets_at } : null);

  return {
    capturedAt: raw.captured_at,
    fiveHour: { utilization: raw.five_hour.utilization, resetsAt: raw.five_hour.resets_at },
    sevenDay: { utilization: raw.seven_day.utilization, resetsAt: raw.seven_day.resets_at },
    sevenDayOpus: win(raw.seven_day_opus),
    sevenDaySonnet: win(raw.seven_day_sonnet),
    sevenDayOauthApps: win(raw.seven_day_oauth_apps),
    sevenDayCowork: win(raw.seven_day_cowork),
    extraUsage: raw.extra_usage
      ? {
          isEnabled: raw.extra_usage.is_enabled,
          monthlyLimitUsd: raw.extra_usage.monthly_limit,
          usedCreditsUsd: raw.extra_usage.used_credits,
          utilization: raw.extra_usage.utilization,
        }
      : null,
  };
}

export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function postBatch(
  config: TeamConfig,
  snapshots: WireUsageSnapshot[],
  planTier?: string,
): Promise<{ inserted: number; skipped: number; status: number }> {
  const res = await fetch(`${config.serverUrl}/api/ingest/usage-history`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.bearerToken}`,
    },
    body: JSON.stringify({ snapshots, ...(planTier ? { planTier } : {}) }),
  });
  if (!res.ok) {
    return { inserted: 0, skipped: snapshots.length, status: res.status };
  }
  const body = (await res.json().catch(() => ({}))) as { inserted?: number; skipped?: number };
  return {
    inserted: body.inserted ?? 0,
    skipped: body.skipped ?? 0,
    status: res.status,
  };
}

export async function runTeamBackfill(
  log: LogFn = noopLog,
  filePath: string = USAGE_LOG,
  configOverride?: TeamConfig | null,
): Promise<BackfillOutcome> {
  const config = configOverride === undefined ? readTeamConfig() : configOverride;
  if (!config) {
    return { paired: false, sentSnapshots: 0, insertedSnapshots: 0, skippedSnapshots: 0, batches: 0 };
  }

  const raw = readSnapshots(filePath);
  // Only push claude-code snapshots: plan_utilization has no agent column,
  // so mixing agents (codex resets May 15, claude resets May 11) would make
  // the burndown flip-flop based on whichever agent polled most recently.
  // Legacy snapshots without an agent field were claude-code by design.
  const claudeOnly = raw.filter((s) => !s.agent || s.agent === "claude-code");
  if (claudeOnly.length === 0) {
    log("info", "team backfill: no usage snapshots to send");
    return { paired: true, sentSnapshots: 0, insertedSnapshots: 0, skippedSnapshots: 0, batches: 0 };
  }

  const wire = claudeOnly.map(rawToWire);
  const batches = chunk(wire, BATCH_SIZE);
  const planTier = (await getPlanTier(PROFILE_CACHE).catch(() => null)) ?? undefined;

  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    try {
      const result = await postBatch(config, batch, planTier);
      if (result.status >= 400) {
        log("warn", `team backfill: batch ${i + 1}/${batches.length} failed (${result.status})`);
        return {
          paired: true,
          sentSnapshots: wire.length,
          insertedSnapshots: inserted,
          skippedSnapshots: skipped,
          batches: i,
          error: `HTTP ${result.status}`,
        };
      }
      inserted += result.inserted;
      skipped += result.skipped;
    } catch (err) {
      log("warn", `team backfill: batch ${i + 1}/${batches.length} error: ${(err as Error).message}`);
      return {
        paired: true,
        sentSnapshots: wire.length,
        insertedSnapshots: inserted,
        skippedSnapshots: skipped,
        batches: i,
        error: (err as Error).message,
      };
    }
  }

  log(
    "info",
    `team backfill: ${inserted} new, ${skipped} already-known across ${batches.length} batch${batches.length === 1 ? "" : "es"}`,
  );
  return {
    paired: true,
    sentSnapshots: wire.length,
    insertedSnapshots: inserted,
    skippedSnapshots: skipped,
    batches: batches.length,
  };
}
