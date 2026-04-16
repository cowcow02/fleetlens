# Team Edition Tickets + Insights — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decorate the Doc 3 Gantt with ticket labels via a six-tier signal hierarchy, add auto-detection of team ticket config, ship the `gh pr list` enricher, and surface pattern-based insights for engineering managers.

**Architecture:** Extends the daemon aggregator with `ticketSignals` extraction, adds server-side ticket matching via the `TicketMatcher` interface, enrichment via `TicketEnricher`, introduces `session_block_tickets` child table + `tickets` + `pr_ticket_map` + `insights_feed` + `enrichment_queue` tables, and adds ticket list, ticket detail, and insights feed pages.

**Tech Stack:** Same as Plans 1-3, plus `gh` CLI for the default enricher.

**Spec:** `docs/superpowers/specs/2026-04-16-team-edition-04-tickets-insights-design.md`

**Depends on:** Plan 1 (Foundation) + Plan 3 (Timeline). Plan 2 (Plan Utilization) is optional — insights `capacity` and `cost` detectors use Doc 2 data when present.

---

## File Structure

### New/modified in `packages/team-server/`

```
src/
  db/
    schema-doc4.sql                # session_block_tickets, tickets, pr_ticket_map, insights_feed,
                                   #   enrichment_queue, tickets_dirty
  lib/
    ticket-matcher.ts              # TicketMatcher interface + default-tiered implementation
    ticket-enricher.ts             # TicketEnricher interface + gh-pr-list implementation
    enrichment-worker.ts           # background worker: pop queue, run enricher, update tickets
    auto-detector.ts               # scan session_block ticketSignals → auto-detect prefix/provider
    insights-detector.ts           # daily pattern engine: share_worthy, coachable, check_in, capacity, cost
    tickets-rebuild.ts             # hourly tickets table rebuild from session_block_tickets
  app/
    team/[slug]/
      tickets/
        page.tsx                   # Ticket list view
        [ticketId]/
          page.tsx                 # Ticket detail view
      insights/
        page.tsx                   # Insights feed
    api/team/
      tickets/
        route.ts                   # GET /api/team/tickets
        [ticketId]/
          route.ts                 # GET /api/team/tickets/:ticketId
      insights/
        route.ts                   # GET /api/team/insights
        [id]/
          acknowledge/
            route.ts               # POST /api/team/insights/:id/acknowledge
          dismiss/
            route.ts               # POST /api/team/insights/:id/dismiss
      auto-detect/
        route.ts                   # POST /api/team/auto-detect, GET status
      enricher-status/
        route.ts                   # GET /api/team/enricher-status
  components/
    ticket-decorated-block.tsx     # gantt block with ticket label overlay
    ticket-list-row.tsx
    ticket-detail.tsx
    insight-card.tsx
test/
  lib/
    ticket-matcher.test.ts         # every tier, disambiguation, multi-ticket
    ticket-enricher.test.ts        # gh pr list mock
    auto-detector.test.ts          # kipwise fixture → HIGH confidence
    insights-detector.test.ts      # each detector kind
```

### Modified in `packages/cli/`

```
src/
  team/
    aggregator.ts                  # MODIFY: add ticketSignals extraction
    ticket-signals.ts              # NEW: URL extraction, cwd worktree, agentName, slash cmd, content freq, git branch
    push.ts                        # MODIFY: include ticketSignals in sessionBlocks[] entries
test/
  team/
    ticket-signals.test.ts         # URL disambiguation, same-repo filter, content freq counting
```

---

## Chunk 1: Daemon Signals + Server Matcher

### Task 1: Schema migration (6 new tables)

- [ ] Write `schema-doc4.sql`:
  - `session_block_tickets` (child table with weight column, FK to session_blocks)
  - `tickets` (canonical ticket view)
  - `pr_ticket_map` (passive PR↔ticket index with canonical flag)
  - `insights_feed` (with dedup_key column)
  - `enrichment_queue`
  - `tickets_dirty` (staging table for hourly rebuild)
- [ ] Update `migrate.ts`, write test, commit

### Task 2: Ticket signals extraction (daemon side)

This is the most intricate daemon-side logic — extracting structured signals from raw JSONL without leaking content.

- [ ] **Write failing tests for ticket-signals.ts**

