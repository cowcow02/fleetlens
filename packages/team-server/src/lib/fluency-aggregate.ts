/**
 * Manager-readable fluency aggregator.
 *
 * After any member pushes a scorecard for a given (team × week), this
 * module:
 *   1. Stores the scorecard in `fluency_member_scorecards` (private —
 *      indexed by membership, never queried by the team page).
 *   2. Re-derives the team aggregate from ALL member scorecards in the
 *      same week and writes it to `fluency_team_aggregate`.
 *
 * The team page reads ONLY from `fluency_team_aggregate`. There is no
 * code path that lets manager-side queries reach into another member's
 * scorecard row. Per-engineer scorecards stay private by construction.
 */

import type pg from "pg";
import { Fluency } from "@claude-lens/entries";

type FluencyScorecard = Fluency.FluencyScorecard;

export async function upsertMemberScorecard(
  teamId: string,
  membershipId: string,
  weekMonday: string,
  scorecard: FluencyScorecard,
  pool: pg.Pool,
): Promise<void> {
  await pool.query(
    `INSERT INTO fluency_member_scorecards
       (team_id, membership_id, week_monday, scorecard, score_numerator, score_denominator)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     ON CONFLICT (team_id, membership_id, week_monday)
     DO UPDATE SET scorecard = EXCLUDED.scorecard,
                   score_numerator = EXCLUDED.score_numerator,
                   score_denominator = EXCLUDED.score_denominator,
                   ingested_at = now()`,
    [
      teamId,
      membershipId,
      weekMonday,
      JSON.stringify(scorecard),
      scorecard.score.numerator,
      scorecard.score.denominator,
    ],
  );
}

export async function recomputeTeamAggregate(
  teamId: string,
  weekMonday: string,
  pool: pg.Pool,
): Promise<void> {
  const cardsRes = await pool.query<{ scorecard: FluencyScorecard }>(
    `SELECT scorecard FROM fluency_member_scorecards
     WHERE team_id = $1 AND week_monday = $2`,
    [teamId, weekMonday],
  );
  const cards = cardsRes.rows.map((r) => r.scorecard);

  const totalRes = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM memberships WHERE revoked_at IS NULL AND team_id = $1`,
    [teamId],
  );
  const membersTotal = totalRes.rows[0]?.n ?? cards.length;

  const teamRes = await pool.query<{ slug: string; name: string }>(
    `SELECT slug, name FROM teams WHERE id = $1`,
    [teamId],
  );
  const team = teamRes.rows[0];
  if (!team) return;

  const prevRes = await pool.query<{ report: import("@claude-lens/entries").Fluency.TeamFluencyReport }>(
    `SELECT report FROM fluency_team_aggregate
     WHERE team_id = $1 AND week_monday < $2
     ORDER BY week_monday DESC LIMIT 1`,
    [teamId, weekMonday],
  );
  const prev = prevRes.rows[0]?.report ?? null;

  const report = Fluency.buildTeamFluencyReport({
    team_slug: team.slug,
    team_name: team.name,
    week_monday: weekMonday,
    members_total: membersTotal,
    scorecards: cards,
    prev,
  });

  await pool.query(
    `INSERT INTO fluency_team_aggregate
       (team_id, week_monday, report, members_active, team_score)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     ON CONFLICT (team_id, week_monday)
     DO UPDATE SET report = EXCLUDED.report,
                   members_active = EXCLUDED.members_active,
                   team_score = EXCLUDED.team_score,
                   generated_at = now()`,
    [teamId, weekMonday, JSON.stringify(report), report.members_active, report.team_score.value],
  );
}

/** Read the latest team aggregate (most recent week_monday <= given target,
 *  or absolute latest if target omitted). Returns null if no scorecards
 *  have ever been ingested for this team. */
export async function readLatestTeamAggregate(
  teamId: string,
  target: string | null,
  pool: pg.Pool,
): Promise<import("@claude-lens/entries").Fluency.TeamFluencyReport | null> {
  const res = target
    ? await pool.query<{ report: import("@claude-lens/entries").Fluency.TeamFluencyReport }>(
        `SELECT report FROM fluency_team_aggregate
         WHERE team_id = $1 AND week_monday <= $2
         ORDER BY week_monday DESC LIMIT 1`,
        [teamId, target],
      )
    : await pool.query<{ report: import("@claude-lens/entries").Fluency.TeamFluencyReport }>(
        `SELECT report FROM fluency_team_aggregate
         WHERE team_id = $1
         ORDER BY week_monday DESC LIMIT 1`,
        [teamId],
      );
  return res.rows[0]?.report ?? null;
}
