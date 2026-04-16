# Fleetlens Team Edition — Doc 2: Plan Utilization Reporting

**Status:** Draft (revised after Doc 2 review iteration 1)
**Date:** 2026-04-16
**Author:** split from 2026-04-15-team-edition-design.md
**Ships:** Finance view with plan utilization charts + plan-optimizer recommendations
**Depends on:** Doc 1 (Foundation) — the team server, members, and daemon pair flow
**Enables:** Nothing directly; Docs 3 and 4 are independent extensions

## Overview

The first usable *analytical* feature of Fleetlens Team Edition, landing on top of the walking skeleton from Doc 1. Doc 2 adds:

- Per-member **plan utilization** reporting — the same 5-hour and 7-day window percentages that Claude Code's `/usage` slash command already shows, rolled up across the team
- A **plan-optimizer** recommendation engine that tells the admin which seats should move between plan tiers (`Pro` → `Pro Max` → `Pro Max 20x`, or vice versa) based on 30-day usage patterns
- **Capacity burndown** warnings when a member or team is on track to exceed their 7-day cap
- A **Finance view** dashboard page that surfaces these as actionable cards
- An **admin-configured `members.plan_tier`** field so the server knows what each member is actually paying for (Anthropic's usage API does not report dollar caps)

No Gantt, no tickets, no insights feed. Doc 2 is narrowly focused on answering *"are we paying the right amount for Claude Code?"* — the single highest-value question a finance controller has about the tool.

## Why ship Doc 2 second?

- **Highest-value first-analytical question, low technical cost.** Plan utilization is already polled by the solo edition daemon (`fleetlens daemon`, from v0.1.x). `UsageSnapshot` rows land in `~/.cclens/usage.jsonl` every 5 minutes today. Doc 2 is mostly about *shipping those snapshots to the team server* and *aggregating them into a finance view*.
- **Finance persona gets immediate wins.** A 20-person team can save $1,000-4,000/month by right-sizing seats, which easily justifies the tool's cost and generates word-of-mouth adoption.
- **Pure server-side concern.** No new UI complexity beyond charts + recommendation cards. No ticket correlation. No network calls beyond existing ingest. Small surface area for bugs.

## Personas

**Primary**: finance controller / procurement person who owns the Claude Code license budget. Primary question: "should we downgrade these 4 seats and save $400/month?"

**Secondary**: tech manager / CTO who needs capacity warnings to avoid throttling during a critical sprint.

## Non-goals for Doc 2

- Token-cost breakdowns by ticket / project — Doc 4 (once ticket correlation exists)
- Per-ticket cost reporting — Doc 4
- Historical chargeback to cost centers — v2
- Billing integration with Stripe / Anthropic's billing API — v1.1
- Multi-seat-tier comparisons beyond the known Claude Code tiers — expandable via the tier catalog
- Anomaly detection on individual usage spikes — Doc 4's insights feed
- Automated seat purchase/adjustment via Anthropic's account API — out of scope entirely

## What "plan utilization" actually is (grounded in real data)

The existing solo-edition daemon at `packages/cli/src/usage/api.ts` polls `https://api.anthropic.com/api/oauth/usage` every 5 minutes and writes `UsageSnapshot` rows to `~/.cclens/usage.jsonl`:

```ts
// packages/cli/src/usage/api.ts:29-39 (source of truth)
export type UsageSnapshot = {
  captured_at: string;                            // client ISO timestamp
  five_hour: UsageWindow;                         // rolling 5-hour window
  seven_day: UsageWindow;                         // rolling 7-day window
  seven_day_opus: UsageWindow | null;             // per-model cap (Opus)
  seven_day_sonnet: UsageWindow | null;           // per-model cap (Sonnet)
  seven_day_oauth_apps: UsageWindow | null;       // aggregate across OAuth apps
  seven_day_cowork: UsageWindow | null;           // cowork tier, if applicable
  extra_usage: ExtraUsage | null;                 // top-up credits, when enabled
};

export type UsageWindow = {
  utilization: number | null;                     // 0-100 scale percentage
  resets_at: string | null;                       // ISO timestamp when window resets
};

export type ExtraUsage = {
  is_enabled: boolean;
  monthly_limit: number | null;                   // monthly credit ceiling in dollars
  used_credits: number | null;                    // dollars consumed so far
  utilization: number | null;                     // 0-100 scale
};
```

**Key facts** (these shape every downstream design decision in Doc 2):

1. **Utilization is a 0-100 percentage**, not a 0.0-1.0 fraction. This matches how the solo edition renders it (`format.ts:38` uses `${pct.toFixed(1)}%`). Doc 2 stores and reasons in 0-100 throughout.
2. **Anthropic does NOT report dollar caps per window.** There is no `weekly_limit_usd` field in the API response. A member's dollar cap must be derived from knowing *which plan tier they are on* — and the API doesn't tell us that either.
3. **The `seven_day` window is rolling, not Monday-aligned.** It resets at `resets_at`, which is 7 days after the member's first use of the current window. Doc 2 uses the rolling window directly rather than inventing a "Monday start" the API doesn't support.
4. **The `extra_usage` block is the top-up credit system.** When enabled, it reports dollar-denominated monthly caps and used credits. Most members will not have this enabled; when they do, it gives us the only dollar figure the API actually provides.
5. **Per-model utilization windows exist** for Opus / Sonnet / OAuth apps / Cowork separately. This matters for the optimizer: a member hitting 100% of their Opus cap while sitting at 30% of the combined 7-day cap is a different story than hitting 90% of everything.

### Deriving dollar amounts from plan tier

Since the API can't tell us dollar caps, Doc 2 introduces an **admin-configured plan tier per member**. The tier is stored on `members.plan_tier` and maps to a fixed catalog of dollar caps in server code:

```ts
// Server-side tier catalog
const PLAN_TIERS: Record<string, { label: string; weeklyLimitUsd: number }> = {
  "pro":           { label: "Claude Pro",          weeklyLimitUsd: 20 },
  "pro-max":       { label: "Claude Pro Max",      weeklyLimitUsd: 100 },
  "pro-max-20x":   { label: "Claude Pro Max 20x",  weeklyLimitUsd: 200 },
  "custom":        { label: "Custom",              weeklyLimitUsd: 0 },   // dollar-unaware
};
```

Admins set each member's `plan_tier` at invite time (default `pro-max`) or edit it later in Settings → Members. The server multiplies `seven_day.utilization / 100 × weeklyLimitUsd` to estimate the member's current weekly spend. For the `custom` tier, the Finance view shows percentages only — no dollar numbers, no optimizer recommendations.

The top-up credit story lives in `extra_usage`: when present, `used_credits` is the authoritative dollar number and the tier catalog's `weeklyLimitUsd` is ignored in favor of `extra_usage.monthly_limit / 4.33` as the weekly-equivalent cap. This is the only path that produces actual server-reported dollars.

## Data model

### Doc 1 schema addition: `members.plan_tier`

This is a Doc 1 schema change that Doc 2 owns. It is a one-column migration:

```sql
ALTER TABLE members
  ADD COLUMN plan_tier text NOT NULL DEFAULT 'pro-max'
    CHECK (plan_tier IN ('pro', 'pro-max', 'pro-max-20x', 'custom'));
```

Rationale for putting this in Doc 2 rather than Doc 1: Doc 1 does not need the column — nothing Doc 1 ships reads or writes it. Doc 2 is the first consumer. The migration runs when the server is upgraded from Doc-1-era to Doc-2-era.

### New table: `plan_utilization`

One row per snapshot shipped. The schema matches the real `UsageSnapshot` shape rather than the fabricated one from the earlier draft.

```sql
CREATE TABLE plan_utilization (
  id                              bigserial PRIMARY KEY,
  team_id                         uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  member_id                       uuid NOT NULL REFERENCES members ON DELETE CASCADE,
  captured_at                     timestamptz NOT NULL,                -- client ISO, from UsageSnapshot.captured_at
  five_hour_utilization           real,                                -- 0-100, nullable
  five_hour_resets_at             timestamptz,
  seven_day_utilization           real,                                -- 0-100, nullable
  seven_day_resets_at             timestamptz,
  seven_day_opus_utilization      real,                                -- 0-100, nullable
  seven_day_sonnet_utilization    real,                                -- 0-100, nullable
  seven_day_oauth_apps_utilization real,                               -- 0-100, nullable
  seven_day_cowork_utilization    real,                                -- 0-100, nullable
  extra_usage_enabled             boolean NOT NULL DEFAULT false,
  extra_usage_monthly_limit_usd   real,                                -- dollars, from extra_usage.monthly_limit
  extra_usage_used_credits_usd    real,                                -- dollars, from extra_usage.used_credits
  extra_usage_utilization         real,                                -- 0-100, from extra_usage.utilization
  UNIQUE (team_id, member_id, captured_at)                             -- idempotent on retry
);
CREATE INDEX ON plan_utilization (team_id, captured_at DESC);
CREATE INDEX ON plan_utilization (team_id, member_id, captured_at DESC);
```

The `UNIQUE` constraint handles C1's M6 finding: if Doc 1's request-level dedupe lets a retry through (e.g., because `ingest_log` expired), the `captured_at` uniqueness blocks the duplicate insert at the row level.

### Derived table: `member_weekly_utilization` (materialized view, refreshed hourly)

The materialized view groups by a **daemon-computed rolling 7-day window label**. Since Anthropic's window is rolling, the label is simply the `date_trunc('day', seven_day_resets_at - interval '7 days')` — the date the current 7-day window started. This is stable within a single 7-day window and changes atomically when `resets_at` advances.

```sql
CREATE MATERIALIZED VIEW member_weekly_utilization AS
SELECT
  team_id,
  member_id,
  date_trunc('day', seven_day_resets_at - interval '7 days') AS window_start_day,
  MAX(seven_day_resets_at)                                   AS window_end,
  -- aggregated utilization stats over all snapshots in this 7-day window:
  MAX(seven_day_utilization)    AS peak_seven_day_pct,
  AVG(seven_day_utilization)    AS avg_seven_day_pct,
  MAX(five_hour_utilization)    AS peak_five_hour_pct,
  MAX(seven_day_opus_utilization)    AS peak_opus_pct,
  MAX(seven_day_sonnet_utilization)  AS peak_sonnet_pct,
  MAX(extra_usage_used_credits_usd)  AS peak_extra_credits_usd,
  MAX(extra_usage_monthly_limit_usd) AS extra_monthly_limit_usd,
  COUNT(*)                       AS snapshot_count,
  COUNT(DISTINCT date_trunc('day', captured_at)) AS distinct_days_observed,
  MAX(captured_at)               AS last_captured_at
FROM plan_utilization
WHERE seven_day_resets_at IS NOT NULL
GROUP BY team_id, member_id, date_trunc('day', seven_day_resets_at - interval '7 days');

CREATE UNIQUE INDEX ON member_weekly_utilization (team_id, member_id, window_start_day);
```

Refreshed by extending Doc 1's existing `node-cron` scheduler with a new job at `:05` past every hour: `REFRESH MATERIALIZED VIEW CONCURRENTLY member_weekly_utilization`. Uses the unique index so the view stays readable during refresh. The scheduler extension is a single line added to the existing cron config set up in Doc 1, not a second process.

**Why `distinct_days_observed` matters**: it's the unambiguous answer to "did this member run their daemon for enough days to trust the recommendation?" See the optimizer rules below for how this is used.

### No changes to Doc 1's `daily_rollups`

Doc 1's `daily_rollups` stores token counts, which are a proxy for cost (via the `pricing.ts` estimator in solo edition) but are NOT the same as Anthropic's reported utilization. Doc 2 does not duplicate or touch `daily_rollups`. The two tables answer different questions:
- `daily_rollups`: "how much activity did Alice have?" (tokens, sessions, tool calls)
- `plan_utilization`: "how much of her plan did Anthropic say she consumed?" (5-hour pct, 7-day pct, top-up credits used)

They're correlated but the optimizer uses `plan_utilization` as ground truth because it's what Anthropic actually charges against.

## Ingest API extension

Doc 1's `POST /api/ingest/metrics` endpoint gains one new optional top-level field: `usageSnapshot`. The field name is chosen to match the existing solo-edition type, not a new one.

```json
{
  "ingestId": "01HV9KQ8N3W7XC4M2YR5T9D6F8",
  "observedAt": "2026-04-16T10:30:00Z",
  "dailyRollup": {
    "day": "2026-04-16",
    "agentTimeMs": 14700000,
    "sessions": 5,
    "toolCalls": 342,
    "turns": 78,
    "tokens": { "input": 1200000, "output": 85000, "cacheRead": 9800000, "cacheWrite": 450000 }
  },
  "usageSnapshot": {
    "capturedAt": "2026-04-16T10:29:50Z",
    "fiveHour":         { "utilization": 23.7, "resetsAt": "2026-04-16T14:00:00Z" },
    "sevenDay":         { "utilization": 47.2, "resetsAt": "2026-04-19T00:00:00Z" },
    "sevenDayOpus":     { "utilization": 61.0, "resetsAt": "2026-04-19T00:00:00Z" },
    "sevenDaySonnet":   { "utilization": 31.4, "resetsAt": "2026-04-19T00:00:00Z" },
    "sevenDayOauthApps": null,
    "sevenDayCowork":   null,
    "extraUsage":       null
  }
}
```

**Doc 1 server compatibility**: because Doc 1 parses all request bodies permissively at every level, a Doc 2 daemon pushing this payload to a Doc 1 server is silently ignored for the new field and accepted for the rest.

**Daemon-side responsibility**: on every 5-minute cycle, the daemon reads the latest line from `~/.cclens/usage.jsonl` (if present and the newest entry is less than 10 minutes old) and includes it as the `usageSnapshot` field. The daemon converts snake_case solo-edition field names to camelCase for the wire format (team server uses camelCase throughout). If the file doesn't exist, the daemon omits the field entirely.

**Cadence**: once per 5-minute ingest cycle = 288 snapshots per member per day. Bounded table growth: 288 × 365 × 20 members = ~2.1M rows/year for a 20-person team. The `plan_utilization` prune job (below) caps this.

**Unknown-field handling**: unchanged from Doc 1's permissive-at-every-level invariant.

## Plan-optimizer recommendation engine

### Input query

For each member, read the last 30 days from `member_weekly_utilization`:

```sql
SELECT
  member_id,
  MAX(peak_seven_day_pct)        AS worst_7day_peak,
  AVG(avg_seven_day_pct)         AS avg_7day_avg,
  MAX(peak_five_hour_pct)        AS worst_5hr_peak,
  MAX(peak_opus_pct)             AS worst_opus_peak,
  SUM(distinct_days_observed)    AS total_days_observed,
  MAX(last_captured_at)          AS last_seen
FROM member_weekly_utilization
WHERE team_id = $1
  AND window_end >= now() - interval '30 days'
GROUP BY member_id;
```

### Decision rules (ordered pseudocode — first match wins)

```ts
type Recommendation =
  | { action: "insufficient_data" }
  | { action: "top_up_needed", rationale: string }
  | { action: "upgrade_urgent", targetTier: string, rationale: string }
  | { action: "upgrade", targetTier: string, rationale: string }
  | { action: "downgrade", targetTier: string, estimatedSavingsUsd: number, rationale: string }
  | { action: "stay", rationale: string };

function recommend(m: MemberStats, tier: TierCatalogEntry, settings: OptimizerSettings): Recommendation {
  // 1. Not enough data — always defer
  if (m.total_days_observed < settings.minDaysRequired) {
    return { action: "insufficient_data" };
  }

  // 2. Any 7-day window hit 100%+ utilization — top-up or upgrade needed
  if (m.worst_7day_peak >= 100) {
    return {
      action: "top_up_needed",
      rationale: `Hit ${m.worst_7day_peak.toFixed(0)}% of 7-day cap at least once in the last 30 days. Throttling risk.`
    };
  }

  // 3. On the entry-level tier and consistently >80% avg — urgent upgrade
  if (tier.rank <= 1 && m.worst_7day_peak >= settings.urgentUpgradeIfMaxAbove) {
    return {
      action: "upgrade_urgent",
      targetTier: PLAN_TIERS_IN_ORDER[tier.rank + 1].key,
      rationale: `Peaked at ${m.worst_7day_peak.toFixed(0)}% on ${tier.label}. Upgrade to avoid throttling.`
    };
  }

  // 4. Consistently >80% avg — upgrade recommended (non-urgent)
  if (m.avg_7day_avg >= settings.upgradeIfAvgAbove) {
    return {
      action: "upgrade",
      targetTier: PLAN_TIERS_IN_ORDER[tier.rank + 1].key,
      rationale: `Averaging ${m.avg_7day_avg.toFixed(0)}% of ${tier.label}. Upgrade gives headroom.`
    };
  }

  // 5. On a higher tier and consistently <40% with peak <60% — downgrade saves money
  if (tier.rank >= 2
      && m.avg_7day_avg < settings.downgradeIfAvgBelow
      && m.worst_7day_peak < settings.downgradeIfMaxBelow) {
    const targetTier = PLAN_TIERS_IN_ORDER[tier.rank - 1];
    return {
      action: "downgrade",
      targetTier: targetTier.key,
      estimatedSavingsUsd: (tier.weeklyLimitUsd - targetTier.weeklyLimitUsd) * 4.33, // weekly → monthly
      rationale: `Averaging ${m.avg_7day_avg.toFixed(0)}% with peak ${m.worst_7day_peak.toFixed(0)}% on ${tier.label}. Downgrading to ${targetTier.label} retains ${Math.round((1 - m.worst_7day_peak / 100) * 100)}% headroom.`
    };
  }

  // 6. Everything else — no action
  return {
    action: "stay",
    rationale: `Plan well-matched to usage: avg ${m.avg_7day_avg.toFixed(0)}%, peak ${m.worst_7day_peak.toFixed(0)}%.`
  };
}
```

**Thresholds** live in `teams.settings.planOptimizer` as a JSON block with defaults:

```json
{
  "planOptimizer": {
    "minDaysRequired": 14,
    "upgradeIfAvgAbove": 80,
    "urgentUpgradeIfMaxAbove": 95,
    "downgradeIfAvgBelow": 40,
    "downgradeIfMaxBelow": 60
  }
}
```

All values are 0-100 percentages. The 14-day minimum guarantees a meaningful window has been observed (two full 7-day windows at least). Admins can tune via the Settings → Plan tuning accordion.

### Confidence levels

- **high**: ≥ 21 distinct days of observation, clear rule match, member not on `custom` tier
- **medium**: 14-20 days, rule match, or any edge case
- **low**: rule matched but stats sit within 10pp of a threshold boundary (ambiguous)
- **insufficient**: < 14 days — returns the `insufficient_data` action

The UI renders `low` and `insufficient` as "collecting more data" rather than actionable cards.

### `custom` tier handling

Members with `plan_tier = 'custom'` get:
- No dollar savings numbers (the tier has `weeklyLimitUsd: 0`)
- Recommendation limited to `{ action: "review_manually", rationale: string }` even if their utilization pattern would otherwise match an automated rule
- A banner on the Finance view: "N members on custom tiers — review their plans manually"

The `review_manually` action is separate from `insufficient_data` because the member has plenty of data; the optimizer just can't compute dollar deltas without a known tier.

### Output endpoint

```http
GET /api/team/plan-optimizer
Authorization: admin session cookie
```

Response:

```json
{
  "recommendations": [
    {
      "memberId": "uuid...",
      "memberName": "Alice Wong",
      "currentPlan": { "key": "pro-max-20x", "label": "Claude Pro Max 20x", "weeklyLimitUsd": 200 },
      "usage": {
        "avgSevenDayPct": 32.1,
        "worstSevenDayPeak": 51.4,
        "worstFiveHourPeak": 68.0,
        "totalDaysObserved": 28,
        "lastSeen": "2026-04-16T10:29:50Z"
      },
      "recommendation": {
        "action": "downgrade",
        "targetTier": { "key": "pro-max", "label": "Claude Pro Max", "weeklyLimitUsd": 100 },
        "estimatedSavingsUsd": 433,
        "confidence": "high",
        "rationale": "Averaging 32% with peak 51% on Claude Pro Max 20x. Downgrading to Claude Pro Max retains 49% headroom."
      }
    }
  ],
  "summary": {
    "membersToUpgrade": 1,
    "membersToDowngrade": 1,
    "membersCustomTier": 0,
    "membersInsufficientData": 2,
    "estimatedMonthlyDelta": -100
  }
}
```

`estimatedMonthlyDelta` is the **net** impact of acting on all recommendations. Negative = savings, positive = spend increase. Finance controllers want one bottom-line number.

## Capacity burndown warnings

Near-real-time warnings when the team is on track to hit its collective cap in the current rolling 7-day window.

### Computation

For each team, compute:

```sql
-- Most recent snapshot per member in the last hour
WITH latest AS (
  SELECT DISTINCT ON (member_id)
    member_id, seven_day_utilization, seven_day_resets_at, captured_at
  FROM plan_utilization
  WHERE team_id = $1 AND captured_at > now() - interval '1 hour'
  ORDER BY member_id, captured_at DESC
)
SELECT
  -- current team spend, dollars this 7-day window
  SUM((l.seven_day_utilization / 100.0) * pt.weekly_limit_usd) AS current_spend_usd,
  -- team cap
  SUM(pt.weekly_limit_usd) AS team_cap_usd,
  -- average fraction of window elapsed (members may have different reset days)
  AVG(EXTRACT(epoch FROM (now() - (l.seven_day_resets_at - interval '7 days'))) / (7 * 86400)) AS avg_window_fraction_elapsed
FROM latest l
JOIN members m ON m.id = l.member_id
JOIN (
  -- inlined tier catalog
  VALUES ('pro', 20), ('pro-max', 100), ('pro-max-20x', 200), ('custom', NULL)
) pt(tier_key, weekly_limit_usd) ON pt.tier_key = m.plan_tier
WHERE pt.weekly_limit_usd IS NOT NULL;  -- exclude custom tier members from the warning
```

Then project:

```
projected_end_of_window_spend = current_spend_usd / avg_window_fraction_elapsed
```

### Thresholds (on the projected end-of-window spend)

- **Red (throttling risk)**: projected > 100% of team cap AND avg window fraction < 0.8 (i.e., still time for it to matter)
- **Yellow (near cap)**: projected 85-100% of team cap AND avg window fraction < 0.7
- **Info (healthy)**: anything else — no card shown

### Caveats

The "rolling window per member" model means members have different `resets_at` values. The aggregation averages `avg_window_fraction_elapsed`, which is a rough proxy — a member who just reset and a member near the end of their window mix awkwardly. This is stated in the UI: "Projected end-of-window is an approximation across members whose 7-day windows are not Monday-aligned." A finance controller is shown the approximation with a clear caveat rather than a falsely-precise number.

Cards are refreshed on the hourly materialized view refresh. Not live-by-SSE — the data doesn't move fast enough to warrant real-time updates.

### Output endpoint

```http
GET /api/team/capacity-warnings
```

```json
{
  "warnings": [
    {
      "level": "yellow",
      "message": "Team on track to hit 91% of 7-day cap before current windows close",
      "currentSpendUsd": 980,
      "projectedEndOfWindowUsd": 1820,
      "capUsd": 2000,
      "approxDaysRemaining": 2.1,
      "topContributors": [
        { "memberName": "Alice Wong", "contributionUsd": 450, "tierLabel": "Pro Max 20x" },
        { "memberName": "Bob Smith",  "contributionUsd": 320, "tierLabel": "Pro Max" }
      ]
    }
  ]
}
```

## Web UI — new pages in Doc 2

### `/team/:slug/plan` — Finance view (new page)

Top: **Optimizer summary card**. Bottom-line ("Acting on all recommendations saves $100/month") with a "Review recommendations" button.

Below: **Per-member recommendations grid**. Each card shows:

```
┌────────────────────────────────────────┐
│ Alice Wong        Pro Max 20x ($200/wk)│
│ ──────────────────────────────────     │
│ 7-day avg (30d):   32%                 │
│ 7-day peak (30d):  51%                 │
│ 5-hour peak (30d): 68%                 │
│ Days observed:     28 / 30             │
│                                        │
│ [ Recommendation: Downgrade ]          │
│ Move to Pro Max ($100/wk)              │
│ Saves ~$433/month                      │
│ 49% headroom retained vs. peak         │
│ Confidence: High                       │
│                                        │
│ [ Acknowledge ] [ Snooze 30 days ]     │
└────────────────────────────────────────┘
```

Acknowledging a recommendation writes an `event` row (`plan.recommendation.acknowledged`) and hides the card for 7 days. Snoozing hides it for 30 days. The Finance view queries `events` for the most recent `plan.recommendation.*` row per member to determine current hide/show state — no new `snoozed_recommendations` table. Neither acknowledge nor snooze actually changes the member's plan — Fleetlens doesn't have that power; the admin acts externally via Anthropic's billing portal.

Below: **Capacity burndown card** showing current window spend, projected end-of-window, top contributors, and the approximation caveat.

Below: **Per-member utilization charts**. Line chart of weekly peak 7-day % over the last 12 weeks, one chart per member, arranged in a responsive grid. Reuses solo edition's Recharts-based chart primitives (see `apps/web/components/...`), no new chart library.

Below: **Custom-tier banner** when any members are on `custom`: *"2 members on custom tiers — recommendations are manual for these."*

Below: **Tuning accordion** (collapsed by default). Admin can adjust optimizer thresholds via sliders. Hidden from non-admin viewers.

### `/team/:slug/members/:id` — profile page enhancement

Doc 1's profile page gains a new section, **rendered only when the viewer is an admin OR the viewer's `member_id` matches the profile's `member_id`** (the member-visibility policy from Doc 2):

```
Plan utilization (30 days)
─────────────────────────────
Plan tier:         Pro Max 20x ($200/week cap)
7-day window avg:  32%
7-day window peak: 51%
5-hour peak:       68%
Days observed:     28 / 30
Last snapshot:     2 minutes ago
```

Plus a sparkline of the last 30 days' peak 7-day utilization values. If the viewer is not authorized, this section is not rendered at all — not hidden via CSS, not returned in the API response.

### Settings → Plan (new subsection)

Admins can:

- **Tune** optimizer thresholds with sliders (bound to `teams.settings.planOptimizer`)
- **Set default plan tier** for new members joining this team (persisted in `teams.settings.defaultPlanTier`, used at the `POST /api/team/join` endpoint when the daemon doesn't specify a tier)
- **Edit** per-member plan tiers in a table (`members.plan_tier` dropdown per row)
- **Clear** snoozed recommendations (deletes the most recent `plan.recommendation.snoozed` event for selected members)
- **Export** the 30-day utilization data as CSV with these columns: `member_email, window_start_day, peak_seven_day_pct, avg_seven_day_pct, peak_five_hour_pct, snapshot_count, distinct_days_observed`

## Implementation sequencing within Doc 2

Milestones for the implementation plan:

1. **Schema migration**: add `plan_utilization` table, add `plan_tier` column to `members`, create `member_weekly_utilization` materialized view. Include the tier catalog as server-side constants.
2. **Ingest API extension**: extend the parser to accept and persist the `usageSnapshot` field. Idempotent on `(team_id, member_id, captured_at)`. Integration test with Doc 1's permissive parsing invariant (send Doc 4-era payloads, verify Doc 2 ignores unknown fields).
3. **Daemon extension**: read `~/.cclens/usage.jsonl` latest line on each cycle, convert snake_case to camelCase, include in payload. Test against a machine with an active solo daemon.
4. **Materialized view refresh job**: extend Doc 1's node-cron scheduler with a :05-past-every-hour refresh. Emit success/failure into `events`.
5. **`plan_utilization` prune job**: add a daily prune at 04:00 UTC (one hour after Doc 1's ingest_log prune) deleting rows older than `teams.retention_days`.
6. **Optimizer engine**: pure functions implementing the decision-rule pseudocode. Unit tests for every branch, including threshold boundary cases and `custom` tier.
7. **`GET /api/team/plan-optimizer`**: wire the optimizer to the API. Integration tests with synthetic data covering all six rule branches.
8. **Capacity burndown engine**: window-fraction projection + threshold check. Unit tests + a test covering the "member just reset" edge case.
9. **`GET /api/team/capacity-warnings`**: endpoint + hourly refresh trigger.
10. **Finance view page** `/team/:slug/plan`: optimizer summary, per-member cards, burndown, utilization charts, tuning accordion.
11. **Profile page enhancement**: plan utilization section with visibility gate.
12. **Settings → Plan subsection**: tuning UI, default tier setting, per-member tier editor, CSV export.
13. **End-to-end smoke test**: fresh Doc 1 + Doc 2 deploy, 3 test daemons running for ≥24 hours, verify Finance view renders real recommendations against real `UsageSnapshot` data.

## Privacy boundary (Doc 2 additions)

### Added to "shipped to team server"

- Utilization percentages (`five_hour`, `seven_day`, per-model windows) on the 0-100 scale
- Window reset timestamps (`seven_day_resets_at` etc.)
- Top-up credit state if enabled (`extra_usage.monthly_limit_usd`, `extra_usage.used_credits_usd`)
- The **admin-configured** `members.plan_tier` key (set at invite time, editable in Settings — not observed from the daemon)

### Still never leaves the laptop

- Everything in Doc 1's "stays on laptop" list
- The full `~/.cclens/usage.jsonl` history — only the *latest snapshot* is shipped per cycle
- The OAuth token used to poll Anthropic's usage endpoint (stays in `~/.cclens/oauth.json`)
- Which specific prompts, requests, or tool calls consumed the quota

### New data category: financial

Plan utilization, dollar savings numbers, and capacity projections are **financial** data — more sensitive than Doc 1's activity metrics. The privacy section acknowledges this as a distinct category so admins can set different retention or access rules in v1.1:

- **Member visibility policy**: members see their own plan utilization section on their profile page. They do not see other members' plan utilization. They do not see the Finance view page at all.
- **Admin visibility**: admins see all members' plan utilization, the Finance view, capacity warnings, and CSV export.
- **The dollar numbers are derived, not directly shipped**: the daemon only sends percentages and (optionally) top-up credit amounts. All $X/week and $X/month figures are computed server-side from `plan_tier × weekly_limit_usd`. A breach of the team server reveals utilization patterns and plan tiers, not the raw financial records themselves.

## v1 scope for Doc 2

**Ships on top of Doc 1:**

- `members.plan_tier` column migration (Doc 2 owns it)
- `plan_utilization` table + `member_weekly_utilization` materialized view
- Server-side `PLAN_TIERS` catalog (`pro`, `pro-max`, `pro-max-20x`, `custom`) with dollar caps
- Ingest API extension (accepts `usageSnapshot` as optional field, idempotent inserts)
- Daemon extension (reads `~/.cclens/usage.jsonl`, converts snake_case → camelCase, pushes latest snapshot)
- Plan-optimizer decision engine (ordered pseudocode, configurable via `teams.settings.planOptimizer`)
- `GET /api/team/plan-optimizer` endpoint
- Capacity burndown computation + `GET /api/team/capacity-warnings` endpoint
- `/team/:slug/plan` Finance view page
- Profile page plan utilization section with visibility gate
- Settings → Plan subsection with tuning sliders, default tier setting, per-member tier editor, CSV export
- Hourly materialized view refresh + daily `plan_utilization` prune jobs (extending Doc 1's node-cron)
- Acknowledge / snooze state derived from `events` table (no new table)

**Not in Doc 2:**

- Per-ticket cost attribution — Doc 4
- Cross-team / cross-project cost allocation — v2 (org-wide rollups)
- Weekly email digest of recommendations — v1.1 (depends on Resend integration from Doc 1)
- Stripe integration for automated plan adjustment — out of scope
- Historical chargeback — v2
- Anomaly detection on individual usage spikes — Doc 4 insights feed
- Dynamic tier catalog (admin-defined tiers beyond the hardcoded four) — v2

## Open questions for Doc 2

1. **Tier catalog freshness**: Claude Code plan tiers may change (new Max tier, enterprise tiers, regional pricing). The hardcoded catalog in server code is fine for v1 but needs a v1.1 story — either a JSON config file the admin can override, or a Settings UI to edit the catalog. Defer.
2. **Member plan tier changes mid-window**: if the admin changes a member's `plan_tier` halfway through a 7-day window, the capacity burndown calculation and optimizer recommendations will both use the new tier for *all* historical data in that window (since we compute dollars at query time, not store them). This is pragmatic but means a mid-window change makes historical projections slightly wrong. Acceptable for v1; the dashboard shows "Plan tier changed on [date]" as a small annotation.
3. **`seven_day_resets_at` drift**: Anthropic's rolling window resets at different times per member based on their first use. Two members could legitimately belong to the "same week" in the admin's mental model but have `window_start_day` values a day apart. The materialized view's `GROUP BY date_trunc('day', seven_day_resets_at - interval '7 days')` groups them correctly per-member but not across members. Finance view aggregates per-member then sums, which is correct — but admins may expect "team week ending 2026-04-22" which doesn't exist as a concept. Document in the UI: "7-day windows are per-member and may not align across the team."
4. **Plan tier audit trail**: changing a member's `plan_tier` should write to `events` for audit (`members.plan_tier_changed`). Trivial to add — call out in the implementation spec.
5. **Default tier at invite time**: Doc 2 proposes `teams.settings.defaultPlanTier` (default `pro-max`). The `POST /api/team/join` endpoint needs one line to honor this when the joining member doesn't specify a tier. Small cross-doc change — flag for Doc 1 server upgrade or Doc 2 ingest server upgrade.

## Dependencies on Doc 1

Doc 2 assumes Doc 1 has shipped:

- Team server running with `teams`, `members`, `daily_rollups`, `events`, etc. schema
- Member daemon pair flow works
- Admin authentication and Settings page shell
- SSE `LiveRefresher` component for the Finance view's live refresh
- `teams.settings jsonb` column (extensible config bucket)
- node-cron scheduler (already running for the `ingest_log` prune job)

### Schema changes Doc 2 makes to Doc 1's tables

**Only one**: `ALTER TABLE members ADD COLUMN plan_tier text NOT NULL DEFAULT 'pro-max' CHECK (...)`. All other changes are additive (new tables only). Doc 2's deploy is a standard forward migration: apply the new DDL, deploy the new server code, deploy the new daemon (which downgrades gracefully if the server is still on Doc 1).

### Daemon compatibility

A Doc 2 daemon (emits `usageSnapshot`) pushing to a Doc 1 server (ignores unknown fields) works silently — the field is dropped. When the server upgrades to Doc 2, the next ingest cycle's data flows into `plan_utilization`. No historical backfill; finance view starts populating from the upgrade moment forward.

A Doc 1 daemon (omits `usageSnapshot`) pushing to a Doc 2 server works too — the Finance view simply reports "insufficient data" for that member until they upgrade.
