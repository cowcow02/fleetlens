# Personal → Team Bridge — Design Spec

**Date:** 2026-05-16
**Status:** Approved direction; this spec drives Phase-1 implementation.
**Audience:** Engineers building the real (non-mock) team insight report.

---

## 1. Problem

The v0–v7 prototypes designed *what* a team-level insight report should look like and *which* metrics belong on it. None of those numbers were real — every variant rendered mock data. To ship something useful, we need a **scientific bridge** from the Personal Edition's local data (JSONL transcripts + the perception layer's enriched Entries) to the Team Edition's server, with the data shape, privacy model, and aggregation queries to back every block that's been defined.

This spec defines that bridge. It is intentionally minimal-but-honest: it does not introduce any new LLM workload or new external integration. It only piggybacks on what the Personal Edition already computes locally, and pushes a structured rollup of that to the Team Edition.

---

## 2. Where the report lives

Team Groups (#44) gives the right scope boundary:

| Page | Visibility | What it shows |
|---|---|---|
| `/team/[slug]/insights` | Team admin + staff | All members in the team |
| `/team/[slug]/groups/[group-slug]/insights` | Group managers + admin + staff | Members of that group only |

Non-admins without group-manager rows do not see an insights page at all — they see their own personal weekly digest at `/team/[slug]/members/[id]` exactly as today. This mirrors the existing roster routing in `packages/team-server/src/app/team/[slug]/page.tsx`.

**The group-scoped page is the primary surface.** Most managers will land there. The team-wide page exists for admins who need to see the whole org.

---

## 3. The bridge — three layers, ordered

### Layer A — Deterministic per-day numeric rollup (cheap, always-on)

Already partially shipped via `IngestPayload.dailyRollup` (#45). It pushes per-member per-day:

- `agentTimeMs`, `sessions`, `toolCalls`, `turns`
- `tokens.{input, output, cacheRead, cacheWrite}`
- `usageSnapshot`, `cyclePeaks`, `planTier`

This spec **extends** the daily rollup with deterministic Entry-derived fields the daemon already computes:

```ts
type RichDailyRollup = DailyRollup & {
  // Per-project breakdown — derived from canonicalProjectName() over sessions.
  projects: {
    project: string;     // canonical name
    agentTimeMs: number;
    sessions: number;
  }[];

  // Working-shape distribution — derived from Entry.signals.working_shape
  // (deterministic classification from subagent dispatches + skills + first_user).
  workingShapes: { shape: string; sessions: number; agentTimeMs: number }[];

  // Concurrency + parallelism — already produced by parser's
  // computeBurstsFromSessions / summarizeBursts.
  concurrencyPeak: number;       // peak concurrent sessions in any 5-min window
  parallelMinutes: number;       // total min where ≥2 sessions overlapped

  // Long-autonomous turn texture — same definition as v3-v5 dashboards.
  longAutonomous: {
    count: number;               // turns where active span ≥ 60 min
    totalMin: number;
    maxSingleMin: number;
  };

  // Tool + skill + subagent texture — counts only.
  toolErrors: number;
  toolRetryChains: number;
  skillsLoaded: { name: string; sessions: number }[];   // includes user-authored
  subagentsDispatched: { type: string; count: number }[];
  brainstormWarmupSessions: number;                     // sessions opening with a brainstorming skill
  planModeUsed: number;                                 // sessions with exit_plan_calls > 0

  // Outcome aggregates from per-session deterministic signals.
  // (Counts of PRs/commits/pushes are already in Entry.numbers; the rest
  //  flows from the LLM-enriched layer below — if present.)
  prs: number;
  commits: number;
  pushes: number;
};
```

All of the above is **deterministic**, computed inside the daemon from already-cached Entries. No model call. No opt-in needed — these are counts and taxonomy labels, the same Tier-1 surface the 2026-05-14 spec already defined.

### Layer B — LLM-enriched per-day fields (opt-in, automatic)

Personal Edition already enriches Entries via the perception pipeline. The fields that already exist per Entry:

- `enrichment.outcome` — shipped / partial / exploratory / blocked / trivial
- `enrichment.claude_helpfulness` — essential / helpful / neutral / unhelpful
- `enrichment.goal_categories` — minutes per category (build / debug / refactor / plan / review / research / test / release / warmup_minimal / meta)

These are LLM-derived but already cached on disk. Pushing them does not trigger fresh LLM work. They're enriched fields, so they require explicit opt-in. Wire payload:

```ts
type EnrichedDailyExtras = {
  // Sessions whose enrichment status is 'done'; missing keys = not opted in.
  outcomeMix: Partial<Record<"shipped"|"partial"|"exploratory"|"blocked"|"trivial", number>>;
  helpfulnessMix: Partial<Record<"essential"|"helpful"|"neutral"|"unhelpful", number>>;
  goalMix: Partial<Record<string, number>>;             // minutes per goal_category
};
```

These ride in the same ingest payload, gated by a per-team setting `share_enriched_extras` (default off; admin toggles it on; per-member opt-out via `~/.cclens/team-config.json`'s `private_projects` / `enrichment_opt_in` flags).

### Layer C — Opt-in per-session content (later phase)

The v2/v4 "case studies" spine requires session-content (timeline, pins, narrative). That's the spec §5 opt-in model from the 2026-05-14 design and is deferred to a Phase-2 spec. **This Phase-1 spec stops at Layer B.**

---

## 4. Wire payload

The CLI's existing `POST /api/ingest/metrics` endpoint stays. The body schema becomes the discriminated-union:

```ts
type IngestV1 = { /* current shape, unchanged */ };

type IngestV2 = IngestV1 & {
  schemaVersion: 2;
  richRollup?: RichDailyRollup;            // Layer A
  enrichedExtras?: EnrichedDailyExtras;    // Layer B (only if opt-in)
};
```

Backward-compat:
- V1 payloads are accepted unchanged (no `schemaVersion` → treated as V1).
- The server's response stays the same shape.
- Daemons that haven't been updated keep working.

The richRollup is keyed by `(team_id, membership_id, day)`. Re-pushing for the same key UPSERTs (same idempotency as today's daily_rollups).

---

## 5. Database schema additions

One migration, all new tables:

```sql
-- description: rich daily rollup + enriched extras for team insights

CREATE TABLE rich_daily_rollups (
  team_id        uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  membership_id  uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  day            date NOT NULL,
  -- denormalized for indexability; populated from the union of layers A+B.
  agent_time_ms  bigint NOT NULL DEFAULT 0,
  sessions       int NOT NULL DEFAULT 0,
  prs            int NOT NULL DEFAULT 0,
  commits        int NOT NULL DEFAULT 0,
  pushes         int NOT NULL DEFAULT 0,
  concurrency_peak       int NOT NULL DEFAULT 0,
  parallel_minutes       int NOT NULL DEFAULT 0,
  long_auto_count        int NOT NULL DEFAULT 0,
  long_auto_total_min    int NOT NULL DEFAULT 0,
  long_auto_max_single_min int NOT NULL DEFAULT 0,
  tool_errors            int NOT NULL DEFAULT 0,
  brainstorm_warmup_sessions int NOT NULL DEFAULT 0,
  plan_mode_used         int NOT NULL DEFAULT 0,
  -- Per-project / per-shape / per-skill / per-subagent breakdowns
  -- and the optional enriched extras live as JSONB to avoid 30 narrow tables.
  -- We index the JSONB keys we actually query on (project, shape, skill name).
  projects               jsonb NOT NULL DEFAULT '[]'::jsonb,
  working_shapes         jsonb NOT NULL DEFAULT '[]'::jsonb,
  skills_loaded          jsonb NOT NULL DEFAULT '[]'::jsonb,
  subagents_dispatched   jsonb NOT NULL DEFAULT '[]'::jsonb,
  outcome_mix            jsonb DEFAULT NULL,
  helpfulness_mix        jsonb DEFAULT NULL,
  goal_mix               jsonb DEFAULT NULL,
  ingested_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, membership_id, day)
);
CREATE INDEX idx_rich_daily_rollups_team_day ON rich_daily_rollups(team_id, day DESC);

-- Cross-member skill diffusion is computed on read by an aggregation query,
-- not stored. Same for per-project totals, working-shape distribution,
-- concurrency-peak-of-team-day, etc.
```

No new tables for skill diffusion, per-project totals, etc. — those are aggregations over `rich_daily_rollups`. JSONB indexes are added only where queries actually filter.

---

## 6. Group-scoped aggregation queries

Single helper module: `packages/team-server/src/lib/insights-aggregate.ts`. Every function takes either `teamId` (admin scope) or `(teamId, groupId)` (group scope) and produces one block's worth of data.

The visibility predicate from the groups spec stays the single source of truth:

```ts
async function visibleMembershipIds(
  teamId: string,
  scope: { kind: "team-wide" } | { kind: "group", groupId: string },
  pool: pg.Pool,
): Promise<string[]>
```

Every block-data function uses this list to filter `rich_daily_rollups.membership_id IN (...)`.

Examples:

```ts
// Team pulse for a week, scoped to a group
async function teamPulseWeek(
  teamId: string, scope, weekMonday: string, pool,
): Promise<TeamPulseBlockData>

// Skill diffusion events: cross-member skill pickups within the scope
async function skillDiffusion(
  teamId: string, scope, weekMonday: string, pool,
): Promise<SkillDiffusionBlockData>

// Per-project hours, this week vs last
async function perProjectTimeWoW(...): Promise<ProjectTimeBlockData>
```

Each function returns the exact shape the existing v7 catalog block renderers already consume — so the renderers don't change.

---

## 7. Auth & privacy

Five rules, enforced everywhere:

1. **The ingest endpoint authenticates by bearer token** (existing `resolveMembershipFromBearer`). A member can only push their own data. The endpoint extracts membership_id from the token and ignores any client-provided membership_id.

2. **Enriched extras are opt-in.** The CLI reads `~/.cclens/team-config.json` and only includes `enrichedExtras` if `enrichment_opt_in: true`. Default is `false`. Project-name and skill-name *labels* in `richRollup` are always shared (consistent with the 2026-05-14 spec's Tier-1 ruling) but are filtered by the member's `private_projects[]` list before being pushed.

3. **Group-scoped reads use the visibility predicate.** Any aggregation query that returns per-member data must filter on `visibleMembershipIds(...)`. Team-wide aggregates only run for admin/staff.

4. **No raw transcripts cross the wire.** Layer C (case studies) is out of scope for this spec; when it lands, it follows its own opt-in-per-session flow.

5. **Conservative attribution is acknowledged.** Like the 2026-05-14 spec's methodology footnote, the UI must mark sections that are derived from rich rollups as such, and clarify which sections require enriched-extras opt-in.

---

## 8. Mapping — v7 catalog blocks to data sources

The table below proves the bridge is complete for the deterministic surface. For every block in the v7 catalog, this names the field(s) in `rich_daily_rollups` (or aggregation query) that backs it.

| v7 block id | Source field(s) | Layer |
|---|---|---|
| `team-pulse-wow` | `SUM(agent_time_ms)`, `SUM(sessions)`, parallel-execution aggregation | A |
| `long-autonomous-texture` | `SUM(long_auto_count)`, `SUM(long_auto_total_min)`, `MAX(long_auto_max_single_min)` | A |
| `delegation-depth` | derived: distribution of session-level human-turn-after-brief counts (requires per-session detail; see Phase 2) | A* |
| `augmentation-automation-flip` | derived from working_shapes JSONB | A |
| `purpose-mix-bar` | `goal_mix` JSONB aggregated | B |
| `per-project-time-bars` | `projects` JSONB aggregated | A |
| `economic-primitives-table` | requires per-session detail (Phase 2 Layer C) | C |
| `skill-diffusion-arrows` | aggregation query over `skills_loaded` JSONB and earliest-day-per-member-per-skill | A |
| `user-authored-skills-bars` | `skills_loaded` JSONB filtered to user-authored skills | A |
| `skill-usage-wow-bars` | `skills_loaded` aggregated WoW | A |
| `harness-engineering` | cache hit % = `SUM(cacheRead) / (SUM(input) + SUM(cacheRead))`; tool error % = `SUM(tool_errors)` / total tool calls | A |
| `risk-signals` | derived: heavy-steering session count, conformity-failure count (later), mid-session skill loads | A |
| `dora-attribution` | external integration (deferred) | — |
| `quality-watch` | external integration (deferred) | — |
| `case-studies-all` | per-session opt-in (Phase-2 Layer C) | C |
| `workflow-mapper` | external Linear/Jira integration (deferred) | — |
| `phase-bottleneck-cards` | external (deferred) | — |
| `ticket-live-journeys` | external (deferred) | — |
| `implementation-window-trend` | external (deferred) | — |
| `member-phase-allocation` | external (deferred) | — |
| `member-fingerprints` | aggregations + per-member view | A + (Layer B/C for narrative) |
| `oneonone-prompts` | LLM synthesis over signals; deferred | C |
| `demo-candidates` | per-session detail; deferred | C |
| `hero-takeaway` | LLM synthesis; deferred | C |
| `strengths-cards` / `dysfunctions-cards` | LLM synthesis over Layer-A signals; deferred | C |
| `paired-speed-quality` | mix of A + external integration | A + — |
| `investments` | LLM synthesis; deferred | C |
| `trajectories-grid` | aggregation over `rich_daily_rollups` for last 4 weeks | A |
| `diffusion-grid` | aggregation over `skills_loaded` + first-use per member | A |

**Phase-1 deliverable scope** (everything marked Layer A or B above): 16 of the 31 catalog blocks become real, not mock.

---

## 9. Phasing

**Phase 1 (this spec):**
- DB migration (`rich_daily_rollups`).
- CLI extension: compute `RichDailyRollup` from Entries + push.
- Server endpoint extension: accept V2 payloads, write into `rich_daily_rollups`.
- Aggregation library: 4 starter functions covering team pulse, per-project, skill diffusion, working-shape distribution.
- Wire the v7 builder's data flow to read live data instead of mock for those 4 blocks (other blocks fall back to a "needs more data" placeholder).
- Group-scoped page at `/team/[slug]/groups/[group-slug]/insights`.

**Phase 2 (separate spec):**
- Per-session detail (Layer C). Enables case studies, delegation depth, complexity primitives.
- LLM-narrative synthesis at team level (strengths/dysfunctions/closing reflections).

**Phase 3:**
- External integrations: GitHub PR/merge attribution, Linear ticket lifecycle, CI/CD signal.
- Enables: ticket-flow blocks, DORA-with-attribution, quality-watch.

---

## 10. Migration & backward-compat

- The current `IngestPayload` shape stays valid. V2 is purely additive.
- The current `/api/ingest/metrics` route's response shape is unchanged.
- Existing `daily_rollups` table is **kept** — `rich_daily_rollups` is a sibling, not a replacement. Older clients that only push v1 payloads continue to update `daily_rollups` only. The team server treats `rich_daily_rollups` as "if present, prefer it" but falls back to `daily_rollups` for blocks that don't need the extra fields.
- Existing v0–v7 mock prototypes stay as `?v=0..7` tabs. Phase-1 ships a new "real" insights page at `/team/[slug]/insights` and `/team/[slug]/groups/[group-slug]/insights` — these read live data. The v0–v7 prototypes are kept under `?v=N` for reference until the real page covers their content.

---

## 11. Acceptance criteria for Phase 1

- DB migration applies cleanly.
- A CLI member running `fleetlens team push` produces a `richRollup` for the most recent N days, picked up by the server, stored in `rich_daily_rollups`.
- The real `/team/[slug]/groups/[group-slug]/insights` page renders four block types backed by live data:
  - Team pulse (agent hours, sessions, concurrency peak)
  - Per-project time (WoW)
  - Skill usage (this week)
  - Working-shape distribution
- Group managers see only members of groups they manage. Team admins see everyone.
- All four block render functions cope cleanly when no rich rollups exist for the scope (empty-state, not crash).
- Typecheck + existing tests pass.
