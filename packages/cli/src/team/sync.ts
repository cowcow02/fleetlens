import { readTeamConfig, writeTeamConfig, type TeamConfig } from "./config.js";
import {
  buildIngestPayload,
  buildRichBlocksForDay,
  buildRollupsForRange,
  pushToTeamServer,
  readLatestUsageSnapshotForWire,
  type IngestPayload,
} from "./push.js";
import { enqueuePayload, dequeuePayloads } from "./queue.js";
import { runTeamBackfill, type BackfillOutcome } from "./backfill.js";
import { getPlanTier } from "../usage/profile.js";
import { cclensPath } from "@claude-lens/parser/fs";

const USAGE_LOG = cclensPath("usage.jsonl");
const PROFILE_CACHE = cclensPath("profile.json");

type LogFn = (level: "info" | "warn" | "error", message: string) => void;

const noopLog: LogFn = () => {};

export type SyncOutcome = {
  paired: boolean;
  pushed: number;
  queued: number;
  queuedDrained: number;
  usageBackfill?: BackfillOutcome;
  failedDay?: string;
  error?: string;
};

export type TeamSyncOptions = {
  forceUsageBackfill?: boolean;
};

export async function runTeamSync(
  log: LogFn = noopLog,
  configOverride?: TeamConfig | null,
  options: TeamSyncOptions = {},
): Promise<SyncOutcome> {
  const config = configOverride === undefined ? readTeamConfig() : configOverride;
  if (!config) return { paired: false, pushed: 0, queued: 0, queuedDrained: 0 };

  try {
    const { listSessions, loadCalibrationCurve } = await import("@claude-lens/parser/fs");
    const { toLocalDay, sessionDay } = await import("@claude-lens/parser");
    const today = toLocalDay(Date.now());
    let nextConfig: TeamConfig = { ...config };

    const persistConfig = (patch: Partial<TeamConfig>) => {
      nextConfig = { ...nextConfig, ...patch };
      writeTeamConfig(nextConfig);
    };

    const usageBackfill = await runTeamBackfill(log, USAGE_LOG, config, {
      sinceCapturedAt: options.forceUsageBackfill
        ? undefined
        : config.lastSyncedUsageSnapshotAt,
    });
    if (usageBackfill.lastSnapshotAt) {
      persistConfig({ lastSyncedUsageSnapshotAt: usageBackfill.lastSnapshotAt });
    }

    const sessions = await listSessions({ limit: 10_000 });
    const rollups = buildRollupsForRange(sessions, config.lastSyncedDay);

    // Snapshot represents *current* utilization, not historical days. Attach
    // only to the most recent rollup so a multi-day backfill doesn't repeat
    // the same captured_at across older days.
    const usageSnapshot = readLatestUsageSnapshotForWire(USAGE_LOG) ?? undefined;
    // Tier is membership-level metadata; tag every push so the server can
    // self-correct if it changes (admin upgraded mid-week, etc.). Cached on
    // disk to avoid hammering Anthropic's profile endpoint.
    const planTier = (await getPlanTier(PROFILE_CACHE).catch(() => null)) ?? undefined;
    // Per-cycle peaks computed locally — same logic that drives the personal
    // /usage trend strip. Pushing the COMPUTED OUTCOME keeps the team server
    // free of any prediction math: it stores and renders, never derives.
    const cyclePeaks = await buildCyclePeaksForPush(planTier, loadCalibrationCurve);

    if (rollups.length === 0) {
      // No new daily activity (idle day / weekend) — but the daemon polls
      // /api/oauth/usage every 5 minutes regardless, so we still push the
      // fresh snapshot / tier / cyclePeaks so the team server's live views
      // don't freeze.
      const hasLiveData = Boolean(usageSnapshot || planTier || cyclePeaks);
      if (!hasLiveData) {
        if (usageBackfill.sentSnapshots === 0) log("info", "team push: nothing to sync");
        return { paired: true, pushed: 0, queued: 0, queuedDrained: 0, usageBackfill };
      }
      const payload = buildIngestPayload({ usageSnapshot, planTier, cyclePeaks });
      const result = await pushToTeamServer(config, payload);
      if (!result.ok) {
        log("warn", `team push (live-only) failed (${result.status}); queueing`);
        enqueuePayload(payload);
        return { paired: true, pushed: 0, queued: 1, queuedDrained: 0, usageBackfill };
      }
      // Try to drain any queued backlog while the server is reachable.
      let queuedDrained = 0;
      const backlog = dequeuePayloads() as IngestPayload[];
      for (let i = 0; i < backlog.length; i++) {
        const qResult = await pushToTeamServer(config, backlog[i]);
        if (!qResult.ok) {
          for (const remaining of backlog.slice(i)) enqueuePayload(remaining);
          break;
        }
        queuedDrained++;
      }
      log("info", `team push ok: live-only (no new daily activity)` +
        (queuedDrained ? `, ${queuedDrained} queued retried` : ""));
      return { paired: true, pushed: 1, queued: 0, queuedDrained, usageBackfill };
    }

    let pushed = 0;
    let queued = 0;
    let failedDay: string | undefined;
    let lastPushedDay: string | undefined;

    const privateProjects = new Set(config.privateProjects ?? []);
    const enrichmentOptIn = !!config.enrichmentOptIn;

    for (let i = 0; i < rollups.length; i++) {
      const rollup = rollups[i]!;
      const isLatest = i === rollups.length - 1;
      const daySessions = sessions.filter((s) => sessionDay(s) === rollup.day);
      const richBlocks = buildRichBlocksForDay(
        rollup.day,
        daySessions,
        privateProjects,
        enrichmentOptIn,
      );
      const payload = buildIngestPayload({
        rollup,
        richExtras: richBlocks?.rich,
        enrichedExtras: richBlocks?.enriched,
        usageSnapshot: isLatest ? usageSnapshot : undefined,
        planTier,
        // Same rationale as usageSnapshot — current cycle data only on the
        // latest rollup so older days don't get tagged with today's peaks.
        cyclePeaks: isLatest ? cyclePeaks : undefined,
      });
      const result = await pushToTeamServer(config, payload);
      if (!result.ok) {
        log("warn", `team push failed on ${rollup.day} (${result.status}); queueing`);
        enqueuePayload(payload);
        queued++;
        failedDay = rollup.day;
        break;
      }
      pushed++;
      lastPushedDay = rollup.day;
    }

    if (failedDay) {
      if (lastPushedDay) persistConfig({ lastSyncedDay: lastPushedDay });
    } else {
      persistConfig({ lastSyncedDay: today });
    }

    let queuedDrained = 0;
    if (!failedDay) {
      const backlog = dequeuePayloads() as IngestPayload[];
      for (let i = 0; i < backlog.length; i++) {
        const qResult = await pushToTeamServer(config, backlog[i]);
        if (!qResult.ok) {
          for (const remaining of backlog.slice(i)) enqueuePayload(remaining);
          break;
        }
        queuedDrained++;
      }
    }

    if (pushed > 0) {
      log("info", `team push ok: ${pushed} day${pushed === 1 ? "" : "s"} pushed` +
        (queuedDrained ? `, ${queuedDrained} queued retried` : "") +
        (queued ? `, ${queued} queued for retry` : ""));
    }

    return { paired: true, pushed, queued, queuedDrained, usageBackfill, failedDay };
  } catch (err) {
    const message = (err as Error).message;
    log("warn", `team push error: ${message}`);
    return { paired: true, pushed: 0, queued: 0, queuedDrained: 0, error: message };
  }
}

