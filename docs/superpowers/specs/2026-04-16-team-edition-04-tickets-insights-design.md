# Fleetlens Team Edition — Doc 4: Tickets + Insights

**Status:** Draft
**Date:** 2026-04-16
**Author:** split from 2026-04-15-team-edition-design.md
**Ships:** Ticket correlation, signal hierarchy, pluggable matcher/enricher, insights feed
**Depends on:** Doc 1 (Foundation), Doc 3 (Timeline)
**Independent of:** Doc 2 (Plan Utilization) — can ship before or after

## Overview

The final layer of Fleetlens Team Edition. Doc 4 decorates the Doc 3 Gantt with **ticket labels** — without rewriting the visual — and adds an **insights feed** that surfaces patterns the manager should know about.

The new pieces:

1. **Signal hierarchy** — a tiered ticket-identification stack (URL extraction → cwd worktree → agentName → content frequency → slash command → git branch) that works without any connector configured.
2. **Auto-detection** — on first team-sync, Fleetlens scans session logs and auto-configures the team's primary ticket prefix, provider, and home GitHub repo with zero admin input.
3. **Pluggable `TicketMatcher` / `TicketEnricher` interfaces** — published in v1, one built-in implementation each (`default` matcher, `gh pr list` enricher). Third parties can add Linear / Jira / Shortcut enrichers via the plugin interface.
4. **Ticket decoration on `session_blocks`** — new nullable columns populate with ticket IDs, ship states, PR URLs. Doc 3 blocks get ticket labels overlaid as an overlay layer; existing Doc 3 blocks stay visible and useful.
5. **Passive PR ↔ ticket index** — sessions that contain both a PR URL and a ticket URL give us a free mapping, stored in a new `pr_ticket_map` table.
6. **Insights feed** — a background pattern engine surfaces cards like "Alice's morning concurrency pattern is worth sharing" or "Bob's cadence is choppy — coachable." Framed as *patterns worth learning from*, not patterns worth controlling for.
7. **Privacy toggles** — the daemon-policy endpoint (introduced in Doc 3 for repo slug renames) gains `stripPRTitle` and `skillTagDenyList` so regulated teams can scrub sensitive metadata at source.

## Why ship Doc 4 last?

- **Ticket correlation is the hardest problem in the entire product.** Deferring it means Docs 1-3 ship already-useful features even if Doc 4's signal hierarchy needs more work than expected.
- **Doc 3 is already valuable without tickets.** Managers see who's working, when, on what repo. Doc 4 makes this view sharper by adding "what ticket specifically," but the Gantt is legible without it.
- **The validation data is kipwise-specific.** The 85.5% coverage / 100% precision numbers from the experiment are best-case under a workflow that stacks three reinforcing signals. Teams without that workflow get lower coverage — the tiered stack's whole point is graceful degradation. Shipping last lets us measure against real customer data before hardening the insights copy.
- **The insights feed is a UX-heavy feature.** Surfacing "patterns worth learning from" without feeling like surveillance requires careful copy and visual framing. Doc 4 has room to iterate on this.

## Personas

**Primary**: engineering manager who wants to read the team's shipping story at a glance — which tickets shipped when, which parallel branches converged on a milestone, which patterns are worth spreading.

**Secondary**: engineering manager who wants to learn from their own team's best weeks (reviewing past insight cards).

**Tertiary**: individual engineer who wants to see their own shipping cadence with tickets labeled (the opt-in self-improvement angle).

## Non-goals for Doc 4

