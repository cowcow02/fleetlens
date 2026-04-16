# Fleetlens Team Edition — Doc 1: Foundation

**Status:** Draft
**Date:** 2026-04-16
**Author:** split from 2026-04-15-team-edition-design.md
**Ships:** Deployable team server + member daemon pairing + basic profile pages
**Depends on:** Nothing (Doc 1 is the walking skeleton)
**Enables:** Docs 2, 3, 4

## Overview

The first shippable layer of Fleetlens Team Edition. A tech manager or CTO can stand up a team server (via Railway or AWS Terraform), invite their engineers by share link, and see a simple dashboard listing every active team member with their basic runtime stats — total sessions this week, agent hours, token usage, last seen.

**No tickets, no Gantt, no insights, no signal hierarchy.** Those are later docs. Doc 1 proves that the deployment + pairing + metric-ingest pipeline works end-to-end against a real team before any clever analysis is built on top.

## Why ship Doc 1 alone?

- **Validates the deployment flow.** The Railway-in-under-2-minutes claim only holds if real customers can actually do it. Doc 1 lets us test that against real adopters without also testing ticket correlation.
- **Gives engineering managers immediate "who's using it" visibility.** That answers a real question most teams don't have a tool for today.
- **De-risks the architecture before we invest in the clever parts.** If the ingest pipeline, auth flow, or multi-tenant schema turns out to need rework, we find out at Doc 1 scale — not after we've built the Gantt on top of it.

## Personas

**Primary**: tech manager / CTO / finance controller who wants to know whether their team is actually using Claude Code and at what scale. Non-engineer adoption path is critical.

**Secondary**: engineering manager who wants a "roster of active members" before committing to a deeper tool.

## Non-goals for Doc 1

- Tickets, PRs, ticket correlation, signal hierarchy — Doc 4
- Per-member Gantt / timeline visualization — Doc 3
- Plan utilization / cost reporting / finance optimizer — Doc 2
- Insights feed / pattern recognition — Doc 4
- SSO / SAML / OIDC — v2 of the product
- Org-wide rollups across multiple teams — v2
- Stripe billing — v1.1
- White-label branding beyond team name + logo
- Native mobile app

## Core architecture

