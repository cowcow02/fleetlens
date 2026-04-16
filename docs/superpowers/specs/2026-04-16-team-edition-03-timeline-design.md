# Fleetlens Team Edition — Doc 3: Team Timeline Visualization

**Status:** Draft
**Date:** 2026-04-16
**Author:** split from 2026-04-15-team-edition-design.md
**Ships:** Per-member Gantt timeline view (session-level blocks, no ticket correlation)
**Depends on:** Doc 1 (Foundation)
**Enables:** Doc 4 decorates this view with ticket labels
**Independent of:** Doc 2 (Plan Utilization) — can ship in either order

## Overview

The third layer of Fleetlens Team Edition, and the one that delivers the hero visualization a manager sees in the dashboard. Doc 3 adds a **team Gantt timeline**: one row per team member, one block per session (or per contiguous group of sessions in the same repo), with agent time density overlay and cross-member concurrency detection.

**Crucially, Doc 3 ships without ticket correlation.** Blocks are labeled by repo name (`payments-service · 2.3h · 4 sessions`), not by ticket ID. The ticket layer is Doc 4 — which *decorates* the Doc 3 Gantt with ticket IDs as an overlay, without rewriting the visual.

Shipping Doc 3 before Doc 4 means managers get the "shape of team activity" view — who's working when, where concurrency happens, how the team's shipping cadence looks — *without waiting on the harder ticket-correlation problem*. If Doc 4 turns out to need more work than expected, Doc 3 is already useful on its own.

## Why ship Doc 3 third?

- **It's the feature managers ask for.** Engineering managers who see the Doc 1 roster card view will immediately ask "can I see *when* they're working?" Doc 3 is the answer.
- **Ticket correlation is the hardest unsolved piece.** By shipping the Gantt with session-level blocks first, the hard problem (Doc 4) is deferred and the rest of the product is already working.
- **Incremental data-shape change.** Doc 3 adds one new table (`session_blocks`) and extends the ingest API with a `sessionBlocks[]` field. No new sub-systems, no new external dependencies, no new network calls. The complexity is in the UI, not the backend.
- **Reuses solo edition's existing Gantt primitives.** Solo edition has a `/parallelism` page today that renders a session-based Gantt for a single user. Doc 3's team Gantt is the same visual language at a different zoom level (rows-are-members instead of rows-are-sessions-within-one-member). The rendering code is adapted, not invented.

## Personas

**Primary**: engineering manager / team lead. Wants to see the team's workday shape at a glance — who's active when, where parallelism happens, which repos the team is converging on. Does not want to drill into individual transcripts.

**Secondary**: the individual engineer reviewing their own week's work on their profile page ("what did I ship on Tuesday?").

## Non-goals for Doc 3

- **Ticket correlation** — Doc 4. Blocks are labeled by repo, not by ticket ID.
- **Signal hierarchy / auto-detection / pluggable matcher/enricher** — Doc 4.
- **Pattern-based insights feed** — Doc 4.
- **Historical time-travel (view the Gantt as it looked last month)** — a modest History page is included in Doc 3, but deep drill-down into historical patterns lives in Doc 4.
- **Plan utilization overlay on the Gantt** — Doc 2 ships the Finance view separately; the Gantt stays activity-only in Doc 3.
- **Real-time cursor / "who is typing right now" indicators** — deferred to v2.
- **Export to PNG/SVG/PDF of the Gantt** — v2.

## Core concept: session blocks on per-member rows

The Gantt's visual primitive is a **session block**: a contiguous range of agent time on a specific `(member, repo)` pair. A session block aggregates one or more individual sessions that happened close together in the same repo.

```
            Mon       Tue       Wed       Thu       Fri
          ┌─────────────────────────────────────────────┐
  Alice   │ [web-app 2.3h] [api-svc 1.1h]  [web-app 3.0h]│
   Bob    │ [api-svc 4.1h ────]           [api-svc 2.8h] │
  Carol   │ [terraform 2.0h ]  [terraform 1.5h] [api-svc]│
   Dan    │                  [payments-svc 3.2h ─────]   │
          └─────────────────────────────────────────────┘
```

**What a manager reads from this view**:
- Alice moves between web-app and api-svc frequently (frontend → backend round trips)
- Bob is the api-svc owner, working deep sessions
- Carol mostly focuses on terraform, with occasional api-svc
- Dan spent Wednesday+Thursday exclusively on payments-svc (deep focus)
- Wednesday has the highest cross-member concurrency — both Alice, Bob, Carol, and Dan were active

