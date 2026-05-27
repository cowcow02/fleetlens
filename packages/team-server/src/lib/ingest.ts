import pg from "pg";
import { randomUUID } from "node:crypto";
import { getPool } from "../db/pool";
import { IngestPayload, UsageHistoryPayload, type UsageSnapshot } from "./zod-schemas";
import { refreshMembershipWeeklyUtilization } from "./scheduler";
import { broadcastEvent } from "./sse";
import { processCommandResults, fetchPendingCommands, type PendingCommand } from "./member-commands";

export type SnapshotHistoryResult = { received: number; inserted: number; skipped: number };
export type IngestResult = {
  accepted: true;
  deduplicated?: boolean;
  nextSyncAfter?: string;
  snapshotHistory?: SnapshotHistoryResult;
  commands?: PendingCommand[];
};

export async function processIngest(
  raw: unknown,
  membershipId: string,
  teamId: string,
  pool?: pg.Pool
): Promise<IngestResult> {
  const p = pool || getPool();
  const payload = IngestPayload.parse(raw);

  let dedupHit!: boolean;
  let historyInserted = 0;

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
          INSERT INTO daily_rollups (team_id, membership_id, day, agent_time_ms, sessions, tool_calls, turns,
                                     tokens_input, tokens_output, tokens_cache_read, tokens_cache_write)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (team_id, membership_id, day) DO UPDATE SET
            agent_time_ms = EXCLUDED.agent_time_ms,
            sessions = EXCLUDED.sessions,
            tool_calls = EXCLUDED.tool_calls,
            turns = EXCLUDED.turns,
            tokens_input = EXCLUDED.tokens_input,
            tokens_output = EXCLUDED.tokens_output,
            tokens_cache_read = EXCLUDED.tokens_cache_read,
            tokens_cache_write = EXCLUDED.tokens_cache_write
        `, [teamId, membershipId, r.day, r.agentTimeMs, r.sessions, r.toolCalls, r.turns,
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

    if (payload.richRollup) {
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
          tokens_input, tokens_output, tokens_cache_read, tokens_cache_write
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
          $24, $25, $26, $27
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
          -- Preserve previously-pushed enriched extras on opt-out: re-pushing
          -- without enrichedExtras leaves the columns alone instead of
          -- nulling them. Member opt-out should be done by the team-server
          -- admin tool, not silently by every metric push.
          outcome_mix = COALESCE(EXCLUDED.outcome_mix, rich_daily_rollups.outcome_mix),
          helpfulness_mix = COALESCE(EXCLUDED.helpfulness_mix, rich_daily_rollups.helpfulness_mix),
          goal_mix = COALESCE(EXCLUDED.goal_mix, rich_daily_rollups.goal_mix),
          tokens_input = EXCLUDED.tokens_input,
          tokens_output = EXCLUDED.tokens_output,
          tokens_cache_read = EXCLUDED.tokens_cache_read,
          tokens_cache_write = EXCLUDED.tokens_cache_write,
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
        ex?.outcomeMix ? JSON.stringify(ex.outcomeMix) : null,
        ex?.helpfulnessMix ? JSON.stringify(ex.helpfulnessMix) : null,
        ex?.goalMix ? JSON.stringify(ex.goalMix) : null,
        r.tokens.input, r.tokens.output, r.tokens.cacheRead, r.tokens.cacheWrite,
      ]);
    }

    if (payload.artifactSignals && payload.richRollup) {
      await upsertDayArtifactSignals(client, teamId, membershipId, payload.richRollup.day, payload.artifactSignals);
      await reconcileTeamSkillCatalog(client, teamId, membershipId, payload.richRollup.day, payload);
    } else if (payload.richRollup) {
      // Always reconcile the catalog from skills_loaded so adopters are
      // tracked even when the file-system probe hasn't reported authorship.
      await reconcileTeamSkillCatalog(client, teamId, membershipId, payload.richRollup.day, payload);
    }

    if (!dedupHit || historyInserted > 0) {
      await client.query("UPDATE memberships SET last_seen_at = now() WHERE id = $1", [membershipId]);
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

  // nextSyncAfter is the 200-vs-202 signal at the HTTP layer: present iff
  // actual work happened. A dedup'd headline that still landed history rows
  // counts as work; a pure replay (no history work) doesn't.
  const result: IngestResult = { accepted: true };
  if (dedupHit) result.deduplicated = true;
  if (!dedupHit || historyInserted > 0) {
    result.nextSyncAfter = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  }
  if (payload.snapshotHistory?.length) {
    const received = payload.snapshotHistory.length;
    result.snapshotHistory = {
      received,
      inserted: historyInserted,
      skipped: received - historyInserted,
    };
  }
  if (commands.length > 0) result.commands = commands;
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

// Stable hash for matching skill identity across members. Importing crypto
// here so the file's other helpers don't grow a top-level dependency.
function hashStable(s: string): string {
  // Lazily required — Node's crypto is fine here.
  const { createHash } = require("node:crypto");
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
