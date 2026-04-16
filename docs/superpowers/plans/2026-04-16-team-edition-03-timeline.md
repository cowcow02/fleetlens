# Team Edition Timeline — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the team Gantt with per-member session blocks (labeled by repo, no ticket correlation yet).

**Architecture:** Extends `packages/team-server` with `session_blocks` table, daemon-side session aggregator in `packages/cli`, Gantt feed API, and a team Gantt UI page that becomes the new hero view.

**Tech Stack:** Same as Plan 1, plus the existing solo-edition parser (`@claude-lens/parser`) for session aggregation.

**Spec:** `docs/superpowers/specs/2026-04-16-team-edition-03-timeline-design.md`

**Depends on:** Plan 1 (Foundation) must be complete.

---

## File Structure

### New/modified in `packages/team-server/`

```
src/
  db/
    schema-doc3.sql                # session_blocks table + indexes
  lib/
    gantt-feed.ts                  # query builder for GET /api/team/gantt
    daemon-policy.ts               # GET /api/team/daemon-policy handler logic
  app/
    team/[slug]/
      gantt/
        page.tsx                   # Team Gantt hero page (replaces roster as default)
        day/[day]/
          page.tsx                 # Hourly drill-down for a single day
        member/[id]/
          page.tsx                 # Single-member weekly detail
      history/
        page.tsx                   # Time-travel week-by-week navigation
    api/team/
      gantt/
        route.ts                   # GET /api/team/gantt?from=...&to=...
        day/[day]/
          route.ts                 # GET /api/team/gantt/day/:day
        member/[id]/
          route.ts                 # GET /api/team/gantt/member/:id
      repos/
        route.ts                   # GET /api/team/repos
      blocks/[id]/
        route.ts                   # GET /api/team/blocks/:id
      daemon-policy/
        route.ts                   # GET /api/team/daemon-policy
      settings/
        repo-slug-mappings/
          route.ts                 # PUT /api/team/settings/repo-slug-mappings
  components/
    gantt-chart.tsx                # Gantt canvas component (adapted from solo /parallelism)
    gantt-block.tsx                # individual block rendering
    gantt-filter-bar.tsx           # date range + member + repo filters
    block-side-panel.tsx           # selected block detail panel
test/
  lib/
    gantt-feed.test.ts
    daemon-policy.test.ts
  api/
    gantt.integration.test.ts
```

### New/modified in `packages/cli/`

```
src/
  team/
    aggregator.ts                  # session block aggregator (merge, repo slug, block_key)
    repo-slug.ts                   # git remote → basename slug resolver
    push.ts                        # MODIFY: include sessionBlocks[] in payload
  daemon-worker.ts                 # MODIFY: call aggregator, push session blocks
test/
  team/
    aggregator.test.ts             # merge rules, block_key stability, peak concurrency
    repo-slug.test.ts              # git remote parsing, fallback behavior
```

---

## Chunk 1: Schema + Daemon Aggregator

### Task 1: session_blocks schema migration

- [ ] Write `schema-doc3.sql` with the `CREATE TABLE session_blocks` DDL + indexes from the spec
- [ ] Update `migrate.ts` to apply doc3 schema after doc1+doc2
- [ ] Write test verifying the table exists and unique constraint works
- [ ] Commit

### Task 2: Repo slug resolver

- [ ] Write failing tests: `resolveRepoSlug(cwd)` returns `basename(git remote get-url origin)` stripped of `.git`; falls back to `basename(cwd)` when git fails
- [ ] Implement `repo-slug.ts` using `child_process.execSync("git remote get-url origin", { cwd })`
- [ ] Test: no remote → falls back; remote with `.git` suffix → stripped; cached per cwd
- [ ] Commit

### Task 3: Session block aggregator

This is the core new logic in the daemon — merge sessions into blocks per (member, repo).

- [ ] **Write failing tests for aggregator.ts**