None of this requires ticket correlation. The repo name is enough to tell the story.

### How sessions aggregate into blocks

A session block is created from one or more individual Claude Code sessions with the following rules:

1. **Same member, same repo** — different repos never merge into one block.
2. **Contiguous or near-contiguous timing** — if two sessions are separated by a gap of ≤ 30 minutes, they merge into the same block. Longer gaps start a new block. 30 minutes is chosen to match the solo edition's "active segment" bucketing; cross-session merging is team-side only.
3. **Each block has**: start time, end time, total agent time (sum of active segments), session count, peak concurrency within the block, list of skills used (when the parser detects sub-agent invocations — captured but not surfaced as a primary visual until Doc 4).

This happens on the **daemon side**, not the server. The daemon reads its own JSONL, runs the existing solo-edition aggregator, and pushes pre-computed session blocks to the team server. The server just stores them. This keeps ingest cheap and avoids shipping per-session data.

### Block encoding on the Gantt

- **Width**: block start → block end (wall-clock)
- **Label**: repo name + total agent time (e.g., `api-svc 4.1h`)
- **Color**: repo-based hash color, stable across the team. `api-svc` is always the same color for everyone. This makes cross-member convergence visually obvious (many blocks in the same color on the same day = the team converged on that repo).
- **Density / opacity**: agent time relative to wall-clock window. A 4-hour block with only 30 minutes of actual agent time renders lighter than a 4-hour block with 3.8 hours of agent time.
- **Border**: solid for single-session blocks, dashed for multi-session merged blocks. Tooltip shows session count.
- **Day header badge**: when ≥ 3 distinct members have blocks on the same day, a small concurrency counter badge appears (e.g., "4 members active").

### Interactions

- **Click a block** → side panel with: member name, repo name, block start/end, total agent time, session count, peak concurrency, skills detected, first/last tool call timestamps.
- **Click a member row** → drill into that member's weekly detail view (all their blocks for the week, vertically stacked by time).
- **Click a day header** → drill into an hourly view for that day across all members (zoomed-in Gantt at hour granularity).
- **Filter bar**: date range, member filter, repo filter, "show only shipped" (deferred to Doc 4 since "shipped" requires PR detection).

## Data model

### New table: `session_blocks`

One row per aggregated session block per member.

```sql
CREATE TABLE session_blocks (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id               uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  member_id             uuid NOT NULL REFERENCES members ON DELETE CASCADE,
  block_key             text NOT NULL,                -- client-generated stable ID, e.g. sha256("alice|api-svc|2026-04-16T10:00")
  repo_slug             text NOT NULL,                -- 'api-svc', not a path — see "Repo slug" below
  started_at            timestamptz NOT NULL,
  ended_at              timestamptz NOT NULL,
  agent_time_ms         bigint NOT NULL DEFAULT 0,    -- sum of active segments within the block
  session_count         int NOT NULL DEFAULT 0,       -- number of individual sessions merged into this block
  tool_call_count       int NOT NULL DEFAULT 0,
  turn_count            int NOT NULL DEFAULT 0,
  peak_concurrency      int NOT NULL DEFAULT 1,       -- max concurrent sessions observed within the block
  skills                text[] NOT NULL DEFAULT '{}', -- sub-agent / skill names detected, collected for Doc 4
  tokens_input          bigint NOT NULL DEFAULT 0,
  tokens_output         bigint NOT NULL DEFAULT 0,
  tokens_cache_read     bigint NOT NULL DEFAULT 0,
  tokens_cache_write    bigint NOT NULL DEFAULT 0,
  last_synced_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, member_id, block_key)              -- idempotent on retry
);
CREATE INDEX ON session_blocks (team_id, started_at DESC);
CREATE INDEX ON session_blocks (team_id, member_id, started_at DESC);
CREATE INDEX ON session_blocks (team_id, repo_slug, started_at DESC);
```

**`block_key`** is a client-generated stable identifier so retries and re-ingests are idempotent. The daemon computes it from `sha256("${member_id}|${repo_slug}|${started_at_iso}|${ended_at_iso}")`. If the daemon recomputes a block with the same boundaries, the INSERT upserts cleanly.

**Note**: Doc 3's `session_blocks` has zero `ticket_*` columns. When Doc 4 lands, it adds:

```sql
ALTER TABLE session_blocks
  ADD COLUMN ticket_id           text,
  ADD COLUMN ticket_provider     text,
  ADD COLUMN ticket_confidence   real,
  ADD COLUMN signal_tier         text;
```