SaaS + self-hosted hybrid with a shared codebase. The local `fleetlens` daemon (already running on the member's laptop from solo edition) gains a `team join` command and starts pushing metric rollups to whichever team server the member paired with.

```
┌────────────────────┐          ┌────────────────────────────┐          ┌────────────────────┐
│ Alice's laptop     │          │ Fleetlens team server       │          │ Bob's laptop       │
│                    │          │  (SaaS or self-hosted)      │          │                    │
│ fleetlens daemon   │─HTTPS───▶│                             │◀──HTTPS──│ fleetlens daemon   │
│                    │  POST    │ Postgres: teams, members,   │  POST    │                    │
│ stays: raw JSONL   │ /ingest  │  admin_sessions, invites,   │ /ingest  │ stays: raw JSONL   │
│                    │          │  daily_rollups, events,     │          │                    │
│                    │          │  ingest_log                  │          │                    │
└────────────────────┘          │                             │          └────────────────────┘
                                │ Next.js web UI              │
                                │  - team roster page         │
                                │  - per-member profile page  │
                                │  - admin settings           │
                                └─────────────────────────────┘
                                              ▲
                                              │
                                         admin browser
```

**Privacy boundary** (unchanged from monolith): transcripts stay on the laptop. Only aggregated daily rollups (agent time sums, session counts, tool call counts, turn counts, token counts) flow to the team server. No message content, no tool call arguments, no file contents, no file paths, no commit messages.

## Deployment paths

Two officially supported deployment shapes. Same Docker image, different targets.

### Path A — Railway recipe (zero-config, non-DevOps adopter)

Target experience: CTO clicks "Deploy on Railway" button, fills in no forms, has a running team server in ~2 minutes. The Railway template provisions:

- `fleetlens-team-server` service running `fleetlens/team-server:latest`
- Railway managed Postgres 17
- Auto-wired `DATABASE_URL`, `RAILWAY_PUBLIC_DOMAIN`, `PORT`

**Zero env var form fields at deploy time.** Everything else the server needs is generated on first boot and stored in Postgres.

**Click-by-click (target: under 2 minutes, under 10 clicks):**

| # | Action | Elapsed |
|---|---|---|
| 1 | Visit fleetlens.com, click "Deploy on Railway" | 0s |
| 2 | Railway opens; log in if not already | 10s |
| 3 | Template preview shows 2 services, no forms → click **Deploy** | 15s |
| 4 | Wait for build + provision | ~75s |
| 5 | Railway shows the URL → click it | 90s |
| 6 | Fleetlens "Claim this instance" page → paste bootstrap token from Railway logs → **Claim as admin** | 100s |
| 7 | "Name your team" prompt → type "Acme Engineering" → Continue | 115s |
| 8 | Landed in dashboard → click **Invite members** | 118s |
| 9 | "Share this link" modal → click the copy icon | 120s |
| 10 | Paste link into Slack / email / DM | 122s |

No terminal, no env vars, no DNS setup, no cert management, no SMTP.

### Path B — AWS Terraform module (enterprise DevOps)

Target: DevOps engineer with existing AWS account. Reviewable HCL, standard resources, ~10 inputs.

```hcl
module "fleetlens" {
  source  = "github.com/cowcow02/fleetlens//deploy/terraform/aws?ref=v0.3.0"
  
  hostname    = "fleetlens.acme.com"
  admin_email = "cto@acme.com"
  vpc_id      = data.aws_vpc.main.id
  subnet_ids  = data.aws_subnets.private.ids
  # Resend + SMTP are optional in Doc 1; can be added via Settings post-deploy
}

output "fleetlens_url" { value = module.fleetlens.url }
```

**Module provisions**: Fargate ECS service, RDS PostgreSQL (default v17, configurable via `postgres_version` variable, minimum PG14), ALB + ACM cert, IAM, Secrets Manager entries, optional Route 53 record. Customers with existing RDS skip the provision via `database_url` override.

**Step-by-step:**

| # | Action | Time |
|---|---|---|
| 1 | Reference module via `source = "github.com/..."` | 2 min |
| 2 | Fill `terraform.tfvars` (hostname, admin_email, vpc_id, subnet_ids) | 10 min |
| 3 | `terraform init && terraform plan` | 5 min |
| 4 | PR review of the plan output | 5-60 min |
| 5 | `terraform apply` | ~8 min |
| 6 | DNS record → ALB | 5-15 min |
| 7 | ACM cert validation | 2-10 min |
| 8 | Read bootstrap token from ECS CloudWatch logs, visit `fleetlens_url`, claim admin | 3 min |
| 9 | Invite members via in-app share links | 2 min |

**Total elapsed**: 45 min to 2 hours. Most variance is review + DNS, not Fleetlens-specific work.

### Path C — Docker Compose (community / DIY tier)

Not a headline offering, but shipped for users who want to run on their own Hetzner / home lab / internal VM. Reference `docker-compose.yml` + `Caddyfile` for automatic TLS via Let's Encrypt. Documented in `deploy/compose/README.md`.

### Deployment artifacts shipped

| Artifact | Path | Purpose |
|---|---|---|
| `fleetlens/team-server:latest` | Docker Hub + GHCR | Primary image |
| Railway template | `deploy/railway/` | Zero-config 2-min deploy |
| AWS Terraform module | `deploy/terraform/aws/` | Enterprise IaC |
| Docker Compose reference | `deploy/compose/` | DIY / community |
| `docs/self-hosting.md` | Docs site | Single-page runbook |

### Deployment mode migration

**v1 does not support** migrating a team between deployment modes. A team that starts on Fleetlens Cloud cannot directly move to self-hosted, and vice versa. Customers who need migration guarantees should start on self-hosted (the Postgres DB is theirs to export/restore).

## Single-team vs multi-team per instance

A **self-hosted Fleetlens deployment is single-team.** Even though the `teams` table allows multiple rows (for Fleetlens Cloud's multi-tenant SaaS), a self-hosted instance's claim flow only creates one team, and the slug is pre-computed from the team name. The routing `/team/:slug/*` works identically in both modes — in self-hosted the slug is just a stable constant for the one team that exists.

**Fleetlens Cloud is multi-team**: each signup creates a distinct `teams` row, slug collisions append a 4-char suffix, and routing genuinely disambiguates tenants. The same codebase handles both modes; multi-tenancy is a query-scoping concern, not a schema concern.

## Secrets lifecycle

| Secret | Where it lives | Lifespan | Threat model |
|---|---|---|---|
| Bootstrap token | Stdout logs on first boot, `teams.settings.bootstrap_token_hash` until claimed | 15 min or until claim | Log access = admin access. Protects against URL leakage alone. |
| Cookie signing secret | `teams.settings.cookie_secret` (auto-generated on first boot, 32 random bytes) | Rotated on `fleetlens-server --rotate-secrets` command | DB compromise already game over for existing sessions; rotation invalidates all admin_sessions rows |
| Bearer token hash salt | Not used — tokens are 32-byte random values hashed with plain SHA-256 | N/A | High-entropy random tokens do not need a salt |
| Invite token hash | `invites.token_hash = sha256(token)` | 7-day TTL via `expires_at` | Plaintext returned once at creation, never retrievable |
| Member bearer token hash | `members.bearer_token_hash = sha256(token)` | Until revoked | Plaintext returned once at pair time, never retrievable |
| Recovery token hash | `admin_sessions.token_hash = sha256(token)` with 10-year `expires_at` | Until admin revokes via Settings → Security | Paste-on-new-device; treated as equivalent to primary auth |
| Resend API key | `teams.resend_api_key_enc = AES-256-GCM(key, value)` where `key` comes from `FLEETLENS_ENCRYPTION_KEY` env var | Until admin replaces or clears | **Tamper-evident only against a stolen DB backup.** The encryption key is either injected via env var (recommended — Fleetlens Cloud uses AWS KMS) or defaults to a first-boot random value stored alongside the DB (self-hosted default — no external key management required, but at-rest encryption is only as good as the DB volume's encryption). Self-hosted customers wanting stronger key separation can set `FLEETLENS_ENCRYPTION_KEY` themselves and rotate externally. |

**What this protects against**: casual DB dump / backup leak for the Resend API key (the only externally-valuable secret stored at rest). Cookie secrets, bearer tokens, and recovery tokens are hashed — theft of the DB still leaks team metrics but not the ability to impersonate users on other systems.

**What this does not protect against**: full server root access (all secrets are reconstructable from the process memory + DB). This is the standard self-hosted threat model.

## Security: first-claim via boot-log token

The claim flow requires a single-use **bootstrap token** printed to stdout on first server boot, visible only in the container's log stream (Railway service logs, ECS CloudWatch, docker compose logs, whatever the platform uses).

```
fleetlens-server: bootstrap token = ab8d-3f21-9c47-5e80 (valid for 15 minutes)
fleetlens-server: to claim this instance, open <BASE_URL> and paste the token
```

Being the first HTTP visitor is not sufficient — the user must also paste the token from the logs. This matches the pattern used by Grafana, Sentry, and other self-hosted tools. After successful claim, the token is invalidated. If no claim happens in 15 minutes, a fresh token is printed on the next restart.

**Rationale**:
- Log access = admin access (standard threat model)
- URL leakage alone is not sufficient to hijack
- Non-engineer adopters still see this — Railway's deploy logs are on the same page as the deploy button, ECS CloudWatch is one click from the service, docker compose logs is one command. Two clicks or one command.

## Data model

Single Postgres database, multi-tenant via `team_id` scoping on every query. **Minimum PostgreSQL 14**, tested on PG17.

```sql
-- the tenant
CREATE TABLE teams (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                   text UNIQUE NOT NULL,
  name                   text NOT NULL,
  retention_days         int  NOT NULL DEFAULT 365,
  resend_api_key_enc     text,                               -- see "Secrets lifecycle" below
  custom_domain          text,
  settings               jsonb NOT NULL DEFAULT '{}',        -- extensible bucket for future per-team config
  created_at             timestamptz NOT NULL DEFAULT now()
);
-- No admin_user_id column — admin-ness lives on members.role. Querying "who is this team's first admin?" uses:
--   SELECT id FROM members WHERE team_id = ? AND role = 'admin' ORDER BY joined_at LIMIT 1;

-- a team member (one per developer who paired their daemon)
CREATE TABLE members (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id           uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  email             text,                              -- optional until configured
  display_name      text,                              -- from `git config user.name` or first invite
  role              text NOT NULL CHECK (role IN ('admin','member')),
  bearer_token_hash text NOT NULL,                     -- daemon auth, long-lived
  joined_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz,
  revoked_at        timestamptz,
  UNIQUE (team_id, email)
);
CREATE INDEX ON members (team_id) WHERE revoked_at IS NULL;

-- invite tokens (7-day expiry, one-time use)
CREATE TABLE invites (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id            uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES members,
  token_hash         text NOT NULL UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  used_at            timestamptz,
  expires_at         timestamptz NOT NULL
);

-- admin login sessions (cookie-backed, long-lived)
CREATE TABLE admin_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    uuid NOT NULL REFERENCES members ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_used_at timestamptz
);

-- per-member per-day rollup — the only metric storage Doc 1 ships
CREATE TABLE daily_rollups (
  team_id          uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  member_id        uuid NOT NULL REFERENCES members ON DELETE CASCADE,
  day              date NOT NULL,
  agent_time_ms    bigint NOT NULL DEFAULT 0,
  sessions         int NOT NULL DEFAULT 0,
  tool_calls       int NOT NULL DEFAULT 0,
  turns            int NOT NULL DEFAULT 0,
  tokens_input     bigint NOT NULL DEFAULT 0,
  tokens_output    bigint NOT NULL DEFAULT 0,
  tokens_cache_read  bigint NOT NULL DEFAULT 0,
  tokens_cache_write bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (team_id, member_id, day)
);
CREATE INDEX ON daily_rollups (team_id, day DESC);

-- audit / event log (write-only, used by later docs for Settings → Activity)
CREATE TABLE events (
  id           bigserial PRIMARY KEY,
  team_id      uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  member_id    uuid REFERENCES members,
  action       text NOT NULL,                           -- 'admin.claim', 'member.invite', 'member.revoke', etc.
  payload      jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON events (team_id, created_at DESC);

-- ingest deduplication log (24h TTL prune)
CREATE TABLE ingest_log (
  ingest_id    text PRIMARY KEY,                        -- ULID (Crockford base32), lexicographically sortable
  team_id      uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  member_id    uuid NOT NULL REFERENCES members ON DELETE CASCADE,
  received_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ingest_log (received_at);
```

**Hash algorithm for all `_hash` columns**: SHA-256. These are high-entropy random 32-byte tokens, not user-chosen passwords, so a fast unique-index lookup is the correct trade-off (not bcrypt / argon2).

**Scheduled maintenance**: a nightly in-process `node-cron` job runs at 03:00 UTC to prune `ingest_log` rows older than 24 hours. No external cron daemon or `pg_cron` extension required.

**Recovery token storage**: the admin's recovery token is stored as a second hash in `admin_sessions` — specifically, the first admin's initial claim creates both a session cookie *and* a recovery token; the recovery token is an additional `admin_sessions` row with `token_hash = sha256(recovery_token)` and `expires_at = created_at + interval '10 years'` (effectively permanent until revoked). Pasting the recovery token on a new device hits `POST /api/team/admin-recover` with `{recovery_token}` and receives a fresh session cookie.

### Forward-compatibility principles

This schema must not block future docs. Specifically:

- **Docs 2, 3, 4 will add new tables** (`plan_utilization`, `session_blocks`, `tickets`, `ticket_sessions`, `pr_ticket_map`). Migrations are additive only.
- **The Doc 1 ingest endpoint accepts and silently ignores unknown fields in the request body** so a Doc 4-era daemon can push to a Doc 1-era server without breaking. Forward-compat is a one-way guarantee: newer daemon + older server is fine; older daemon + newer server may not benefit from newer fields but continues working.
- **The `teams.settings jsonb` column is the extensible bucket** for per-team config that later docs will add (ticket prefix overrides, privacy toggles, insight cadence preferences). No schema migration needed when later docs add new keys.

## Ingest API

### Hot path: daemon metric ingest

```http
POST /api/ingest/metrics
Authorization: Bearer <member_token>
Content-Type: application/json
```

Request body — Doc 1 only sends `dailyRollup`. Future docs extend the same endpoint with additional top-level keys (`tickets[]`, `sessionBlocks[]`, `planUtilization`).

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
    "tokens": {
      "input": 1200000,
      "output": 85000,
      "cacheRead": 9800000,
      "cacheWrite": 450000
    }
  }
}
```

Server response:

```json
{ "accepted": true, "nextSyncAfter": "2026-04-16T10:35:00Z" }
```

Server validates the bearer token, resolves the member, upserts the daily rollup row, inserts the `ingest_log` entry, and updates `members.last_seen_at`. All in one transaction.

**Cadence**: every 5 minutes, same as solo edition's usage daemon. No new scheduling infrastructure.

### Rollup upsert semantics: replace, not delta

The daemon always sends the **full-day aggregate** for each `day` it touches, recomputed from scratch from local JSONL on every cycle. The server's upsert is `INSERT ... ON CONFLICT (team_id, member_id, day) DO UPDATE SET ... = EXCLUDED.*` — i.e., **replace all columns with the latest values**. There is no delta arithmetic. This matches the solo edition's model (rebuild from JSONL, no client-side delta state) and eliminates reconciliation bugs between the client and server.

Every 5-minute cycle, the daemon typically sends 1-2 days (today, and yesterday if it crossed midnight since the last sync). Older days are only resent if the daemon detects new events landed in the corresponding JSONL file (e.g., after a replay or a pulled-from-network resume).

### `day` timezone policy

The `day` field is the **local calendar date on the daemon's host**, computed the same way solo edition's `dailyActivity` splits bucket boundaries (see `packages/parser/src/analytics.ts` `toLocalDay`). A session that spans 11pm → 3am local time contributes to both the evening day and the following morning day in the member's local zone.

The server stores `day` as-is and does not reinterpret. The dashboard displays days as-sent; a CTO viewing the team roster sees each member's own local calendar days rolled up into "this week" using the admin's local week boundary (Mon-Sun by default, configurable in Settings). This matches the solo edition's behavior for feature parity.

### Unknown-field handling — permissive at every level

The server parses the request body with an **open schema at every level of nesting** — unknown keys are ignored whether they appear at the top level (e.g., `tickets[]` from a Doc 4 daemon), inside `dailyRollup` (e.g., `dailyRollup.planUtilization` from a Doc 2 daemon), inside `dailyRollup.tokens` (e.g., new cache tiers), or anywhere else. Use `Zod.object({...}).passthrough()` or `Ajv({ strict: false, removeAdditional: false })` — **not** `.strict()` at any level.

The response always includes `"accepted": true` as long as the bearer token is valid and the *known* fields in the daily rollup pass type validation. Unknown fields never cause rejection.

### Onboarding endpoints

#### `POST /api/team/claim` — first-run admin claim using bootstrap token

Request:
```json
{
  "bootstrapToken": "ab8d-3f21-9c47-5e80",
  "teamName": "Acme Engineering",
  "adminEmail": "cto@acme.com",
  "adminDisplayName": "Alice Wong"
}
```

Response (201 Created):
```json
{
  "team": { "id": "uuid...", "slug": "acme-engineering", "name": "Acme Engineering" },
  "admin": { "id": "uuid...", "email": "cto@acme.com", "displayName": "Alice Wong", "role": "admin" },
  "sessionCookie": "set via Set-Cookie header, HttpOnly, Secure, SameSite=Lax",
  "recoveryToken": "rt_64charRandomHex"
}
```

Server generates `slug` by slugifying `teamName` (`acme-engineering`); if the slug collides with an existing team on a multi-team instance, append a random 4-char suffix. Self-hosted instances are single-team (see below) so collisions only matter for Fleetlens Cloud.

The claim invalidates the bootstrap token and creates the first `members` row (role=admin) plus two `admin_sessions` rows: the browser session cookie (90-day TTL, refreshed on use) and the recovery token (10-year TTL, paste-on-new-device). Both are returned to the client once and never retrievable again.

**Mandatory first-login modal**: the dashboard blocks on a "Save your recovery token" screen before the admin proceeds. The `recoveryToken` field in the response is the *plaintext* value shown once in this modal.

#### `POST /api/team/admin-recover` — re-auth from another device

Request:
```json
{ "recoveryToken": "rt_64charRandomHex" }
```

Response (200 OK): sets a fresh session cookie via `Set-Cookie`. The recovery token is not consumed; it can be used indefinitely unless the admin revokes it via Settings → Security.

#### `POST /api/team/invites` — admin creates a shareable invite token

Request (requires admin session cookie):
```json
{ "label": "Bob Smith", "expiresInDays": 7 }
```

Response (201):
```json
{
  "inviteId": "uuid...",
  "joinUrl": "https://fleetlens-acme.up.railway.app/join?token=iv_32charRandomHex",
  "tokenPlaintext": "iv_32charRandomHex",
  "expiresAt": "2026-04-23T10:30:00Z"
}
```

The plaintext token is returned once; the server stores only `sha256(token)` in `invites.token_hash`. Label is a convenience for the admin UI (e.g., displayed in the pending-invites list).

#### `POST /api/team/join` — member pairs using invite

Request (public, no auth — the invite token is the credential):
```json
{
  "inviteToken": "iv_32charRandomHex",
  "email": "bob@acme.com",
  "displayName": "Bob Smith"
}
```

Response (201):
```json
{
  "member": { "id": "uuid...", "email": "bob@acme.com", "displayName": "Bob Smith", "role": "member" },
  "bearerToken": "bt_64charRandomHex",
  "teamSlug": "acme-engineering",
  "serverBaseUrl": "https://fleetlens-acme.up.railway.app"
}
```

`email` and `displayName` are optional; if omitted, the daemon fills them in from `git config user.email` and `git config user.name` on the local machine. If both sources are empty, the pair flow prompts the user interactively via the CLI.

Server marks the invite as used (`invites.used_at = now()`), creates the `members` row, returns the plaintext bearer token (stored as `sha256` in `members.bearer_token_hash`). The bearer token is returned once and never retrievable again; if lost, the admin must revoke and re-invite.

#### Other onboarding endpoints

```
GET    /api/team/settings              — read current settings (admin only)
PUT    /api/team/settings/email        — set Resend API key (body: {apiKey})
PUT    /api/team/settings/domain       — set custom domain (body: {domain})
PUT    /api/team/settings/profile      — update team name / logo (body: {name, logoUrl})
DELETE /api/team/members/:id           — revoke a member (immediate, sets revoked_at)
POST   /api/team/members/:id/reissue   — generate fresh share link for an existing member
```

### Dashboard read endpoints

```
GET  /api/team/roster                  — list of members with last_seen + current-week stats
GET  /api/team/members/:id             — per-member profile page data
GET  /api/sse/updates                  — SSE stream, pushes `roster-updated` events on ingest
```

All read endpoints require either an `admin_sessions` cookie (admin) or a `members` bearer (daemon/self-access).

### Replica model: single replica in Doc 1

**Doc 1 targets a single server replica** on both Railway (default) and the Fargate Terraform module (`desired_count = 1`). In a single-replica deploy, SSE broadcast is an in-memory iteration over connected clients — simple and reliable.

Multi-replica SSE fanout via Postgres `LISTEN/NOTIFY` (or Redis pub/sub) is deferred to v1.1. Teams that want HA in Doc 1 can place Fleetlens behind a load balancer with sticky sessions, but the recommended deployment is single-replica with Postgres HA (RDS Multi-AZ or Railway managed Postgres).

## Daemon reliability

The local daemon runs on laptops that close, sleep, lose network, and hibernate. Building on solo-edition wake-from-sleep handling:

- **Queue on failure**. When a POST fails (network, 5xx, timeout), the daemon writes the payload to `~/.cclens/ingest-queue.jsonl` and retries on the next cycle.
- **Queue retention**: up to 7 days or 10 MB, whichever comes first. Overflow drops oldest with a warning in `~/.cclens/daemon.log`.
- **Wake-from-sleep**: immediate catch-up cycle on wake before resuming the 5-minute cadence. Piggybacks on existing solo-edition logic.
- **Deduplication**: client-generated `ingest_id` (UUID). Server stores recently-seen IDs in `ingest_log` (24h TTL). Duplicates return `202 Accepted {deduplicated: true}`.
- **Backoff on 4xx**: 3 consecutive 401/403 stops the daemon and surfaces a clear error in `fleetlens team status`. Prevents a revoked member from hammering the server.
- **Catch-up rate**: up to 3 parallel requests with a 1-second server rate limit between payloads.

## Web UI — what ships in Doc 1

All routes under `/team/:slug/*`.

### `/team/:slug` — Team roster (hero page)

Simple card grid listing every active member:

```
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│ Alice Wong           │  │ Bob Smith            │  │ Carol Chen           │
│ alice@acme.com       │  │ bob@acme.com         │  │ carol@acme.com       │
│                      │  │                      │  │                      │
│ Last seen: 2 min ago │  │ Last seen: 1 hr ago  │  │ Last seen: yesterday │
│ This week:           │  │ This week:           │  │ This week:           │
│   18.3h agent time   │  │   12.1h agent time   │  │   4.2h agent time    │
│   47 sessions        │  │   29 sessions        │  │   11 sessions        │
│   2.1M tokens        │  │   1.4M tokens        │  │   680K tokens        │
└──────────────────────┘  └──────────────────────┘  └──────────────────────┘
```

**What a CTO reads from this**: the team is active (last seen times are fresh), Alice is the heaviest user, Carol is ramping slowly. That's already useful before any deeper analysis.

### `/team/:slug/members/:id` — Per-member profile page

Drill-down for a single member, rendered entirely from server-side data (no per-member content fetched from the laptop):

- Email, display name, joined date, role (admin/member)
- 30-day activity chart (daily agent time bars from `daily_rollups`)
- 30-day token breakdown (input / output / cache read / cache write)
- Session count per day
- Admin-only controls: revoke member, copy fresh share link

**Not in Doc 1**: "most-used repos" and any repo-level breakdown. Repo names are not shipped to the team server in Doc 1 (see the privacy boundary section). Repo dimensions are added in Doc 3 when the per-member Gantt lands, along with the `session_blocks` table that introduces them.

### `/team/:slug/settings` — Admin settings

- **Team profile**: name, logo (v1.1)
- **Members**: invite new, revoke existing, copy share links
- **Email**: paste Resend API key (optional; when set, enables magic-link admin login from other devices)
- **Custom domain**: point your own DNS at the deployment, provide TLS cert info (or Let's Encrypt automatic on Railway)
- **Retention window**: default 365 days
- **Security**: export recovery token (mandatory on first login), revoke all admin sessions
- **Danger zone**: delete team (irreversible)

### Live refresh — SSE

Every dashboard page subscribes to `/api/sse/updates`. When a daemon ingests new data, the server broadcasts a `roster-updated` event scoped by `team_id`. Clients re-fetch the affected slice. Reuses the `LiveRefresher` component from Fleetlens solo edition.

## Email: Resend post-deploy, share links by default

Doc 1 ships **no email requirement at deploy time**. The default member onboarding is share-link copy-paste:

1. Admin clicks "Invite members"
2. System generates a one-time share link: `https://fleetlens-acme.up.railway.app/join?token=abc123` (7-day expiry)
3. Admin copies the link and pastes it into whatever the team uses (Slack, DM, email, voice)
4. Member clicks the link → lands on install page with a one-line command:

```bash
# If they don't have Fleetlens:
curl -fsSL https://fleetlens.com/install.sh | sh -s join \
  https://fleetlens-acme.up.railway.app abc123

# If they already have Fleetlens solo edition:
fleetlens team join https://fleetlens-acme.up.railway.app abc123
```

5. Member's daemon pairs with the team server, starts pushing metrics on the next 5-minute cycle.

### Optional: Resend for automated email

Post-deploy, the admin can visit Settings → Email and paste a **Resend API key**. This enables:

- Magic-link admin login from other devices
- Automated invite emails instead of share-link copy-paste
- Weekly digest emails (v1.1 feature)

**Validation at save time**: pasting a key triggers a test email to the admin's email. If Resend rejects the key, it's not saved and the UI shows the error.

**Runtime failure fallback**: if a previously-working Resend key starts failing, the server falls back to share-link mode for invites and surfaces a red banner in Settings. Share-link login always remains available.

**Free tier**: 100 emails/day, 3,000/month. Enough for teams of ≤100.

**Raw SMTP is not a v1 first-class path.** Teams needing internal SMTP relay use the Terraform path with env var overrides.

## Auth: bearer tokens + admin session cookies

Doc 1's auth model:

- **Admin claim**: boot-log bootstrap token → exchanged at `/api/team/claim` for an admin session cookie (stored in `admin_sessions`, long-lived with 90-day expiry, **refreshed on every dashboard visit and on every successful daemon ingest from any team member** — effectively permanent for active teams)
- **Member daemon**: invite token → exchanged at `/api/team/join` for a long-lived bearer token (stored as `members.bearer_token_hash`)
- **Admin re-login from another device**: Settings → Security → Export recovery token → paste on the new device to authenticate
- **Mandatory first-login modal** forces recovery token export on fresh admin claim. Eliminates lockout chains.

**Lockout-prevention guarantee**: an admin is never locked out as long as at least one of these holds:
- (a) valid admin session cookie
- (b) configured email provider + access to their email
- (c) saved recovery token from first-login

Since (c) is mandatory at first-login, the guarantee always holds.

### Bearer token rotation

Member bearer tokens are long-lived by design. v1 supports:

- **Revoke**: admin → Settings → Members → Revoke. Sets `revoked_at`, invalidates immediately. Revoked member's daemon gets 401 on next push, stops trying, surfaces error in `fleetlens team status`.
- **Re-issue**: revoke + re-invite. Member re-runs `fleetlens team join` with a fresh share link.

**Token refresh without re-invite is deferred to v2** along with short-lived tokens if enterprise demand appears.

## Privacy boundary (Doc 1)

### Stays on the laptop (never leaves)

- Raw JSONL transcripts in `~/.claude/projects/`
- Content of user / assistant messages
- Tool call arguments (Bash commands, Edit contents, etc.)
- Tool call results (stdout, stderr, file contents)
- File diffs
- Local filesystem paths
- Commit messages
- Branch names
- Repo names (not shipped in Doc 1; added to the payload in Doc 3 as part of session block metadata)

### Shipped to the team server (aggregate metadata only)

- `member_id` (UUID assigned at pair time)
- Daily counts: agent time ms, sessions, tool calls, turns
- Daily token sums: input, output, cache read, cache write
- Member email + display name (at pair time only)
- `last_seen_at` timestamp (derived from ingest time)

**Nothing in this payload contains transcript content, file contents, or any identifiable code/business information.** The boundary is dramatically narrower than the solo edition's local storage — the team server only knows "Alice used Claude Code for 3 hours yesterday across 5 sessions totaling 342 tool calls," not what she was working on.

Later docs will expand this payload (plan utilization in Doc 2, session block metadata in Doc 3, ticket correlation metadata in Doc 4), always with the same principle: only aggregate / metadata fields, never content.

## v1 scope for Doc 1

**Ships:**

- Fleetlens solo edition (existing, v0.2.x+) — unchanged
- Local daemon `fleetlens team join` + `fleetlens team status` + `fleetlens team leave` commands (see CLI surface below)
- Team server: Next.js 16 App Router, multi-tenant Postgres, ingest API, SSE stream
- PostgreSQL 14+ schema (7 tables: teams, members, invites, admin_sessions, daily_rollups, events, ingest_log)
- Railway template (zero-config deploy)
- AWS Terraform module
- Docker Compose reference
- Boot-log bootstrap token claim flow
- Invite token member pairing
- Admin session cookies + mandatory recovery token on first login
- Resend email (optional, post-deploy)
- Web UI: team roster, per-member profile, admin settings
- SSE live refresh using solo-edition `LiveRefresher` component

**Not in Doc 1 (deferred to later docs):**

- Tickets / PRs / ticket correlation → Doc 4
- Signal hierarchy / auto-detection / pluggable matcher/enricher → Doc 4
- Per-member Gantt timeline → Doc 3
- Plan utilization / finance view / plan-optimizer → Doc 2
- Insights feed / pattern engine → Doc 4
- History / time-travel view → Doc 3 or 4

## CLI surface for Doc 1

New subcommands added to the existing `fleetlens` binary:

```bash
fleetlens team join <url> <invite_token> [--email <e>] [--name <n>]
    # Pairs the laptop with a team server. Writes ~/.cclens/team.json
    # (mode 0600) containing the server URL, member_id, and bearer token.
    # Optionally prompts for email + display name if not in git config.

fleetlens team status
    # Prints: paired team URL, member_id, last successful sync, queue depth,
    # any recent 4xx errors. Exit code 0 if healthy, 1 if unpaired,
    # 2 if paired but backing off.

fleetlens team leave
    # Calls POST /api/team/leave (new endpoint) which sets members.revoked_at
    # on the server side, then deletes ~/.cclens/team.json. Confirms with
    # the user first (`--yes` skips). Idempotent — if the local file is
    # missing or the server already revoked, exits cleanly.

fleetlens team logs
    # Tails ~/.cclens/daemon.log for team-ingest-related lines.
```

The `fleetlens team leave` endpoint `POST /api/team/leave` is authed by the member bearer, idempotent (returns 200 even if the member is already revoked), and records a `member.leave` event.

## Open questions for Doc 1

1. **Canonical `member.display_name` source**: email local-part? `git config user.name`? First invite form? Daemon proposes a default at pair time, admin can override in Settings — needs a concrete policy.
2. **Daemon bearer token storage on the laptop**: `~/.cclens/team.json` with `0600` permissions is the default. Optional macOS Keychain integration for corporate-managed laptops is a nice-to-have but not v1 blocking.
3. **`fleetlens-team-server` image supply chain**: registry, image signing (cosign?), SBOM publication, CVE scan cadence. Not a v1 implementation concern but a v1 *operational* commitment that needs to be decided before first paying customer.
4. **Custom domain TLS for SaaS**: Caddy automatic Let's Encrypt provisioning is the plan, but the exact architecture (per-team certs in a shared Caddy, or per-team Caddy instances?) needs implementation spec.
5. **Multi-tenant Postgres scaling ceiling**: at what team count does the single-Postgres model need sharding? Not a v1 problem but a v2 roadmap item to track from day one.

## Implementation sequencing within Doc 1

Rough milestones for the implementation plan that `writing-plans` will generate:

1. **Schema + migrations** — all 7 tables, seed script for tests
2. **Ingest API + bearer auth** — `/api/ingest/metrics` with dedup, validation, rollup upsert; tests with a synthetic daemon
3. **Onboarding flow** — claim + invites + join endpoints, bootstrap token generation, recovery token export
4. **Daemon extension** — `fleetlens team join`, queue-and-retry, 5-minute cadence, status command
5. **Web UI shell** — layout, admin session cookie middleware, SSE subscription
6. **Team roster page** — the hero view with member cards and live refresh
7. **Per-member profile page** — drill-down with 30-day chart
8. **Admin settings page** — team profile, members, email, domain, security
9. **Railway template** — 2-service spec, deploy button, docs
10. **Terraform module** — Fargate + RDS + ALB + ACM, examples/basic, docs
11. **Docker Compose reference** — for community tier
12. **End-to-end smoke test** — deploy fresh, pair 3 test daemons, verify roster updates live
