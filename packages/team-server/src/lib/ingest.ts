import pg from "pg";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { getPool } from "../db/pool";
import {
  IngestPayload,
  IngestEnvelope,
  UsageHistoryPayload,
  DailyRollupSchema,
  RichDailyRollupSchema,
  EnrichedDailyExtrasSchema,
  DayArtifactSignalsSchema,
  UsageSnapshotSchema,
  PlanTierKeySchema,
  WireCyclePeaksSchema,
  CommandResultsSchema,
  SyncLogLineSchema,
  type UsageSnapshot,
} from "./zod-schemas";
import { refreshMembershipWeeklyUtilization } from "./scheduler";
import { broadcastEvent } from "./sse";
import { processCommandResults, fetchPendingCommands, type PendingCommand } from "./member-commands";

export type SnapshotHistoryResult = { received: number; inserted: number; skipped: number };
// Per-block validation outcome surfaced to the daemon. `accepted` lists the
// data blocks that were APPLIED within this call's transaction — on a dedup
// replay only the row-level-idempotent streams (snapshotHistory, syncLog)
// can appear; `skipped` maps a rejected block name to the failing field
// path + reason. This is the 200-with-partial contract: a single bad block
// is dropped, not fatal to the whole push.
export type IngestBlocksResult = { accepted: string[]; skipped: Record<string, string> };
export type IngestResult = {
  accepted: true;
  deduplicated?: boolean;
  nextSyncAfter?: string;
  snapshotHistory?: SnapshotHistoryResult;
  blocks?: IngestBlocksResult;
  commands?: PendingCommand[];
};

type ParsedIngest = z.infer<typeof IngestPayload>;
type SyncLogLine = z.infer<typeof SyncLogLineSchema>;

// Keep snapshotHistory transactions bounded — mirrors the old schema cap.
const SNAPSHOT_HISTORY_MAX = 1000;
// syncLog raw-length cap — mirrors the old block schema's `.max(500)`.
const SYNC_LOG_MAX = 500;
// btree index tuples top out around ~2704 bytes, and the syncLog dedup index
// carries msg — a ≤2000-CHAR multibyte msg can be ~8000 BYTES, aborting the
// whole txn (500 → the daemon re-sends the same poison line forever). Bound
// msg by bytes before insert.
const SYNC_LOG_MSG_MAX_BYTES = 2000;

// Truncate to a UTF-8 byte budget at a codepoint boundary, marking the cut.
function truncateUtf8Bytes(s: string, maxBytes: number): string {
  if (Buffer.byteLength(s, "utf8") <= maxBytes) return s;
  const cut = Buffer.from(s, "utf8").subarray(0, maxBytes - 3).toString("utf8"); // 3 = "…"
  // A mid-codepoint cut decodes to trailing U+FFFD — strip before marking.
  return cut.replace(/�+$/, "") + "…";
}