These are nullable. Doc 3's blocks have NULL ticket columns forever; newly-ingested Doc 4-era blocks fill them in. No data migration, no historical reclassification — the Gantt just starts showing ticket labels on new blocks once Doc 4 is deployed.

### Repo slug

`repo_slug` is **not a filesystem path** and **not a git remote URL**. It's a team-stable short name that the daemon produces from the repo root:

- If the repo has a git remote: `repo_slug = basename(git remote get-url origin, ".git")` — e.g., `github.com:kipwise/agentic-knowledge-system.git` → `agentic-knowledge-system`.
- If no remote but the cwd is a worktree of a repo with a remote: resolve to the parent repo's slug (same `canonicalProjectName()` logic solo edition already uses).
- If no remote at all: `basename(cwd)` — e.g., `/Users/alice/scratchpad` → `scratchpad`. Rare; only happens for throwaway projects.

The daemon ships only the slug, never the full path. The team server never learns that Alice works out of `/Users/alice/Repo/...` — only that she was active in `agentic-knowledge-system`.

**Collision handling**: if two members work on repos with the same slug but different remotes (e.g., Alice's fork vs. Bob's fork, both named `utils`), the team server silently treats them as the same repo. This is a *feature* in the common case (Alice and Bob are both on `utils` = good, they're collaborating) and a minor noise source in the rare case of truly unrelated repos sharing a name. Doc 3 accepts this tradeoff. If it becomes a real problem, Doc 4 or v2 can add an `org_slug` dimension.

## Ingest API extension

Doc 1's `POST /api/ingest/metrics` gains one new optional top-level field: `sessionBlocks[]`.

```json
{
  "ingestId": "01HV9KQ8N3W7XC4M2YR5T9D6F8",
  "observedAt": "2026-04-16T10:30:00Z",
  "dailyRollup": { ... },
  "usageSnapshot": { ... },
  "sessionBlocks": [
    {
      "blockKey": "sha256hex...",
      "repoSlug": "agentic-knowledge-system",
      "startedAt": "2026-04-16T09:15:00Z",
      "endedAt":   "2026-04-16T10:25:00Z",
      "agentTimeMs": 3900000,
      "sessionCount": 2,
      "toolCallCount": 78,
      "turnCount": 24,
      "peakConcurrency": 1,
      "skills": ["frontend-design", "playwright-qa-verifier"],
      "tokens": { "input": 250000, "output": 18000, "cacheRead": 1900000, "cacheWrite": 95000 }
    },
    {
      "blockKey": "sha256hex...",
      "repoSlug": "terraform-infra",
      "startedAt": "2026-04-16T08:00:00Z",
      "endedAt":   "2026-04-16T08:45:00Z",
      "agentTimeMs": 2100000,
      "sessionCount": 1,
      "toolCallCount": 31,
      "turnCount": 8,
      "peakConcurrency": 1,
      "skills": [],
      "tokens": { "input": 80000, "output": 6000, "cacheRead": 340000, "cacheWrite": 12000 }
    }
  ]
}
```

**Doc 1 server compatibility**: because Doc 1 parses permissively at every nesting level, a Doc 3 daemon pushing this payload to a Doc 1 server has the `sessionBlocks[]` silently ignored. The daemon keeps pushing; when the server upgrades to Doc 3, new blocks land in `session_blocks` and the Gantt populates. No historical backfill unless the daemon is asked to replay (see "Backfill" below).

**Cadence**: every 5 minutes, same cycle as Doc 1's ingest. On each cycle, the daemon re-computes all blocks that overlap the last 24 hours from local JSONL (which is cheap — solo edition already does this). Blocks that haven't changed since the last push are skipped (tracked via `last_pushed_hash` in the daemon's local state). Only changed blocks are sent.

**Block boundaries may shift across cycles**. If a session starts at 10:00 and ends at 10:40, the first ingest after 10:00 sends a block ending at the current time (`ended_at = now()`). The ingest after 10:40 sends an updated block ending at 10:40. The server upserts on `(team_id, member_id, block_key)` — but `block_key` incorporates `ended_at`, so this would create a *second* block unless we fix the key.

**Fix**: `block_key` is computed from `(member_id, repo_slug, started_at)` only — **not** `ended_at`. This makes the block key stable across re-ingests; the `ended_at`, `agent_time_ms`, `session_count`, and token counts are all upserted (`EXCLUDED.*` columns updated). Once a block is "done" (no activity for > 30 min after `ended_at`), it stops being re-sent.

**Unknown-field handling**: unchanged from Doc 1's permissive invariant.

### Backfill

When a Doc 1-era daemon pairs with a Doc 3-era team server, the server's Gantt is empty because the old daemon never sent session blocks. Two options:

1. **Do nothing**: the daemon naturally fills in going forward. After ~3 days of normal operation, the last-30-days Gantt view is populated. Acceptable for Doc 3.
2. **Explicit backfill**: add a `fleetlens team backfill --days 30` command that re-computes session blocks for the last N days from local JSONL and pushes them all at once, respecting rate limits. Useful for demos and initial team onboarding.

Doc 3 ships option 2 as a polish item (milestone 11 below). Option 1 is the default; the backfill command is opt-in.

**Backfill interaction with retention**: backfill respects the team's `retention_days` setting. Blocks older than the retention window will be swept by the 04:15 prune job within 24 hours of landing on the server. The CLI surfaces a warning when `--days` exceeds `retention_days`: `"Warning: team retention is 365d, you requested 730d. Blocks older than 365d will be pruned overnight."`

## Gantt feed endpoint

```http
GET /api/team/gantt?from=<ISO>&to=<ISO>&members=<id1,id2>&repos=<slug1,slug2>
Authorization: admin session cookie
```

Query parameters:
- `from`, `to`: date range. Defaults to `from = now() - 14 days`, `to = now()`.
- `members`: comma-separated member IDs to filter. Omitted = all members.
- `repos`: comma-separated repo slugs to filter. Omitted = all repos.

Response:

```json
{
  "from": "2026-04-02T00:00:00Z",
  "to":   "2026-04-16T23:59:59Z",
  "members": [
    { "id": "uuid-alice", "displayName": "Alice Wong", "email": "alice@acme.com" },
    { "id": "uuid-bob",   "displayName": "Bob Smith",  "email": "bob@acme.com" }
  ],
  "blocks": [
    {
      "id": "uuid-block-1",
      "memberId": "uuid-alice",
      "repoSlug": "agentic-knowledge-system",
      "startedAt": "2026-04-12T09:15:00Z",
      "endedAt":   "2026-04-12T10:25:00Z",
      "agentTimeMs": 3900000,
      "sessionCount": 2,
      "toolCallCount": 78,
      "turnCount": 24,
      "peakConcurrency": 1,
      "skills": ["frontend-design", "playwright-qa-verifier"],
      "tokens": { "input": 250000, "output": 18000, "cacheRead": 1900000, "cacheWrite": 95000 }
    }
  ],
  "summary": {
    "totalBlocks": 47,
    "totalAgentTimeMs": 612000000,
    "uniqueReposActive": 6,
    "peakCrossMemberConcurrency": 4,
    "peakDay": "2026-04-09"
  },
  "cursor": null
}
```

### Pagination and scale caps

The Gantt is bounded by the following rules to prevent pathological queries on large teams:

- **Default window**: 14 days. Queries asking for > 90 days are rejected with `400 Bad Request` (expand via the History page, which paginates differently).
- **Member cap**: `blocks` returns rows for at most 100 members per response. Teams over 100 members must filter.
- **Block cap**: max **5,000 blocks** per response. If the query would return more, `cursor` is set and the client pages by `?cursor=<...>`. The UI shows "5,000 of 5,247 shown — widen filters or narrow date range" with a "load more" button.
- **Row hiding on the hero page**: members with zero blocks in the requested window are omitted from `members[]`. The hero page doesn't render empty rows.

For a **heavy-use 20-person team** querying a 14-day window, expect ~3-5 blocks per person per working day × 10 working days × 20 members = **600-1,000 blocks** in a typical response, ~250-400 KB payload. Cursor-based pagination is only invoked by very large teams, very wide windows, or teams with unusual activity patterns — it is not the common path for a 20-person squad. Postgres query latency on the `(team_id, started_at DESC)` index is < 30 ms at 1M rows (verified separately with `EXPLAIN ANALYZE` against seed data).

### Other read endpoints Doc 3 adds

```
GET /api/team/gantt/day/:day                    — hourly-granularity Gantt for one day (click drill-down)
GET /api/team/gantt/member/:id                  — single-member weekly detail
GET /api/team/repos                             — list of distinct repo_slugs active in the last 30 days
GET /api/team/blocks/:id                        — full detail for one block (side panel data)
PUT /api/team/settings/repo-slug-mappings       — upsert the repoSlugMappings JSON (admin only)
    Body: { "mappings": { "acme-billing-secret-rebrand": "billing-service", ... } }
    Response: { "policyVersion": 4, "rewrittenRows": 17 }
    Side effects: (1) writes teams.settings.repoSlugMappings, (2) bumps policyVersion,
    (3) runs the server-side UPDATE to rewrite matching session_blocks.repo_slug, (4) logs an
    event row (settings.repo_slug_mapping_updated).
```

### SSE live refresh

Extends Doc 1's existing `/api/sse/updates` stream with a new event type:

```
event: block-updated
data: { "blockId": "uuid", "memberId": "uuid", "startedAt": "...", "repoSlug": "..." }
```

Clients re-fetch the affected slice of the Gantt. Events are debounced at 1-per-second-per-team to avoid storm-refreshes when multiple daemons ingest simultaneously.

## Web UI — new pages in Doc 3

### `/team/:slug/gantt` — Team Gantt (hero page)

The new default landing page (replaces the Doc 1 roster as the team's primary view, though the roster stays available at `/team/:slug/members`).

```
┌─────────────────────────────────────────────────────────────────┐
│ Fleetlens    Acme Engineering             [settings] [profile]  │
├─────────┬───────────────────────────────────────────────────────┤
│         │ Team Gantt    [< This week >]     Apr 10 – 16          │
│ Gantt*  │ ──────────────────────────────────────────────        │
│ Roster  │           Mon    Tue    Wed    Thu    Fri              │
│ Plan    │        ┌────────────────────────────────────────────┐ │
│ Members │ Alice  │ [web-app 2h] [api 1h] [web-app 3h]         │ │
│ Profile │ Bob    │ [api 4h ────]        [api 3h]               │ │
│ Settings│ Carol  │ [tf 2h]       [tf 1h]    [api 1h]           │ │
│         │ Dan    │              [pay-svc 3h ─────]             │ │
│         │        └────────────────────────────────────────────┘ │
│         │                                                       │
│         │ Filter: [Members ▼] [Repos ▼] [Date range ▼]          │
│         │                                                       │
│         │ Selected block                                        │
│         │ api-svc · Bob Smith · Wed 09:15 - 13:20                │
│         │ 4.1h agent time · 3 sessions · peak concurrency 2     │
│         │ Skills: (none detected)                                │
│         │                                                       │
│         │ Week summary                                          │
│         │ • 47 blocks across 6 repos                            │
│         │ • 170 agent hours total                               │
│         │ • Peak cross-member concurrency: 4 (Wed)              │
└─────────┴───────────────────────────────────────────────────────┘
```

**Left sidebar nav** updated from Doc 1:
- **Gantt** (new, now the default)
- **Roster** (was the hero in Doc 1, now a secondary view)
- **Plan** (from Doc 2)
- **Members** (was `/team/:slug`, now `/team/:slug/members`)
- **Settings**

### `/team/:slug/gantt/day/:day` — Hourly day view

Clicking a day header on the main Gantt drills into an hourly view for that day:

```
Apr 14                                      [back to week]
─────────────────────────────────────────────────────────
       00   03   06   09   12   15   18   21
     ┌──────────────────────────────────────────────────┐
Alice│                 [api 2h] [web-app 3h ─────]      │
Bob  │                    [api 4h ──────]               │
Carol│              [tf 1h]      [api 1h]               │
Dan  │                        [pay-svc 3h ─────]        │
     └──────────────────────────────────────────────────┘
```

Same interactions as the main Gantt but at hour-granularity.

### `/team/:slug/gantt/member/:id` — Single-member detail

Vertical layout of all the member's blocks for the selected week, with expanded per-block stats (tokens, skills, session count). Useful for 1:1 reviews (the manager preps for an Alice catch-up by looking at Alice's week here, not on the cross-team view).

### `/team/:slug/history` — Time-travel to any past week

Simple prev/next pagination, one week at a time, renders the same Gantt component as the current view. Useful for "show me the week we shipped the SSO feature." Quarterly navigation is v2.

### Filter bar

Available on every Gantt view:
- **Date range**: picker with presets ("This week", "Last week", "Last 14 days", "Last 30 days", "Custom...")
- **Members**: multi-select dropdown
- **Repos**: multi-select dropdown populated from `GET /api/team/repos`
- **Minimum block duration**: slider (hide blocks under N minutes — reduces clutter from tiny experimentation sessions)

## Daemon-side session block aggregation

The daemon already has solo-edition session parsing (`packages/parser`). Doc 3 adds a lightweight aggregator on top:

1. **Read recent JSONL**: for each `~/.claude/projects/<encoded-cwd>/*.jsonl` modified in the last 24 hours, parse via `parseTranscript` (already in solo edition).
2. **Canonicalize project**: use `canonicalProjectName()` to roll worktrees up to their parent repo.
3. **Extract active segments**: already done by the parser — each session has an `activeSegments: [{ start, end }]` array.
4. **Group by repo**: bucket sessions by `canonicalProjectName`.
5. **Merge contiguous sessions within a repo**: active segments from different sessions merge if the gap between consecutive segments is ≤ 30 minutes. A merged block spans from the earliest segment's `startMs` to the latest segment's `endMs`. **Peak concurrency is recomputed from scratch** on every ingest cycle over the block's *current* segment set — never inherited from a previous cycle. If a new overlapping session lands in a subsequent cycle and extends the block, the recomputation may yield a higher peak than the last cycle; the upsert then replaces the stored value. This uses the same `computeBurstsFromSessions` primitive from `packages/parser/src/analytics.ts` that the solo-edition `/parallelism` page uses.

   The parser's segments are `{ startMs: number; endMs: number }` objects — not `{ start, end }`. The daemon passes them through unchanged from `SessionMeta.activeSegments`.
6. **Compute repo slug**: spawn `git remote get-url origin` via `child_process` from the session's `cwd` (the daemon already uses `child_process` for other flows — see `packages/cli/src/updater.ts`). Extract the basename, strip `.git` suffix. Fall back to `basename(cwd)` if any of these fail: `git` not on PATH, not a git repo, detached worktree, missing remote, non-zero exit. Log the fallback at DEBUG level but do not surface to the user. Results are cached per-`cwd` in-memory for the life of the daemon process and invalidated on file-system-watch events for `.git/config` (opportunistic — staleness is acceptable).

7. **Compute block_key**: `sha256(member_id + "|" + repo_slug + "|" + started_at_iso)` where `started_at_iso` is the block's earliest segment `startMs` rendered as `YYYY-MM-DDTHH:mm:ss.sssZ` in UTC with full millisecond precision. Exact same format as `new Date(ms).toISOString()` — never truncated, never local-time, never re-rounded. This guarantees two daemon cycles recomputing the same block from the same JSONL produce the same key.
8. **Detect changes**: compare against the daemon's local block cache (`~/.cclens/team-blocks-cache.json`). Only push blocks that are new or changed.
9. **Send to server**: include changed blocks in the next ingest cycle's `sessionBlocks[]` field.

### Performance and local storage

The daemon's local cache stores minimal metadata per block (~200 bytes each). A team-member with 50 active blocks over 30 days = 10 KB cache file. Re-computed from JSONL every 5 minutes (cheap; JSONL is already resident in the file cache from solo edition's live refresh).

### Privacy boundary in the aggregator

The daemon passes the parser's `SessionDetail` through the aggregator but **extracts only**:
- Timestamps (`firstTimestamp`, `lastTimestamp`, active segment start/end times)
- Aggregate counts (tool calls, turns, tokens)
- Sub-agent / skill names (from sidechain events — these are pluggable skill identifiers, not content)
- The repo slug (derived from `git remote`, not the full path)

**It never extracts** message content, tool call arguments, tool call results, file contents, branch names, or commit messages. The same privacy boundary as the rest of the team ingest.

## Implementation sequencing within Doc 3

1. **Schema migration**: add `session_blocks` table with indexes. Seed script for tests.
2. **Daemon aggregator**: implement block merging, repo slug computation, block_key generation, local cache. Unit tests against solo edition's existing test fixtures.
3. **Daemon push integration**: extend the ingest payload builder to include `sessionBlocks[]`. Test end-to-end against a test server.
4. **Ingest API extension**: server-side accept/validate `sessionBlocks[]`, upsert on `(team_id, member_id, block_key)`. Test with Doc 1 compatibility fixtures.
5. **Gantt feed endpoint** `GET /api/team/gantt`: query with filter + pagination, return structured response. Performance test at 1M blocks.
6. **Supporting read endpoints**: `/api/team/repos`, `/api/team/blocks/:id`, `/api/team/gantt/day/:day`, `/api/team/gantt/member/:id`.
7. **Gantt UI component**: adapt solo edition's `/parallelism` page component to the team context (rows-are-members, blocks-are-session-merged). Reuse color and density primitives.
8. **Team Gantt page** `/team/:slug/gantt`: integrate the Gantt component, filter bar, selected-block side panel, summary footer. Live refresh via extended SSE.
9. **Hourly day drill-down** and **member weekly detail** pages: stripped-down Gantt views with adjusted granularity.
10. **History page**: prev/next week navigation with the same Gantt component.
11. **`fleetlens team backfill` command**: re-compute and push session blocks for the last N days. Respects rate limits.
12. **End-to-end smoke test**: fresh Doc 1 + Doc 3 deploy, 3 test daemons running for ≥ 3 days with varied repo activity, verify Gantt renders correctly and cross-member concurrency detection works.

## Privacy boundary (Doc 3 additions)

### Added to "shipped to team server"

- **Repo slugs** — short names like `agentic-knowledge-system`, not paths or remote URLs
- **Session block aggregates**: start/end times, agent time sums, session counts, tool call counts, turn counts, token counts per block
- **Skill/sub-agent names** detected during sessions (captured but not surfaced as a visual primitive until Doc 4)
- **Peak concurrency** within a block

### Still never leaves the laptop

- Everything in Docs 1/2's "stays on laptop" lists
- Individual session IDs, message content, tool call bodies, file contents, file paths
- The full git remote URL (only the slug is shipped)
- Branch names, commit messages

### New leak surface: repo slugs can encode sensitive project names

A repo called `acme-billing-secret-rebrand` leaks the codename to the team server. This is a real issue for regulated teams.

**Mitigation (Doc 3 scope)**: Settings → Privacy adds a **"repo slug rename"** table. Admins can define mappings like:
- `acme-billing-secret-rebrand` → `billing-service`

When set, the daemon's local aggregator applies the mapping *before* computing `block_key` and shipping. The team server only ever sees the renamed slug. The mapping is stored in `teams.settings.repoSlugMappings` as a JSON object and pulled by the daemon via `GET /api/team/daemon-policy` (the endpoint introduced for Doc 4's privacy filtering — but Doc 3 adds its first use here).

