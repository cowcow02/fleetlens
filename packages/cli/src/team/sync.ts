import { randomUUID } from "node:crypto";
import { readTeamConfig, writeTeamConfig, type TeamConfig } from "./config.js";
import {
  buildIngestPayload,
  buildRichBlocksForDay,
  buildRollupsForRange,
  pushToTeamServer,
  readLatestUsageSnapshotForWire,
  resetEnsuredSessions,
  sessionTouchesDay,
  type DailyRollup,
  type IngestPayload,
  type IngestResponse,
  type WireUsageSnapshot,
} from "./push.js";
import { createRepoResolver } from "./git-remote.js";
import { enqueuePayload, dequeuePayloads } from "./queue.js";
import { runTeamBackfill, type BackfillOutcome } from "./backfill.js";
import { readPendingSyncLog, type SyncLogLine } from "./sync-log.js";
import { writeLastPushSuccess, writeLastPushFailure } from "./last-push.js";
import { dispatchCommand, type ServerCommand, type CommandResult } from "./commands.js";
import { getPlanTier } from "../usage/profile.js";
import { cclensPath } from "@claude-lens/parser/fs";

// Process-scoped to prevent the same command from being dispatched twice
// when a long backfill spans multiple sync ticks (sync N+1 fires before
// N's dispatch completes). Within a single sync, collectedCommands is a
// Map keyed by id so the same pending command echoed in multiple push
// legs (rollup loop + queue drain) is only dispatched once. Both layers
// are needed: this Set survives across sync invocations, the Map does not.
// Lost on daemon restart, which is fine — the server will re-deliver.
const inFlightCommands = new Set<string>();

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
  // What kicked off this run — surfaced in the one-per-run [sync] summary
  // line so an operator (or an agent) can tell automatic ticks apart from a
  // catch-up or an operator-driven push: "auto" (the 5-min timer), "boot"
  // (first sync after the daemon starts), "pair" (the join backfill), and
  // "manual" (an explicit `fleetlens team sync`).
  trigger?: "auto" | "boot" | "pair" | "manual";
  // The scheduler's interval to the NEXT team sync, so the summary line can
  // print an accurate "next ~Nm" rather than a hardcoded guess.
  nextSyncMs?: number;
};

// Fixed leading status word of every uploaded [sync] line — the ONE token a
// human or an agent greps to know how the last sync went. Ordered by
// severity so the level mapping below is obvious:
//   ok       — rollups pushed clean
//   idle     — nothing new to push (live snapshot only / truly nothing)
//   degraded — pushed, but the server skipped a block or a day was dropped
//   failed   — a transient push error; queued for retry
//   error    — unrecoverable (validation-poison drop, or the run threw)
export type SyncStatus = "ok" | "idle" | "degraded" | "failed" | "error";

// Everything the one-per-run summary line reports. Accumulated across the run
// so a MIXED outcome (pushed 1 day, queued another) is not flattened to a
// single verb — the line shows both.
export type SyncSummary = {
  pushedDays: string[];
  droppedDays: string[];
  // Previously-dropped days re-accepted by the server this run (self-heal
  // after a server upgrade). Surfaced positively; does not affect status.
  recoveredDays?: string[];
  queued: number;
  queuedDay?: string;
  queuedStatus?: number;
  queuedDrained: number;
  idleReason?: string;
  live?: string;
  usageSnapshots: number;
  // The server's own verdict on the last successful push this run — which
  // data blocks it accepted vs. skipped (with reason). Closes the loop: the
  // member log shows both what the daemon sent AND what the server did with it.
  accepted?: string[];
  skipped?: Record<string, string>;
  errorMsg?: string;
};

// The server's block-level verdict on whether it ingested the syncLog block.
// A V1 server omits `blocks` entirely → treat as delivered. The watermark
// advances only when the CARRYING push was ok AND this returns true; otherwise
// the lines re-send next tick (server dedups on member,ts,msg).
function syncLogDelivered(body: IngestResponse | null): boolean {
  const blocks = body?.blocks;
  return !blocks || blocks.accepted.includes("syncLog");
}

