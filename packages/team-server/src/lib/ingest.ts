import pg from "pg";
import { getPool } from "../db/pool";
import { IngestPayload, UsageHistoryPayload } from "./zod-schemas";
import { refreshMembershipWeeklyUtilization } from "./scheduler";
import { broadcastEvent } from "./sse";

export async function processIngest(
  raw: unknown,
  membershipId: string,
  teamId: string,
  pool?: pg.Pool
) {
  const p = pool || getPool();
  const payload = IngestPayload.parse(raw);

  const client = await p.connect();
  try {
    await client.query("BEGIN");

    const logRes = await client.query(
      "INSERT INTO ingest_log (ingest_id, team_id, membership_id) VALUES ($1, $2, $3) ON CONFLICT (ingest_id) DO NOTHING RETURNING 1",
      [payload.ingestId, teamId, membershipId]
    );
    if (logRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return { accepted: true, deduplicated: true };
    }

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

    if (payload.planTier) {
      // Server-trusted source of truth — the daemon read this directly from
      // Anthropic's profile endpoint. Admin can still override post-hoc;
      // the next daemon push will reassert if Anthropic still reports the
      // same tier.
      await upsertMembershipPlanTier(client, teamId, membershipId, payload.planTier);
    }

    if (payload.usageSnapshot) {
      const u = payload.usageSnapshot;
      await client.query(`
        INSERT INTO plan_utilization (
          team_id, membership_id, captured_at,
          five_hour_utilization, five_hour_resets_at,
          seven_day_utilization, seven_day_resets_at,
          seven_day_opus_utilization, seven_day_sonnet_utilization,
          seven_day_oauth_apps_utilization, seven_day_cowork_utilization,
          extra_usage_enabled, extra_usage_monthly_limit_usd,
          extra_usage_used_credits_usd, extra_usage_utilization
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (team_id, membership_id, captured_at) DO NOTHING
      `, [
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
      ]);
    }

    if (payload.cyclePeaks) {
      await upsertMembershipCyclePeaks(client, teamId, membershipId, payload.cyclePeaks);
    }

    await client.query("UPDATE memberships SET last_seen_at = now() WHERE id = $1", [membershipId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  broadcastEvent(teamId, "roster-updated", { membershipId });
  return { accepted: true, nextSyncAfter: new Date(Date.now() + 5 * 60 * 1000).toISOString() };
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

// Bulk-loads historical UsageSnapshot rows from the daemon's local
// usage.jsonl. Called once on first `team join` so the dashboard reflects
// pre-pairing data instead of waiting 7+ days to leave "insufficient_data".
// Idempotent via the (team_id, membership_id, captured_at) unique key, so
// it's safe to re-run.
export async function processUsageHistory(
  raw: unknown,
  membershipId: string,
  teamId: string,
  pool?: pg.Pool,
) {
  const p = pool || getPool();
  const { snapshots, planTier } = UsageHistoryPayload.parse(raw);

  let inserted = 0;
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    if (planTier) {
      await upsertMembershipPlanTier(client, teamId, membershipId, planTier);
    }
    for (const u of snapshots) {
      const res = await client.query(
        `INSERT INTO plan_utilization (
           team_id, membership_id, captured_at,
           five_hour_utilization, five_hour_resets_at,
           seven_day_utilization, seven_day_resets_at,
           seven_day_opus_utilization, seven_day_sonnet_utilization,
           seven_day_oauth_apps_utilization, seven_day_cowork_utilization,
           extra_usage_enabled, extra_usage_monthly_limit_usd,
           extra_usage_used_credits_usd, extra_usage_utilization
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (team_id, membership_id, captured_at) DO NOTHING`,
        [
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
        ],
      );
      if (res.rowCount === 1) inserted++;
    }
    await client.query("UPDATE memberships SET last_seen_at = now() WHERE id = $1", [membershipId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Surface backfilled data on the dashboard immediately rather than waiting
  // for the hourly scheduler tick.
  if (inserted > 0) {
    try {
      await refreshMembershipWeeklyUtilization();
    } catch {
      // Refresh races with the scheduler are non-fatal — the next hourly
      // tick will correct any missed concurrent refresh.
    }
    broadcastEvent(teamId, "roster-updated", { membershipId });
  }

  return { accepted: true, received: snapshots.length, inserted, skipped: snapshots.length - inserted };
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