export async function processIngest(
  raw: unknown,
  membershipId: string,
  teamId: string,
  pool?: pg.Pool
): Promise<IngestResult> {
  const p = pool || getPool();

  // Envelope is strict (throws ZodError → 400). Data blocks are validated
  // independently below so one malformed block is skipped, not fatal.
  const env = IngestEnvelope.parse(raw);
  const rawObj = raw as Record<string, unknown>;

  const acceptedBlocks: string[] = [];
  const skippedBlocks: Record<string, string> = {};
  // safeParse one DATA block. Present + valid → recorded accepted, value
  // returned for ingest. Present + invalid → skipped with the failing field
  // path logged (field-agnostic: we never need to know which field is bad).
  // Absent → undefined, untouched. Validation happens BEFORE the DB
  // transaction opens, so a skipped block can never roll back an accepted one.
  const tryBlock = <S extends z.ZodTypeAny>(name: string, schema: S): z.infer<S> | undefined => {
    const value = rawObj[name];
    if (value === undefined) return undefined;
    const res = schema.safeParse(value);
    if (res.success) {
      acceptedBlocks.push(name);
      return res.data;
    }
    const issue = res.error.issues[0];
    const path = issue && issue.path.length ? `${name}.${issue.path.join(".")}` : name;
    const reason = `${path}: ${issue?.message ?? "invalid"}`;
    skippedBlocks[name] = reason;
    console.warn(`[ingest] skipped block "${name}": ${reason}`);
    return undefined;
  };

  // snapshotHistory gets row-level resilience rather than block-level: the
  // backfill push carries ONLY this block, so dropping the whole array on a
  // single corrupt row would be the all-or-nothing failure we're killing.
  // Keep every valid snapshot, skip individual bad rows. `rawSnapshotCount`
  // preserves the daemon's `received` contract even when the field is junk.
  let rawSnapshotCount = 0;
  let snapshotHistory: UsageSnapshot[] | undefined;
  if (rawObj.snapshotHistory !== undefined) {
    const arr = rawObj.snapshotHistory;
    if (Array.isArray(arr)) {
      rawSnapshotCount = arr.length;
      // Cap on RAW length BEFORE parsing. Row-level resilience must not become
      // an unbounded-work primitive: a hostile member could send millions of
      // mostly-invalid rows (so `valid.length` stays under the cap) and force a
      // safeParse of every one. Enforce the old schema-level `.max(1000)` bound
      // on the raw array first.
      if (arr.length > SNAPSHOT_HISTORY_MAX) {
        skippedBlocks.snapshotHistory = `snapshotHistory: exceeds ${SNAPSHOT_HISTORY_MAX}-row cap (${arr.length} received)`;
        console.warn(`[ingest] skipped block "snapshotHistory": ${skippedBlocks.snapshotHistory}`);
      } else {
        const valid: UsageSnapshot[] = [];
        let firstBad: string | undefined;
        for (let i = 0; i < arr.length; i++) {
          const res = UsageSnapshotSchema.safeParse(arr[i]);
          if (res.success) valid.push(res.data);
          else if (!firstBad) {
            const issue = res.error.issues[0];
            firstBad = `snapshotHistory[${i}]${issue?.path.length ? "." + issue.path.join(".") : ""}: ${issue?.message ?? "invalid"}`;
          }
        }
        if (valid.length > 0) {
          snapshotHistory = valid;
          acceptedBlocks.push("snapshotHistory");
        }
        if (firstBad) {
          skippedBlocks.snapshotHistory = `${firstBad} (${arr.length - valid.length}/${arr.length} rows dropped)`;
          console.warn(`[ingest] partial snapshotHistory: ${skippedBlocks.snapshotHistory}`);
        }
      }
    } else {
      skippedBlocks.snapshotHistory = "snapshotHistory: expected array";
      console.warn(`[ingest] skipped block "snapshotHistory": ${skippedBlocks.snapshotHistory}`);
    }
  }

  // syncLog gets the same row-level resilience as snapshotHistory: the block
  // used to validate atomically, so one corrupt line killed up to 500 valid
  // ones. Keep every valid line; the block reports skipped only when nothing
  // survives (a partial drop is warn-logged but the block is still accepted
  // with the valid subset).
  let syncLog: SyncLogLine[] | undefined;
  if (rawObj.syncLog !== undefined) {
    const arr = rawObj.syncLog;
    if (!Array.isArray(arr)) {
      skippedBlocks.syncLog = "syncLog: expected array";
      console.warn(`[ingest] skipped block "syncLog": ${skippedBlocks.syncLog}`);
    } else if (arr.length > SYNC_LOG_MAX) {
      // Cap on RAW length before parsing — same DoS reasoning as snapshotHistory.
      skippedBlocks.syncLog = `syncLog: exceeds ${SYNC_LOG_MAX}-row cap (${arr.length} received)`;
      console.warn(`[ingest] skipped block "syncLog": ${skippedBlocks.syncLog}`);
    } else {
      const valid: SyncLogLine[] = [];
      let firstBad: string | undefined;
      for (let i = 0; i < arr.length; i++) {
        const res = SyncLogLineSchema.safeParse(arr[i]);
        if (res.success) {
          valid.push({ ...res.data, msg: truncateUtf8Bytes(res.data.msg, SYNC_LOG_MSG_MAX_BYTES) });
        } else if (!firstBad) {
          const issue = res.error.issues[0];
          firstBad = `syncLog[${i}]${issue?.path.length ? "." + issue.path.join(".") : ""}: ${issue?.message ?? "invalid"}`;
        }
      }
      if (valid.length > 0) {
        syncLog = valid;
        acceptedBlocks.push("syncLog");
        if (firstBad) {
          console.warn(`[ingest] partial syncLog: ${firstBad} (${arr.length - valid.length}/${arr.length} rows dropped)`);
        }
      } else if (firstBad) {
        skippedBlocks.syncLog = `${firstBad} (${arr.length}/${arr.length} rows dropped)`;
        console.warn(`[ingest] skipped block "syncLog": ${skippedBlocks.syncLog}`);
      }
    }
  }

  const commandResults = tryBlock("commandResults", CommandResultsSchema);

  // Reconstructed payload of only the envelope + valid blocks. The downstream
  // insert logic keeps its `if (payload.x)` guards unchanged — a skipped
  // block is simply absent here.
  const payload: ParsedIngest = {
    ingestId: env.ingestId,
    observedAt: env.observedAt,
    schemaVersion: env.schemaVersion,
    cliVersion: env.cliVersion,
    dailyRollup: tryBlock("dailyRollup", DailyRollupSchema),
    richRollup: tryBlock("richRollup", RichDailyRollupSchema),
    enrichedExtras: tryBlock("enrichedExtras", EnrichedDailyExtrasSchema),
    artifactSignals: tryBlock("artifactSignals", DayArtifactSignalsSchema),
    usageSnapshot: tryBlock("usageSnapshot", UsageSnapshotSchema),
    planTier: tryBlock("planTier", PlanTierKeySchema),
    cyclePeaks: tryBlock("cyclePeaks", WireCyclePeaksSchema),
    snapshotHistory,
    commandResults,
    syncLog,
  };

  // accepted must imply applied. Both extras blocks are keyed to a rollup day
  // they don't carry themselves: enrichedExtras only lands through the rich
  // upsert's COALESCE columns, and artifactSignals needs the push's day. When
  // the prerequisite block is absent (or itself skipped), demote them —
  // reporting them accepted would tell the daemon data landed that didn't.
  if (payload.enrichedExtras && !payload.richRollup) {
    acceptedBlocks.splice(acceptedBlocks.indexOf("enrichedExtras"), 1);
    skippedBlocks.enrichedExtras = "enrichedExtras: requires richRollup";
    console.warn(`[ingest] skipped block "enrichedExtras": ${skippedBlocks.enrichedExtras}`);
    payload.enrichedExtras = undefined;
  }
  const signalsDay = payload.richRollup?.day ?? payload.dailyRollup?.day;
  if (payload.artifactSignals && !signalsDay) {
    acceptedBlocks.splice(acceptedBlocks.indexOf("artifactSignals"), 1);
    skippedBlocks.artifactSignals = "artifactSignals: requires richRollup or dailyRollup (day key)";
    console.warn(`[ingest] skipped block "artifactSignals": ${skippedBlocks.artifactSignals}`);
    payload.artifactSignals = undefined;
  }

  let dedupHit!: boolean;
  let historyInserted = 0;
  let daemonLogInserted = 0;

  const client = await p.connect();
  try {
    await client.query("BEGIN");

    const logRes = await client.query(
      "INSERT INTO ingest_log (ingest_id, team_id, membership_id) VALUES ($1, $2, $3) ON CONFLICT (ingest_id) DO NOTHING RETURNING 1",
      [payload.ingestId, teamId, membershipId]
    );
    dedupHit = logRes.rowCount === 0;

    if (!dedupHit) {
      if (payload.dailyRollup) {
        const r = payload.dailyRollup;
        await client.query(`
          INSERT INTO daily_rollups (team_id, membership_id, day, agent_time_ms, sessions, unique_sessions, tool_calls, turns,
                                     tokens_input, tokens_output, tokens_cache_read, tokens_cache_write)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (team_id, membership_id, day) DO UPDATE SET
            agent_time_ms = EXCLUDED.agent_time_ms,
            sessions = EXCLUDED.sessions,
            unique_sessions = EXCLUDED.unique_sessions,
            tool_calls = EXCLUDED.tool_calls,
            turns = EXCLUDED.turns,
            tokens_input = EXCLUDED.tokens_input,
            tokens_output = EXCLUDED.tokens_output,
            tokens_cache_read = EXCLUDED.tokens_cache_read,
            tokens_cache_write = EXCLUDED.tokens_cache_write
        `, [teamId, membershipId, r.day, r.agentTimeMs, r.sessions, r.uniqueSessions ?? null, r.toolCalls, r.turns,
            r.tokens.input, r.tokens.output, r.tokens.cacheRead, r.tokens.cacheWrite]);
      }

      if (payload.planTier) {
        // Server-trusted source of truth — the daemon read this directly from
        // Anthropic's profile endpoint. Admin can still override post-hoc;
        // the next daemon push will reassert if Anthropic still reports the
        // same tier.
        await upsertMembershipPlanTier(client, teamId, membershipId, payload.planTier);
      }

      if (payload.usageSnapshot) {
        await insertPlanUtilizationSnapshots(client, teamId, membershipId, [payload.usageSnapshot]);
      }

      if (payload.cyclePeaks) {
        await upsertMembershipCyclePeaks(client, teamId, membershipId, payload.cyclePeaks);
      }
    }

    // snapshotHistory dedups at the row level via (team_id, membership_id,
    // captured_at), so it's processed regardless of the headline-ingestId
    // gate — a retried batch with the same ingestId can still apply new rows.
    if (payload.snapshotHistory?.length) {
      historyInserted = await insertPlanUtilizationSnapshots(
        client, teamId, membershipId, payload.snapshotHistory,
      );
    }

    // Member daemon log — the client-side sync story. Row-level dedup on
    // (membership_id, ts, msg) so a retried push (same lines) is idempotent;
    // processed regardless of the ingestId gate, like snapshotHistory.
    if (payload.syncLog?.length) {
      const vals: unknown[] = [];
      const tuples = payload.syncLog.map((l, i) => {
        const b = i * 5;
        vals.push(teamId, membershipId, l.ts, l.level, l.msg);
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`;
      });
      const res = await client.query(
        `INSERT INTO member_daemon_log (team_id, membership_id, ts, level, msg)
         VALUES ${tuples.join(",")}
         ON CONFLICT (membership_id, ts, msg) DO NOTHING`,
        vals,
      );
      daemonLogInserted = res.rowCount ?? 0;
    }

    // Headline blocks below are gated on !dedupHit like dailyRollup: a replay
    // with the same ingestId carries the same content, so re-upserting is a
    // no-op at best and must not be reported as applied.
    if (!dedupHit && payload.richRollup) {
      const r = payload.richRollup;
      const ex = payload.enrichedExtras;
      await client.query(`
        INSERT INTO rich_daily_rollups (
          team_id, membership_id, day,
          agent_time_ms, sessions,
          prs, commits, pushes,
          concurrency_peak, parallel_minutes,
          long_auto_count, long_auto_total_min, long_auto_max_single_min,
          tool_errors, brainstorm_warmup_sessions, plan_mode_used,
          projects, working_shapes, skills_loaded, subagents_dispatched,
          outcome_mix, helpfulness_mix, goal_mix,
          tokens_input, tokens_output, tokens_cache_read, tokens_cache_write,
          unique_sessions
        )
        VALUES (
          $1, $2, $3,
          $4, $5,
          $6, $7, $8,
          $9, $10,
          $11, $12, $13,
          $14, $15, $16,
          $17, $18, $19, $20,
          $21, $22, $23,
          $24, $25, $26, $27,
          $28
        )
        ON CONFLICT (team_id, membership_id, day) DO UPDATE SET
          agent_time_ms = EXCLUDED.agent_time_ms,
          sessions = EXCLUDED.sessions,
          prs = EXCLUDED.prs,
          commits = EXCLUDED.commits,
          pushes = EXCLUDED.pushes,
          concurrency_peak = EXCLUDED.concurrency_peak,
          parallel_minutes = EXCLUDED.parallel_minutes,
          long_auto_count = EXCLUDED.long_auto_count,
          long_auto_total_min = EXCLUDED.long_auto_total_min,
          long_auto_max_single_min = EXCLUDED.long_auto_max_single_min,
          tool_errors = EXCLUDED.tool_errors,
          brainstorm_warmup_sessions = EXCLUDED.brainstorm_warmup_sessions,
          plan_mode_used = EXCLUDED.plan_mode_used,
          projects = EXCLUDED.projects,
          working_shapes = EXCLUDED.working_shapes,
          skills_loaded = EXCLUDED.skills_loaded,
          subagents_dispatched = EXCLUDED.subagents_dispatched,
          -- Preserve previously-pushed enriched extras when a push carries no
          -- enrichment: re-pushing leaves the columns alone instead of nulling
          -- them. Critical because enrichment is async -- a day's first push
          -- (before claude -p finishes, or with AI off) carries EMPTY mixes,
          -- and a later push must not clobber the real mix once it lands. The
          -- empty-mix to NULL guard is below (Object.keys length), so EXCLUDED is
          -- NULL for an empty mix and COALESCE keeps the stored value.
          outcome_mix = COALESCE(EXCLUDED.outcome_mix, rich_daily_rollups.outcome_mix),
          helpfulness_mix = COALESCE(EXCLUDED.helpfulness_mix, rich_daily_rollups.helpfulness_mix),
          goal_mix = COALESCE(EXCLUDED.goal_mix, rich_daily_rollups.goal_mix),
          tokens_input = EXCLUDED.tokens_input,
          tokens_output = EXCLUDED.tokens_output,
          tokens_cache_read = EXCLUDED.tokens_cache_read,
          tokens_cache_write = EXCLUDED.tokens_cache_write,
          unique_sessions = EXCLUDED.unique_sessions,
          ingested_at = now()
      `, [
        teamId, membershipId, r.day,
        r.agentTimeMs, r.sessions,
        r.prs, r.commits, r.pushes,
        r.concurrencyPeak, r.parallelMinutes,
        r.longAutonomous.count, r.longAutonomous.totalMin, r.longAutonomous.maxSingleMin,
        r.toolErrors, r.brainstormWarmupSessions, r.planModeUsed,
        JSON.stringify(r.projects), JSON.stringify(r.workingShapes),
        JSON.stringify(r.skillsLoaded), JSON.stringify(r.subagentsDispatched),
        ex?.outcomeMix && Object.keys(ex.outcomeMix).length ? JSON.stringify(ex.outcomeMix) : null,
        ex?.helpfulnessMix && Object.keys(ex.helpfulnessMix).length ? JSON.stringify(ex.helpfulnessMix) : null,
        ex?.goalMix && Object.keys(ex.goalMix).length ? JSON.stringify(ex.goalMix) : null,
        r.tokens.input, r.tokens.output, r.tokens.cacheRead, r.tokens.cacheWrite,
        r.uniqueSessions ?? null,
      ]);
    }

    // artifactSignals writes its own table (day_artifact_signals) but carries
    // no day — keyed to the push's rollup day (richRollup, or dailyRollup when
    // the rich block was dropped) so a skipped richRollup doesn't strand it.
    if (!dedupHit && payload.artifactSignals && signalsDay) {
      await upsertDayArtifactSignals(client, teamId, membershipId, signalsDay, payload.artifactSignals);
    }
    // Always reconcile the catalog when richRollup is present (skills_loaded
    // tracks adopters even without the file-system probe's authorship).
    if (!dedupHit && signalsDay && (payload.artifactSignals || payload.richRollup)) {
      await reconcileTeamSkillCatalog(client, teamId, membershipId, signalsDay, payload);
    }

    if (!dedupHit || historyInserted > 0) {
      await client.query("UPDATE memberships SET last_seen_at = now() WHERE id = $1", [membershipId]);
    }

    // Track the member's installed CLI version on every push (incl. dedup
    // replays) so the roster reflects upgrades promptly. Only when reported —
    // never overwrite a known version with null from an older client.
    if (payload.cliVersion) {
      await client.query("UPDATE memberships SET cli_version = $2 WHERE id = $1", [
        membershipId,
        payload.cliVersion,
      ]);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Surface backfilled rows on the dashboard immediately rather than waiting
  // for the hourly scheduler tick. Refresh races with the scheduler are
  // non-fatal — the next tick corrects any missed concurrent refresh.
  if (historyInserted > 0) {
    try { await refreshMembershipWeeklyUtilization(); } catch {}
  }

  if (!dedupHit || historyInserted > 0) {
    broadcastEvent(teamId, "roster-updated", { membershipId });
  }

  // Command channel: drain daemon-reported results, then hand back any
  // pending commands. Runs on both dedupe-replay and active-work paths so a
  // daemon retry still picks up work queued in the interim.
  if (payload.commandResults && payload.commandResults.length > 0) {
    await processCommandResults(p, membershipId, payload.commandResults);
  }
  const commands = await fetchPendingCommands(p, membershipId);

  // blocks.accepted must list exactly what this call APPLIED. On a dedup
  // replay every headline block is skipped wholesale — only the row-level-
  // idempotent streams (snapshotHistory, syncLog) still ran.
  const appliedBlocks = dedupHit
    ? acceptedBlocks.filter((b) => b === "snapshotHistory" || b === "syncLog")
    : acceptedBlocks;

  // nextSyncAfter is the 200-vs-202 signal at the HTTP layer: present iff
  // actual work happened. A dedup'd headline that still landed history rows
  // counts as work; a pure replay (no history work) doesn't.
  const result: IngestResult = { accepted: true };
  if (dedupHit) result.deduplicated = true;
  if (!dedupHit || historyInserted > 0) {
    result.nextSyncAfter = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  }
  // Report a snapshotHistory result whenever the block was sent (valid or
  // not) so the daemon's backfill loop sees its inserted/skipped contract and
  // never trips the "older image" guard. `received` is the raw sent count;
  // `skipped` folds in both validation-dropped rows and captured_at dups.
  if (rawSnapshotCount > 0 || skippedBlocks.snapshotHistory) {
    result.snapshotHistory = {
      received: rawSnapshotCount,
      inserted: historyInserted,
      skipped: rawSnapshotCount - historyInserted,
    };
  }
  result.blocks = { accepted: appliedBlocks, skipped: skippedBlocks };
  if (commands.length > 0) result.commands = commands;

  // Always-on per-push health line — the single source of truth for "is this
  // member's sync healthy?". Emitted on EVERY push (success, partial, dedup)
  // so a healthy sync is never silent, and it survives production `next start`
  // (unlike Next's dev-only request log). Carries member/team/cli/ingest
  // identity so it's greppable per member, and lists accepted/skipped BLOCK
  // NAMES so a split-brain (usage lands / metrics rot, or vice versa) reads at
  // a glance. warn when any block dropped so degraded pushes surface at warn
  // level; log otherwise.
  const skippedDetail = Object.values(skippedBlocks);
  const histNote =
    rawSnapshotCount > 0 || historyInserted > 0 ? ` hist=${historyInserted}/${rawSnapshotCount}` : "";
  const logNote =
    payload.syncLog?.length ? ` daemonLog=${daemonLogInserted}/${payload.syncLog.length}` : "";
  const health =
    `[ingest] push member=${membershipId} team=${teamId} cli=${payload.cliVersion ?? "-"}` +
    ` ingest=${payload.ingestId} accepted=[${appliedBlocks.join(",")}]` +
    ` skipped=[${skippedDetail.join("; ")}] dedup=${dedupHit}${histNote}${logNote}`;
  if (skippedDetail.length > 0) console.warn(health);
  else console.log(health);

  // Persist the same health event so it's viewable per member in the UI
  // ("View logs") without shelling into container stdout. POST-COMMIT and
  // best-effort: an observability write must NEVER fail a member's real
  // ingest. Skips pure no-op dedup replays (nothing happened) to avoid
  // flooding — anything that did work or dropped a block is kept.
  const syncStatus = skippedDetail.length > 0 ? "partial" : "ok";
  if (!dedupHit || historyInserted > 0 || syncStatus === "partial") {
    try {
      await p.query(
        `INSERT INTO member_sync_log
           (team_id, membership_id, ingest_id, cli_version, accepted, skipped, status, dedup, hist_inserted, hist_received)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          teamId, membershipId, payload.ingestId, payload.cliVersion ?? null,
          JSON.stringify(appliedBlocks), JSON.stringify(skippedBlocks), syncStatus,
          dedupHit, historyInserted, rawSnapshotCount,
        ],
      );
    } catch (err) {
      console.warn(`[ingest] member_sync_log write failed (non-fatal): ${(err as Error).message}`);
    }
  }

  return result;
}