function levelForStatus(s: SyncStatus): "info" | "warn" | "error" {
  if (s === "ok" || s === "idle") return "info";
  if (s === "degraded" || s === "failed") return "warn";
  return "error";
}

function fmtDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function liveSnapshotStr(snap: WireUsageSnapshot | undefined): string | undefined {
  if (!snap) return undefined;
  const f = snap.fiveHour?.utilization;
  const s = snap.sevenDay?.utilization;
  const parts = [
    typeof f === "number" ? `5h ${Math.round(f)}%` : null,
    typeof s === "number" ? `7d ${Math.round(s)}%` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" / ") : undefined;
}

// The single self-contained sync-log line the daemon writes per run and
// uploads to the Team Edition. Format: a fixed status word, then the trigger,
// then whatever actually happened this run as ` · `-separated attributes, so
// it stays human-readable while an agent can regex the leading `[sync] <word>`
// and the inline `key value` facts. Empty sections are omitted, not blanked.
export function buildSyncLine(
  status: SyncStatus,
  trigger: string,
  s: SyncSummary,
  elapsedMs: number,
  nextSyncMs: number | undefined,
): string {
  const parts: string[] = [`[sync] ${status}`, trigger];
  if (s.pushedDays.length) {
    parts.push(
      s.pushedDays.length === 1
        ? `pushed 1 day (${s.pushedDays[0]})`
        : `pushed ${s.pushedDays.length} days (${s.pushedDays[0]}→${s.pushedDays[s.pushedDays.length - 1]})`,
    );
  }
  if (s.queued) {
    parts.push(
      s.queuedDay
        ? `queued ${s.queued} for retry (${s.queuedDay}, HTTP ${s.queuedStatus})`
        : `queued ${s.queued} for retry`,
    );
  }
  if (s.droppedDays.length) {
    parts.push(`dropped ${s.droppedDays.length} unrecoverable (${s.droppedDays.join(",")})`);
  }
  if (s.recoveredDays?.length) {
    parts.push(
      `recovered ${s.recoveredDays.length} dropped day${s.recoveredDays.length === 1 ? "" : "s"} (${s.recoveredDays.join(",")})`,
    );
  }
  if (s.queuedDrained) parts.push(`drained ${s.queuedDrained} from backlog`);
  if (s.idleReason) parts.push(s.idleReason);
  if (s.live) parts.push(`live ${s.live}`);
  if (s.usageSnapshots > 0) {
    parts.push(`usage +${s.usageSnapshots} snapshot${s.usageSnapshots === 1 ? "" : "s"}`);
  }
  if (s.accepted?.length) parts.push(`server accepted ${s.accepted.join(",")}`);
  if (s.skipped && Object.keys(s.skipped).length) {
    parts.push(
      `server SKIPPED ${Object.entries(s.skipped)
        .map(([k, v]) => `${k} (${v})`)
        .join("; ")}`,
    );
  }
  if (s.errorMsg) parts.push(s.errorMsg);
  parts.push(fmtDuration(elapsedMs));
  if (nextSyncMs) parts.push(`next ~${Math.round(nextSyncMs / 60_000)}m`);
  return parts.join(" · ");
}

