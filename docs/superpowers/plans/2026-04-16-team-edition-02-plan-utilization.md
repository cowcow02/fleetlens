# Team Edition Plan Utilization — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the finance view with plan-optimizer recommendations and capacity burndown on top of the Doc 1 foundation.

**Architecture:** Extends `packages/team-server` with `plan_utilization` table + materialized view, plan-optimizer decision engine as pure functions, capacity burndown computation. Extends the CLI daemon to read `~/.cclens/usage.jsonl` and include `usageSnapshot` in ingest payloads.

**Tech Stack:** Same as Plan 1, plus Recharts for utilization charts.

**Spec:** `docs/superpowers/specs/2026-04-16-team-edition-02-plan-utilization-design.md`

**Depends on:** Plan 1 (Foundation) must be complete.

---

## File Structure

### New/modified in `packages/team-server/`

```
src/
  db/
    schema-doc2.sql                # plan_utilization table, plan_tier column migration, mat view
  lib/
    plan-optimizer.ts              # pure decision-rule functions
    capacity-burndown.ts           # projected end-of-window computation
    plan-tiers.ts                  # PLAN_TIERS catalog constant
  app/
    team/[slug]/
      plan/
        page.tsx                   # Finance view page
    api/team/
      plan-optimizer/
        route.ts                   # GET /api/team/plan-optimizer
      capacity-warnings/
        route.ts                   # GET /api/team/capacity-warnings
  components/
    optimizer-card.tsx             # per-member recommendation card
    utilization-chart.tsx          # Recharts line chart for weekly peak %
    burndown-card.tsx              # capacity burndown warning card
    plan-tuning.tsx                # optimizer threshold sliders
test/
  lib/
    plan-optimizer.test.ts         # every rule branch + boundary cases
    capacity-burndown.test.ts
  api/
    plan-optimizer.integration.test.ts
```

### Modified in `packages/cli/`

```
src/
  team/
    push.ts                        # MODIFY: add usageSnapshot from ~/.cclens/usage.jsonl
  daemon-worker.ts                 # MODIFY: read latest usage snapshot, include in push
test/
  team/
    push.test.ts                   # extend: test usageSnapshot inclusion
```

---

## Chunk 1: Schema + Ingest + Daemon

### Task 1: Schema migration (plan_utilization, plan_tier column, mat view)

**Files:**
- Create: `packages/team-server/src/db/schema-doc2.sql`
- Modify: `packages/team-server/src/db/migrate.ts` (apply doc2 schema after doc1)
- Create: `packages/team-server/test/db/migrate-doc2.test.ts`

- [ ] **Step 1: Write schema-doc2.sql**