// Multi-row INSERT with ON CONFLICT DO NOTHING — one round-trip per batch
// instead of one per snapshot. Intra-batch duplicate captured_at values are
// collapsed first because PG raises a cardinality violation if a single
// statement proposes two rows that hit the same conflict target.
async function insertPlanUtilizationSnapshots(
  client: pg.PoolClient,
  teamId: string,
  membershipId: string,
  snapshots: UsageSnapshot[],
): Promise<number> {
  const unique = Array.from(new Map(snapshots.map((s) => [s.capturedAt, s])).values());
  if (unique.length === 0) return 0;

  const placeholders: string[] = [];
  const values: unknown[] = [];
  for (const u of unique) {
    const base = values.length;
    const ph = Array.from({ length: 15 }, (_, i) => `$${base + i + 1}`).join(",");
    placeholders.push(`(${ph})`);
    values.push(
      teamId, membershipId, u.capturedAt,
      u.fiveHour.utilization, u.fiveHour.resetsAt,
      u.sevenDay.utilization, u.sevenDay.resetsAt,
      u.sevenDayOpus?.utilization ?? null,
      u.sevenDaySonnet?.utilization ?? null,
      u.sevenDayOauthApps?.utilization ?? null,
      u.sevenDayCowork?.utilization ?? null,
      u.extraUsage?.isEnabled ?? false,
      u.extraUsage?.monthlyLimitUsd ?? null,
      u.extraUsage?.usedCreditsUsd ?? null,
      u.extraUsage?.utilization ?? null,
    );
  }
  const res = await client.query(
    `INSERT INTO plan_utilization (
       team_id, membership_id, captured_at,
       five_hour_utilization, five_hour_resets_at,
       seven_day_utilization, seven_day_resets_at,
       seven_day_opus_utilization, seven_day_sonnet_utilization,
       seven_day_oauth_apps_utilization, seven_day_cowork_utilization,
       extra_usage_enabled, extra_usage_monthly_limit_usd,
       extra_usage_used_credits_usd, extra_usage_utilization
     ) VALUES ${placeholders.join(",")}
     ON CONFLICT (team_id, membership_id, captured_at) DO NOTHING`,
    values,
  );
  return res.rowCount ?? 0;
}