```ts
describe("extractTicketSignals", () => {
  it("extracts same-repo GitHub PR URL from tool_result of gh pr create", ...);
  it("extracts Linear URL from tool_result of mcp__linear__update_issue", ...);
  it("filters out third-party URLs (PostHog, Grafana, etc.)", ...);
  it("ranks URLs by priority: gh-pr-create > MCP-tool > final-assistant > frequency > first-user", ...);
  it("excludes tool_use input URLs (WebFetch targets)", ...);
  it("extracts cwdWorktreeTicketId from worktree directory name", ...);
  it("extracts agentNameTicketHint from agentName field", ...);
  it("extracts slashCommandTicketHint from /implement in first user message", ...);
  it("extracts contentFrequencyTop — the dominant ticket mention by count", ...);
  it("reads gitBranch from session events", ...);
  it("applies skillTagDenyList — replaces matching tags with [redacted]", ...);
  it("applies stripPRTitle — omits prTitle from URL entries when policy is set", ...);
});
```

- [ ] **Implement ticket-signals.ts**

For each session block, scan the underlying JSONL events and produce a `TicketSignals` object:

```ts
export type TicketSignals = {
  urls: Array<{
    url: string;
    type: "github-pr" | "github-issue" | "linear-issue" | "jira-issue" | "shortcut-story" | "gitlab-mr" | "gitlab-issue";
    priority: number; // 1-5 per spec's disambiguation rule
    extractedFrom: string; // "tool_result:gh pr create", "assistant:final", etc.
  }>;
  cwdWorktreeTicketId: string | null;
  agentNameTicketHint: string | null;
  slashCommandTicketHint: string | null;
  contentFrequencyTop: { id: string; count: number } | null;
  gitBranch: string | null;
};
```

URL extraction uses regex patterns from Appendix A of the spec. Same-repo filter uses `resolveRepoSlug` from Doc 3.

Content frequency scanning: count `[A-Z]{2,6}-\d{1,5}` occurrences across all `user` + `assistant` + `tool_result` event text, pick the most frequent. Ship only `{id, count}` — never the raw text.

- [ ] **Run tests, commit**

### Task 3: Extend daemon aggregator with ticketSignals

- [ ] Modify `aggregator.ts` to call `extractTicketSignals()` for each session block
- [ ] Include in the `sessionBlocks[]` payload entries as a `ticketSignals` nested object
- [ ] Read daemon-policy for `ticketConfig` (prefixes) and `privacy` settings, apply before push
- [ ] Test: verify the full pipeline (JSONL → aggregator → signals → payload)
- [ ] Commit

### Task 4: Server-side default ticket matcher

- [ ] **Write failing tests for ticket-matcher.ts**

```ts
describe("DefaultTieredMatcher", () => {
  it("Tier 0: URL match → gold, confidence 1.0", ...);
  it("Tier 1: cwd worktree → gold, confidence 1.0", ...);
  it("Tier 2: agentName → gold, confidence 1.0", ...);
  it("Tier 3: content freq → silver, confidence 0.95", ...);
  it("content + slash agreement → silver boosted, confidence 0.99", ...);
  it("Tier 4: slash only → silver, confidence 0.89", ...);
  it("Tier 5: branch only → returns null (never sole source)", ...);
  it("no match → returns null", ...);
  it("multi-URL tie → returns multiple matches with is_multi_ticket", ...);
  it("URL disambiguation: gh-pr-create wins over frequency", ...);
});
```

- [ ] **Implement the TicketMatcher interface + DefaultTieredMatcher**

Pure functions. Takes a `SessionBlockIngest` (with `ticketSignals`) and `TeamConfig`, returns `TicketMatch[] | null`. Implements the six-tier resolution rule from the spec.

- [ ] **Run tests, commit**

### Task 5: Ingest pipeline extension — match + store tickets

- [ ] Modify `processIngest` to run the matcher on each session block's `ticketSignals`
- [ ] For each match: INSERT into `session_block_tickets` (DELETE old rows for the block_id first, then INSERT new matches — replace semantics)
- [ ] If both a PR URL and a ticket URL are in the same block: INSERT into `pr_ticket_map` (canonical resolution logic)
- [ ] INSERT into `tickets_dirty` for each affected ticket_id
- [ ] Write test: block with URL signals → ticket match stored; block without signals → zero child rows
- [ ] Commit