```sql
-- plan_tier column on members (Doc 2 owns this migration)
ALTER TABLE members ADD COLUMN IF NOT EXISTS
  plan_tier text NOT NULL DEFAULT 'pro-max'
  CHECK (plan_tier IN ('pro', 'pro-max', 'pro-max-20x', 'custom'));

-- plan_utilization table
CREATE TABLE IF NOT EXISTS plan_utilization (
  id                              bigserial PRIMARY KEY,
  team_id                         uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  member_id                       uuid NOT NULL REFERENCES members ON DELETE CASCADE,
  captured_at                     timestamptz NOT NULL,
  five_hour_utilization           real,
  five_hour_resets_at             timestamptz,
  seven_day_utilization           real,
  seven_day_resets_at             timestamptz,
  seven_day_opus_utilization      real,
  seven_day_sonnet_utilization    real,
  seven_day_oauth_apps_utilization real,
  seven_day_cowork_utilization    real,
  extra_usage_enabled             boolean NOT NULL DEFAULT false,
  extra_usage_monthly_limit_usd   real,
  extra_usage_used_credits_usd    real,
  extra_usage_utilization         real,
  UNIQUE (team_id, member_id, captured_at)
);
CREATE INDEX IF NOT EXISTS idx_pu_team_captured ON plan_utilization (team_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_pu_team_member_captured ON plan_utilization (team_id, member_id, captured_at DESC);

-- materialized view
CREATE MATERIALIZED VIEW IF NOT EXISTS member_weekly_utilization AS
SELECT
  team_id, member_id,
  date_trunc('day', seven_day_resets_at - interval '7 days') AS window_start_day,
  MAX(seven_day_resets_at) AS window_end,
  MAX(seven_day_utilization) AS peak_seven_day_pct,
  AVG(seven_day_utilization) AS avg_seven_day_pct,
  MAX(five_hour_utilization) AS peak_five_hour_pct,
  MAX(seven_day_opus_utilization) AS peak_opus_pct,
  MAX(seven_day_sonnet_utilization) AS peak_sonnet_pct,
  MAX(extra_usage_used_credits_usd) AS peak_extra_credits_usd,
  MAX(extra_usage_monthly_limit_usd) AS extra_monthly_limit_usd,
  COUNT(*) AS snapshot_count,
  COUNT(DISTINCT date_trunc('day', captured_at)) AS distinct_days_observed,
  MAX(captured_at) AS last_captured_at
FROM plan_utilization
WHERE seven_day_resets_at IS NOT NULL
GROUP BY team_id, member_id, date_trunc('day', seven_day_resets_at - interval '7 days');

CREATE UNIQUE INDEX IF NOT EXISTS idx_mwu_key
  ON member_weekly_utilization (team_id, member_id, window_start_day);
```

- [ ] **Step 2: Write failing test — verify table + view exist after migration**
- [ ] **Step 3: Update migrate.ts to apply schema-doc2.sql after schema.sql**
- [ ] **Step 4: Run test, commit**

### Task 2: Ingest extension — accept usageSnapshot

**Files:**
- Modify: `packages/team-server/src/lib/zod-schemas.ts`
- Modify: `packages/team-server/src/lib/ingest.ts`
- Create: `packages/team-server/test/lib/ingest-usage.test.ts`

- [ ] **Step 1: Add Zod schema for usageSnapshot**

```ts
const UsageWindowSchema = z.object({
  utilization: z.number().nullable(),
  resetsAt: z.string().datetime().nullable(),
}).passthrough();

const ExtraUsageSchema = z.object({
  isEnabled: z.boolean(),
  monthlyLimitUsd: z.number().nullable(),
  usedCreditsUsd: z.number().nullable(),
  utilization: z.number().nullable(),
}).passthrough().nullable();

export const UsageSnapshotSchema = z.object({
  capturedAt: z.string().datetime(),
  fiveHour: UsageWindowSchema,
  sevenDay: UsageWindowSchema,
  sevenDayOpus: UsageWindowSchema.nullable(),
  sevenDaySonnet: UsageWindowSchema.nullable(),
  sevenDayOauthApps: UsageWindowSchema.nullable(),
  sevenDayCowork: UsageWindowSchema.nullable(),
  extraUsage: ExtraUsageSchema,
}).passthrough();

// Extend IngestPayload:
export const IngestPayload = z.object({
  ingestId: z.string(),
  observedAt: z.string().datetime(),
  dailyRollup: DailyRollupSchema,
  usageSnapshot: UsageSnapshotSchema.optional(),  // NEW in Doc 2
}).passthrough();
```

- [ ] **Step 2: Extend ingest.ts processIngest**

After the daily_rollup upsert, if `payload.usageSnapshot` is present:

```ts
if (payload.usageSnapshot) {
  const u = payload.usageSnapshot;
  await client.query(`
    INSERT INTO plan_utilization (team_id, member_id, captured_at,
      five_hour_utilization, five_hour_resets_at,
      seven_day_utilization, seven_day_resets_at,
      seven_day_opus_utilization, seven_day_sonnet_utilization,
      seven_day_oauth_apps_utilization, seven_day_cowork_utilization,
      extra_usage_enabled, extra_usage_monthly_limit_usd,
      extra_usage_used_credits_usd, extra_usage_utilization)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    ON CONFLICT (team_id, member_id, captured_at) DO NOTHING
  `, [teamId, memberId, u.capturedAt,
      u.fiveHour.utilization, u.fiveHour.resetsAt,
      u.sevenDay.utilization, u.sevenDay.resetsAt,
      u.sevenDayOpus?.utilization, u.sevenDaySonnet?.utilization,
      u.sevenDayOauthApps?.utilization, u.sevenDayCowork?.utilization,
      u.extraUsage?.isEnabled ?? false, u.extraUsage?.monthlyLimitUsd,
      u.extraUsage?.usedCreditsUsd, u.extraUsage?.utilization]);
}
```

- [ ] **Step 3: Write unit test — usageSnapshot present → row in plan_utilization; absent → no row**
- [ ] **Step 4: Run tests, commit**

### Task 3: Daemon extension — read usage.jsonl and include in push

**Files:**
- Modify: `packages/cli/src/team/push.ts`
- Modify: `packages/cli/src/daemon-worker.ts`
- Modify: `packages/cli/test/team/push.test.ts`

- [ ] **Step 1: Add `readLatestUsageSnapshot()` function**

Reads `~/.cclens/usage.jsonl`, finds the last line with `captured_at` within the last 10 minutes, converts snake_case fields to camelCase for the wire format.

- [ ] **Step 2: Include in payload builder**

```ts
const usageSnapshot = readLatestUsageSnapshot();
const payload = { ingestId, observedAt, dailyRollup, ...(usageSnapshot ? { usageSnapshot } : {}) };
```

- [ ] **Step 3: Test — mock a usage.jsonl, verify snapshot appears in built payload**
- [ ] **Step 4: Commit**

### Task 4: Materialized view refresh + prune jobs

**Files:**
- Modify: `packages/team-server/src/lib/scheduler.ts`

- [ ] **Step 1: Add two cron jobs**

```ts
// :05 past every hour — refresh mat view
new CronJob("5 * * * *", async () => {
  await pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY member_weekly_utilization");
}, null, true, "UTC");

// 04:00 UTC daily — prune plan_utilization older than retention
new CronJob("0 4 * * *", async () => {
  // Per-team prune respecting teams.retention_days
  await pool.query(`
    DELETE FROM plan_utilization pu
    USING teams t
    WHERE pu.team_id = t.id
      AND pu.captured_at < now() - make_interval(days => t.retention_days)
  `);
}, null, true, "UTC");
```

- [ ] **Step 2: Commit**

---

## Chunk 2: Optimizer + Burndown + UI

### Task 5: Plan tier catalog

**Files:**
- Create: `packages/team-server/src/lib/plan-tiers.ts`

- [ ] **Step 1: Write catalog constant**

```ts
export const PLAN_TIERS = {
  pro:           { label: "Claude Pro",         weeklyLimitUsd: 20,  rank: 0 },
  "pro-max":     { label: "Claude Pro Max",     weeklyLimitUsd: 100, rank: 1 },
  "pro-max-20x": { label: "Claude Pro Max 20x", weeklyLimitUsd: 200, rank: 2 },
  custom:        { label: "Custom",             weeklyLimitUsd: 0,   rank: -1 },
} as const;

export const PLAN_TIERS_IN_ORDER = Object.entries(PLAN_TIERS)
  .filter(([, v]) => v.rank >= 0)
  .sort(([, a], [, b]) => a.rank - b.rank)
  .map(([key, val]) => ({ key, ...val }));
```

- [ ] **Step 2: Commit**

### Task 6: Plan optimizer engine

**Files:**
- Create: `packages/team-server/src/lib/plan-optimizer.ts`
- Create: `packages/team-server/test/lib/plan-optimizer.test.ts`

- [ ] **Step 1: Write failing tests for every rule branch**