// Upsert per-cycle peak utilization values computed by the daemon. We
// replace the entire snapshot per push (delete-then-insert) so that
// `is_current` flips correctly when cycles roll over and old `current`
// rows don't linger as ghosts.
async function upsertMembershipCyclePeaks(
  client: pg.PoolClient,
  teamId: string,
  membershipId: string,
  payload: { fiveHour: Array<{ endsAt: string; peakPct: number; source: "real" | "predicted"; current: boolean }>;
             sevenDay: Array<{ endsAt: string; peakPct: number; source: "real" | "predicted"; current: boolean }> },
): Promise<void> {
  const all: Array<{ window: "5h" | "7d"; endsAt: string; peakPct: number; source: string; current: boolean }> = [
    ...payload.fiveHour.map((c) => ({ window: "5h" as const, ...c })),
    ...payload.sevenDay.map((c) => ({ window: "7d" as const, ...c })),
  ];
  if (all.length === 0) return;

  // Replace the visible window — a daemon push is the freshest snapshot of
  // the user's recent cycles, so older rows for cycles outside the pushed
  // set are safe to drop. We keep entries beyond the pushed range so a
  // historical view isn't lost between pushes.
  const minEndsAt = all.reduce(
    (min, c) => (Date.parse(c.endsAt) < min ? Date.parse(c.endsAt) : min),
    Date.parse(all[0]!.endsAt),
  );
  await client.query(
    `DELETE FROM membership_cycle_peaks
     WHERE team_id = $1 AND membership_id = $2 AND ends_at >= $3`,
    [teamId, membershipId, new Date(minEndsAt).toISOString()],
  );

  for (const c of all) {
    await client.query(
      `INSERT INTO membership_cycle_peaks
         (team_id, membership_id, "window", ends_at, peak_pct, source, is_current, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (team_id, membership_id, "window", ends_at) DO UPDATE
         SET peak_pct = EXCLUDED.peak_pct,
             source = EXCLUDED.source,
             is_current = EXCLUDED.is_current,
             updated_at = now()`,
      [teamId, membershipId, c.window, c.endsAt, c.peakPct, c.source, c.current],
    );
  }
}