---

## Chunk 2: Enricher + Auto-detect + Insights

### Task 6: gh-pr-list enricher + enrichment queue

- [ ] **Write failing tests for ticket-enricher.ts**

```ts
describe("GhPrListEnricher", () => {
  it("returns ok with title + merged state for an accessible PR", ...);
  it("returns not_found for a deleted PR", ...);
  it("returns enricher_unavailable when gh is not installed", ...);
  it("returns not_authorized for a private repo without auth", ...);
  it("returns transient_error on network failure", ...);
});
```

- [ ] **Implement the TicketEnricher interface + GhPrListEnricher**

Uses `child_process.execSync("gh pr view <pr_number> --json title,state,mergedAt", { cwd })`. Parses JSON output. Maps `state: "MERGED"` → `ship_state: "merged"`. Returns discriminated union per spec.

- [ ] **Implement enrichment-worker.ts**

Background worker (runs every 2 minutes via scheduler): pops up to 50 pending jobs from `enrichment_queue`, runs the enricher, updates `tickets` row, marks job succeeded/failed. Retry with exponential backoff (2×2^attempts, cap 1h). After 5 attempts → abandoned.

- [ ] **Wire into scheduler, write integration test**
- [ ] Commit

### Task 7: Tickets table rebuild (hourly job)

- [ ] Implement `tickets-rebuild.ts`: read `tickets_dirty`, for each dirty ticket_id, aggregate `session_blocks ⋈ session_block_tickets` → upsert `tickets` row using the canonical merge policy
- [ ] Add to scheduler at 01:00 UTC
- [ ] Test: seed blocks with ticket matches → run rebuild → verify tickets table
- [ ] Commit

### Task 8: Auto-detector

- [ ] **Write failing test with kipwise-like fixture data**

Seed ~50 session blocks with ticketSignals containing Linear URLs with KIP prefix → expect auto-detect returns `{ prefix: "KIP", provider: "linear", slug: "kipwise", confidence: "high" }`.

- [ ] **Implement auto-detector.ts**

Scoring algorithm per spec: +5 per URL session, +3 per branch/agentName, +1 per content. Blacklist filter. Confidence tiers. Multi-prefix support.

- [ ] **Wire to `POST /api/team/auto-detect` endpoint + first-data trigger**
- [ ] Commit

### Task 9: Extend daemon-policy with ticket config + privacy

- [ ] Extend `GET /api/team/daemon-policy` response with `ticketConfig` and `privacy` sections
- [ ] Daemon reads `ticketConfig.prefixes` to scope content-frequency scanning to known prefixes (optimization)
- [ ] Daemon reads `privacy.stripPRTitle` — when true, omit any `prTitle`-like content from ticketSignals (note: PR titles come from the enricher, not the daemon — this flag is primarily a server-side enricher control)
- [ ] Daemon reads `privacy.skillTagDenyList` — redact matching skill names with `[redacted]`
- [ ] Commit

### Task 10: Insights detector functions

- [ ] **Implement share_worthy detector**: query session_blocks for members with peak_concurrency > 3 on ≥ 5 days in last 14 days AND ≥ 2 shipped tickets (from `tickets` where `ship_state = 'merged'` — graceful null check)
- [ ] **Implement coachable detector**: query session_blocks for members with avg active segment < 3 min and avg gap > 10 min and > 30 sessions in 14 days
- [ ] **Implement check_in detector**: find session_blocks with a single segment > 2 hours where member's 30-day avg is < 45 min
- [ ] **Implement capacity detector**: if Doc 2 tables present, surface capacity-warning cards; if not, no-op
- [ ] **Implement cost detector**: if Doc 2 tables present, surface plan-optimizer summary as insight; if not, no-op
- [ ] **Add dedup logic**: generate `dedup_key` per spec, check 30-day window before emitting
- [ ] **Wire to scheduler at 02:00 UTC**
- [ ] **Write unit tests for each detector with fixture data**
- [ ] Commit

---

## Chunk 3: Ticket UI + Insights UI + Polish

### Task 11: Gantt label decoration