export async function runTeamSync(
  log: LogFn = noopLog,
  configOverride?: TeamConfig | null,
  options: TeamSyncOptions = {},
): Promise<SyncOutcome> {
  const config = configOverride === undefined ? readTeamConfig() : configOverride;
  if (!config) return { paired: false, pushed: 0, queued: 0, queuedDrained: 0 };

  // One-per-run [sync] summary line. Fields accumulate through the run; a
  // single `finish(status)` at each exit (including the catch) builds and
  // writes the line. It's read back off daemon.log at the START of a LATER
  // run (self-reference guard) and uploaded per-member — this IS the
  // member-side sync log. Declared outside the try so the catch can emit too.
  const startedAt = Date.now();
  const trigger = options.trigger ?? "auto";
  const summary: SyncSummary = {
    pushedDays: [],
    droppedDays: [],
    queued: 0,
    queuedDrained: 0,
    usageSnapshots: 0,
  };
  const finish = (status: SyncStatus): void => {
    log(
      levelForStatus(status),
      buildSyncLine(status, trigger, summary, Date.now() - startedAt, options.nextSyncMs),
    );
  };
  // Capture the server's block-level verdict from each successful push so the
  // line shows accepted vs. skipped. Accumulated (not last-wins) across the
  // multi-day loop: a skip on ANY day must survive to the status computation —
  // otherwise a later clean day would erase an earlier day's dropped block and
  // silently downgrade a degraded run to "ok". No-op against a V1 server that
  // omits `blocks`.
  const recordVerdict = (
    body: { blocks?: { accepted: string[]; skipped: Record<string, string> } } | null,
  ): void => {
    if (body?.blocks) {
      summary.accepted = [...new Set([...(summary.accepted ?? []), ...body.blocks.accepted])];
      summary.skipped = { ...summary.skipped, ...body.blocks.skipped };
    }
  };

  try {
    // Run-scoped: a transient read failure on one session must not poison it
    // for the daemon's lifetime — clear the attempted-set each run so the next
    // 5-min tick retries. Within-run dedupe across a multi-day backfill stands.
    resetEnsuredSessions();
    const { listSessions, loadCalibrationCurve } = await import("@claude-lens/parser/fs");
    const { toLocalDay } = await import("@claude-lens/parser");
    const today = toLocalDay(Date.now());
    let nextConfig: TeamConfig = { ...config };

    const persistConfig = (patch: Partial<TeamConfig>) => {
      nextConfig = { ...nextConfig, ...patch };
      writeTeamConfig(nextConfig);
    };

    // The daemon's own sync-log lines since the last successful upload, read
    // from daemon.log at the START of this run — so they describe PRIOR runs,
    // never the push that carries them (which hasn't happened / been logged
    // yet). Attached to the first push below; watermark advances only on that
    // push succeeding. These become this member's per-member "View logs".
    const pendingLog = readPendingSyncLog(config.lastSyncedLogAt);

    // Keyed by command id so a command echoed in multiple push responses
    // within this single sync is only collected (and dispatched) once.
    const collectedCommands = new Map<string, ServerCommand>();
    const collectCommands = (commands: ServerCommand[] | undefined): void => {
      if (!commands) return;
      for (const cmd of commands) {
        if (!collectedCommands.has(cmd.id)) collectedCommands.set(cmd.id, cmd);
      }
    };

    const dispatchAndReport = async (): Promise<void> => {
      try {
        if (collectedCommands.size === 0) return;
        const results: CommandResult[] = [];
        for (const cmd of collectedCommands.values()) {
          if (inFlightCommands.has(cmd.id)) continue;
          inFlightCommands.add(cmd.id);
          try {
            const result = await dispatchCommand(cmd, config, log);
            results.push(result);
          } finally {
            inFlightCommands.delete(cmd.id);
          }
        }
        if (results.length === 0) return;

        // Bare-results push: no rollup/snapshot/tier/cyclePeaks, just commandResults
        // so the server can mark the corresponding rows complete. Failure here is
        // non-fatal — the server will re-deliver on the next sync via the same
        // pending-commands query.
        const resultsPayload: IngestPayload = {
          ingestId: randomUUID(),
          observedAt: new Date().toISOString(),
          commandResults: results,
        };
        const r = await pushToTeamServer(config, resultsPayload);
        if (!r.ok) {
          log("warn", `team commandResults push failed (${r.status}); will retry on next sync`);
        } else {
          log("info", `team commandResults push ok: ${results.length} result${results.length === 1 ? "" : "s"}`);
        }
      } catch (err) {
        // Dispatcher errors must not reverse the main sync outcome. The server
        // re-delivers pending commands on the next sync, and any partially-pushed
        // backfill is idempotent on the server side (daily_rollups upsert).
        log("warn", `team command dispatch error: ${(err as Error).message}`);
      }
    };

    // A 4xx validation error (400/422) is unrecoverable: the same payload will
    // fail identically forever. Auth (401/403) and rate-limit (429) are NOT
    // day-specific and ARE recoverable, so they fall through to the transient
    // path (queue + retry). With the server's partial-success ingestion a
    // data-block error now returns 200, so this guards against a future
    // hard-4xx, not the common path.
    const isValidationPoison = (status: number): boolean => status === 400 || status === 422;

    // Drain queued payloads while the server is reachable. A queued item that
    // now fails with 4xx validation-poison is DROPPED (it would fail identically
    // forever and, worse, block every item behind it); a transient failure
    // re-enqueues the remainder and stops so ordering/backpressure is kept.
    const drainBacklog = async (): Promise<number> => {
      let drained = 0;
      const backlog = dequeuePayloads() as IngestPayload[];
      for (let i = 0; i < backlog.length; i++) {
        const qResult = await pushToTeamServer(config, backlog[i]!);
        if (!qResult.ok) {
          if (isValidationPoison(qResult.status)) {
            log("warn", `team push: queued payload rejected (HTTP ${qResult.status}); dropping unrecoverable item`);
            continue;
          }
          for (const remaining of backlog.slice(i)) enqueuePayload(remaining);
          break;
        }
        collectCommands(qResult.body?.commands);
        drained++;
      }
      return drained;
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
    // All day rollups, unfiltered — `rollups` is the new-days slice pushed by
    // the main loop; the full set is also indexed for the dropped-day retry,
    // whose target predates lastSyncedDay.
    const allRollups = buildRollupsForRange(sessions);
    const rollups = allRollups.filter((r) => !config.lastSyncedDay || r.day >= config.lastSyncedDay);

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
        summary.usageSnapshots = usageBackfill.sentSnapshots;
        if (usageBackfill.sentSnapshots > 0) {
          finish("ok");
        } else {
          summary.idleReason = "nothing to sync";
          finish("idle");
        }
        return { paired: true, pushed: 0, queued: 0, queuedDrained: 0, usageBackfill };
      }
      summary.usageSnapshots = usageBackfill.sentSnapshots;
      summary.live = liveSnapshotStr(usageSnapshot);
      const payload = buildIngestPayload({ usageSnapshot, planTier, cyclePeaks, syncLog: pendingLog.lines });
      const result = await pushToTeamServer(config, payload);
      if (!result.ok) {
        if (isValidationPoison(result.status)) {
          // Unrecoverable — queuing it would just wedge the drain loop forever.
          const errLine = `team push: live-only payload rejected (HTTP ${result.status}); dropping unrecoverable payload`;
          writeLastPushFailure(payload, errLine);
          summary.errorMsg = `live-snapshot push HTTP ${result.status} (validation) — dropped unrecoverable`;
          finish("error");
          return { paired: true, pushed: 0, queued: 0, queuedDrained: 0, usageBackfill };
        }
        const errLine = `team push failed (${result.status})`;
        writeLastPushFailure(payload, errLine);
        enqueuePayload(payload);
        summary.queued = 1;
        summary.errorMsg = `live-snapshot push HTTP ${result.status} — queued for retry`;
        finish("failed");
        return { paired: true, pushed: 0, queued: 1, queuedDrained: 0, usageBackfill };
      }
      writeLastPushSuccess(payload);
      // Advance the sync-log watermark only when THIS push carried the lines
      // AND the server accepted the block — else they re-send next tick.
      if (pendingLog.watermark && syncLogDelivered(result.body)) {
        persistConfig({ lastSyncedLogAt: pendingLog.watermark });
      }
      collectCommands(result.body?.commands);
      recordVerdict(result.body);
      // Try to drain any queued backlog while the server is reachable.
      const queuedDrained = await drainBacklog();
      summary.queuedDrained = queuedDrained;
      summary.idleReason = "no new daily activity";
      finish(summary.skipped && Object.keys(summary.skipped).length ? "degraded" : "idle");
      await dispatchAndReport();
      return { paired: true, pushed: 1, queued: 0, queuedDrained, usageBackfill };
    }

    let pushed = 0;
    let queued = 0;
    let failedDay: string | undefined;
    // The most recent day we RESOLVED — pushed successfully OR deliberately
    // skipped as validation-poison. lastSyncedDay never rewinds before it, so
    // a skipped poison day is not re-pushed on the next tick.
    let lastResolvedDay: string | undefined;
    // Days the server hard-4xx'd on a previous run, retried below. Start from
    // the persisted list; this run's own drops are appended in the loop.
    const droppedDaysBefore = config.droppedDays ?? [];
    const workingDropped = [...droppedDaysBefore];
    // Whether the push that CARRIED the sync-log block (i===0) landed AND the
    // server accepted the block. Only then may the watermark advance.
    let syncLogWasDelivered = false;

    const resolveRepo = createRepoResolver();

    const { probeArtifactSignals } = await import("../perception/file-probe.js");

    // Build the full ingest payload for one day — shared by the main loop and
    // the dropped-day retry so a recovered day resends the SAME rich shape the
    // server first rejected (not a base-only fallback that would falsely pass).
    const buildDayPayload = (
      rollup: DailyRollup,
      opts: { latest: boolean; syncLog?: SyncLogLine[] },
    ): IngestPayload => {
      const daySessions = sessions.filter((s) => sessionTouchesDay(s, rollup.day));
      const richBlocks = buildRichBlocksForDay(rollup.day, daySessions, resolveRepo);
      let artifactSignals: ReturnType<typeof probeArtifactSignals> = null;
      try {
        // Probe auto-detects git email from `git config user.email`.
        artifactSignals = probeArtifactSignals({ day: rollup.day, extraRoots: [process.cwd()] });
      } catch {
        // Probe is best-effort; never block the push path.
      }
      return buildIngestPayload({
        rollup,
        richExtras: richBlocks?.rich,
        enrichedExtras: richBlocks?.enriched,
        artifactSignals: artifactSignals ?? undefined,
        // Current-cycle data only on the latest day so older days aren't tagged
        // with today's snapshot / peaks.
        usageSnapshot: opts.latest ? usageSnapshot : undefined,
        planTier,
        cyclePeaks: opts.latest ? cyclePeaks : undefined,
        syncLog: opts.syncLog,
      });
    };

    for (let i = 0; i < rollups.length; i++) {
      const rollup = rollups[i]!;
      const isLatest = i === rollups.length - 1;
      // File-system probe (skill/sub-agent/CLAUDE.md authoring) rides inside
      // buildDayPayload. Sync-log rides the FIRST push only — it's not
      // day-specific.
      const payload = buildDayPayload(rollup, {
        latest: isLatest,
        syncLog: i === 0 ? pendingLog.lines : undefined,
      });
      const result = await pushToTeamServer(config, payload);
      if (!result.ok) {
        if (isValidationPoison(result.status)) {
          // Unrecoverable: skip past this day so the loop makes progress.
          // Don't queue (it would fail identically forever); don't set
          // failedDay (later days should still push). Persist the day so a
          // future server upgrade can retry it instead of losing it forever.
          const errLine = `team push: ${rollup.day} rejected (HTTP ${result.status}); skipping past unrecoverable day`;
          writeLastPushFailure(payload, errLine);
          summary.droppedDays.push(rollup.day);
          if (!workingDropped.includes(rollup.day)) workingDropped.push(rollup.day);
          lastResolvedDay = rollup.day;
          continue;
        }
        const errLine = `team push failed on ${rollup.day} (${result.status})`;
        writeLastPushFailure(payload, errLine);
        enqueuePayload(payload);
        queued++;
        summary.queuedDay = rollup.day;
        summary.queuedStatus = result.status;
        failedDay = rollup.day;
        break;
      }
      writeLastPushSuccess(payload);
      collectCommands(result.body?.commands);
      recordVerdict(result.body);
      // The i===0 push is the sync-log carrier; record whether the server
      // accepted the block so the watermark only advances on delivery.
      if (i === 0) syncLogWasDelivered = syncLogDelivered(result.body);
      pushed++;
      summary.pushedDays.push(rollup.day);
      lastResolvedDay = rollup.day;
    }

    // Retry AT MOST ONE previously-dropped day (oldest first, and not one just
    // dropped this run) while the server is reachable — a server upgrade then
    // self-heals the day. On success it leaves the list; on another hard-4xx
    // it stays for next tick; a transient failure also leaves it untouched.
    if (!failedDay) {
      const retryDay = [...droppedDaysBefore]
        .sort()
        .find((d) => !summary.droppedDays.includes(d));
      const retryRollup = retryDay ? allRollups.find((r) => r.day === retryDay) : undefined;
      if (retryDay && retryRollup) {
        const payload = buildDayPayload(retryRollup, { latest: false });
        const result = await pushToTeamServer(config, payload);
        if (result.ok) {
          writeLastPushSuccess(payload);
          collectCommands(result.body?.commands);
          recordVerdict(result.body);
          const idx = workingDropped.indexOf(retryDay);
          if (idx >= 0) workingDropped.splice(idx, 1);
          summary.recoveredDays = [retryDay];
        } else {
          writeLastPushFailure(payload, `team push: dropped-day retry ${retryDay} failed (HTTP ${result.status})`);
        }
      }
    }

    // Fold the dropped-day list into the same persist as lastSyncedDay so a
    // clean run still writes config exactly once. Dedup + keep the 90 most
    // recent; only write when the list actually changed.
    const nextDropped = [...new Set(workingDropped)].sort().slice(-90);
    const prevDropped = [...new Set(droppedDaysBefore)].sort();
    const droppedChanged =
      nextDropped.length !== prevDropped.length || nextDropped.some((d, i) => d !== prevDropped[i]);
    const droppedPatch: Partial<TeamConfig> = droppedChanged ? { droppedDays: nextDropped } : {};

    if (failedDay) {
      if (lastResolvedDay || droppedChanged) {
        persistConfig({ ...(lastResolvedDay ? { lastSyncedDay: lastResolvedDay } : {}), ...droppedPatch });
      }
    } else {
      persistConfig({ lastSyncedDay: today, ...droppedPatch });
    }
    // syncLog rode the first day's push (i===0); advance only if that push
    // landed AND the server accepted the block.
    if (syncLogWasDelivered && pendingLog.watermark) {
      persistConfig({ lastSyncedLogAt: pendingLog.watermark });
    }

    const queuedDrained = !failedDay ? await drainBacklog() : 0;

    summary.queued = queued;
    summary.queuedDrained = queuedDrained;
    summary.usageSnapshots = usageBackfill.sentSnapshots;
    // Status precedence: a queued day (transient failure) is the loudest
    // signal → "failed"; else a dropped day or a server-skipped block means
    // the push landed but incompletely → "degraded"; else clean → "ok".
    let status: SyncStatus;
    if (failedDay) status = "failed";
    else if (summary.droppedDays.length || (summary.skipped && Object.keys(summary.skipped).length)) status = "degraded";
    else status = "ok";
    finish(status);

    await dispatchAndReport();
    return { paired: true, pushed, queued, queuedDrained, usageBackfill, failedDay };
  } catch (err) {
    const message = (err as Error).message;
    summary.errorMsg = `sync aborted: ${message}`;
    finish("error");
    writeLastPushFailure(
      { ingestId: "n/a", observedAt: new Date().toISOString() },
      `team push error: ${message}`,
    );
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
    // 7d cycle history cap (26 ≈ six months) MUST stay in lock-step with two
    // downstream sites or the strip silently truncates: the server read
    // (loadMembership7dCyclePeaks maxCyclesPerMember in plan-queries.ts) and
    // the renderer (CyclePeaksStrip maxBars in member-plan-block.tsx). The 5h
    // cap (24) is independent — leave it.
    fiveHour: peaksFor("cycle_end_5h", "real_5h", "pred_5h", 24),
    sevenDay: peaksFor("cycle_end_7d", "real_7d", "pred_7d", 26),
  };
}