// Legacy shape adapter. The /api/ingest/usage-history route still calls this
// for backwards compatibility with older CLIs; new daemons send the same
// snapshots through the consolidated /api/ingest/metrics path via
// IngestPayload.snapshotHistory. Both flows ultimately run through
// processIngest, so there's exactly one DB code path.
//
// Each legacy call gets a fresh random ingestId — the old route's contract
// had no batch-level idempotency (it relied solely on captured_at uniqueness
// at the row level), so ingest_log accumulates one no-purpose row per legacy
// call until this route is removed. Acceptable for the transition window;
// expected to bleed off as CLIs upgrade.
export async function processUsageHistory(
  raw: unknown,
  membershipId: string,
  teamId: string,
  pool?: pg.Pool,
): Promise<{ accepted: true; received: number; inserted: number; skipped: number }> {
  const { snapshots, planTier } = UsageHistoryPayload.parse(raw);
  const result = await processIngest(
    {
      ingestId: `legacy-usage-history-${randomUUID()}`,
      observedAt: new Date().toISOString(),
      snapshotHistory: snapshots,
      ...(planTier ? { planTier } : {}),
    },
    membershipId,
    teamId,
    pool,
  );
  // UsageHistoryPayload enforces snapshots.min(1), so processIngest always
  // returns a snapshotHistory result block.
  const h = result.snapshotHistory!;
  return { accepted: true, received: h.received, inserted: h.inserted, skipped: h.skipped };
}