**Historical row handling**: saving a new rename also triggers a server-side `UPDATE` that rewrites existing rows:

```sql
UPDATE session_blocks
SET repo_slug = 'billing-service'
WHERE team_id = $team_id
  AND repo_slug = 'acme-billing-secret-rebrand';
```

This runs synchronously inside the `PUT /api/team/settings/repo-slug-mappings` request handler so historical rows are scrubbed atomically with the mapping save. The `block_key` values on rewritten rows are intentionally left *unchanged* — they were computed with the old slug, so a daemon re-ingest will produce a different key and create a new row, which is fine because the block is conceptually the same work. The dead rows are cleaned up by the daily prune once they exit the retention window. This is a minor storage inefficiency in exchange for atomic privacy enforcement.

**Daemon cache window**: when the admin saves a new mapping, daemons in the field take up to one ingest cycle (~5 min) to pick it up via `/api/team/daemon-policy` polling. Blocks already queued locally (`~/.cclens/ingest-queue.jsonl`) still have the old slug and will push with the old slug when network returns. The server-side UPDATE catches these on arrival — after the mapping is saved, the server runs the same UPDATE rule at ingest time: any `sessionBlocks[]` entry whose `repoSlug` matches a current mapping's source gets rewritten to the target slug before insertion. This closes the queue-drain race.

