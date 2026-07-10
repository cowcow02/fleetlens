import { randomUUID } from "node:crypto";
import { readTeamConfig, writeTeamConfig, type TeamConfig } from "./config.js";
import {
  buildIngestPayload,
  buildRichBlocksForDay,
  buildRollupsForRange,
  filterSyncedSessions,
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
import { projectKey } from "@claude-lens/parser";
import { cclensPath, resolveProjectIdentity, shouldSyncProject } from "@claude-lens/parser/fs";

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
  setupPending?: boolean;
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
  // Fired as the run progresses — the onboarding wizard's SSE relay pipes
  // these straight to `--progress-json` stdout lines; the daemon's normal
  // path leaves this unset.
  onProgress?: (ev: SyncProgressEvent) => void;
};

// One line per run, streamed via `fleetlens team sync --progress-json` for
// the onboarding wizard's live progress list. Not the [sync] summary line —
// that stays log-only.
export type SyncProgressEvent =
  | { type: "phase"; phase: "usage-backfill" | "activity"; totalDays?: number }
  | { type: "usage"; inserted: number; alreadyKnown: number }
  | { type: "day"; day: string; index: number; total: number; outcome: "pushed" | "queued" | "dropped" }
  | { type: "done"; pushed: number; queued: number; pushedDays: string[] }
  | { type: "error"; message: string };

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

  // Wizard gate: the join wrote config but the member hasn't confirmed the
  // project selection yet. Nothing may leave the machine until they do.
  if (config.setupPending) {
    log(
      "info",
      buildSyncLine(
        "idle",
        options.trigger ?? "auto",
        {
          pushedDays: [], droppedDays: [], queued: 0, queuedDrained: 0, usageSnapshots: 0,
          idleReason: "setup pending — finish onboarding in the dashboard (/team/onboarding)",
        },
        0,
        options.nextSyncMs,
      ),
    );
    return { paired: true, pushed: 0, queued: 0, queuedDrained: 0, setupPending: true };
  }

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
  const emit = options.onProgress ?? (() => {});

  try {
    // Run-scoped: a transient read failure on one session must not poison it
    // for the daemon's lifetime — clear the attempted-set each run so the next
    // 5-min tick retries. Within-run dedupe across a multi-day backfill stands.
    resetEnsuredSessions();
    const { listSessions, loadCalibrationCurve } = await import("@claude-lens/parser/fs");
    const { toLocalDay } = await import("@claude-lens/parser");
    const today = toLocalDay(Date.now());
    // Watermark patches accumulate across the run and merge onto a FRESH disk
    // read at each write — this run only owns watermark keys, so a concurrent
    // web write (Settings selection change, wizard clearing setupPending) is
    // never clobbered by this run's stale snapshot.
    let patches: Partial<TeamConfig> = {};

    const persistConfig = (patch: Partial<TeamConfig>) => {
      patches = { ...patches, ...patch };
      const onDisk = readTeamConfig();
      if (!onDisk) return; // unpaired mid-run (team leave) — don't resurrect the file
      writeTeamConfig({ ...onDisk, ...patches });
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
        const queuedPayload = backlog[i]!;
        // Queued before a selection change? Don't leak the now-excluded
        // project — the day rebuilds from filtered sessions anyway, because
        // lastSyncedDay never advances past a queued day.
        if (queuedPayload.richRollup?.projects?.some((p) => !shouldSyncProject(p.project, config.syncProjects))) {
          log("info", "team push: dropped queued payload containing now-excluded project(s)");
          continue;
        }
        const qResult = await pushToTeamServer(config, queuedPayload);
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

    emit({ type: "phase", phase: "usage-backfill" });
    const usageBackfill = await runTeamBackfill(log, USAGE_LOG, config, {
      sinceCapturedAt: options.forceUsageBackfill
        ? undefined
        : config.lastSyncedUsageSnapshotAt,
    });
    emit({
      type: "usage",
      inserted: usageBackfill.insertedSnapshots ?? 0,
      alreadyKnown: usageBackfill.skippedSnapshots ?? 0,
    });
    if (usageBackfill.lastSnapshotAt) {
      persistConfig({ lastSyncedUsageSnapshotAt: usageBackfill.lastSnapshotAt });
    }

    const unfilteredSessions = await listSessions({ limit: 10_000 });
    const sessions = filterSyncedSessions(unfilteredSessions, config.syncProjects);
    // All day rollups, unfiltered — `rollups` is the new-days slice pushed by
    // the main loop; the full set is also indexed for the dropped-day retry,
    // whose target predates lastSyncedDay.
    const allRollups = buildRollupsForRange(sessions);
    const inWindow = (day: string) => !config.lastSyncedDay || day >= config.lastSyncedDay;
    const rollups = allRollups.filter((r) => inWindow(r.day));
    // Tombstones: a day whose ONLY activity is now-excluded projects vanishes
    // from the filtered rollups, so its previously-pushed server row would
    // linger forever. Push an explicit empty day to overwrite it.
    if (config.syncProjects) {
      const filteredDays = new Set(allRollups.map((r) => r.day));
      for (const r of buildRollupsForRange(unfilteredSessions)) {
        if (!filteredDays.has(r.day) && inWindow(r.day)) {
          rollups.push({
            day: r.day,
            agentTimeMs: 0,
            sessions: 0,
            uniqueSessions: 0,
            toolCalls: 0,
            turns: 0,
            tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          });
        }
      }
      rollups.sort((a, b) => (a.day < b.day ? -1 : 1));
    }
    emit({ type: "phase", phase: "activity", totalDays: rollups.length });

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
        emit({ type: "done", pushed: 0, queued: 0, pushedDays: summary.pushedDays });
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
          emit({ type: "done", pushed: 0, queued: 0, pushedDays: summary.pushedDays });
          return { paired: true, pushed: 0, queued: 0, queuedDrained: 0, usageBackfill };
        }
        const errLine = `team push failed (${result.status})`;
        writeLastPushFailure(payload, errLine);
        enqueuePayload(payload);
        summary.queued = 1;
        summary.errorMsg = `live-snapshot push HTTP ${result.status} — queued for retry`;
        finish("failed");
        emit({ type: "done", pushed: 0, queued: 1, pushedDays: summary.pushedDays });
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
      emit({ type: "done", pushed: 1, queued: 0, pushedDays: summary.pushedDays });
      return { paired: true, pushed: 1, queued: 0, queuedDrained, usageBackfill };
    }

    let pushed = 0;
    let queued = 0;
    let failedDay: string | undefined;
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
      // Tombstone day (every session excluded): force EMPTY rich/enriched
      // blocks — the server upsert replaces `projects` wholesale and
      // COALESCEs the mixes, so absent blocks would leave the stale row.
      const tombstone = daySessions.length === 0 && !!config.syncProjects;
      const emptyRich = tombstone
        ? {
            projects: [],
            workingShapes: [],
            concurrencyPeak: 0,
            parallelMinutes: 0,
            longAutonomous: { count: 0, totalMin: 0, maxSingleMin: 0 },
            toolErrors: 0,
            skillsLoaded: [],
            subagentsDispatched: [],
            brainstormWarmupSessions: 0,
            planModeUsed: 0,
            prs: 0,
            commits: 0,
            pushes: 0,
          }
        : undefined;
      let artifactSignals: ReturnType<typeof probeArtifactSignals> = null;
      try {
        // Probe auto-detects git email from `git config user.email`. cwd may
        // itself be an excluded repo (daemon launched from it) — don't let its
        // .claude/CLAUDE.md authoring signals ride along.
        const cwdAllowed = shouldSyncProject(projectKey(resolveProjectIdentity(process.cwd()).projectName), config.syncProjects);
        artifactSignals = probeArtifactSignals({ day: rollup.day, extraRoots: cwdAllowed ? [process.cwd()] : [] });
      } catch {
        // Probe is best-effort; never block the push path.
      }
      return buildIngestPayload({
        rollup,
        richExtras: richBlocks?.rich ?? emptyRich,
        enrichedExtras:
          richBlocks?.enriched ?? (tombstone ? { outcomeMix: {}, helpfulnessMix: {}, goalMix: {} } : undefined),
        artifactSignals: artifactSignals ?? undefined,
        // Current-cycle data only on the latest day so older days aren't tagged
        // with today's snapshot / peaks.
        usageSnapshot: opts.latest ? usageSnapshot : undefined,
        planTier,
        cyclePeaks: opts.latest ? cyclePeaks : undefined,
        syncLog: opts.syncLog,
      });
    };

    // Newest day first: a long first sync fills the team dashboard with the
    // freshest data immediately, and the wizard's live log reads naturally.
    const rollupsDesc = [...rollups].reverse();
    for (let i = 0; i < rollupsDesc.length; i++) {
      const rollup = rollupsDesc[i]!;
      const isLatest = i === 0;
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
          emit({ type: "day", day: rollup.day, index: i + 1, total: rollupsDesc.length, outcome: "dropped" });
          continue;
        }
        const errLine = `team push failed on ${rollup.day} (${result.status})`;
        writeLastPushFailure(payload, errLine);
        enqueuePayload(payload);
        queued++;
        summary.queuedDay = rollup.day;
        summary.queuedStatus = result.status;
        failedDay = rollup.day;
        emit({ type: "day", day: rollup.day, index: i + 1, total: rollupsDesc.length, outcome: "queued" });
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
      emit({ type: "day", day: rollup.day, index: i + 1, total: rollupsDesc.length, outcome: "pushed" });
    }

    // Retry AT MOST ONE previously-dropped day (oldest first, and not one just
    // dropped this run) while the server is reachable — a server upgrade then
    // self-heals the day. On success it leaves the list; on another hard-4xx
    // it stays for next tick; a transient failure also leaves it untouched.
    if (!failedDay) {
      const retryDay = [...droppedDaysBefore]
        .sort()
        .find((d) => !summary.droppedDays.includes(d));
      if (retryDay && summary.pushedDays.includes(retryDay)) {
        // Main loop already re-pushed this day this run (possibly as a
        // tombstone after a selection change) — server row is corrected;
        // just drop it from the list instead of pushing twice.
        const idx = workingDropped.indexOf(retryDay);
        if (idx >= 0) workingDropped.splice(idx, 1);
        summary.recoveredDays = [retryDay];
      }
      // A day whose sessions are all excluded since it was dropped has no
      // filtered rollup — retry it as a tombstone so it still heals instead
      // of lingering in droppedDays forever.
      const retryRollup =
        retryDay && !summary.pushedDays.includes(retryDay)
          ? (allRollups.find((r) => r.day === retryDay) ??
            (config.syncProjects
              ? {
                  day: retryDay,
                  agentTimeMs: 0,
                  sessions: 0,
                  uniqueSessions: 0,
                  toolCalls: 0,
                  turns: 0,
                  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                }
              : undefined))
          : undefined;
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
      // Newest-first loop: the failed day and everything OLDER are unresolved,
      // so the watermark must not advance — already-pushed newer days simply
      // re-push on the next tick (idempotent per-day upserts server-side).
      if (droppedChanged) persistConfig(droppedPatch);
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
    emit({ type: "done", pushed, queued, pushedDays: summary.pushedDays });
    return { paired: true, pushed, queued, queuedDrained, usageBackfill, failedDay };
  } catch (err) {
    const message = (err as Error).message;
    summary.errorMsg = `sync aborted: ${message}`;
    emit({ type: "error", message });
    finish("error");
    writeLastPushFailure(
      { ingestId: "n/a", observedAt: new Date().toISOString() },
      `team push error: ${message}`,
    );
    return { paired: true, pushed: 0, queued: 0, queuedDrained: 0, error: message };
  }
}

