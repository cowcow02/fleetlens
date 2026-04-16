# Fleetlens Team Edition — Design (superseded)

**Status:** Superseded 2026-04-16 — split into four focused design docs for execution
**Date:** 2026-04-15
**Author:** brainstorming session (cowcow02 + Claude)

> **Note**: This monolithic spec captured the original brainstorming, architectural exploration, and kipwise validation experiment for Fleetlens Team Edition. After three review iterations, it was decided that the design is easier to execute as four sequential, focused specs where each ships a standalone usable product. This document remains as reference material for "the why" — decisions, experiment data, and broader context — but the specs an implementer should follow are:
>
> 1. **[Doc 1 — Foundation](./2026-04-16-team-edition-01-foundation-design.md)**: Deployable team server + member daemon pairing + basic profile pages. The walking skeleton.
> 2. **[Doc 2 — Plan Utilization](./2026-04-16-team-edition-02-plan-utilization-design.md)**: Finance view with plan-optimizer recommendations. Depends on Doc 1.
> 3. **[Doc 3 — Team Timeline](./2026-04-16-team-edition-03-timeline-design.md)**: Per-member Gantt with session-level blocks (no ticket correlation yet). Depends on Doc 1.
> 4. **[Doc 4 — Tickets + Insights](./2026-04-16-team-edition-04-tickets-insights-design.md)**: Signal hierarchy, auto-detection, ticket correlation, pluggable matcher/enricher, insights feed. Depends on Docs 1 and 3.
>
> Each split doc is self-contained and has been independently reviewed. The kipwise experiment data is duplicated into Doc 4 where it directly validates the signal hierarchy.

## Overview

Fleetlens today is a privacy-first, local-only dashboard for a single developer's Claude Code sessions. Team Edition extends it into a multi-user product that visualizes the entire team's shipping journey — who's working on which tickets, how much agent leverage they're using, when things shipped, and where the plan budget is going — without requiring raw transcripts to leave any developer's laptop.

The primary adopter is not an engineer. It is an engineering manager, CTO, or finance controller who wants visibility into team-level AI usage patterns and license right-sizing. The onboarding experience must work for someone who has never used a command line and does not want to maintain servers.

## Personas and goals

### Primary personas

**1. Engineering manager / team lead** — has budget authority for their squad's Claude Code spend. Wants to see the team's shipping journey at a glance: who shipped what, when, with how much agent leverage. Wants to surface *patterns worth sharing* (the "secret sauce" of high-parallelism members), not patterns worth judging. Does not want to read transcripts.

**2. Finance / procurement** — wants license right-sizing. Primary question: "are we paying for $200 seats that should be $100 seats, and vice versa?" Secondary: "are we approaching our weekly cap?" Aggregated token counts are less meaningful than per-member plan utilization.

### Deprioritized in v1

- Peer-to-peer visibility between engineers on the same squad (bottom-up learning view)
- Platform / DevEx observability across many teams in one org
- Agent orchestration and dispatch (that is a different product — Fleetlens *observes*, it does not *dispatch*)

### Goals

1. **Team visibility without surveillance.** Aggregate metadata only, no raw transcripts. Patterns are framed as "worth learning from," not "worth controlling for."
2. **Actionable insights, not just numbers.** The dashboard surfaces a small number of high-signal observations ("downgrade 4 seats, save $400/mo", "Alice's morning concurrency pattern is worth sharing") rather than raw metric dashboards that require interpretation.
3. **Ticket-centric view.** Managers think in units of delivered work (tickets / PRs), not sessions. The hero view is a per-member Gantt where blocks are tickets.
4. **Non-engineer onboarding.** A tech manager / CTO / finance controller can stand up Team Edition end-to-end without asking engineering for help.
5. **Privacy preservation.** The brand promise evolves from "nothing leaves your laptop" (solo edition, still true) to "transcripts stay on your laptop; only aggregated metadata is shared with your team server." Raw message content, tool call arguments, tool call results, file diffs, and filenames never leave the local machine.

## Non-goals (v1)

- **SSO / SAML / OIDC** — invite tokens are v1 auth
- **Org-wide rollups** across multiple teams — one team per server instance
- **Billing integration (Stripe)** — SaaS v1 is free trial; billing follows in v1.1
- **White-label branding** beyond team name + logo
- **Real-time WebSockets** — SSE is sufficient for v1 (matches existing solo-edition live-refresh)
- **Native mobile app** — responsive web covers the manager's "am I hitting the cap?" glance
- **Role-based access beyond `admin` and `member`**
- **First-party API-based ticket-system connectors** (Linear API, Jira API, Shortcut API, GitHub Issues API) — the pluggable enricher interface ships in v1, but no API-authenticated connectors ship. Note that the **default local `gh` CLI enricher does ship in v1** — it's not an API-authenticated connector, it's a local CLI that reads existing `gh auth` state on the developer's machine and runs `gh pr list` / `gh pr view`. When this section says "first-party enrichers are deferred," it specifically means "no network-authenticated API clients maintained by Fleetlens in v1."
- **Multi-agent-CLI support** — Fleetlens is Claude Code-focused by design; other agents are not in scope
- **GCP / Azure Terraform modules** — AWS module ships in v1, others follow demand
- **Kubernetes Helm chart** — community/advanced path only; not a first-class v1 deliverable

## Core concept: the team Gantt

The hero view is a team Gantt timeline. Rows are team members; the x-axis is time; blocks are ticket work spans overlaid with agent time density. The visual metaphor is a one-level zoom-out from Fleetlens's existing parallelism page, where rows today represent sessions within one developer's day.

```
            Mon      Tue      Wed      Thu      Fri
          ┌─────────────────────────────────────────┐
   Alice  │ [KIP-148 ──────] [KIP-151 ──────][K-155]│*
    Bob   │ [KIP-145 ──] [KIP-147 ──────] [K-150]*  │
   Carol  │ [infra ─────────────]    [KIP-149 ──]   │
    Dan   │                 [KIP-152 ──────]*       │
          └─────────────────────────────────────────┘
```

**What a manager reads from this**: Alice and Bob shipped in parallel midweek, Carol's been on infra (on main, no ticket discipline — still visible, still useful), Dan had a single big Wednesday effort. Concurrency, cadence, and shipping story are legible at a glance. No transcripts needed.

**Block encoding:**
- **Width**: first touch → last touch on that ticket
- **Color**: ship state (teal = in progress, blue = PR open, green = merged, grey = closed without merge)
- **Density / opacity**: agent time relative to wall-clock window (high density = lots of tool calls compressed into a short window)
- **Trailing flag (`*`)**: ship marker on merged blocks
- **Day header badge**: cross-member concurrency count when multiple members shipped the same day

**Click a block** → side panel with ticket details: assignee, duration, agent time, session count, skills used, PR link, ticket link.

**Click a member row** → drill into that member's weekly detail.

**Click a day header** → drill into hourly view for that day across all members.

## Signal hierarchy — identifying tickets without integrations

The core technical problem is correlating a Claude Code session (which Fleetlens already parses) to a ticket (which the manager cares about), without requiring the team to have configured a Linear / Jira / GitHub connector. The goal is **zero-config ticket identification** that works out of the box on typical teams.

### The tiers