// Build the cycle-peaks block in the same shape the server expects. Wraps
// loadCalibrationCurve so the import stays in one place; tier-aware so the
// rate constants match the user's actual subscription. Returns undefined
// when no JSONL data is available (cold-start before any session exists).
async function buildCyclePeaksForPush(
  planTier: string | undefined,
  loadCurve: typeof import("@claude-lens/parser/fs").loadCalibrationCurve,
): Promise<import("./push.js").WireCyclePeaks | undefined> {
  const validTiers = ["pro", "pro-max", "pro-max-20x", "custom"] as const;
  const tier = validTiers.find((t) => t === planTier) ?? "pro-max-20x";
  const dump = await loadCurve(tier).catch(() => null);
  if (!dump || dump.curve.length === 0) return undefined;

  const HOUR = 3_600_000;
  const nowMs = Date.now();
  const peaksFor = (
    cycleKey: "cycle_end_5h" | "cycle_end_7d",
    realKey: "real_5h" | "real_7d",
    predKey: "pred_5h" | "pred_7d",
    maxCycles: number,
  ): import("./push.js").WireCyclePeak[] => {
    // Hour-round + window-specific merge tolerance — mirrors
    // previousCyclesTrend in apps/web/lib/calibration-data.ts. The 7-day
    // window's anchor can slide a few hours within the same cycle, which
    // otherwise renders as two bars labeled the same day. 5h cycles have a
    // stable anchor, so no merging beyond hour-rounding (distinct 5h
    // cycles are only 5 h apart and would collapse under a wider window).
    const TOLERANCE_MS = cycleKey === "cycle_end_7d" ? 12 * HOUR : 0;
    const byCycle = new Map<number, typeof dump.curve>();
    for (const p of dump.curve) {
      const k = p[cycleKey];
      if (!k) continue;
      const ms = Date.parse(k);
      if (Number.isNaN(ms)) continue;
      const bucket = Math.round(ms / HOUR) * HOUR;
      const arr = byCycle.get(bucket) ?? [];
      arr.push(p);
      byCycle.set(bucket, arr);
    }
    const merged: Array<{ endMs: number; points: typeof dump.curve }> = [];
    for (const [endMs, points] of Array.from(byCycle.entries()).sort((a, b) => a[0] - b[0])) {
      const last = merged[merged.length - 1];
      if (last && endMs - last.endMs <= TOLERANCE_MS) {
        last.endMs = endMs;
        last.points.push(...points);
      } else {
        merged.push({ endMs, points: [...points] });
      }
    }
    const out: import("./push.js").WireCyclePeak[] = [];
    for (const { endMs, points } of merged) {
      // Take the max across BOTH real and predicted — when the daemon goes
      // dark before cycle close, the cycle's true peak is the predicted
      // close, not the last poll. Mirrors previousCyclesTrend in the
      // personal /usage chart.
      let peak = 0;
      let source: "real" | "predicted" = "predicted";
      for (const p of points) {
        const r = p[realKey];
        if (typeof r === "number" && r > peak) { peak = r; source = "real"; }
        const v = p[predKey] ?? 0;
        if (v > peak) { peak = v; source = "predicted"; }
      }
      out.push({
        endsAt: new Date(endMs).toISOString(),
        peakPct: Math.round(peak * 10) / 10,
        source,
        current: endMs > nowMs,
      });
    }
    return out.slice(-maxCycles);
  };

  return {
    fiveHour: peaksFor("cycle_end_5h", "real_5h", "pred_5h", 24),
    sevenDay: peaksFor("cycle_end_7d", "real_7d", "pred_7d", 12),
  };
}