- [ ] Modify `gantt-block.tsx` to read `session_block_tickets` data from the gantt feed response
- [ ] When a block has a non-null ticket_id: prepend ticket ID to the label (`KIP-148 api-svc 4.1h`)
- [ ] When the ticket has `ship_state = 'merged'`: add a trailing ship marker
- [ ] Blocks without tickets render exactly as Doc 3 left them (regression-safe)
- [ ] Extend the gantt feed API to join `session_block_tickets` and include ticket data in the response
- [ ] Visual regression test: Doc 3 blocks without tickets still look the same
- [ ] Commit

### Task 12: Ticket list page

- [ ] Implement `GET /api/team/tickets?from=&to=&members=&signal_tier=` — query `tickets` table with pagination (500 cap)
- [ ] Implement `/team/:slug/tickets` page — table with columns: ticket ID, title (from enricher), assignee, ship state, agent time, session count, last touch, signal tier badge
- [ ] Click row → navigate to detail page
- [ ] Commit

### Task 13: Ticket detail page

- [ ] Implement `GET /api/team/tickets/:ticketId` — return ticket row + all contributing members (from session_block_tickets ⋈ session_blocks ⋈ members) + all associated blocks as a mini-Gantt data feed
- [ ] Implement `/team/:slug/tickets/:ticketId` page — header (ticket ID, title, PR link, ship state, signal tier + source), member contribution list (agent time per member), mini-Gantt of associated blocks, detected skills
- [ ] Commit

### Task 14: Insights feed page

- [ ] Implement `GET /api/team/insights` — return `insights_feed` rows where `dismissed_at IS NULL`, ordered by `generated_at DESC`, limit 50
- [ ] Implement `POST /api/team/insights/:id/acknowledge` and `POST /api/team/insights/:id/dismiss`
- [ ] Implement `/team/:slug/insights` page — card grid with kind badge, title, body, subject member names, acknowledge/dismiss buttons
- [ ] Copy discipline: verify all detector template strings use only approved vocabulary (observe, pattern, cadence, shape, share, try, check-in — never performance, efficiency, rank, score)
- [ ] Commit

### Task 15: Settings extensions

- [ ] Settings → Integrations: show auto-detected ticket config (prefixes, provider, home repo), "Re-detect" button, enricher status card
- [ ] Settings → Privacy: add `stripPRTitle` toggle and `skillTagDenyList` regex textarea (server-side UPDATE on toggle)
- [ ] Commit

### Task 16: Plugin interface documentation

- [ ] Create `docs/plugins.md` with TypeScript definitions for `TicketMatcher` and `TicketEnricher` interfaces
- [ ] Include example implementations showing how a third party would write a Linear API enricher
- [ ] Note that v1 ships the interfaces only; the runtime loader is v1.1
- [ ] Commit

### Task 17: End-to-end smoke test

- [ ] Deploy fresh Docs 1/2/3/4 stack
- [ ] Run 3 test daemons producing kipwise-like data for 24 hours:
  - Daemon A: sessions with `gh pr create` tool_results containing PR URLs
  - Daemon B: sessions with Linear MCP tool_results containing ticket URLs
  - Daemon C: sessions with no URLs (content-frequency-only matching)
- [ ] Verify auto-detect runs and produces correct config
- [ ] Verify tickets populate in the ticket list with correct signal tiers
- [ ] Verify Gantt blocks gain ticket labels
- [ ] Verify insights feed generates at least one card (seed data designed to trigger share_worthy)
- [ ] Verify enricher populates PR titles for daemon A's tickets
- [ ] Commit

---

## Summary

**17 tasks across 3 chunks.** Estimated: **4-5 weeks** for one developer on top of Plans 1+3.

**Key integration points:**
1. Daemon extracts `ticketSignals` from JSONL → ships in `sessionBlocks[]` → server matcher produces `TicketMatch[]` → `session_block_tickets` rows → Gantt decoration
2. Auto-detector scans accumulated `ticketSignals` → stores config in `teams.settings.ticketConfig` → daemon reads via `/api/team/daemon-policy`
3. Enricher worker pops `enrichment_queue` → `gh pr view` → updates `tickets.pr_title` / `ship_state` → Gantt `*` marker
4. Insights detector reads `session_blocks` + `tickets` + `plan_utilization` (if present) → emits cards to `insights_feed` → UI renders

**Total estimated implementation time across all 4 plans: ~22-26 weeks** for one full-time developer, or **~14-16 weeks** for two developers working in parallel on Docs 2+3 once Doc 1 is done.