```ts
describe("aggregateSessionBlocks", () => {
  it("merges two sessions in the same repo within 30-min gap into one block", ...);
  it("splits sessions in the same repo with >30-min gap into two blocks", ...);
  it("keeps sessions in different repos as separate blocks", ...);
  it("computes peak concurrency correctly for overlapping sessions", ...);
  it("re-computes peak concurrency from scratch when a new session extends the block", ...);
  it("produces a stable block_key from (memberId, repoSlug, startedAt)", ...);
  it("block_key uses full-ms UTC ISO for startedAt", ...);
  it("collects skill names from SubagentRun.agentType, never description/prompt", ...);
  it("applies repo slug mappings from daemon policy", ...);
});
```

- [ ] **Implement aggregator.ts**

Core algorithm (matching the spec):
1. Read recent JSONL via `@claude-lens/parser/fs` `listSessions` for the last 24 hours
2. Parse each session with `parseTranscript` to get `SessionMeta.activeSegments` (shape: `{startMs, endMs}[]`)
3. Canonicalize cwd via `canonicalProjectName()` from `@claude-lens/parser`
4. Resolve repo slug per canonicalized cwd
5. Group sessions by repo slug
6. Within each group, sort active segments by `startMs`, merge segments with gaps ≤ 30 min
7. Each merged group = one session block with computed fields
8. Compute `blockKey = sha256(memberId + "|" + repoSlug + "|" + new Date(earliestStartMs).toISOString())`
9. Compute `peakConcurrency` using `computeBurstsFromSessions` from `@claude-lens/parser/analytics`
10. Extract skill names: scan events for `SubagentRun`, collect `agentType` values only (never `description`, `prompt`, `finalText`, or `finalPreview`)

- [ ] **Run tests, fix until green**
- [ ] **Commit**

### Task 4: Extend daemon push with sessionBlocks[]

- [ ] Modify `push.ts` to call `aggregateSessionBlocks()` and include result in the ingest payload
- [ ] Add change detection: compare each block against a local cache file (`~/.cclens/team-blocks-cache.json`); only push blocks whose computed hash differs from the cached version
- [ ] Write test: blocks that haven't changed are skipped; changed blocks are included
- [ ] Commit

### Task 5: Server-side ingest extension for sessionBlocks[]

- [ ] Add `SessionBlockSchema` to Zod schemas (with `.passthrough()` at every level)
- [ ] Extend `processIngest` in `ingest.ts`: if `payload.sessionBlocks[]` present, upsert each block on `(team_id, member_id, block_key)` with `EXCLUDED.*` columns
- [ ] Apply repo slug mappings server-side: check `teams.settings.repoSlugMappings`, rewrite `repo_slug` if matched
- [ ] Broadcast SSE `block-updated` event after successful block upsert
- [ ] Write test: blocks arrive in DB, duplicates upsert cleanly, unknown fields preserved
- [ ] Commit

---

## Chunk 2: Gantt API + UI

### Task 6: Daemon-policy endpoint

- [ ] Implement `GET /api/team/daemon-policy` returning `{ policyVersion, repoSlugMappings }` from `teams.settings`
- [ ] Implement `PUT /api/team/settings/repo-slug-mappings` with server-side UPDATE of historical rows + policyVersion bump
- [ ] Implement daemon-side policy polling (once per ingest cycle, cache by policyVersion, 304 on unchanged)
- [ ] Write test: set a mapping → verify daemon applies it → verify historical rows rewritten
- [ ] Commit

### Task 7: Gantt feed endpoint

- [ ] Implement `GET /api/team/gantt?from=&to=&members=&repos=`

Query:
```sql
SELECT sb.*, m.display_name, m.email
FROM session_blocks sb
JOIN members m ON m.id = sb.member_id AND m.revoked_at IS NULL
WHERE sb.team_id = $1
  AND sb.started_at >= $2
  AND sb.ended_at <= $3
  AND ($4::uuid[] IS NULL OR sb.member_id = ANY($4))
  AND ($5::text[] IS NULL OR sb.repo_slug = ANY($5))
ORDER BY sb.started_at DESC
LIMIT 5001  -- fetch one extra to determine if cursor needed
```