Test cases: insufficient data, top-up-needed (peak > 100), upgrade-urgent (entry tier + peak > 95), upgrade (avg > 80), downgrade (high tier + avg < 40 + peak < 60), stay (in between), custom tier → review_manually. Boundary cases: exactly at threshold.

- [ ] **Step 2: Implement the ordered-pseudocode recommend() function from the spec**

Pure function — takes member stats + tier catalog entry + optimizer settings → returns recommendation.

- [ ] **Step 3: Run tests, fix until green, commit**

### Task 7: Capacity burndown engine

**Files:**
- Create: `packages/team-server/src/lib/capacity-burndown.ts`
- Create: `packages/team-server/test/lib/capacity-burndown.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases: yellow (85-100% projected), red (>100% projected), info (healthy), edge case: all members just reset (window_fraction near 0 → skip projection).

- [ ] **Step 2: Implement the computation from the spec**

Query latest snapshot per member → compute team-level spend → project → threshold check.

- [ ] **Step 3: Run tests, commit**

### Task 8: API endpoints (plan-optimizer, capacity-warnings)

**Files:**
- Create: `packages/team-server/src/app/api/team/plan-optimizer/route.ts`
- Create: `packages/team-server/src/app/api/team/capacity-warnings/route.ts`
- Create: `packages/team-server/test/api/plan-optimizer.integration.test.ts`

- [ ] **Step 1: Wire optimizer to GET endpoint**

For each non-revoked member: read 30 days from `member_weekly_utilization`, look up `members.plan_tier` → catalog, run `recommend()`, collect results, compute summary.

- [ ] **Step 2: Wire burndown to GET endpoint**

Read latest snapshot per member, compute, return warnings.

- [ ] **Step 3: Write integration test — seed fixtures, verify response shapes**
- [ ] **Step 4: Commit**

### Task 9: Finance view page + profile enhancement

**Files:**
- Create: `packages/team-server/src/app/team/[slug]/plan/page.tsx`
- Create: `packages/team-server/src/components/optimizer-card.tsx`
- Create: `packages/team-server/src/components/utilization-chart.tsx`
- Create: `packages/team-server/src/components/burndown-card.tsx`
- Create: `packages/team-server/src/components/plan-tuning.tsx`
- Modify: `packages/team-server/src/app/team/[slug]/members/[id]/page.tsx`
- Modify: `packages/team-server/src/app/team/[slug]/layout.tsx` (add Plan nav link)

- [ ] **Step 1: Implement Finance view page**

Server component fetching from `/api/team/plan-optimizer` + `/api/team/capacity-warnings`. Renders: summary card, per-member recommendation grid, burndown card, utilization charts (Recharts), tuning accordion (collapsed).

- [ ] **Step 2: Implement optimizer-card.tsx, utilization-chart.tsx, burndown-card.tsx**
- [ ] **Step 3: Add plan utilization section to per-member profile page with visibility gate (admin-or-self only)**
- [ ] **Step 4: Add Settings → Plan subsection (tuning sliders, default tier, per-member tier editor, CSV export)**
- [ ] **Step 5: Test in browser — verify the full finance flow with synthetic data**
- [ ] **Step 6: Commit**

### Task 10: End-to-end smoke test

- [ ] **Step 1: Seed 3 test members with varying plan_utilization data for 30 days**
- [ ] **Step 2: Verify plan-optimizer returns correct recommendations for each**
- [ ] **Step 3: Verify burndown fires a yellow warning with the seeded data**
- [ ] **Step 4: Verify the Finance page renders all cards correctly in the browser**
- [ ] **Step 5: Commit**

---

## Summary

**10 tasks across 2 chunks.** Estimated: **4-5 weeks** for one developer on top of Plan 1.

**Key integration point:** daemon reads real `~/.cclens/usage.jsonl` → converts to camelCase `usageSnapshot` → team server stores in `plan_utilization` → mat view refreshes hourly → optimizer reads mat view → Finance page renders recommendations.