**Wait — Doc 4 introduces `/api/team/daemon-policy`?** Yes. Doc 3 adds this endpoint earlier than Doc 4's ticket-correlation privacy toggles require it, because repo slug renames need the same versioned + polled infrastructure. The endpoint is small (5 lines of server code, 30 lines of daemon code) and it's the right place to put *any* per-team daemon-side config that changes dynamically. Doc 4 extends it with more fields.

The endpoint's Doc 3 shape:

```json
{
  "policyVersion": 3,
  "repoSlugMappings": {
    "acme-billing-secret-rebrand": "billing-service"
  }
}
```

The daemon caches this and applies renames before pushing `sessionBlocks[]`. A 5-minute lag between admin toggle and effect is acceptable for this use case.

## v1 scope for Doc 3

**Ships on top of Doc 1 (and optionally Doc 2):**

- `session_blocks` table with indexes
- Ingest API extension (accepts `sessionBlocks[]`)
- Daemon-side session block aggregator with 30-min merge rule
- Repo slug computation from git remote
- Gantt feed endpoint `GET /api/team/gantt` with filtering, pagination, caps
- Supporting read endpoints (`/api/team/repos`, `/api/team/blocks/:id`, day/member drill-downs)
- `GET /api/team/daemon-policy` endpoint (shared with Doc 4, introduced here)
- `/team/:slug/gantt` hero page with filter bar, side panel, summary footer
- Hourly day drill-down and member weekly detail pages
- `/team/:slug/history` time-travel page with prev/next week navigation
- `fleetlens team backfill --days N` command
- SSE `block-updated` event for live refresh
- Settings → Privacy: repo slug rename table