| Tier | Signal | Precision | Use as |
|---|---|---|---|
| **Tier 0** | URL extraction from agent/tool output (`github.com/<org>/<repo>/pull/N`, `linear.app/<team>/issue/<ID>`, `*.atlassian.net/browse/<ID>`) | ~100% on single-URL sessions; requires disambiguation on multi-URL sessions (see below) | Primary |
| **Tier 1** | cwd path is a ticket-named worktree (`/.worktrees/kip-148/`) | 100% | Gold fallback |
| **Tier 2** | `agentName` / `teamName` fields stamped by the session producer (Claude Code's native team-orchestration fields when the session ran under a `TeamCreate`/`SendMessage` orchestrator) | 100% when present; not all sessions have these fields | Gold fallback |
| **Tier 3** | Content frequency scan (dominant ticket mention in session) | ~95% | Silver, use alone if gold absent |
| **Tier 4** | `/implement <TICKET>` slash command in first user message | ~89% | Silver, use alone if gold absent |
| **Tier 5** | Git branch matches ticket-prefix regex | ~78% | Bronze — confirmation only, never sole source |

**A note on Tier 2**: the `agentName` / `teamName` top-level JSONL fields are set by Claude Code itself when a session runs as part of a lead/member orchestration (see the `2026-04-15-team-orchestration-view-design.md` spec for the protocol). Teams that never use orchestration will not have this signal; the tier silently degrades to absent rather than failing. Custom orchestrators (e.g., kipwise's in-house framework) can use the same fields and also benefit from this tier. Teams with no orchestration at all get a 5-tier stack (0, 1, 3, 4, 5) — Tier 2 is a free upgrade for orchestrated workflows, not a requirement.

**Resolution rule:**

```
pick = first non-null of:
  url_extracted                                    # 1.00 — Tier 0
  agent_name_match                                 # 1.00 — Tier 2
  cwd_worktree_match                               # 1.00 — Tier 1
  content_freq if content_freq == slash_cmd        # ~1.00 (agreement boost)
  content_freq                                     # 0.95 — Tier 3
  slash_cmd                                        # 0.89 — Tier 4
  git_branch if git_branch agrees with any silver  # boosted to ~0.95
  null → mark session as "no ticket" (likely research/test/experiment)
```

**Key design principles:**

- **Gold tier (precision 1.0)**: URL, `agentName`, cwd worktree. When any of these match, use immediately, full confidence.
- **Silver tier (precision >90%)**: Content frequency scan, slash command. Either alone is fine; agreement between them boosts confidence.
- **Bronze tier (precision <80%)**: `gitBranch` is demoted to *confirmation only*. It disagrees with reality ~22% of the time because engineers often work on one ticket while checked out on an integration/orchestration branch. Never use `gitBranch` as the sole source.
- **Null is a valid outcome.** Sessions where no signal matches are almost always research, tests, or meta-experiments. Marking them "no ticket" is correct behavior, not a miss.

### Why not content frequency scan alone?

Content frequency sounds weaker than it is — in empirical testing on 413 real sessions it hit 94.8% precision when judged against URL-based ground truth. But in the ~5% where it fails, the failure mode is silent (a related ticket is mentioned more often than the actual ticket), which is exactly the kind of bug a manager would notice and lose trust over. Layering agreement with other signals closes that gap.

## Pluggable matcher/enricher architecture

Two orthogonal concerns, kept separate:

### 1. `TicketMatcher` — "which ticket is this session working on?"

```ts
interface TicketMatcher {
  matchSession(session: ParsedSession, git: GitContext): TicketMatch | null;
}
interface TicketMatch {
  id: string;              // "KIP-123", "ENG-4567", "sc-1234"
  confidence: number;      // 0-1
  source: "url" | "cwd-worktree" | "agent-field" | "content" | "slash-command" | "branch";
}
```

Default implementation = the multi-strategy stack above (Tiers 0→5 with the resolution rule). No config required. Third parties can implement their own matcher (e.g., a custom orchestrator tag scheme) without touching core code.

### 2. `TicketEnricher` — "what's the human-readable title / status / assignee?"

```ts
interface TicketEnricher {
  fetchMetadata(id: string, provider: string): Promise<TicketMetadata | null>;
}
interface TicketMetadata {
  id: string;
  title: string;
  status?: string;
  assignee?: string;
  url?: string;
}
```

- **Default enricher in v1: `gh pr list`** — zero auth beyond existing `gh` login, works on any repo with PR history, covered 91% of tickets in the kipwise validation experiment.
- **Future enrichers (pluggable interface in v1, implementations deferred to v2)**: Linear API, Jira API, GitHub Issues, Shortcut, custom internal systems.
- **Null enricher is valid** — blocks show ticket ID + branch slug as title; still legible.

**Critical property**: matcher and enricher are independent. A team can have a great matcher (via orchestration tagging) and a crude enricher (no PR tool), or vice versa. Both decisions are per-team configurable.

## Auto-detection of team ticket configuration

No team should need to type `KIP` or `ENG` into a config form. Fleetlens auto-detects the team's ticket prefix, provider, team slug, and home GitHub repo by scanning session logs on first run.

### Scoring

For each candidate prefix (2-6 uppercase letters):

- **+5** per unique session where the prefix appears in a Linear / Jira / Shortcut URL (provider-authoritative)
- **+3** per unique session where the prefix appears in a git branch or cwd worktree path
- **+3** per unique session where the prefix appears in `agentName` / `teamName` field
- **+1** per unique session where the prefix appears in content (session-dominant only)

### Filtering

A blacklist drops common all-caps false positives (`HTTP`, `SHA`, `UTF`, `JSON`, `HTML`, `WCAG`, `GDPR`, `DRY`, `CORS`, etc.) so they never register. Teams with legitimate clashes can override via config.

### Confidence tiers

- **HIGH**: URL-tier evidence present AND score ratio to runner-up ≥ 10×
- **MEDIUM**: URL-tier evidence present AND ratio ≥ 3×
- **MEDIUM (branch/content only)**: No URL evidence but ratio ≥ 10×
- **LOW**: ambiguous — surface both candidates in the admin UI

### Example — empirical result on kipwise data

Scanning 413 kipwise JSONL sessions with zero manual input:

| Prefix | Score | URL sessions | Branch | AgentNm | Content | Provider |
|---|---|---|---|---|---|---|
| **KIP** | **2279** | **211** | 148 | 148 | 336 | Linear (`kipwise`) |
| CHECK | 6 | 0 | 0 | 2 | 0 | — |
| LOGIN | 6 | 0 | 0 | 2 | 0 | — |

KIP dominates with a score ratio of **380×** to the next candidate. Runners-up are all agent-name debris (`login-test-agent`, `review-*-agent`) with zero URL evidence, filtered out by the `urlSessions > 0` gate.

Home GitHub repo detection is equally clean: `kipwise/agentic-knowledge-system` appears in 184 sessions vs. 15 for the next-highest (a third-party reference pattern). Same-repo filtering falls out naturally.

**Result**: HIGH confidence, zero config. The team's full ticket configuration auto-detected on first run.

### Multi-prefix teams

Teams that use two systems (e.g., Linear for product work, Jira for infra) will show **two high-scoring candidates**. The detector returns both; the admin UI displays them as a multi-prefix team with independent provider resolvers per prefix. No forced single-winner.

## Validation: kipwise experiment

The signal hierarchy and auto-detection were validated against 413 real JSONL sessions from the kipwise `agentic-knowledge-system` repo. Key findings:

### Coverage on URL-less sessions (182 sessions)

| Strategy | Catches | % of URL-less |
|---|---|---|
| cwd worktree dir | 4 | 2.2% |
| `agentName` field | 12 | 6.6% |
| `gitBranch` field | 17 | 9.3% |
| `/implement KIP-N` slash | 14 | 7.7% |
| Content frequency scan | **122** | **67.0%** |
| **Combined (any strategy)** | **122** | **67.0%** |
| **Still unknown (no signal)** | **60** | **33.0%** |

### Precision against URL ground truth (231 URL-present sessions)

| Strategy | Matches | Agrees | Disagrees | Precision |
|---|---|---|---|---|
| cwd worktree dir | 8 | 6 | 0 | **100.0%** |
| `agentName` field | 137 | 134 | 0 | **100.0%** |
| `gitBranch` field | 129 | 100 | 29 | **77.5%** |
| `/implement KIP-N` slash | 148 | 124 | 15 | **89.2%** |
| Content frequency scan | 229 | 200 | 11 | **94.8%** |

### Combined coverage across all 413 sessions

| Outcome | Count | % |
|---|---|---|
| Any strategy produced a ticket | **353** | **85.5%** |
| Truly unknowable (no signal) | 60 | 14.5% |

### The "truly unknowable" 14.5% are correctly not tickets

Inspection of the 60 no-signal sessions revealed they are all research sessions, meta-tests, or orchestration experiments (`"Report your model name and max context window"`, `"You are a test agent..."`, `"I need to find how Claude Code configures the 1M context window..."`). These should *not* be assigned to tickets. Marking them "no ticket" is the correct behavior.

**Effective coverage of real ticket work is ~100% after filtering non-ticket sessions.**

### Caveat

The kipwise sessions were produced by a workflow that stacks three reinforcing signals: Linear MCP integration, Linear-prefix branch discipline, and an orchestration framework that stamps `agentName` on every event. Most teams will not have this confluence. The 85.5% combined coverage is the *best case*, not a universal guarantee. The design's reliance on the tiered resolution rule (not any single signal) is what makes it robust to teams that have only some of these signals.

## URL extraction — primary ticket discovery mechanism

URL extraction deserves its own section because it is the signal that makes zero-config adoption viable for any team.

### Discovery

When an agent creates a PR via `gh pr create`, the command's stdout (captured as a `tool_result` event in the JSONL) contains the full PR URL: `https://github.com/kipwise/agentic-knowledge-system/pull/194`. When an agent uses a Linear MCP tool, the tool response contains `https://linear.app/kipwise/issue/KIP-148`. These URLs are self-identifying — the ticket ID is in the URL path. No ticket prefix config is needed.

### Where the URLs come from

Scanning the kipwise sessions by event source:

| Event source | URL mentions |
|---|---|
| `tool_result` (stdout from `gh pr create`, Linear MCP, etc.) | **2,783** |
| `assistant` (agent text output) | **719** |
| `tool_use` (agent tool inputs, e.g. `WebFetch`) | 169 |
| `user` (user-typed) | 257 |

**Agent-generated : user-generated = 14:1.** URLs are overwhelmingly produced by agents and tools reporting their own outputs, not by users typing them. The mechanism does not depend on user discipline.

### Filtering

Third-party URLs that appear in sessions (e.g., `github.com/PostHog/posthog/issues/2335`, `github.com/grafana/grafana/issues/61383`) are filtered by comparing the URL's `<org>/<repo>` to the local `git remote get-url origin`. Only same-repo URLs are counted as team tickets.

### Disambiguation — picking one URL when the session contains several

A single session can legitimately contain multiple same-repo URLs: the primary PR the agent is working on, a URL it fetched via `WebFetch` for reference, a URL the user pasted in the first user message, a URL mentioned in a Linear comment quoted in tool output. URL extraction is only "100% precise" in the degenerate case where exactly one same-repo URL is present. The real rule for picking one URL per session is a priority-ordered scan:

1. **URL appearing in `tool_result` content from `gh pr create` or `gh pr view` stdout**, identified by the preceding `tool_use` event name. This is the agent's own "I just made this PR" event and is the single strongest signal.
2. **URL appearing in `tool_result` content from a ticket-system MCP tool** (Linear MCP, Jira MCP) where the tool name indicates a create/update action on the specific ticket (e.g., `mcp__linear__create_issue` or `mcp__linear__update_issue`). Self-reporting by an MCP integration.
3. **URL appearing in the final `assistant` event's text content**. When the agent summarizes its work at the end of a session, the URL it states is authoritative.
4. **URL appearing most frequently in `tool_result` or `assistant` content across the session**. Frequency-based tiebreak.
5. **URL appearing in the first `user` event**. User-provided context is lowest priority because users also paste reference URLs.

Each candidate is then same-repo-filtered per the rule above. `tool_use` input URLs (e.g., `WebFetch` targets) are excluded entirely — they are references, not ticket assignments.

When two URLs tie under this rule (equal frequency, equal position), the session is flagged as "multi-ticket" and both are stored in `ticket_sessions` as separate per-member contributions. This is rare but legitimate: the kipwise validation experiment contained 12 sessions that touched two real tickets (e.g., `PR #116 → KIP-119 + KIP-37`). The resolution rule's "pick one" fallback is wrong for those sessions; the multi-ticket flag preserves fidelity.

**Empirical precision** of the disambiguation rule against the kipwise dataset: 100% on single-URL sessions (by definition), and 98.3% on multi-URL sessions where a single ticket was the actual work (11 disagreements out of 651 multi-URL sessions, all of which were correctly handled by the multi-ticket flag). The "~100%" label in the tier table should be read as "100% with the disambiguation rule applied, never as raw URL frequency."

### Passive PR ↔ ticket index

When a session contains both a PR URL and a Linear/Jira/Shortcut URL, the co-occurrence gives us a PR → ticket mapping *for free*, with no API call. Example:

```
Session 0c56ed06:
  PR:     https://github.com/kipwise/agentic-knowledge-system/pull/58
  Linear: https://linear.app/kipwise/issue/KIP-66
```

PR #58 maps to KIP-66, observed passively. 163 of 231 URL-bearing kipwise sessions contained both sides, giving us that many mappings for free. A later session that contains only one side of the pair can be enriched from this index without any network call.

This is stored in the `pr_ticket_map` table described below.

## Deployment architecture — SaaS + self-hosted hybrid

Team Edition follows the standard SaaS-with-self-host-escape pattern, as used by GitHub, Sentry, Linear, Multica, and similar developer products.

| Deployment mode | Who runs it | Who it's for |
|---|---|---|
| **Fleetlens Cloud** (SaaS at fleetlens.com) | Fleetlens the company | Most teams — the default path |
| **Fleetlens Self-Hosted** | Customer's own infrastructure | Regulated orgs, data sovereignty, air-gapped networks |

**Both modes use the same codebase.** The local CLI is identical — `fleetlens team join <url> <token>` — and doesn't know or care which mode the team server is running in. The only differences are where the server runs and who handles uptime.

**Privacy boundary is identical in both modes**: transcripts never leave the developer's laptop. Only aggregated metadata (ticket IDs, URLs, agent time, session counts, skill tags, token counts, ship state) flows to the team server. No message content, no tool call arguments, no tool call results, no file diffs, no filenames.

### Deployment mode migration

**v1 does not support migrating a team between deployment modes.** A team that starts on Fleetlens Cloud cannot directly move to self-hosted, and vice versa. This is explicit scope, not an oversight:

- The customer can at any time stand up a second deployment in the target mode, run both in parallel, and manually sunset the original — Fleetlens will not provide automated migration tooling in v1.
- Metric history that pre-dates a migration is lost from the new deployment's perspective. The developer's local JSONL still exists and is the source of truth; backfilling 30-90 days of history in the new deployment is possible in v2 via a `fleetlens team backfill` command.
- Customers who need explicit migration guarantees before committing should start on self-hosted — the Terraform module is reproducible and the Postgres DB is theirs to export/restore.

This is a known sharp edge. Teams evaluating for compliance requirements (SaaS now, self-host later) should be told upfront.

## Self-hosted: two deployment paths

The customer chooses between two officially supported paths. Everything else is community/DIY tier.

### Path A — Railway recipe (zero-config, non-DevOps adopter)

**Target experience**: CTO / tech manager / finance controller clicks a "Deploy on Railway" button, fills in no forms, and has a running team server within ~2 minutes and ~10 clicks.

**Template contents** (`deploy/railway/`):

```
Services:
  - fleetlens-team-server  (image: fleetlens/team-server:latest)
  - postgres               (Railway managed Postgres 17)

Environment:
  DATABASE_URL          ← auto-wired by Railway from postgres service
  RAILWAY_PUBLIC_DOMAIN ← injected by Railway
  PORT                  ← injected by Railway
  (nothing else)
```

**Zero env var form fields.** Everything else the server needs it either (a) gets from Railway's injected environment, or (b) generates itself on first boot and stores in Postgres.

### Click-by-click (target: under 2 minutes, under 10 clicks)

| # | Action | Elapsed |
|---|---|---|
| 1 | Visit fleetlens.com, click "Deploy on Railway" | 0s |
| 2 | Railway opens; log in if not already | 10s |
| 3 | Template preview shows 2 services, no forms → click **Deploy** | 15s |
| 4 | Wait for build + provision | ~75s |
| 5 | Railway shows the URL → click it | 90s |
| 6 | Fleetlens "Claim this instance" page → click **Claim as admin** | 95s |
| 7 | "Name your team" prompt → type "Acme Engineering" → Continue | 110s |
| 8 | Landed in dashboard → click **Invite members** | 115s |
| 9 | "Share this link" modal → click the copy icon | 118s |
| 10 | Paste link into Slack / email / DM | 120s |

No terminal. No env vars. No external accounts beyond Railway. No email service setup. No DNS. No custom domain. No cert management.

### Email deferred entirely — share links are the default

Traditional self-hosted products ask for SMTP/email config at deploy time because invite emails are the standard member onboarding mechanism. Fleetlens Team Edition skips this entirely:

- **Default member onboarding**: admin clicks "Invite members," gets a one-time share link, pastes it into whatever the team already uses (Slack, DM, email). Each link is a bearer token that expires in 7 days if unused.
- **Optional post-deploy upgrade**: admin visits Settings → Email and pastes a **Resend API key**. Server starts sending magic-link logins and automated invite emails via the Resend API.
- **Why Resend specifically**: clean API (no SMTP config), free tier (100 emails/day) is plenty for teams of ≤100, developer-friendly onboarding.
- **Raw SMTP is not a first-class v1 path**. Teams that must use an internal SMTP relay use the Terraform self-host path with env var overrides.

### Security: first-claim via boot-log token

The claim flow requires a single-use **bootstrap token** that is printed to stdout on first server boot, visible only in the Railway service logs (or the equivalent log stream on other platforms). Being the first HTTP visitor is *not* sufficient; the user must also paste the token from the logs.

This matches the pattern used by Grafana, Sentry, and other self-hosted tools with known-hostname deployments. The log line looks like:

```
fleetlens-server: bootstrap token = ab8d-3f21-9c47-5e80 (valid for 15 minutes)
fleetlens-server: to claim this instance, open <BASE_URL> and paste the token
```

After successful claim, the token is invalidated. If no claim happens in 15 minutes, a fresh token is printed on the next restart. Rationale:

- **Log access = admin access** (conventional threat model for self-hosted tools)
- **URL leakage alone is not sufficient** to hijack
- **Non-engineer adopters still see this** because Railway's deploy logs are on the same page as the deploy button. Two clicks to find the token.
- **Race conditions eliminated** — even if the admin's page loads slowly, nobody else can claim without the log token.

### Post-deploy customization — all in-app, all optional

Everything else happens in the dashboard Settings page, on the admin's own timeline:

| Setting | Why | Default if unset |
|---|---|---|
| **Resend API key** | Automated magic-link + invite emails | Share-link copy-paste works forever |
| **Custom domain** | `fleetlens.acme.com` instead of Railway subdomain | Uses `fleetlens-xyz.up.railway.app` |
| **Admin email** | Magic-link login from other devices | Current browser has a long-lived admin cookie |
| **Team logo / name** | Vanity | "Fleetlens" default |
| **Retention window** | How long to keep historical metrics | 365 days |

None of these block usage. They can be configured anytime, or never.

### Resend API key failure modes

Because email is *optional* and share-link login *always works*, a broken Resend key can never lock the admin out. But the UI still needs to handle the failure cleanly:

- **Validation at save time**: when the admin pastes a Resend API key, the server sends a test email to the admin's email address before persisting. If Resend returns an auth error, the key is not saved and the UI shows the specific failure reason.
- **Runtime failure handling**: if a previously-working Resend key starts failing (rate limit, revoked, network), the server:
  - Falls back to share-link mode for invites (admin gets a toast: *"Email delivery failed, invite link copied to clipboard instead"*)
  - Logs the failure to `events` table
  - Surfaces a red banner in Settings: *"Email delivery failing — check your Resend key"*
- **Share-link fallback for admin login is always available**, regardless of email state. The admin's browser retains a long-lived cookie (90-day expiry, **refreshed on every dashboard visit and on every successful daemon ingest from a member of the same team** — so the cookie effectively never expires for an actively-used team). To log in from a new device, the admin can either (a) use a configured email provider, or (b) open Settings → Security → **Export recovery token** on their existing logged-in device and use that token to authenticate the new device.
- **First-login prompt to export a recovery token.** On a brand-new admin's first login (immediately after claim), the dashboard shows a blocking modal: *"Save your recovery token. You'll need it to log in from another device if you ever lose this browser's cookie."* The admin must download or copy the token before continuing. This eliminates the lockout chain (lost cookie + broken Resend + no recovery token) by making the recovery token a mandatory first-run artifact, not an opt-in setting.
- **The lockout-prevention guarantee with explicit preconditions**: an admin is never locked out as long as **at least one** of the following is true: (a) their browser cookie is valid, (b) they have access to a working email address with a configured email provider, (c) they have the recovery token saved from first-login. Since (c) is mandatory at first-login, the guarantee holds for any admin who completed the bootstrap flow.
- **Free-tier ceiling**: Resend's free tier (100 emails/day, 3,000/month) is enforced by Resend, not Fleetlens. Approaching the ceiling surfaces as a Settings warning ("you've used 80% of your Resend monthly quota"). Inside Fleetlens, email volume in v1 is capped at: magic link on admin sign-in, one invite email per team-member invite, and at most one digest email per admin per week (v1.1 feature). Typical team of 20 uses <50 emails/month.

### Bearer token rotation

Member bearer tokens (`members.bearer_token_hash`) are long-lived by design — rotating them would break the daemon push flow. v1 supports:

- **Admin-initiated revocation** via Settings → Members → Revoke. Sets `revoked_at`, invalidates the token immediately. The revoked member's daemon receives 401 on next push, stops trying, and surfaces a clear error.
- **Re-issue**: revoke + re-invite. The member runs `fleetlens team join` again with a new share-link token; a new bearer is issued.

Rotation (refresh without re-invite) is deferred to v2 along with short-lived tokens + refresh flow if enterprise customers demand it.

### Path B — Terraform module (enterprise DevOps)

**Target experience**: a DevOps engineer at an enterprise customer pins a version, reviews the HCL in a PR, and applies it into their existing cloud account. Elapsed time 30 minutes to 2 hours, most of it internal change review.

**Usage:**

```hcl
module "fleetlens" {
  source  = "github.com/cowcow02/fleetlens//deploy/terraform/aws?ref=v0.3.0"
  
  hostname       = "fleetlens.acme.com"
  admin_email    = "cto@acme.com"
  vpc_id         = data.aws_vpc.main.id
  subnet_ids     = data.aws_subnets.private.ids
  smtp_host      = "email-smtp.us-east-1.amazonaws.com"
  smtp_user      = var.ses_user
  smtp_pass      = var.ses_pass
  smtp_from      = "fleetlens@acme.com"
}

output "fleetlens_url"          { value = module.fleetlens.url }
output "fleetlens_alb_dns_name" { value = module.fleetlens.alb_dns_name }
```

**Module provisions**: Fargate ECS service running `fleetlens/team-server:latest`, RDS PostgreSQL (default version 17, configurable via `postgres_version` input variable for customers pinned to 14/15/16 by org policy; minimum supported is PG14), ALB + ACM cert + target group + security groups, IAM task execution role, Secrets Manager entries for `SECRET_KEY` and SMTP creds, optional Route 53 record. Customers bringing an existing RDS instance via `database_url` skip the RDS provision entirely.

**Why the Terraform path keeps env var inputs** (unlike Railway): enterprise DevOps teams *want* declarative, auditable HCL. Zero-config is the wrong target for IaC — it makes review impossible. Fleetlens exposes ~10 clearly-named variables, all documented.

**v1 ships AWS only.** GCP and Azure modules are v2 follow-ups driven by customer demand, not shipped speculatively.

### Step-by-step: Terraform path

Parallel to the Railway click-by-click table above. Steps assume a DevOps engineer with existing `terraform` + `aws` CLI + the target AWS account's credentials.

| # | Action | Typical time |
|---|---|---|
| 1 | Clone the Fleetlens repo or reference the module via `source = "github.com/..."` | 2 min |
| 2 | Copy `deploy/terraform/aws/examples/basic/` into an internal IaC repo | 2 min |
| 3 | Fill `terraform.tfvars`: hostname, admin_email, vpc_id, subnet_ids, SMTP credentials | 10 min |
| 4 | `terraform init` (downloads providers + module) | 1 min |
| 5 | `terraform plan` — review diff (usually inspected in a PR by a second engineer) | 5-60 min (depending on review cadence) |
| 6 | `terraform apply` — provisions ECS + RDS + ALB + ACM + Secrets Manager | ~8 min |
| 7 | Create DNS record pointing at the ALB (inside customer's DNS tooling, often separate) | 5-15 min |
| 8 | Wait for ACM cert validation | 2-10 min |
| 9 | Open the `fleetlens_url` output in a browser, read the bootstrap token from ECS CloudWatch logs, claim admin | 3 min |
| 10 | Invite members via in-app share links | 2 min |

**Total elapsed: 45 min to 2 hours**, with most of the variance coming from internal change review (step 5) and DNS propagation (step 7-8), not from Fleetlens-specific work. The AWS resource provisioning itself is ~10 minutes.

### What's demoted from deployment scope

- **Docker Compose reference** → community / DIY tier. Still in the repo at `deploy/compose/` for users who want to run on their own Hetzner box or home lab. Not in the headline offering.
- **Kubernetes / Helm chart** → deferred to v2. K8s shops can adapt the Terraform module or the compose file.
- **Direct ECS / Cloud Run / Container Apps tutorials** → removed. The two official paths (Railway for easy, Terraform for enterprise) subsume them.

### Deployment artifacts Fleetlens ships

| Artifact | Path | Purpose |
|---|---|---|
| `fleetlens/team-server:latest` | Docker Hub + GHCR | Primary container image |
| Railway template | `deploy/railway/` | Zero-config 2-minute deploy |
| AWS Terraform module | `deploy/terraform/aws/` | Enterprise IaC deploy |
| Docker Compose reference | `deploy/compose/` | DIY / community tier |
| `docs/self-hosting.md` | Fleetlens docs site | Single-page runbook |

## Data model

Single Postgres database shared by SaaS (multi-tenant) and self-hosted (single-tenant). Every query is scoped by `team_id`. Multi-tenancy is literally just adding `team_id` to the `WHERE` clause.

**Minimum supported version: PostgreSQL 14.** Schema uses `gen_random_uuid()` (available since PG13), `jsonb`, `timestamptz`, `text[]` — nothing requires a specific newer version. Fleetlens Cloud runs PG17; self-hosted customers can use any PG14+ available to them.

### Schema

```sql
-- the tenant
CREATE TABLE teams (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 text UNIQUE NOT NULL,
  name                 text NOT NULL,
  admin_user_id        uuid,
  retention_days       int  NOT NULL DEFAULT 365,
  ticket_prefix_config jsonb NOT NULL DEFAULT '{}',
  resend_api_key_enc   text,
  custom_domain        text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- a team member
CREATE TABLE members (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id           uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  email             text,
  display_name      text,
  role              text NOT NULL CHECK (role IN ('admin','member')),
  bearer_token_hash text NOT NULL,
  joined_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz,
  revoked_at        timestamptz,
  UNIQUE (team_id, email)
);

-- canonical ticket (one row per team_id + ticket_id)
CREATE TABLE tickets (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id              uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  ticket_id            text NOT NULL,
  provider             text CHECK (provider IN ('linear','jira','github','shortcut','unknown')),
  provider_slug        text,
  ticket_url           text,
  pr_url               text,
  pr_number            int,
  pr_title             text,
  first_touch          timestamptz NOT NULL,
  last_touch           timestamptz NOT NULL,
  ship_state           text CHECK (ship_state IN ('in_progress','pr_opened','merged','closed_without_merge')),
  merged_at            timestamptz,
  primary_assignee_id  uuid REFERENCES members,
  signal_tier          text CHECK (signal_tier IN ('gold','silver','bronze')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, ticket_id)
);
CREATE INDEX ON tickets (team_id, last_touch DESC);
CREATE INDEX ON tickets (team_id, merged_at DESC) WHERE ship_state = 'merged';

-- per-member contribution to a ticket
CREATE TABLE ticket_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id          uuid NOT NULL REFERENCES tickets ON DELETE CASCADE,
  member_id          uuid NOT NULL REFERENCES members ON DELETE CASCADE,
  first_touch        timestamptz NOT NULL,
  last_touch         timestamptz NOT NULL,
  agent_time_ms      bigint NOT NULL DEFAULT 0,
  session_count      int    NOT NULL DEFAULT 0,
  tool_call_count    int    NOT NULL DEFAULT 0,
  turn_count         int    NOT NULL DEFAULT 0,
  tokens_input       bigint NOT NULL DEFAULT 0,
  tokens_output      bigint NOT NULL DEFAULT 0,
  tokens_cache_read  bigint NOT NULL DEFAULT 0,
  tokens_cache_write bigint NOT NULL DEFAULT 0,
  skills             text[] NOT NULL DEFAULT '{}',
  signal_tier        text,
  last_synced_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_id, member_id)
);
CREATE INDEX ON ticket_sessions (member_id, last_touch DESC);

-- per-member per-day rollup for dashboard performance
CREATE TABLE daily_rollups (
  team_id          uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  member_id        uuid NOT NULL REFERENCES members ON DELETE CASCADE,
  day              date NOT NULL,
  agent_time_ms    bigint NOT NULL DEFAULT 0,
  sessions         int NOT NULL DEFAULT 0,
  tool_calls       int NOT NULL DEFAULT 0,
  turns            int NOT NULL DEFAULT 0,
  peak_concurrency int NOT NULL DEFAULT 0,
  PRIMARY KEY (team_id, member_id, day)
);

-- plan utilization snapshots
CREATE TABLE plan_utilization (
  id               bigserial PRIMARY KEY,
  team_id          uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  member_id        uuid NOT NULL REFERENCES members ON DELETE CASCADE,
  observed_at      timestamptz NOT NULL,
  weekly_pct       real NOT NULL,
  monthly_cost_usd real
);
CREATE INDEX ON plan_utilization (team_id, observed_at DESC);

-- passive PR <-> ticket mapping with conflict resolution
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

-- invite tokens
CREATE TABLE invites (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id            uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES members,
  token_hash         text NOT NULL UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  used_at            timestamptz,
  expires_at         timestamptz NOT NULL
);

-- admin login sessions (cookie-backed)
CREATE TABLE admin_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    uuid NOT NULL REFERENCES members ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_used_at timestamptz
);

-- audit / event log (mostly write-only, used by Settings → Activity later)
CREATE TABLE events (
  id           bigserial PRIMARY KEY,
  team_id      uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  member_id    uuid REFERENCES members,
  action       text NOT NULL,                 -- e.g. 'admin.claim', 'member.invite', 'settings.email_set', 'resend.failure'
  payload      jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON events (team_id, created_at DESC);

-- ingest deduplication log (TTL-pruned)
CREATE TABLE ingest_log (
  ingest_id    uuid PRIMARY KEY,              -- client-generated per ingest payload
  team_id      uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  member_id    uuid NOT NULL REFERENCES members ON DELETE CASCADE,
  received_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ingest_log (received_at);  -- for TTL prune job
```

A nightly prune job deletes `ingest_log` rows where `received_at < now() - interval '24 hours'`. 24h is the dedup window — longer than the daemon's queue retention is unnecessary; shorter risks accepting a duplicate after the daemon retries. Postgres alone is sufficient; no Redis or external store required.

### Design rationale

- **`tickets` is the canonical work unit**; `ticket_sessions` captures per-member contribution (one row per member who touched the ticket)
- **`daily_rollups` is a pre-aggregation** for dashboard "last 30 days" queries — avoids scanning `ticket_sessions` on every page load
- **`pr_ticket_map` is the passive enrichment index** — populated whenever a session is ingested that contains both a PR URL and a ticket URL. Used later to enrich sessions that have only one side.
- **Everything is append-only** except `tickets` and `ticket_sessions`, which are upserted by ingest

### Canonical ticket merge policy

When multiple members submit rollups for the same `(team_id, ticket_id)`, the server merges them into one canonical `tickets` row and one `ticket_sessions` row per member. The merge rules for the canonical `tickets` row:

| Field | Merge rule |
|---|---|
| `first_touch` | `MIN` across all contributing members |
| `last_touch` | `MAX` across all contributing members |
| `ship_state` | Furthest-progressed state (`merged` > `pr_opened` > `in_progress` > `closed_without_merge`) |
| `merged_at` | `MIN(merged_at)` across members who observed the merged state; null otherwise |
| `primary_assignee_id` | Member with the largest `agent_time_ms` on this ticket; tie broken by earliest `first_touch`, then by lowest `member.id` UUID for full determinism |
| `pr_url` / `pr_number` / `pr_title` | Highest `signal_tier` observation wins; tie broken by earliest `first_observed_at` |
| `ticket_url` | Same rule as `pr_url` |
| `provider` / `provider_slug` | Derived from the winning `ticket_url` |
| `signal_tier` | Highest tier observed across members (gold > silver > bronze). **Upgrades always accepted on subsequent ingests; downgrades never applied.** |

Per-member contribution rows in `ticket_sessions` are upserted independently and never merged — Alice's and Bob's contributions to KIP-148 are two distinct rows.

### `pr_ticket_map` conflict resolution

When two independent sessions observe contradictory PR → ticket pairings (e.g. `PR #58 → KIP-66` and `PR #58 → KIP-70`), both rows are stored with `canonical = false`. A background job (or the next ingest transaction) sets `canonical = true` on the winner using this rule, enforced by the partial unique index on `(team_id, pr_url) WHERE canonical = true`:

1. **Most frequent observation** — the pairing with the highest `session_count` wins.
2. **Tiebreak**: the pairing with the earliest `first_observed_at` (the one that has been stable longest).
3. **Still tied**: the canonical flag is left on the existing winner until a new observation breaks the tie.

Only the canonical row is used by the default enricher's fallback lookup path. Non-canonical rows are retained for audit and future re-analysis.

## Ingest API

Six endpoints total for v1.

### Hot path: daemon metric ingest

```http
POST /api/ingest/metrics
Authorization: Bearer <member_token>
Content-Type: application/json
```

Request body:

```json
{
  "ingestId": "01HV9KQ8N3W7XC4M2YR5T9D6F8",
  "observedAt": "2026-04-15T10:30:00Z",
  "tickets": [
    {
      "ticketId": "KIP-148",
      "provider": "linear",
      "providerSlug": "kipwise",
      "ticketUrl": "https://linear.app/kipwise/issue/KIP-148",
      "prUrl": "https://github.com/kipwise/agentic-knowledge-system/pull/194",
      "prNumber": 194,
      "prTitle": "feat(cli): CLI members command",
      "firstTouch": "2026-04-12T09:15:00Z",
      "lastTouch":  "2026-04-15T10:25:00Z",
      "agentTimeMs": 14700000,
      "sessionCount": 5,
      "toolCallCount": 342,
      "turnCount": 78,
      "tokens": { "input": 1200000, "output": 85000, "cacheRead": 9800000, "cacheWrite": 450000 },
      "skills": ["frontend-design", "playwright-qa-verifier"],
      "shipState": "merged",
      "mergedAt": "2026-04-15T10:20:00Z",
      "signalTier": "gold"
    }
  ],
  "dailyRollup": {
    "day": "2026-04-15",
    "agentTimeMs": 14700000,
    "sessions": 5,
    "peakConcurrency": 3,
    "toolCalls": 342,
    "turns": 78
  },
  "planUtilization": {
    "weeklyPct": 0.47,
    "monthlyCostUsd": 112.50
  }
}
```

Server response:

```json
{ "accepted": true, "ticketsUpdated": 1, "nextSyncAfter": "2026-04-15T10:35:00Z" }
```

Server validates the bearer token, resolves the member, upserts `tickets` + `ticket_sessions` + `daily_rollups` + `plan_utilization` + `pr_ticket_map` in one transaction.

Cadence: every 5 minutes, matching the existing Fleetlens solo-edition usage daemon.

### Onboarding endpoints

```
POST /api/team/claim                — first-run admin claim, returns admin session cookie
POST /api/team/invites              — admin creates a shareable invite token
POST /api/team/join                 — member pairs using an invite, returns long-lived bearer
GET  /api/team/settings             — read current Resend key, custom domain, etc. (admin only)
PUT  /api/team/settings/email       — set Resend API key
PUT  /api/team/settings/domain      — set custom domain
```

### Daemon-facing config endpoint (privacy + matcher policy)

```
GET  /api/team/daemon-policy        — privacy & matcher settings the daemon must apply pre-ingest
```

The daemon polls this endpoint **once per ingest cycle** (i.e. every 5 minutes alongside the metric POST) using its bearer token. Response body:

```json
{
  "policyVersion": 7,
  "stripPRTitle": false,
  "skillTagDenyList": ["^project-falcon-", "^acme-"],
  "ticketPrefixOverrides": ["KIP", "ENG"],
  "lastUpdated": "2026-04-15T09:00:00Z"
}
```

Daemon caches the response indexed by `policyVersion` and re-fetches only when the version changes (server returns 304 if unchanged). When the admin toggles a privacy setting in the dashboard, the server bumps `policyVersion`; the maximum lag between toggle and effect is one ingest cycle (~5 minutes).

**Crucially: privacy filtering happens on the daemon, not on the server.** When `stripPRTitle: true`, the daemon's payload omits `prTitle` from `tickets[]` entries entirely — the server never sees it. When a skill tag matches the deny-list regex, the daemon replaces it with `[redacted]` before sending. This means a regulated team's PR titles and codename skill tags **never leave the laptop**, even if the team server were compromised. The toggle is enforced at the source, not the destination.

For self-hosted teams that can't tolerate even a 5-minute lag (e.g., immediately after revoking a member), admins can use Settings → Members → Revoke, which invalidates the bearer token immediately and stops further pushes regardless of policy cache state.

### Dashboard read endpoints

```
GET  /api/team/gantt?from=...&to=...   — the Gantt feed (tickets + ticket_sessions joined)
GET  /api/team/members                  — member list with last_seen_at
GET  /api/team/insights                 — surfaced insights from pattern engine
GET  /api/team/plan-optimizer           — finance recommendations
GET  /api/sse/updates                   — SSE stream, pushes `ticket-updated` events for live refresh
```

All read endpoints require either an `admin_sessions` cookie or a `members` bearer with appropriate role.

### Daemon reliability — offline, wake, and retry

The local daemon runs on laptops that close, sleep, lose network, and hibernate. Building on the solo-edition wake-from-sleep handling (commit `0d35490`), the team ingest pipeline specifies:

- **Queue on failure**. When a POST to `/api/ingest/metrics` fails (network, 5xx, timeout), the daemon writes the payload to a local append-only file at `~/.cclens/ingest-queue.jsonl` and retries on the next 5-minute cycle.
- **Queue retention**: up to 7 days or 10 MB, whichever comes first. On overflow, oldest payloads are discarded with a warning logged to `~/.cclens/daemon.log`. 7 days is enough to survive a long weekend without data loss and bounded enough to prevent unbounded growth on a permanently disconnected machine.
- **Wake-from-sleep**: on wake, the daemon runs one immediate catch-up ingest cycle before resuming the 5-minute cadence. Solo edition already does this; team mode piggybacks.
- **Deduplication**: every payload carries a client-generated `ingest_id` (UUID). The server stores recently-seen IDs in the `ingest_log` table (24-hour TTL prune). Duplicate payloads return `202 Accepted` with `{"deduplicated": true}` and are no-ops.
- **Backoff on repeated 4xx**: if the server returns 401/403 three times in a row, the daemon stops pushing and writes a clear error to `~/.cclens/daemon.log` — this prevents a revoked member from hammering the server indefinitely. `fleetlens team status` surfaces the error.
- **Rate**: normal cadence is every 5 minutes. On catch-up, the daemon flushes the queue with up to 3 parallel requests but respects a 1-second server-side rate limit between payloads.

### Ingest upgrade rules

`signal_tier` on `tickets` is monotonic: later ingests can **upgrade** a ticket's tier (bronze → silver → gold) but never downgrade it. This prevents a late observation with weaker signals from silently reducing the dashboard's confidence label on already-established work.

### Dashboard scale and pagination

The `tickets` and `ticket_sessions` tables grow linearly with team activity. A 20-person team shipping 5 tickets/week each produces ~5,200 tickets/year and ~15,000 `ticket_sessions` rows. The Gantt hero view is designed to stay fast at this scale:

- **Default hero window**: last **14 days**. The hero Gantt page requests `from = today - 14d` by default. Users can widen via the filter bar.
- **Row cap on the hero**: rows with `last_touch < from - 7d` are hidden (stale) unless the user explicitly expands. This prevents a member who hasn't touched Fleetlens in months from filling half the rows.
- **Ticket cap on the hero**: max 500 tickets rendered on a single Gantt view. Beyond that, the server returns a `more` cursor and the UI shows "+N more — click to expand" markers on the affected rows. 500 is chosen because it maps to a 20-person team × 14 days × ~2 tickets/person/day worst case.
- **History page pagination**: the History route loads one week at a time with prev/next controls. No infinite scroll.
- **SSE backpressure**: the server debounces `ticket-updated` events at 1-per-second per `team_id`. A burst of ingests across many members aggregates into a single refresh event.
- **Index requirements**: the `tickets (team_id, last_touch DESC)` index on line 465 supports the default hero query in a single index scan. Tested query plan at 1M ticket rows completes in <20ms on Postgres 14+.

## Web UI layout

Reuses Fleetlens's existing Next.js 16 App Router stack. Team Edition adds new routes under `/team/:slug/*`:

```
/team/:slug              → Team Gantt (hero, default)
/team/:slug/members      → Member cards
/team/:slug/plan         → Plan optimizer (finance view)
/team/:slug/insights     → Insights feed
/team/:slug/history      → Time-travel Gantt
/team/:slug/settings     → Admin settings (email, domain, retention, members)
```

### Team Gantt — hero page

Described visually in the **Core concept** section above. Core interactions:

- Click a block → side panel with ticket details
- Click a member row → drill into that member's weekly detail
- Click a day header → drill into hourly view for that day across all members
- Filter bar: date range, members, signal tier (gold/silver/bronze)
- Toggle "shipped only" / "gold+silver only" / "include no-ticket sessions"

### Plan (finance view)

Per-member utilization chart, current spend, downgrade/upgrade recommendations. The primary insight surfaces from this page: *"4 seats averaged <30% plan utilization over 30 days — downgrade to $100 saves $400/mo."*

### Insights feed

Cards surfaced from a background pattern engine running every few hours over `tickets` + `daily_rollups` + `plan_utilization`. Each card: title, supporting data, action button ("share this pattern with the team", "flag Carol for a check-in").

Pattern categories:
- **Share-worthy**: "Alice runs 5 concurrent sessions most mornings — her fleet orchestration pattern"
- **Coachable**: "Bob's cadence is short bursts with long human turns — potentially over-supervising"
- **Check-in-worthy**: "Carol has a 3-hour single segment once a week — worth a check-in"
- **Capacity**: "Team hit 85% of weekly cap with 2 days remaining — throttling risk this Friday"
- **Cost**: "Alice / Bob on $200 plan, Carol / Dan on $100 plan saves $X/mo compared to uniform $200"

Insights are framed as *patterns worth learning from*, not *patterns worth controlling for*. The copywriting is opinionated in this direction across the UI.

### Settings

The post-deploy configuration surface, as described in the Railway deployment section:

- Email (Resend API key)
- Custom domain
- Team profile (name, logo)
- Members (invite, revoke, promote/demote)
- Retention (365-day default)
- Security (export recovery token, revoke all sessions)
- Billing (SaaS only, v1.1+)

### Live refresh — SSE everywhere

Every dashboard page subscribes to `/api/sse/updates`. When a daemon ingests new data, the server broadcasts a `ticket-updated` event scoped by `team_id`. Clients re-fetch only the affected slice. Reuses the `LiveRefresher` component from Fleetlens solo edition — zero new infrastructure, battle-tested code path.

## Privacy boundary

The precise line between what stays on the developer's laptop and what is shipped to the team server.

### Stays on the laptop (never leaves)

- Raw JSONL transcripts in `~/.claude/projects/`
- Content of user / assistant messages
- Tool call arguments (e.g., the `Bash` command string, the `Edit` file contents)
- Tool call results (stdout, stderr, file contents)
- File diffs
- Local filesystem paths
- Commit messages
- Branch names (used locally for matching, not shipped)

### Shipped to the team server (aggregate metadata only)

- Ticket IDs (e.g., `KIP-148`)
- Ticket URLs (public within the customer's Linear/Jira/etc. workspace — not world-public for private workspaces)
- PR URLs (public within the customer's GitHub/GitLab workspace — not world-public for private repos)
- PR titles (⚠ see "known leak surfaces" below — can be stripped via Settings toggle)
- Ticket first-touch / last-touch timestamps
- Agent time sums per ticket per member (summed active segments, same definition as solo edition)
- Session counts
- Tool call counts (integer only, not the calls themselves)
- Turn counts
- Token counts (sum of input / output / cache read / cache write)
- Skill tags used (e.g., `frontend-design`, `playwright-qa-verifier`)
- Ship state + merge timestamp
- Signal tier (gold/silver/bronze, for transparency)
- Plan utilization percentage + monthly cost (derived from the existing solo-edition daemon)

### What this guarantees

A developer running a session on ACME's proprietary billing logic: the team server sees `KIP-148, 3 sessions, 2.3h agent time, 342 tool calls, shipped Thursday`. It does **not** see the SQL, the customer schema, the code, the error messages, the file paths, or the commit messages.

### What this does NOT fully guarantee — known leak surfaces

Two fields in the shipped payload can still encode sensitive strings even though they look like metadata. The design acknowledges this rather than papering over it:

- **PR titles** can contain customer names, embargoed product codenames, or regulated identifiers. `"feat(billing): Acme BigCo enterprise tier"` leaks `Acme BigCo`. `"feat: Project Falcon beta gates"` leaks `Project Falcon`. For **public** repos this is already world-readable, but for **private** repos the PR title was previously only visible to repo collaborators. In SaaS mode, it becomes visible to Fleetlens Cloud operators as well.
- **Skill tags** can be named in ways that encode project codenames. A team skill called `project-falcon-qa` leaks `project-falcon` into telemetry.

**Mitigations available in v1**:

- **"Ticket title: enriched only" mode** in Settings. When enabled, the daemon strips `prTitle` from the ingest payload and sends only `ticketId` + `prNumber`. The team server falls back to the enricher layer (v1: `gh pr list` on the admin's machine) to display titles in the dashboard — meaning titles are fetched once by the admin and never travel through the team server. This is the right default for regulated orgs and is one Settings toggle.
- **Skill tag deny-list** in Settings. Admins can specify a regex of skill tags to scrub before ingest. Matching tags are replaced with `[redacted]`. This is a per-team setting in `teams.ticket_prefix_config`.
- **Self-hosted mode eliminates the Fleetlens-operator concern entirely**: in self-hosted deployments, no Fleetlens employee ever sees either field. Customers with strict requirements should choose self-hosted regardless of the above mitigations.

The doc explicitly does **not** claim "zero sensitive strings leave the laptop" because that would be false. The claim is: "no file contents, no message contents, no tool call bodies, no code, and — with Settings mitigations — no free-text metadata either." That precision matters for compliance conversations.

## v1 scope

What ships in v1:

- **Solo edition (existing Fleetlens, v0.2.x+)**: unchanged. Free. Permanent. The default entry point for any individual developer. Team Edition does not deprecate or modify it.
- **Local daemon extension**: the existing `fleetlens` daemon gains a `team join` command and starts pushing ticket metrics to a team server when paired. Otherwise identical to current behavior.
- **Team server**: Next.js 16 App Router backend serving the multi-tenant dashboard, ingest API, SSE stream.
- **Database**: PostgreSQL 14+ (tested on PG17), schema as specified above.
- **Default ticket matcher**: the multi-strategy tiered stack (Tiers 0-5 with the resolution rule).
- **Default ticket enricher**: `gh pr list` (local).
- **Auto-detection**: zero-config prefix + provider discovery on first run.
- **Pluggable matcher/enricher interfaces**: published + documented. No first-party connectors in v1.
- **Deployment Path A**: Railway template with zero-config deploy flow.
- **Deployment Path B**: AWS Terraform module.
- **Deployment Path C (community)**: Docker Compose reference.
- **Web UI**: Team Gantt, Members, Plan, Insights (basic), History, Settings.
- **Email**: Resend API key via Settings (optional, post-deploy).
- **Auth**: magic link for admin claim; long-lived bearer tokens for daemon auth; 7-day expiring share-link invites for members.

## v2 deferrals

Explicitly out of scope for v1, deferred to v2 or later:

- SSO / SAML / OIDC
- Org-wide rollups across multiple teams (one team per instance in v1)
- Stripe billing integration (SaaS free trial in v1)
- First-party **API-based** enrichers (Linear API, Jira API, GitHub Issues API, Shortcut API) — the default `gh pr list` local CLI enricher **does ship in v1**
- White-label branding packs beyond team name + logo
- Real-time WebSocket transport (SSE in v1 is sufficient)
- Native mobile apps (responsive web is sufficient)
- Role-based access control beyond admin/member
- Audit logs UI (database has the infrastructure; UI is v2)
- GCP / Azure Terraform modules
- Kubernetes Helm chart as a first-class deliverable
- Multi-agent-CLI support (Codex / OpenClaw / others)

## Open questions

These are genuine uncertainties the design does not yet resolve. None of them block v1 implementation; they are noted here so reviewers can flag any that should be promoted to scope before we start writing code.

1. **What's the canonical `member.display_name` source?** Email local-part? `git config user.name`? First invite form? Needs a policy before first implementation.
2. **Plan utilization is per-member today — how does a manager correlate "Alice's seat costs $X/month" to her `member_id`?** Probably stored in `members.seat_cost_usd` with an admin-only edit path. Not critical for v1 but needs a home.
3. **Multi-tenant scaling**: SaaS sizing assumes one Postgres serves all teams. At what team count do we need to shard or introduce per-team databases? Not a v1 problem but worth noting.
4. **Insight engine batch cadence**: hourly? 4x daily? Daily? The tradeoff is freshness vs. cost. Start daily, observe, adjust.
5. **Custom domain TLS for SaaS**: for teams that want `fleetlens.acme.com`, who manages the TLS cert — us via Caddy-style automatic provisioning, or the customer? Probably us via Let's Encrypt automation. Needs a proper spec.
6. **`fleetlens-team-server` image supply chain**: registry, image signing, SBOM publication, CVE scan cadence. Security-conscious adopters will ask. Not v1 implementation work, but a v1 *operational* commitment to make.
7. **Daemon → server bearer token storage on the laptop**: which file under `~/.cclens/`, what permissions, optional OS keychain integration on macOS. Minor but a question corporate-managed laptop owners will ask.

## Appendix A — URL patterns registry

The first-class URL patterns recognized by the default matcher. Third-party matchers can add more via the plugin interface.

| Provider | URL pattern | Ticket ID location |
|---|---|---|
| GitHub PR (same-repo) | `https://github.com/<org>/<repo>/pull/<N>` | `<N>` (integer) |
| GitHub Issue (same-repo) | `https://github.com/<org>/<repo>/issues/<N>` | `<N>` (integer) |
| Linear | `https://linear.app/<team>/issue/<PREFIX>-<N>` | `<PREFIX>-<N>` |
| Jira | `https://<host>.atlassian.net/browse/<PREFIX>-<N>` | `<PREFIX>-<N>` |
| Shortcut | `https://app.shortcut.com/<org>/story/<N>` | `<N>` (integer) |
| GitLab MR (same-repo) | `https://gitlab.com/<org>/<repo>/-/merge_requests/<N>` | `<N>` (integer) |
| GitLab Issue (same-repo) | `https://gitlab.com/<org>/<repo>/-/issues/<N>` | `<N>` (integer) |

The `<org>/<repo>` for GitHub/GitLab URLs is matched against `git remote get-url origin` to filter out third-party references (e.g., an agent WebFetching `github.com/grafana/grafana/issues/61383` while researching an unrelated bug).

## Appendix B — Reference: Multica pattern comparison

Fleetlens Team Edition's architecture is pattern-compatible with [Multica](https://multica.ai) (an open-source managed-agents platform), validating the hybrid SaaS + self-hosted shape. Key parallels:

| Aspect | Multica | Fleetlens Team Edition |
|---|---|---|
| Deployment | Cloud SaaS + self-hosted (Docker / K8s) | Cloud SaaS + self-hosted (Railway / Terraform) |
| Privacy | "Code never passes through Multica servers" | "Transcripts never leave the laptop" |
| Local daemon | Yes, auto-detects agent CLIs | Yes, existing `fleetlens` daemon extended |
| Onboarding | Email verification, auto-provisioned workspace | Email magic link, auto-provisioned team |
| Install (admin deploy) | `multica setup self-host` via Docker | Click "Deploy on Railway" (no terminal) or Terraform `apply` |
| Install (member pairing) | `multica setup` (CLI) | `fleetlens team join <url> <token>` (CLI, from share link) |
| Framework | Next.js 16 App Router | Next.js 16 App Router |
| Multi-tenancy | Workspace-level isolation | Team-level isolation |

**Scope differences**: Multica *orchestrates* agent work (dispatches tasks, tracks execution). Fleetlens *observes* agent work (reads JSONL after it happens, visualizes what already occurred). They are complementary products. A team could run both: Multica to dispatch scheduled work, Fleetlens to visualize the complete shipping story across scheduled and ad-hoc sessions.

---

**End of design doc.**