- **First-party API-authenticated enrichers** (Linear API, Jira API, GitHub Issues API, Shortcut API) — the pluggable interface ships, the `gh pr list` local CLI enricher ships, but no Fleetlens-maintained API connectors in v1. Third parties can implement.
- **Automated "flag this member for a check-in" workflow** — insights are read-only cards; escalation flows are v2.
- **Natural-language querying of the shipping history** ("show me all tickets Alice shipped in March") — v2 with LLM integration.
- **Weekly email digest of insights** — v1.1 (depends on Doc 1's Resend integration).
- **Multi-project / multi-repo ticket graphs** — tickets are per-team in v1.
- **PR review latency, time-to-ship, cycle time analysis** — adjacent to insights but requires a different data shape (merged-PR timestamps from GitHub). Deferred.

## The signal hierarchy

The core technical problem Doc 4 solves: given a Claude Code session (which the daemon already parses), figure out which ticket it's working on — **without requiring the team to have configured any ticket-system integration**.

### The six tiers

| Tier | Signal | Precision | Coverage (kipwise) | Use as |
|---|---|---|---|---|
| **Tier 0** | URL extraction from agent/tool output | ~100% with disambiguation | 55.9% | Primary |
| **Tier 1** | cwd path is a ticket-named worktree | 100% | rare but perfect | Gold fallback |
| **Tier 2** | `agentName`/`teamName` fields from Claude Code orchestration | 100% when present | varies | Gold fallback |
| **Tier 3** | Content frequency scan (dominant ticket ID mention) | 94.8% | 67% of URL-less | Silver |
| **Tier 4** | `/implement <TICKET>` slash command in first user message | 89.2% | subset of silver | Silver |
| **Tier 5** | Git branch matches ticket-prefix regex | 77.5% | varies | Bronze — confirmation only |

**Resolution rule**, ordered pseudocode (first match wins):

```ts
function identifyTicket(session: ParsedSession, git: GitContext, team: TeamConfig): TicketMatch | null {
  // Gold tier (precision 1.0) — use any match immediately
  const urlMatch = extractTicketUrl(session, team);     // Tier 0
  if (urlMatch) return { id: urlMatch.id, confidence: 1.0, source: "url", provider: urlMatch.provider };

  const cwdMatch = matchCwdWorktree(session.cwd, team);  // Tier 1
  if (cwdMatch) return { id: cwdMatch, confidence: 1.0, source: "cwd-worktree" };

  const agentNameMatch = matchAgentNameField(session, team);  // Tier 2
  if (agentNameMatch) return { id: agentNameMatch, confidence: 1.0, source: "agent-field" };

  // Silver tier (precision 0.9+) — agreement boost
  const contentFreq = scanContentFrequency(session, team);    // Tier 3
  const slashCmd = extractSlashCommand(session, team);        // Tier 4

  if (contentFreq && slashCmd && contentFreq === slashCmd) {
    return { id: contentFreq, confidence: 0.99, source: "content+slash-agreement" };
  }
  if (contentFreq) return { id: contentFreq, confidence: 0.95, source: "content" };
  if (slashCmd)    return { id: slashCmd,    confidence: 0.89, source: "slash-command" };

  // Bronze tier — confirmation only, never sole source
  const branchMatch = matchGitBranch(git.currentBranch, team); // Tier 5
  if (branchMatch) return null; // explicitly do not return a bronze-only match — see below

  // No match — session is research, test, or meta experiment
  return null;
}
```

The Tier 5 / branch match is *deliberately never* used as the sole source of a ticket assignment. It is only used to *boost confidence* when it agrees with a silver match:

```ts
// After the above, if a silver match was returned AND branchMatch agrees with it:
//   → upgrade the confidence from 0.95/0.89 to 0.97
// If branchMatch disagrees with silver:
//   → keep the silver match; branch is assumed to be misleading (e.g., integration branch)
```

### Why gitBranch is demoted

Empirical data from the kipwise experiment: the gitBranch field disagrees with URL-based ground truth **22.5% of the time**. Root cause: developers routinely run Claude Code on integration branches (`integrate/m8`), orchestration branches (`orchestrate-m10-agent-kb-skills`), or `main` while working on a specific ticket. The branch name lies. Silver signals (content frequency, slash commands) have a higher precision than branch because they observe *what the session is actually doing*, not the branch it's checked out on.

### Null is a valid outcome

Sessions where no signal matches are almost always legitimately not tickets — research sessions, meta-experiments, test orchestration ("you are a test agent, report your model"). In the kipwise experiment, 60 of 413 sessions (14.5%) matched no tier and all 60 were manually verified as non-ticket sessions. Doc 4's matcher returns `null` and the Gantt labels the block as repo-only (the Doc 3 default). This is *correct* behavior, not a miss.

## URL extraction — the primary discovery mechanism

### The `tool_result` goldmine

When an agent runs `gh pr create`, the command's stdout (captured as a `tool_result` event in the JSONL) contains the full PR URL: `https://github.com/kipwise/agentic-knowledge-system/pull/194`. When it uses a Linear MCP tool, the response contains `https://linear.app/kipwise/issue/KIP-148`. These URLs are **self-identifying** — the ticket ID is in the path, no regex or prefix configuration needed.

**Kipwise experiment source breakdown**:

| Event source | URL mentions |
|---|---|
| `tool_result` (gh pr create stdout, MCP responses) | **2,783** |
| `assistant` text output | **719** |
| `tool_use` inputs (e.g., WebFetch targets) | 169 |
| `user` typed input | 257 |

Agent-generated : user-generated = **14:1**. The mechanism does not depend on user discipline — agents and MCP tools produce these URLs automatically while doing their work.

### Filtering — same-repo only

Third-party URLs found in sessions (e.g., `github.com/PostHog/posthog/issues/2335` or `github.com/grafana/grafana/issues/61383`) are filtered by comparing the URL's `<org>/<repo>` to the local `git remote get-url origin`. Only same-repo URLs count as team tickets. The daemon does this filtering before shipping, so the team server never sees third-party URLs at all.

### Disambiguation — picking one URL when the session contains several

A single session can legitimately contain multiple same-repo URLs: the primary PR the agent is working on, a URL it fetched via `WebFetch` for reference, a URL the user pasted, or a URL mentioned in a Linear comment quoted in tool output. URL extraction is only "100% precise" in the degenerate single-URL case.

The real rule for picking one URL per session is a **priority-ordered scan**:

1. **URL in `tool_result` from `gh pr create` or `gh pr view` stdout** (identified by the preceding `tool_use` event's name). The agent's own "I just made this PR" event — strongest possible signal.
2. **URL in `tool_result` from a ticket-system MCP tool** where the tool name indicates a create/update action on the specific ticket (e.g., `mcp__linear__create_issue`, `mcp__linear__update_issue`, `mcp__jira__create_issue`). Self-reporting by the MCP integration.
3. **URL in the final `assistant` event's text content.** The agent's own summary at the end of the session is authoritative.
4. **Most-frequent URL** in `tool_result` or `assistant` content across the session. Frequency tiebreak.
5. **URL in the first `user` event.** User-provided context is lowest priority because users also paste reference URLs.

`tool_use` input URLs (WebFetch targets, Linear MCP read queries) are **excluded entirely** — they are references, not ticket assignments.

When two URLs genuinely tie under this rule (equal position, equal frequency), the session is flagged as **multi-ticket** and both ticket IDs are stored as separate `ticket_sessions` rows. This is rare but legitimate — the kipwise experiment contained 12 sessions that legitimately touched two real tickets (e.g., PR #116 → KIP-119 + KIP-37). Forcing a single winner would lose fidelity.

**Empirical precision of the disambiguation rule** (kipwise dataset):
- 100% on single-URL sessions (by definition)
- 98.3% on multi-URL sessions where a single ticket was the actual work (11 disagreements out of 651 multi-URL sessions, all of which were correctly handled by the multi-ticket flag)

The "~100% precision" label in the tier table should be read as *"100% with the disambiguation rule applied"*, never as raw URL frequency.

### Passive PR ↔ ticket index

When a session contains **both** a PR URL and a ticket URL (Linear/Jira/Shortcut), the co-occurrence gives us a PR → ticket mapping **for free**, with no API call:

```
Session 0c56ed06:
  PR:     https://github.com/kipwise/agentic-knowledge-system/pull/58
  Linear: https://linear.app/kipwise/issue/KIP-66
```

**PR #58 maps to KIP-66**, observed passively. In the kipwise experiment, 163 of 231 URL-bearing sessions contained both sides, giving us that many mappings for free. A later session that contains only one side of the pair can be enriched from this passive index without any network call.

This is stored in a new `pr_ticket_map` table (schema below).

## Auto-detection of team configuration

No team should have to type `KIP` or `ENG` into a config form. On first team sync (or on demand via Settings → Integrations → Re-detect), Fleetlens scans recent session logs and auto-configures:

- **Primary ticket prefix** (e.g., `KIP`)
- **Ticket provider** (Linear, Jira, Shortcut, GitHub Issues, unknown)
- **Provider team slug** (e.g., `kipwise` for Linear)
- **Home GitHub repo** (for same-repo PR filtering)

### Scoring

For each candidate prefix found in session logs (2-6 uppercase letters):

- **+5** per unique session where the prefix appears in a Linear / Jira / Shortcut URL (provider-authoritative)
- **+3** per unique session where the prefix appears in a git branch name
- **+3** per unique session where the prefix appears in `agentName` / `teamName` field
- **+1** per unique session where the prefix appears in content (session-dominant only)

A blacklist drops common all-caps false positives (`HTTP`, `SHA`, `UTF`, `JSON`, `HTML`, `WCAG`, `GDPR`, `DRY`, `CORS`, `CSS`, `SQL`, `API`, `URL`, `JWT`, etc.) so they never score.

### Confidence tiers

- **HIGH**: URL-tier evidence present AND score ratio to runner-up ≥ 10×
- **MEDIUM**: URL-tier evidence present AND ratio ≥ 3×
- **MEDIUM (branch/content only)**: No URL evidence but ratio ≥ 10× and total score ≥ 20
- **LOW**: ambiguous — surface both candidates in the admin UI for manual selection

### Empirical result on kipwise

| Prefix | Score | URL sessions | Branch | AgentNm | Content | Provider |
|---|---|---|---|---|---|---|
| **KIP** | **2,279** | **211** | 148 | 148 | 336 | Linear (`kipwise`) |
| CHECK | 6 | 0 | 0 | 2 | 0 | — |
| LOGIN | 6 | 0 | 0 | 2 | 0 | — |
| REVIEW | 6 | 0 | 0 | 2 | 0 | — |

KIP dominates with a score ratio of **380×** to the next candidate. Runner-up prefixes are all agent-name debris (`login-test-agent`, `review-*-agent`) with zero URL evidence — filtered out by the `urlSessions > 0` gate before ratio evaluation.

**Home GitHub repo detection** is equally clean:

| Org/Repo | Sessions | Mentions |
|---|---|---|
| **kipwise/agentic-knowledge-system** | **184** | 3,452 |
| codecov/feedback | 15 | 56 |
| anthropics/claude-code | 3 | 30 |
| (others) | 1 each | 1-2 each |

The home repo is a landslide. Same-repo filtering falls out naturally at the 184-vs-15 gap.

**Result**: HIGH confidence, zero manual configuration. The full ticket config is populated on first run.

### Multi-prefix teams

Teams that use two systems (e.g., Linear for product work, Jira for infra) will show **two high-scoring candidates**. The detector returns both; the admin UI presents them as a multi-prefix team with independent provider resolvers per prefix. No forced single-winner. The auto-detect result is stored in `teams.settings.ticketConfig`:

```json
{
  "ticketConfig": {
    "prefixes": [
      { "prefix": "KIP", "provider": "linear", "slug": "kipwise", "confidence": "high" },
      { "prefix": "INFRA", "provider": "jira", "host": "acme.atlassian.net", "confidence": "high" }
    ],
    "homeGitHubRepo": "kipwise/agentic-knowledge-system",
    "detectedAt": "2026-04-16T10:30:00Z",
    "detectionSampleSize": 413
  }
}
```

Admins can override via Settings → Integrations → Ticket Configuration. Overrides are persistent and not overwritten by subsequent auto-detects unless the admin explicitly clicks "re-detect."

### Where auto-detection runs

Auto-detection is an **admin-initiated background job** on the team server, **not** a daemon-side task. Rationale:

- Auto-detection needs to observe a large sample of sessions (hundreds) across multiple members. A single daemon only sees its own machine.
- The team server already receives `sessionBlocks[]` from all members via Doc 3's ingest. Doc 4 extends the block payload with the signals needed for detection (see below).
- Running the scan on the server means every member benefits from the collective observation, not just the first one to pair.

**When it runs**:
1. On first ingest from the team (when `plan_utilization` or `session_blocks` data exists for ≥ 10 sessions).
2. On manual trigger from Settings → Integrations → Re-detect.
3. Never automatically re-triggered — once the team's config is set, it is stable.

**Implementation**: extends Doc 1's node-cron scheduler with a "detect-on-first-data" hook that runs once per team on the first eligible ingest.

## Session-block matching signals (new daemon payload fields)

The daemon extends its `sessionBlocks[]` push (from Doc 3) with the signals the matcher and auto-detector need:

```json
{
  "blockKey": "sha256hex...",
  "repoSlug": "agentic-knowledge-system",
  "startedAt": "2026-04-12T09:15:00Z",
  "endedAt":   "2026-04-12T10:25:00Z",
  "agentTimeMs": 3900000,
  "sessionCount": 2,
  "toolCallCount": 78,
  "turnCount": 24,
  "peakConcurrency": 1,
  "skills": ["frontend-design", "playwright-qa-verifier"],
  "tokens": { "input": 250000, "output": 18000, "cacheRead": 1900000, "cacheWrite": 450000 },
  
  "ticketSignals": {
    "urls": [
      {
        "url": "https://github.com/kipwise/agentic-knowledge-system/pull/194",
        "type": "github-pr",
        "priority": 1,
        "extractedFrom": "tool_result:gh pr create"
      },
      {
        "url": "https://linear.app/kipwise/issue/KIP-148",
        "type": "linear-issue",
        "priority": 2,
        "extractedFrom": "tool_result:mcp__linear__update_issue"
      }
    ],
    "cwdWorktreeTicketId": null,
    "agentNameTicketHint": "kip-148",
    "slashCommandTicketHint": "KIP-148",
    "contentFrequencyTop": { "id": "KIP-148", "count": 47 },
    "gitBranch": "feat/KIP-148-cli-members-command"
  }
}
```

**Everything in `ticketSignals`** is collected locally by the daemon aggregator and shipped as structured signals — never as raw session content. The daemon:

- Scans `tool_result` events for URL patterns matching the allow-list in Appendix A
- Reads `cwd` to check for worktree directory names matching `kip-*` or similar
- Reads top-level `agentName` and `teamName` JSONL fields
- Reads the first user event for `/implement` slash commands
- Counts prefix-matching tokens in message content (session-dominant only — just the top candidate)
- Reads the current git branch via `git branch --show-current`

**Content scanning stays on the laptop.** The daemon finds the dominant ticket ID in content via a counter, ships only `{id, count}`, and discards the full content after the cycle. The team server never sees raw session text.

**Forward-compat invariant preserved**: a Doc 3 server (which doesn't know about `ticketSignals`) silently ignores the field thanks to permissive parsing. A Doc 4 server receives it and populates `session_blocks.ticket_*` columns. A Doc 3-era daemon (no `ticketSignals`) pushing to a Doc 4 server: the ticket columns stay NULL; the block appears on the Gantt as repo-only (Doc 3 default). No breakage in any direction.

## Data model additions

### `session_blocks` — unchanged uniqueness, new child table for tickets

Doc 3's `session_blocks` uniqueness `(team_id, member_id, block_key)` is **unchanged**. Doc 4 does not ALTER the unique constraint — that would break idempotency on unmatched-block re-ingests (NULL `ticket_id` rows would duplicate because Postgres treats NULL as distinct in unique indexes by default).

Instead, Doc 4 introduces a **child table** for ticket associations. One session block can have zero, one, or many ticket rows:

```sql
CREATE TABLE session_block_tickets (
  block_id            uuid NOT NULL REFERENCES session_blocks(id) ON DELETE CASCADE,
  ticket_id           text NOT NULL,                                   -- "KIP-148"
  provider            text NOT NULL CHECK (provider IN ('linear', 'jira', 'github', 'shortcut', 'unknown')),
  provider_slug       text,                                            -- "kipwise" for Linear
  ticket_url          text,
  pr_url              text,
  pr_number           int,
  signal_tier         text NOT NULL CHECK (signal_tier IN ('gold', 'silver', 'bronze')),
  signal_source       text NOT NULL CHECK (signal_source IN ('url', 'cwd-worktree', 'agent-field', 'content', 'slash-command', 'content+slash-agreement')),
  confidence          real NOT NULL,                                   -- 0.0 - 1.0
  weight              real NOT NULL DEFAULT 1.0,                       -- 1.0 for single-ticket, 0.5 each for two-ticket, etc.
  PRIMARY KEY (block_id, ticket_id)
);
CREATE INDEX ON session_block_tickets (ticket_id);
```

- **Blocks with no ticket match** → zero rows in `session_block_tickets`. Doc 3 behavior preserved.
- **Single-ticket blocks** → one row with `weight = 1.0`.
- **Multi-ticket blocks** (rare, ~3% in kipwise) → two rows with `weight = 0.5` each (or proportional to content-frequency hit counts). Per-ticket rollups use `SUM(block.agent_time_ms * stbt.weight)` so team totals stay accurate without double-counting.

**Why not the ALTER-and-nullable approach**: unique indexes with nullable columns are a Postgres footgun in this case. Every 5-minute re-ingest of an unmatched session would produce a fresh row (NULL != NULL in a unique key under default semantics), doubling the table until the session ages out. A child table with `block_id` as the only FK sidesteps this entirely and correctly models the "zero-or-more" relationship.

**Doc 3 forward-compat preserved**: existing Doc 3 rows have zero associated `session_block_tickets` rows and continue to render on the Gantt as repo-only blocks, exactly as they did in Doc 3. No data migration. The schema change is purely additive.

**Ingest flow**: on every ingest cycle, for each shipped block, the server:
1. Upserts the `session_blocks` row using Doc 3's existing conflict target `(team_id, member_id, block_key)`.
2. Runs the matcher over `block.ticketSignals` and gets a `TicketMatch[]` result (zero, one, or many matches — see the multi-ticket disambiguation rule above).
3. **Replaces** the block's `session_block_tickets` rows: `DELETE WHERE block_id = $1`, then `INSERT` the new matches. This is safe because the matcher is deterministic over the signals, so re-matching the same signals produces the same result set.

All of this runs inside the existing ingest transaction — one atomic upsert per block.

### New table: `tickets` — canonical ticket view

For the ticket-detail side panel and future ticket-centric queries, we denormalize a per-ticket row from the `session_blocks` aggregates:

```sql
CREATE TABLE tickets (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id              uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  ticket_id            text NOT NULL,                -- "KIP-148"
  provider             text CHECK (provider IN ('linear', 'jira', 'github', 'shortcut', 'unknown')),
  provider_slug        text,                          -- "kipwise" for Linear
  ticket_url           text,
  pr_url               text,
  pr_number            int,
  pr_title             text,                          -- from enricher (gh pr list) — optional
  first_touch          timestamptz NOT NULL,
  last_touch           timestamptz NOT NULL,
  ship_state           text CHECK (ship_state IN ('in_progress', 'pr_opened', 'merged', 'closed_without_merge')),
  merged_at            timestamptz,
  primary_assignee_id  uuid REFERENCES members,
  signal_tier          text CHECK (signal_tier IN ('gold', 'silver', 'bronze')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, ticket_id)
);
CREATE INDEX ON tickets (team_id, last_touch DESC);
CREATE INDEX ON tickets (team_id, merged_at DESC) WHERE ship_state = 'merged';
```

**This is a derived view**, not a source of truth. It is rebuilt from `session_blocks ⋈ session_block_tickets` by a scheduled job (not a trigger — see rationale below). The canonical ticket merge policy:

| Field | Rule |
|---|---|
| `first_touch` | `MIN(sb.started_at)` over all blocks joined to this ticket |
| `last_touch` | `MAX(sb.ended_at)` over all blocks joined to this ticket |
| `ship_state` | Furthest-progressed: `merged > pr_opened > in_progress > closed_without_merge`. Derived from enricher response, not from session data. |
| `merged_at` | From enricher; null until enrichment runs or if never merged |
| `primary_assignee_id` | Member with the largest `SUM(sb.agent_time_ms * sbt.weight)` on this ticket; tiebreak by earliest `first_touch`, then lowest `member.id` UUID |
| `pr_url` / `pr_number` | Highest `sbt.signal_tier` wins; tiebreak by earliest `session_blocks.created_at` |
| `pr_title` | Set by the enricher, subject to `stripPRTitle` policy (see Privacy toggles below) |
| `ticket_url` | Same rule as `pr_url` |
| `provider` / `provider_slug` | Derived from the winning `ticket_url` |
| `signal_tier` | Highest tier observed across all joined rows. **Upgrades always accepted; downgrades never applied.** |

**Rebuild strategy — deferred hourly job, not a trigger**:

Rejected: `AFTER INSERT OR UPDATE` trigger on `session_blocks`. Rationale: bulk ingest (e.g. `fleetlens team backfill --days 30` pushing thousands of blocks) would re-run the full aggregate query over *all* blocks matching each ticket on every row update, serializing ingest to 30+ seconds. Not acceptable.

Accepted: a **deferred rebuild job** that runs hourly at **01:00 UTC** (extension of Doc 1's node-cron, one hour before the insights detector at 02:00 UTC so the detector reads fresh data). The job:

1. Computes the set of tickets touched since the last run (tracked via a `tickets_dirty` staging table updated during ingest — an insert of `ticket_id` on every `session_block_tickets` upsert).
2. For each dirty ticket, runs a single aggregate query over `session_blocks ⋈ session_block_tickets WHERE ticket_id = $1` and upserts the `tickets` row.
3. Clears `tickets_dirty`.
4. Logs completion to `events` with `action = 'tickets.rebuild'`.

The `tickets_dirty` table is trivial:

```sql
CREATE TABLE tickets_dirty (
  team_id     uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  ticket_id   text NOT NULL,
  first_dirty timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, ticket_id)
);
```

Insertions into `tickets_dirty` are `ON CONFLICT DO NOTHING` — the first dirty marker wins, subsequent ingests skip. The 01:00 UTC job truncates the table after the rebuild completes.

**Freshness lag**: new tickets appear in the `tickets` table at most 1 hour after first ingest. The `session_blocks` table is always current — the list view and the Gantt decoration read from `session_blocks ⋈ session_block_tickets` directly and see new tickets immediately. The 1-hour lag only affects the derived `tickets` table used by the ticket list and detail pages.

### New table: `pr_ticket_map` — passive enrichment index

```sql
CREATE TABLE pr_ticket_map (
  team_id             uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  pr_url              text NOT NULL,
  ticket_id           text NOT NULL,
  first_observed_at   timestamptz NOT NULL,
  last_observed_at    timestamptz NOT NULL,
  session_count       int NOT NULL DEFAULT 1,
  canonical           boolean NOT NULL DEFAULT false,
  PRIMARY KEY (team_id, pr_url, ticket_id)
);
CREATE UNIQUE INDEX ON pr_ticket_map (team_id, pr_url) WHERE canonical = true;
```

Populated whenever an ingested block's `ticketSignals.urls` contains both a same-repo PR URL and a ticket URL. The `canonical` column resolves conflicts:

1. **Most frequent observation** — pairing with the highest `session_count` wins
2. **Tiebreak**: earliest `first_observed_at` (longest-stable pairing)
3. **Still tied**: existing canonical is retained

The partial unique index `(team_id, pr_url) WHERE canonical = true` enforces at most one canonical row per PR URL. Only canonical rows are used by the enricher fallback lookup.

### New table: `insights_feed`

```sql
CREATE TABLE insights_feed (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id             uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('share_worthy', 'coachable', 'check_in', 'capacity', 'cost', 'other')),
  dedup_key           text NOT NULL,                    -- e.g. "share_worthy:concurrency:member=<uuid>:week=2026-W15"
  title               text NOT NULL,
  body                text NOT NULL,
  subject_member_ids  uuid[] NOT NULL DEFAULT '{}',    -- members this insight is about
  supporting_data     jsonb NOT NULL DEFAULT '{}',
  generated_at        timestamptz NOT NULL DEFAULT now(),
  acknowledged_at     timestamptz,
  acknowledged_by     uuid REFERENCES members,
  dismissed_at        timestamptz,
  dismissed_by        uuid REFERENCES members
);
CREATE INDEX ON insights_feed (team_id, generated_at DESC) WHERE dismissed_at IS NULL;
CREATE INDEX ON insights_feed (team_id, dedup_key, generated_at DESC);
```

**`dedup_key` contract**: each detector constructs a stable key from its `kind`, pattern type, and subject keys. Examples:

- `share_worthy:concurrency:member=<uuid>:week=<ISO-week>` — Alice's concurrency pattern for ISO week 2026-W15
- `coachable:choppy-cadence:member=<uuid>:window=<14d-end-date>` — Bob's choppy cadence observation rolling 14-day window
- `check_in:long-segment:member=<uuid>:day=<YYYY-MM-DD>` — Carol's 3-hour session on a specific day
- `capacity:weekly-cap:team` — team-level weekly cap warning (regenerates weekly)
- `cost:downgrade-opportunity:team:month=<YYYY-MM>` — per-month cost summary

Before emitting a new row, the detector runs:

```sql
SELECT 1 FROM insights_feed
WHERE team_id = $1
  AND dedup_key = $2
  AND generated_at > now() - interval '30 days'
LIMIT 1;
```

If any row exists (regardless of acknowledged / dismissed state), the new insight is **not emitted**. This prevents the detector from re-firing "Alice's morning concurrency pattern" every day for 30 days running — the card appears once per Alice per ISO week and then sleeps.

## Ingest API extension

No new endpoints in Doc 4. The `POST /api/ingest/metrics` endpoint from Doc 1/2/3 accepts a richer `sessionBlocks[]` with embedded `ticketSignals`. Permissive parsing (Doc 1 invariant) means Doc 3-era server code ignores the new field; Doc 4 server code processes it.

The `GET /api/team/daemon-policy` endpoint (introduced in Doc 3 for repo slug renames) gains two new policy fields:

```json
{
  "policyVersion": 8,
  "repoSlugMappings": { "acme-billing-secret-rebrand": "billing-service" },
  "ticketConfig": {
    "prefixes": [{"prefix": "KIP", "provider": "linear", "slug": "kipwise"}],
    "homeGitHubRepo": "kipwise/agentic-knowledge-system"
  },
  "privacy": {
    "stripPRTitle": false,
    "skillTagDenyList": ["^acme-", "^project-falcon-"]
  }
}
```

**Daemon-side vs server-side enforcement** — the two privacy toggles have different enforcement points because they target different data sources:

- **`stripPRTitle` is enforced on the server**, specifically in the `gh-pr-list` enricher. The daemon never has PR titles (they come from `gh pr view` run on the team server). When `stripPRTitle: true`, the enricher either (a) skips the `pr_title` write entirely, leaving `tickets.pr_title = NULL`, or (b) sets it to a fallback placeholder like `"PR #194"`. The UI displays the fallback when `pr_title` is NULL. The daemon plays no role in this filter because it has nothing to filter.
- **`skillTagDenyList` is enforced on the daemon**, in the `sessionBlocks[]` aggregator before shipping. When a skill tag matches any deny-list regex, the daemon replaces it with `[redacted]` in the `skills[]` array. The server never sees the real tag. This filter runs at the source because skill tags are locally-observed from sidechain events.

**Why this matters**: a compromised team server learns the PR *title* only if enrichment has populated it — but the server has to run enrichment itself, so a compromised server could also run an *unfiltered* enrichment regardless of the `stripPRTitle` flag. The policy is enforced *in the enricher code path*, which is subject to server compromise. By contrast, the `skillTagDenyList` filter runs on each dev's laptop; a compromised server cannot re-observe the raw tags. The two controls have different threat models and that's okay — they're both improvements over Doc 3.

### Dashboard read endpoints (new in Doc 4)

```
GET /api/team/tickets                       — list of tickets with filter + pagination
GET /api/team/tickets/:ticket_id             — ticket detail (blocks, timeline, assignees)
GET /api/team/insights                       — insights feed (unacknowledged + recent)
POST /api/team/insights/:id/acknowledge      — admin marks insight as acknowledged
POST /api/team/insights/:id/dismiss          — admin dismisses (hides) an insight
POST /api/team/auto-detect                   — manual trigger for ticket-config auto-detection
GET  /api/team/auto-detect/status            — current auto-detect job status
```

## Pluggable `TicketMatcher` / `TicketEnricher` interfaces

Doc 4 publishes two plugin interfaces. The v1 shipped implementations are the default tiered matcher and the `gh pr list` enricher.

### `TicketMatcher`

```ts
export interface TicketMatcher {
  name: string;                 // "default-tiered", "my-custom-matcher"
  version: string;
  matchBlock(
    block: SessionBlockIngest,
    team: TeamConfig
  ): Promise<TicketMatch[] | null>;
}

export interface TicketMatch {
  ticketId: string;             // "KIP-148"
  provider: "linear" | "jira" | "github" | "shortcut" | "unknown";
  ticketUrl?: string;
  prUrl?: string;
  prNumber?: number;
  signalTier: "gold" | "silver" | "bronze";
  signalSource: "url" | "cwd-worktree" | "agent-field" | "content" | "slash-command" | "content+slash-agreement";
  confidence: number;           // 0.0 - 1.0
}
```

The matcher runs **on the team server**, not the daemon. The daemon sends structured `ticketSignals`; the server's matcher reads them and decides which ticket(s) the block belongs to. This lets multiple members' data inform each other (via `pr_ticket_map`) without leaking content to the server.

The default `default-tiered` matcher implements the six-tier resolution rule above. Teams can install a custom matcher via a v1.1 plugin-loading mechanism (not shipped in v1).

### `TicketEnricher`

```ts
export interface TicketEnricher {
  name: string;                 // "gh-pr-list", "linear-api", "jira-api"
  version: string;
  isAvailable(team: TeamConfig): Promise<boolean>;    // e.g. `gh` CLI installed + authed
  fetchMetadata(
    ticketId: string,
    context: { prUrl?: string; ticketUrl?: string; team: TeamConfig }
  ): Promise<TicketMetadata | null>;
}

export interface TicketMetadata {
  id: string;                   // "KIP-148"
  title: string;                // "CLI members command"
  status?: string;              // "In Review", "Done", etc.
  assignee?: string;
  url?: string;
}
```

**Default enricher in v1: `gh-pr-list`**. Runs on the team server via `child_process`. Covers PR titles + merge state — the 91% of kipwise tickets that had PRs.

### Enricher result as a discriminated union

The interface actually returns a richer shape than `TicketMetadata | null` — the plain-null case is ambiguous between "PR doesn't exist," "gh not installed," and "temporary network error." v1 ships with:

```ts
export type EnricherResult =
  | { status: "ok", metadata: TicketMetadata }
  | { status: "not_found", reason: string }          // PR deleted / never existed
  | { status: "not_authorized", reason: string }     // gh not authed for this repo (private in SaaS)
  | { status: "transient_error", reason: string }    // network, rate limit, retryable
  | { status: "enricher_unavailable", reason: string }; // gh not installed globally
```

### Queue, retry, and failure tracking

Enrichment jobs live in a new `enrichment_queue` table (not in-memory):

```sql
CREATE TABLE enrichment_queue (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id          uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  ticket_id        text NOT NULL,
  pr_url           text,
  enqueued_at      timestamptz NOT NULL DEFAULT now(),
  attempts         int NOT NULL DEFAULT 0,
  last_attempted_at timestamptz,
  last_error       text,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed_transient', 'failed_permanent', 'abandoned')),
  UNIQUE (team_id, ticket_id)
);
CREATE INDEX ON enrichment_queue (team_id, status, last_attempted_at);
```

A background worker loop (part of the same node-cron process) runs every **2 minutes** and pops up to 50 pending jobs per team. For each:

- **status="ok"** → update `tickets.pr_title` / `ship_state` / `merged_at`, mark job `succeeded`.
- **status="not_found"** → mark job `failed_permanent`. The ticket stays in the table but never gets a title. No retry.
- **status="not_authorized"** → mark job `failed_permanent`. Same outcome. The banner in Settings → Integrations surfaces this per-team.
- **status="transient_error"** → increment `attempts`, back off (`2 * 2^attempts` seconds, capped at 1 hour). After 5 attempts, mark `abandoned` and surface in Settings.
- **status="enricher_unavailable"** → mark the job `failed_transient` and pause the whole worker loop for the team until `enricher_available = true` (probed hourly via `which gh && gh auth status`). Emits an `events` row `enricher.unavailable` that the Settings banner reads.

### Enricher status for the admin

```
GET /api/team/enricher-status
```

```json
{
  "enricherName": "gh-pr-list",
  "available": true,
  "lastSuccessAt": "2026-04-16T10:25:00Z",
  "pending": 12,
  "failedPermanent": 3,
  "abandoned": 1,
  "lastFailureReason": "not_authorized: gh not authed for kipwise/private-repo"
}
```

Settings → Integrations → **Enricher status card** renders this with a color-coded state (green = ok, yellow = transient failures, red = unavailable/abandoned) and a "details" expander showing the failed rows.

### Self-hosted and SaaS posture

**Self-hosted** customers can install `gh` and authenticate it as a deployment step (documented in `docs/self-hosting.md`). The Terraform module's AWS task definition includes a `gh` binary in the container image starting from v1.

**SaaS** mode runs `gh` in the Fleetlens Cloud container without any customer-specific auth — so `gh pr view` on private repos will fail with `not_authorized`. This is an **explicit v1 limitation** for SaaS customers with private repos. The dashboard surfaces it clearly:

- When any enrichment job has `failed_permanent:not_authorized`, the `/team/:slug/tickets` list shows a top-of-page banner: *"Shipping state for private repos requires the `gh` enricher to be authenticated. See Settings → Integrations for details. Current tickets without title/state: 47."*
- Ship-state markers (`*` on Gantt blocks, pill on ticket rows) are **hidden** when `ship_state IS NULL` — no false "in progress" showing for tickets we can't actually read. The blocks render as Doc 3-style repo-only blocks with the ticket ID prefix but no ship decoration.
- The `share_worthy` insight detector, which requires `ship_state = 'merged'` to fire, no-ops silently for tickets with NULL `ship_state`. SaaS-private-repo teams may see no `share_worthy` insights; this is accurate, not a bug.

v2 plans two fixes: (a) run the enricher on an admin's paired daemon (daemon has gh auth for their own workstation), and (b) ship first-party API-token-based Linear/Jira/GitHub Issues connectors.

### Plugin loading (deferred to v1.1)

The `TicketMatcher` / `TicketEnricher` interfaces are **published and documented in v1**. The ability to *load* third-party implementations at runtime (plugin discovery, sandboxing, per-team selection) is a v1.1 feature. v1 ships with the two built-in implementations hardcoded.

This is a deliberate simplification: by publishing the interface early, third parties can *prototype* against it during the v1 beta, and v1.1 adds the loader so their prototypes can actually run.

## Insights feed — the pattern engine

### Pattern categories

Insights are organized into five kinds. Each kind gets its own detector function:

| Kind | Description | Example card |
|---|---|---|
| `share_worthy` | A pattern worth spreading to the rest of the team | *"Alice runs 5 concurrent sessions most mornings — her fleet orchestration pattern shipped 3 tickets last week. Worth a team demo."* |
| `coachable` | A cadence that might benefit from a gentle suggestion | *"Bob's cadence is short bursts with long human turns — potentially over-supervising. Try delegating more aggressively."* |
| `check_in` | Something unusual worth a friendly check-in | *"Carol has a 3-hour single-block session every Wednesday at 3am local — maybe worth a 1:1 check-in."* |
| `capacity` | Plan / team capacity approaching a limit (uses Doc 2 data when available) | *"Team hit 85% of weekly cap with 2 days remaining — Friday throttling risk."* |
| `cost` | Cost-optimization opportunity (uses Doc 2 data) | *"4 members on the $200 tier consistently using <30% — consider downgrading. Save $400/month."* |

### Detection cadence

The insight detector runs once per day at **02:00 UTC** (extension of Doc 1's node-cron scheduler). It scans the last 30 days of `session_blocks` and `plan_utilization` data per team and emits new rows into `insights_feed`. Rows that match an already-acknowledged or recently-dismissed insight are de-duped (insights don't re-fire for the same pattern within 30 days).

### Copy discipline — "worth learning from" not "worth controlling for"

The insights UI is opinionated: every card is framed as **observation and opportunity**, never as evaluation or judgment. The copy discipline is enforced in code:

- **Do not** use words like "performance," "efficiency," "productivity," "output," "KPI," "score," "rank," "best/worst."
- **Do** use words like "pattern," "cadence," "shape," "worth sharing," "check-in," "opportunity."
- Subject lines always include at least one verb that frames the insight as active learning: "run," "try," "share," "explore."

This matters because the tool's framing determines whether managers use it for growth conversations or surveillance conversations. The product's entire differentiation is the former.

### Detector functions — v1 implementations

**share_worthy — "high concurrent session count"**:
```
Detect members where peak cross-session concurrency > 3 on at least 5 days in the last 14
AND they shipped (merged PR) at least 2 tickets in those sessions.
Output: "<name> averages N concurrent sessions in the morning — shipped <count> tickets last week."
```

**coachable — "choppy cadence"**:
```
Detect members where, over the last 14 days:
- Average active segment < 3 minutes
- Average gap between segments > 10 minutes
- Total session count in the window > 30
This suggests "autocomplete mode" — frequent short exchanges rather than delegation.
Output: "<name> has a short-burst cadence. Consider letting Claude finish longer turns."
```

**check_in — "unusual long session"**:
```
Detect sessions where a single active segment > 2 hours AND the member's 30-day average segment length < 45 min.
Output: "<name> had a <duration> single session on <day> — unusual for their cadence. Worth a friendly check-in."
```

**capacity** — implemented via Doc 2's capacity burndown engine; Doc 4 just surfaces the warning as an insight card.

**cost** — implemented via Doc 2's plan-optimizer; Doc 4 surfaces the optimizer summary as an insight card when `estimatedMonthlyDelta` is non-zero.

If Doc 2 is not yet deployed (`plan_utilization` table doesn't exist), the `capacity` and `cost` detectors silently no-op. Doc 4 handles Doc-2-missing gracefully.

## Web UI — what's added in Doc 4

### Ticket decoration on the Gantt

The Doc 3 Gantt gets a small visual upgrade: blocks with a non-null `ticket_id` show the ticket ID prepended to the label:

```
Before (Doc 3): [api-svc 4.1h ────]
After (Doc 4):  [KIP-148 api-svc 4.1h ────]*   ← "*" is the shipped marker
```

A trailing `*` appears on blocks whose ticket is in the `merged` ship state. This is the single largest visual change from Doc 3 to Doc 4, and it happens automatically as ticket data populates — no config, no page changes.

### `/team/:slug/tickets` — Ticket list view (new page)

A simple list view of tickets over a date range, with filter bar:

```
┌──────────────────────────────────────────────────────────────┐
│ Tickets — Acme Engineering    [Last 30 days]                  │
├──────────────────────────────────────────────────────────────┤
│ KIP-148  CLI members command              Alice   shipped *   │
│   Apr 12-15 · 4.1h agent time · 2 skills · 5 sessions         │
├──────────────────────────────────────────────────────────────┤
│ KIP-151  dashboard cards                  Bob     in progress │
│   Apr 14- · 2.3h agent time · 3 skills · 3 sessions           │
├──────────────────────────────────────────────────────────────┤
│ KIP-147  invitation email                 Alice   merged *    │
│   Apr 08-10 · 6.1h agent time · 4 skills · 11 sessions        │
└──────────────────────────────────────────────────────────────┘
```

Click a row → drill into the ticket detail page.

### `/team/:slug/tickets/:ticket_id` — Ticket detail (new page)

Shows:
- Ticket ID, title (from enricher), provider + link
- All contributing members and their contribution (agent time per member)
- All `session_blocks` associated with the ticket, rendered as a mini-Gantt
- Detected skills across all blocks
- Ship state, PR link, merge timestamp
- Raw signal tier + source (for transparency — "matched via URL tier 0")

### `/team/:slug/insights` — Insights feed (new page)

```
┌──────────────────────────────────────────────────────────────┐
│ Insights — Acme Engineering                                   │
├──────────────────────────────────────────────────────────────┤
│ [share_worthy]                                    1 day ago   │
│ Alice's morning concurrency pattern                            │
│ Alice runs 5 concurrent sessions most mornings — shipped 3    │
│ tickets last week using this pattern. Worth a team demo.      │
│ [Acknowledge] [Dismiss]                                        │
├──────────────────────────────────────────────────────────────┤
│ [coachable]                                       2 days ago  │
│ Bob's cadence has many short bursts                            │
│ Bob's sessions average 2-minute active segments with 10-min   │
│ gaps. Maybe let Claude finish longer turns?                    │
│ [Acknowledge] [Dismiss]                                        │
└──────────────────────────────────────────────────────────────┘
```

Each card has Acknowledge (keeps the card in a "handled" state for future reference) and Dismiss (hides it). Dismissed cards are retained in the database for audit but not shown in the feed.

### Settings → Integrations (new subsection)

- **Ticket configuration** — view + override auto-detected config (prefixes, provider, home repo)
- **Re-detect** — manual trigger for auto-detect
- **Enricher status** — shows whether `gh` CLI is available + authenticated on the team server
- **Plugin registry** — placeholder UI listing installed matchers/enrichers (v1 shows just the two built-ins)

### Settings → Privacy (updated from Doc 3)

- **Repo slug mappings** (from Doc 3)
- **Strip PR titles** — new toggle that enables `stripPRTitle` in the daemon policy
- **Skill tag deny-list** — regex list field

## Implementation sequencing within Doc 4

1. **Schema migrations**: `tickets`, `pr_ticket_map`, `insights_feed` tables; `session_blocks` ALTER to add ticket columns + new unique constraint. Seed fixtures.
2. **Daemon aggregator extension**: implement URL extraction (same-repo filter, disambiguation rule), cwd worktree detection, agentName/teamName read, slash command detection, content frequency scan, git branch read. Ship the results in `ticketSignals`. Unit tests against kipwise JSONL fixtures.
3. **Server-side default matcher**: implement the six-tier resolution rule as pure functions. Unit tests against every tier including the multi-ticket flag.
4. **Server-side `tickets` view rebuild**: Postgres trigger or scheduled job that maintains the denormalized table from `session_blocks` updates.
5. **`pr_ticket_map` population**: insert rows whenever a block has both a PR URL and a ticket URL. Background job to maintain `canonical` flag.
6. **Auto-detector job**: runs once per team on first eligible ingest. Populates `teams.settings.ticketConfig`. Manual trigger via `POST /api/team/auto-detect`.
7. **`gh pr list` enricher**: server-side enrichment worker. Runs async after ticket detection, updates `tickets.pr_title` and `ship_state`. Handles missing/unauthenticated `gh` gracefully.
8. **Daemon-policy extension**: `ticketConfig`, `privacy.stripPRTitle`, `privacy.skillTagDenyList` added to the existing endpoint. Daemon polls and enforces.
9. **Gantt label decoration**: Doc 3 Gantt component reads `ticket_id` + `ship_state` and renders the decorated label. Visual regression test to ensure Doc 3 blocks (no ticket) still look the same.
10. **Ticket list page** `/team/:slug/tickets`: list, filter, pagination.
11. **Ticket detail page** `/team/:slug/tickets/:id`: member contributions, mini-Gantt, enricher data, signal tier/source.
12. **Insights detector functions**: share_worthy, coachable, check_in. Daily 02:00 UTC cron job. Dedup against 30-day acknowledged/dismissed history.
13. **Insights feed page** `/team/:slug/insights`: card grid, acknowledge/dismiss actions.
14. **Settings → Integrations + Privacy**: ticket config editor, re-detect trigger, enricher status, privacy toggles.
15. **Plugin interface documentation**: write `docs/plugins.md` with TypeScript definitions for `TicketMatcher` and `TicketEnricher`. No loader shipped in v1.
16. **End-to-end smoke test**: deploy fresh Docs 1/2/3/4, run 3 test daemons producing realistic kipwise-like session data for 24 hours, verify auto-detect runs, tickets populate, insights emit, Gantt decorates correctly.

## Privacy boundary (Doc 4 additions)

### Added to "shipped to team server"

- **Ticket signals** (URLs, ticket IDs extracted from content, agent names, slash commands) — all *structured* data, not raw content
- **Ticket IDs** (e.g. `KIP-148`) — considered metadata, not content
- **PR titles** (from enricher) — **can leak codenames** — mitigated by `stripPRTitle` toggle
- **Skill tag names** (already in Doc 3, but Doc 4 surfaces them more prominently) — **can leak project codenames** — mitigated by `skillTagDenyList`

### Still never leaves the laptop

- Everything in Docs 1/2/3's "stays on laptop" lists
- Raw session content used for content-frequency scanning (only the *top candidate ticket ID + count* is shipped, not the text it was found in)
- Tool call arguments and results
- Full URLs that don't match the same-repo filter

### New leak surface: PR titles

A PR titled `"feat(billing): Acme BigCo enterprise tier"` stored in `tickets.pr_title` leaks the customer name to anyone with admin access to the team server. For **public repos** the title is already world-readable via GitHub; for **private repos** the title was previously only visible to repo collaborators — with Doc 4, it's also visible to Fleetlens Cloud operators (SaaS mode) or the team server admin (self-hosted).

**Mitigation**: Settings → Privacy → "Strip PR titles" toggle. When enabled, the server's `gh-pr-list` enricher skips the `pr_title` population — the column stays NULL. The UI displays a fallback label like `"PR #194"` when `pr_title` is NULL.

**Enforcement point**: this is a server-side toggle enforced in the enricher code path, NOT a daemon-side filter (the daemon doesn't have PR titles — they come from `gh pr view` on the server). A self-hosted customer worried about server compromise can also install `gh` without any auth, which prevents the enricher from reading PR titles at all.

### New leak surface: skill tags

A skill named `project-falcon-qa` leaks `project-falcon`. Mitigated by the regex deny-list in Settings → Privacy. The **daemon** (not the server) replaces matching tag names with `[redacted]` in `skills[]` before shipping. This is a source-side filter — the server never sees the real tag value.

### Historical row scrubbing

When an admin enables `stripPRTitle`:

```sql
UPDATE tickets SET pr_title = NULL WHERE team_id = $team_id;
```

Runs synchronously inside the settings PUT handler. `session_blocks` has no `pr_title` column — the scrub only affects `tickets`.

When an admin adds a regex to `skillTagDenyList`:

```sql
-- Rewrite any matching skill tags in historical session_blocks rows
UPDATE session_blocks
SET skills = (
  SELECT array_agg(CASE WHEN s ~ $regex THEN '[redacted]' ELSE s END)
  FROM unnest(skills) AS s
)
WHERE team_id = $team_id
  AND skills && (SELECT array_agg(s) FROM unnest(skills) s WHERE s ~ $regex);
```

Also synchronous with settings save. Daemon-side filter applies to future ingests within ~5 minutes of policy poll, plus an ingest-time rewrite on the server catches any queue-drain race (same pattern as Doc 3's repo slug rename).

## v1 scope for Doc 4

**Ships on top of Docs 1/2/3:**

- `session_blocks` schema ALTER (ticket columns + new unique constraint)
- `tickets`, `pr_ticket_map`, `insights_feed` new tables
- Daemon aggregator extension (URL extraction, cwd worktree, agentName/teamName, slash command, content freq, git branch)
- Server-side default `TicketMatcher` (six-tier resolution rule)
- Server-side `tickets` view maintenance (trigger or job)
- `pr_ticket_map` population with canonical-resolution
- Auto-detector (runs on first eligible ingest + manual trigger)
- `gh pr list` enricher (async, runs on team server)
- Daemon-policy extension (ticketConfig, privacy toggles)
- Gantt label decoration (new visual on Doc 3 blocks)
- `/team/:slug/tickets` list page
- `/team/:slug/tickets/:id` detail page
- `/team/:slug/insights` feed page
- Insight detectors: share_worthy, coachable, check_in (+ capacity/cost from Doc 2 if present)
- Settings → Integrations (ticket config editor, re-detect)
- Settings → Privacy additions (strip PR titles, skill tag deny-list)
- Published `TicketMatcher` / `TicketEnricher` TypeScript interfaces with docs

**Not in Doc 4 (v2 or later):**

- First-party API-authenticated enrichers (Linear, Jira, GitHub Issues, Shortcut)
- Plugin loader (discover + load third-party matchers/enrichers at runtime)
- Weekly email digest of insights
- Automated escalation workflows ("flag for 1:1")
- Natural-language querying
- Cycle-time / time-to-ship analysis
- Cross-team / multi-repo ticket graphs

## Open questions for Doc 4

1. **Insight detector thresholds**: the `share_worthy` / `coachable` / `check_in` thresholds (concurrent count > 3 on 5 days, avg segment < 3 min, etc.) are defaults. They should be tunable via `teams.settings.insights` once the v1 data from real customers shows how they perform. Don't ship the tuning UI in v1; adjust defaults based on feedback.
2. **Initial `weight` allocation for multi-ticket blocks**: the `session_block_tickets.weight` column solves double-counting arithmetically, but the *initial value* when a block has two tickets needs a policy. Simplest: split evenly (`0.5` each). Slightly better: weight by content-frequency hit counts (if KIP-148 was mentioned 30 times and KIP-149 was mentioned 10 times in the block's sessions, assign `0.75` / `0.25`). v1 ships equal-split; v1.1 may upgrade to frequency-weighted if insights teams ask for it.
3. **`gh pr list` on private repos in SaaS mode**: no solution shipped in v1. Documented limitation. v2 either adds daemon-side enrichment (trust the daemon's gh auth) or Linear-style API connectors.
4. **Ticket cardinality at scale**: a team shipping 30 tickets/week × 50 weeks × 3 years = 4,500 tickets. The `tickets` table and `/team/:slug/tickets` list page need pagination by then. v1 caps the list page at 500 recent tickets with a "show all" link to a full listing.
5. **Auto-detect on team rebrand / re-org**: if a team re-detects and the result differs from the existing config, should Fleetlens offer a migration? v1 doesn't; the admin manually updates Settings → Integrations.
6. **Insight copy internationalization**: v1 ships English-only. The copy discipline matters especially in other languages (literal translations of "coachable" can sound harsh in some cultures). Defer i18n to v2.

## Dependencies on Doc 1 and Doc 3

Doc 4 requires:

**From Doc 1**:
- Team server, members, ingest API with permissive parsing
- `events` table (for insight acknowledge/dismiss audit)
- SSE + `LiveRefresher`
- Admin session cookies + bearer token auth
- node-cron scheduler (extended with new detector job)

**From Doc 3**:
- `session_blocks` table — Doc 4 ALTERs it
- Daemon aggregator framework — Doc 4 extends it with `ticketSignals`
- `sessionBlocks[]` ingest field — Doc 4 adds nested `ticketSignals`
- Gantt component — Doc 4 adds ticket label decoration
- `GET /api/team/daemon-policy` — Doc 4 extends it with `ticketConfig` and `privacy`
- Settings → Privacy page — Doc 4 adds two new toggles

**From Doc 2 (optional)**:
- `plan_utilization` and `member_weekly_utilization` — if present, insights feed adds `capacity` and `cost` cards; if absent, those detectors no-op silently

### Compatibility matrix

| Daemon | Server | Result |
|---|---|---|
| Doc 1 | Doc 4 | No ticket data; Gantt shows blocks without tickets (Doc 3 default) |
| Doc 3 | Doc 4 | No ticket signals; same as above |
| Doc 4 | Doc 1 | `ticketSignals` field silently ignored by permissive parsing; daemon continues working |
| Doc 4 | Doc 3 | Same — `ticketSignals` ignored until server upgrade |
| Doc 4 | Doc 4 | Full feature set |

## Appendix A — URL patterns registry

The default matcher recognizes these URL patterns. New patterns can be added in a single constant array; third-party matchers extend via the plugin interface (v1.1).

| Provider | URL pattern | Extracted ticket ID |
|---|---|---|
| GitHub PR (same-repo) | `https://github.com/<org>/<repo>/pull/<N>` | `<N>` (integer) |
| GitHub Issue (same-repo) | `https://github.com/<org>/<repo>/issues/<N>` | `<N>` (integer) |
| Linear | `https://linear.app/<team>/issue/<PREFIX>-<N>` | `<PREFIX>-<N>` |
| Jira | `https://<host>.atlassian.net/browse/<PREFIX>-<N>` | `<PREFIX>-<N>` |
| Shortcut | `https://app.shortcut.com/<org>/story/<N>` | `<N>` (integer) |
| GitLab MR (same-repo) | `https://gitlab.com/<org>/<repo>/-/merge_requests/<N>` | `<N>` (integer) |
| GitLab Issue (same-repo) | `https://gitlab.com/<org>/<repo>/-/issues/<N>` | `<N>` (integer) |

The `<org>/<repo>` for GitHub/GitLab URLs is matched against `git remote get-url origin` (run by the daemon from the session's cwd) to filter out third-party references. An agent fetching `github.com/grafana/grafana/issues/61383` while researching an unrelated bug is excluded automatically.

## Appendix B — Validation: kipwise experiment summary

The signal hierarchy and auto-detection were validated against **413 real JSONL sessions** from the kipwise `agentic-knowledge-system` repo. Summary (full details in the monolith spec, `2026-04-15-team-edition-design.md`):

- **85.5% combined coverage** — 353 of 413 sessions matched at least one tier
- **14.5% truly unknowable** — all 60 no-match sessions manually verified as research/test/meta (correctly non-ticket)
- **Effective coverage of real ticket work: ~100%**
- **Tier 0 URL precision**: 100% on single-URL sessions, 98.3% on multi-URL sessions (with disambiguation rule)
- **Tier 3 content frequency precision**: 94.8%
- **Tier 5 git branch precision**: 77.5% (reason to demote to confirmation-only)
- **Auto-detect result**: KIP dominated with a 380× score ratio; Linear `kipwise` team and home repo `kipwise/agentic-knowledge-system` both identified with HIGH confidence

**Caveat (restated)**: kipwise stacks three reinforcing signals (Linear MCP integration, branch discipline, orchestration framework). The 85.5% is best-case. Teams with weaker signal stacks may land at 50-70% coverage with the same tiered resolution rule. The design's robustness comes from graceful degradation, not any single tier.