**Not in Doc 3:**

- Ticket correlation — Doc 4
- Signal hierarchy / auto-detection / pluggable matcher/enricher — Doc 4
- Insights feed — Doc 4
- Pattern-based recommendations from Gantt data — Doc 4
- Shipping-state labels on blocks (PR opened, merged) — Doc 4
- Per-ticket deep-dive from a block — Doc 4

## Open questions for Doc 3

1. **How should the color palette handle >12 repos?** Current design hashes repo slugs to a fixed 12-color palette. With 20+ repos, colors collide. Options: (a) extend the palette to 20 colors (hard to distinguish), (b) use deterministic hashing with a warning on collision, (c) let the admin assign colors in Settings. Recommended: (b) for v1, (c) for v1.1.
2. **What does "peak concurrency within a block" mean exactly?** If Bob merges two sessions (session-A from 9:00-10:00 and session-B from 9:30-10:30) into one block, the peak concurrency *within the block* is 2 (both running at 9:30-10:00). But if three Bob sessions run simultaneously for 5 minutes, peak is 3. This is worth specifying in the aggregator logic.
3. **Should the Gantt show blocks where `agent_time_ms < 60s`?** Very small blocks clutter the view (a dev tabbed in for 30 seconds). The filter bar has a "min block duration" slider defaulting to 1 minute, which hides these by default. Is 1 min the right default? Maybe 5 min?
4. **Block merging across lunch breaks**: if Alice works 9-12, breaks for lunch until 13, then works 13-17 in the same repo, the 30-min gap rule splits this into two blocks. Is that what a manager wants to see, or should they see one "Alice was on api-svc most of the day" block with a visual gap? Recommended: keep the two-block view — it accurately reflects the cadence. Add a visual "grouping" that joins them with a thin line if same-repo-same-day.
5. **Gantt rendering at 50+ member rows**: the current design assumes ≤ 20 members fit on screen. At 50+ the hero view needs virtualization. v1 uses the 100-member cap and a natural scroll; v1.1 may need virtualization.