async function upsertDayArtifactSignals(
  client: pg.PoolClient,
  teamId: string,
  membershipId: string,
  day: string,
  s: NonNullable<ReturnType<typeof IngestPayload.parse>["artifactSignals"]>,
): Promise<void> {
  await client.query(
    `INSERT INTO day_artifact_signals (
       team_id, membership_id, day,
       skills_authored, skills_edited, subagents_authored,
       slash_commands_authored, claudemd_line_delta
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (team_id, membership_id, day) DO UPDATE SET
       skills_authored = EXCLUDED.skills_authored,
       skills_edited = EXCLUDED.skills_edited,
       subagents_authored = EXCLUDED.subagents_authored,
       slash_commands_authored = EXCLUDED.slash_commands_authored,
       claudemd_line_delta = EXCLUDED.claudemd_line_delta,
       ingested_at = now()`,
    [
      teamId, membershipId, day,
      JSON.stringify(s.skillsAuthored),
      JSON.stringify(s.skillsEdited),
      JSON.stringify(s.subagentsAuthored),
      JSON.stringify(s.slashCommandsAuthored),
      s.claudemdLineDelta,
    ],
  );
}

// Reconciles the team-wide skill catalog from a single member's daily push.
// Originator is "first member observed publishing this path_hash" and stays
// monotonic — once claimed it's preserved (handles out-of-order daemons).
// Loaders of an existing entry are added to the adopter set if they're not
// the originator. Skill loads (no authorship) still count toward `loads_total`
// and the adopter set, which is what powers the L4-coaches detection.
async function reconcileTeamSkillCatalog(
  client: pg.PoolClient,
  teamId: string,
  membershipId: string,
  day: string,
  payload: ReturnType<typeof IngestPayload.parse>,
): Promise<void> {
  type Item = { pathHash: string; kind: "skill" | "subagent" | "slash-command"; authored: boolean; firstSeen?: string };
  const items: Item[] = [];
  if (payload.artifactSignals) {
    for (const a of payload.artifactSignals.skillsAuthored ?? []) {
      items.push({ pathHash: a.pathHash, kind: "skill", authored: true, firstSeen: a.firstSeenDate });
    }
    for (const a of payload.artifactSignals.subagentsAuthored ?? []) {
      items.push({ pathHash: a.pathHash, kind: "subagent", authored: true, firstSeen: a.firstSeenDate });
    }
    for (const a of payload.artifactSignals.slashCommandsAuthored ?? []) {
      items.push({ pathHash: a.pathHash, kind: "slash-command", authored: true, firstSeen: a.firstSeenDate });
    }
  }
  // Also record any skills_loaded as adopter signals (path_hash here is the
  // skill name hash so name-collision across kinds is acceptable for the demo
  // path). The richer per-skill origin_path_hash arrives once the DaySignals
  // shipping work lands.
  if (payload.richRollup?.skillsLoaded) {
    for (const s of payload.richRollup.skillsLoaded) {
      const item = { pathHash: hashStable(`skill:${s.name}`), kind: "skill" as const, authored: false };
      items.push(item);
    }
  }
  for (const item of items) {
    await client.query(
      `INSERT INTO team_skill_catalog (
         team_id, path_hash, kind,
         originator_membership_id, originator_first_seen,
         adopter_membership_ids, loads_total, last_seen_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (team_id, path_hash) DO UPDATE SET
         originator_membership_id = COALESCE(team_skill_catalog.originator_membership_id, EXCLUDED.originator_membership_id),
         originator_first_seen = COALESCE(team_skill_catalog.originator_first_seen, EXCLUDED.originator_first_seen),
         adopter_membership_ids = (
           SELECT ARRAY(
             SELECT DISTINCT m FROM unnest(
               team_skill_catalog.adopter_membership_ids
               || CASE
                    WHEN team_skill_catalog.originator_membership_id IS NULL THEN ARRAY[]::uuid[]
                    WHEN $8::uuid = team_skill_catalog.originator_membership_id THEN ARRAY[]::uuid[]
                    ELSE ARRAY[$8::uuid]
                  END
             ) AS m
           )
         ),
         loads_total = team_skill_catalog.loads_total + 1,
         last_seen_at = now()`,
      [
        teamId,
        item.pathHash,
        item.kind,
        item.authored ? membershipId : null,
        item.authored ? (item.firstSeen ?? day) : null,
        [],
        1,
        membershipId,
      ],
    );
  }
}

// Stable hash for matching skill identity across members. Matches the
// truncation the personal-edition probe uses so server-side reconciliation
// joins cleanly against shipped path_hash values.
function hashStable(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

// Audit-logged upsert. Skips the write when the value already matches so
// the audit log doesn't fill with no-op ticks every 5 minutes.
async function upsertMembershipPlanTier(
  client: pg.PoolClient,
  teamId: string,
  membershipId: string,
  planTier: string,
): Promise<void> {
  const cur = await client.query<{ plan_tier: string }>(
    "SELECT plan_tier FROM memberships WHERE id = $1 AND team_id = $2",
    [membershipId, teamId],
  );
  const previous = cur.rows[0]?.plan_tier ?? null;
  if (previous === planTier) return;

  await client.query(
    "UPDATE memberships SET plan_tier = $1 WHERE id = $2 AND team_id = $3",
    [planTier, membershipId, teamId],
  );
  await client.query(
    "INSERT INTO events (team_id, actor_id, action, payload) VALUES ($1, NULL, 'members.plan_tier_auto_detected', $2)",
    [teamId, JSON.stringify({ membershipId, previousTier: previous, newTier: planTier, source: "anthropic_profile" })],
  );
}