- [ ] Implement pagination (cursor = last block's `started_at` ISO) and the 5,000-block cap
- [ ] Implement summary aggregation (total blocks, total agent time, unique repos, peak cross-member concurrency day)
- [ ] Write integration test with seeded blocks, verify filters, pagination, summary
- [ ] Commit

### Task 8: Supporting read endpoints

- [ ] `GET /api/team/repos` — `SELECT DISTINCT repo_slug FROM session_blocks WHERE team_id = $1 AND started_at > now() - interval '30 days'`
- [ ] `GET /api/team/blocks/:id` — full block detail for the side panel
- [ ] `GET /api/team/gantt/day/:day` — same query as gantt but filtered to one day, hour-granularity response
- [ ] `GET /api/team/gantt/member/:id` — same query filtered to one member
- [ ] Write tests, commit

### Task 9: Team Gantt UI

This is the largest UI task. Adapt the existing solo-edition `/parallelism` page's block rendering.

- [ ] **Implement gantt-chart.tsx** — the canvas component. Y-axis = member rows, X-axis = time. Block rendering with color-by-repo hash, density shading, border style. Adapted from solo edition's existing Gantt primitives.
- [ ] **Implement gantt-block.tsx** — individual block: label (`repo_slug · Xh`), width from start→end, opacity from agent_time/wall_clock ratio, solid/dashed border by session count
- [ ] **Implement gantt-filter-bar.tsx** — date range picker, member multi-select, repo multi-select, min-duration slider
- [ ] **Implement block-side-panel.tsx** — shows block detail on click (member, repo, times, stats, skills)
- [ ] **Implement the hero page** at `/team/:slug/gantt` — fetches gantt feed, renders chart + filter bar + side panel + week summary footer, subscribes to SSE for live refresh
- [ ] **Update the team layout** to make Gantt the default route (redirect `/team/:slug` → `/team/:slug/gantt`)
- [ ] **Test in browser** with seeded block data
- [ ] Commit

### Task 10: Drill-down pages + history

- [ ] Implement hourly day view at `/team/:slug/gantt/day/:day`
- [ ] Implement single-member weekly detail at `/team/:slug/gantt/member/:id`
- [ ] Implement history page at `/team/:slug/history` with prev/next week navigation
- [ ] Test in browser
- [ ] Commit

### Task 11: `fleetlens team backfill` command

- [ ] Implement in `packages/cli/src/team/backfill.ts`
- [ ] Re-compute session blocks for last N days from local JSONL
- [ ] Push all blocks respecting 3-parallel / 1-second rate limit
- [ ] Register as `fleetlens team backfill --days 30`
- [ ] Test manually
- [ ] Commit

### Task 12: session_blocks prune job

- [ ] Add to scheduler: 04:15 UTC daily, delete blocks where `ended_at < now() - teams.retention_days`
- [ ] Commit

### Task 13: End-to-end smoke test

- [ ] Deploy fresh Doc 1 + Doc 3, run 3 test daemons producing varied repo activity for ≥3 days
- [ ] Verify Gantt renders correctly with multiple members
- [ ] Verify filter bar works (repo filter, member filter, date range)
- [ ] Verify cross-member concurrency detection (day header badges)
- [ ] Verify backfill populates historical blocks
- [ ] Commit

---

## Summary

**13 tasks across 2 chunks.** Estimated: **5-6 weeks** for one developer on top of Plan 1.

**Key integration point:** daemon aggregator reads local JSONL → `parseTranscript` → `canonicalProjectName` → `resolveRepoSlug` → merge sessions at 30-min gaps → `pushToTeamServer` with `sessionBlocks[]` → server upserts + SSE broadcast → Gantt renders live.