## Dependencies on Doc 1

- `teams`, `members`, `admin_sessions`, `events` schema
- Ingest API endpoint with permissive parsing
- SSE infrastructure + `LiveRefresher` client component
- Admin session cookie + bearer token auth
- `teams.settings jsonb` column for `repoSlugMappings`
- node-cron scheduler — Doc 3 adds one new daily job (see below)

### New scheduled job: `session_blocks` prune

Doc 3 adds a daily prune at **04:15 UTC** (one step after Doc 2's 04:00 `plan_utilization` prune) that deletes rows where `ended_at < now() - (teams.retention_days * interval '1 day')`. This mirrors Doc 2's approach. Extension of Doc 1's existing node-cron scheduler, not a new process.

```sql
-- Executed once per day per team
DELETE FROM session_blocks
WHERE team_id = $team_id
  AND ended_at < now() - make_interval(days => $retention_days);
```

Without this job, `session_blocks` grows unbounded — a 20-person team producing ~5 blocks/person/day × 365 days = ~36,500 rows/year, bounded but wasteful. With it, the table stays at one year's worth by default.

### Daemon compatibility

A Doc 3 daemon (emits `sessionBlocks[]`) pushing to a Doc 1 server: field ignored, roster page continues working. A Doc 1 daemon (omits `sessionBlocks[]`) pushing to a Doc 3 server: Gantt empty for that member until they upgrade; roster still populated.

A Doc 3 server receiving Doc 4 payloads (with ticket fields in `sessionBlocks[]` entries): Doc 3 server ignores the ticket fields; blocks still land. When Doc 4 server takes over, those fields start being stored.

## Visual design notes

The Gantt view is the biggest UI investment in Team Edition. To de-risk the design, Doc 3 implementation should include:

- **Early mockup review**: before writing React, produce 3 static screenshots of what the Gantt looks like at (a) 5 members, 14 days, (b) 20 members, 14 days, (c) 20 members, 90 days zoomed to 1 week. Iterate on the mockups with real stakeholders.
- **Reuse solo edition primitives**: the existing `/parallelism` page's block rendering, color hashing, and time-axis components should be lifted directly. Adapt them to the team context, don't re-implement.
- **Responsive behavior**: the Gantt is not viable on mobile. The hero page detects small screens and shows "View on a desktop for the full Gantt" with the member roster as a fallback view.