/** In-progress cycle: drop points before the last mid-cycle reset (a ≥30pp
 *  real-reading drop, e.g. a grant 88% → 20%). Valid because utilization only
 *  ever rises within a cycle. Mirrors pointsAfterLastReset in
 *  apps/web/lib/cycle-peaks.ts — keep them aligned. */
const RESET_DROP_PP = 30;
function pointsAfterLastReset<P extends { ts: string; real_5h: number | null; real_7d: number | null }>(
  points: P[],
  realKey: "real_5h" | "real_7d",
): P[] {
  if (points.length < 2) return points;
  const ordered = [...points].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  let cutIdx = 0;
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1][realKey];
    const curr = ordered[i][realKey];
    if (
      typeof prev === "number" &&
      typeof curr === "number" &&
      prev - curr >= RESET_DROP_PP
    ) {
      cutIdx = i;
    }
  }
  return cutIdx === 0 ? ordered : ordered.slice(cutIdx);
}

// Build the cycle-peaks block in the same shape the server expects. Wraps
// loadCalibrationCurve so the import stays in one place; tier-aware so the
// rate constants match the user's actual subscription. Returns undefined
// when no JSONL data is available (cold-start before any session exists).
// Exported so the rebaselining logic can be unit-tested directly — there is
// no shared lib with the web copy (it pulls `server-only`), so this is a
// parallel implementation that must stay in lock-step by test.
export async function buildCyclePeaksForPush(
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
      const isCurrent = endMs > nowMs;
      // Re-baseline an in-progress cycle past a mid-cycle limit reset
      // (grant / overnight reset drops utilization e.g. 88% → 20%): the
      // pre-reset points belong to a superseded limit and must not anchor
      // the pushed peak. Completed cycles keep the all-time max.
      const scoped = isCurrent ? pointsAfterLastReset(points, realKey) : points;
      // Take the max across BOTH real and predicted — when the daemon goes
      // dark before cycle close, the cycle's true peak is the predicted
      // close, not the last poll. Predicted is deliberately NOT capped at
      // 100 here (unlike the web copy): the team wire schema allows >100 to
      // report legitimate extra-usage overage.
      let peak = 0;
      let source: "real" | "predicted" = "predicted";
      for (const p of scoped) {
        const r = p[realKey];
        if (typeof r === "number" && r > peak) { peak = r; source = "real"; }
        const v = p[predKey] ?? 0;
        if (v > peak) { peak = v; source = "predicted"; }
      }
      out.push({
        endsAt: new Date(endMs).toISOString(),
        peakPct: Math.round(peak * 10) / 10,
        source,
        current: isCurrent,
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
