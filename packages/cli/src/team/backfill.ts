import { randomUUID } from "node:crypto";
import { readSnapshots } from "../usage/storage.js";
import type { UsageSnapshot } from "../usage/api.js";
import { readTeamConfig, type TeamConfig } from "./config.js";
import { pushToTeamServer, type IngestPayload, type WireUsageSnapshot, type WireUsageWindow } from "./push.js";
import { getPlanTier } from "../usage/profile.js";
import { cclensPath } from "@claude-lens/parser/fs";

const USAGE_LOG = cclensPath("usage.jsonl");
const PROFILE_CACHE = cclensPath("profile.json");

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
  lastSnapshotAt?: string;
  error?: string;
};

export type BackfillOptions = {
  sinceCapturedAt?: string;
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
  const payload: IngestPayload = {
    ingestId: `backfill-${randomUUID()}`,
    observedAt: new Date().toISOString(),
    snapshotHistory: snapshots,
    ...(planTier ? { planTier } : {}),
  };
  const result = await pushToTeamServer(config, payload);
  if (!result.ok) {
    return { inserted: 0, skipped: snapshots.length, status: result.status };
  }
  const body = result.body as { snapshotHistory?: { inserted?: number; skipped?: number } } | null;
  if (!body?.snapshotHistory) {
    // 200 OK but no snapshotHistory result — older server image silently
    // dropped the field via zod passthrough. Throw so the outer loop aborts
    // without advancing lastSyncedUsageSnapshotAt, otherwise the rows would
    // never be retried after the server upgrades.
    throw new Error(
      "team server accepted snapshotHistory but did not return a result block — older image, upgrade required",
    );
  }
  return {
    inserted: body.snapshotHistory.inserted ?? 0,
    skipped: body.snapshotHistory.skipped ?? 0,
    status: result.status,
  };
}

// On full backfill (no high-water mark) a malformed captured_at falls through
// to the server; on incremental sync we skip it instead, because we can't
// order it against the HWM and including it would either re-send the same
// row each tick (if it sorts first) or stall the HWM. Skipping is the
// defensive choice — a malformed snapshot would be a JSONL corruption bug,
// not normal operation.
function isAfterSince(snapshot: UsageSnapshot, sinceCapturedAt: string | undefined): boolean {
  if (!sinceCapturedAt) return true;
  const sinceMs = Date.parse(sinceCapturedAt);
  if (Number.isNaN(sinceMs)) return true;
  const capturedMs = Date.parse(snapshot.captured_at);
  return !Number.isNaN(capturedMs) && capturedMs > sinceMs;
}

function capturedAtMs(snapshot: UsageSnapshot): number {
  const ms = Date.parse(snapshot.captured_at);
  return Number.isNaN(ms) ? Number.MAX_SAFE_INTEGER : ms;
}

function latestCapturedAt(snapshots: WireUsageSnapshot[]): string | undefined {
  let latest: { at: string; ms: number } | null = null;
  for (const s of snapshots) {
    const ms = Date.parse(s.capturedAt);
    if (Number.isNaN(ms)) continue;
    if (!latest || ms > latest.ms) latest = { at: s.capturedAt, ms };
  }
  return latest?.at;
}

export async function runTeamBackfill(
  log: LogFn = noopLog,
  filePath: string = USAGE_LOG,
  configOverride?: TeamConfig | null,
  options: BackfillOptions = {},
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
  const claudeOnly = raw.filter((s) =>
    (!s.agent || s.agent === "claude-code") &&
    isAfterSince(s, options.sinceCapturedAt)
  ).sort((a, b) => capturedAtMs(a) - capturedAtMs(b));
  if (claudeOnly.length === 0) {
    log("info", "team backfill: no usage snapshots to send");
    return { paired: true, sentSnapshots: 0, insertedSnapshots: 0, skippedSnapshots: 0, batches: 0 };
  }

  const wire = claudeOnly.map(rawToWire);
  const batches = chunk(wire, BATCH_SIZE);
  const planTier = (await getPlanTier(PROFILE_CACHE).catch(() => null)) ?? undefined;

  let inserted = 0;
  let skipped = 0;
  let lastSnapshotAt: string | undefined;
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
          lastSnapshotAt,
          error: `HTTP ${result.status}`,
        };
      }
      inserted += result.inserted;
      skipped += result.skipped;
      lastSnapshotAt = latestCapturedAt(batch) ?? lastSnapshotAt;
    } catch (err) {
      log("warn", `team backfill: batch ${i + 1}/${batches.length} error: ${(err as Error).message}`);
      return {
        paired: true,
        sentSnapshots: wire.length,
        insertedSnapshots: inserted,
        skippedSnapshots: skipped,
        batches: i,
        lastSnapshotAt,
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
    lastSnapshotAt,
  };
}
