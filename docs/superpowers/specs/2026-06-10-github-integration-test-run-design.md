# GitHub integration test run — design

Date: 2026-06-10
Scope: team-server only. Local end-to-end proof that a self-hosted team admin can
connect a GitHub token, sync PRs from a real org repo
(`orbit/agentic-knowledge-system`), and see delivery metrics — including the
AI-assisted vs non-AI split — on the group insights page.

Context: this is the phase-1 "token paste" flow from the integration design
discussion (Datadog AI Impact gap analysis). GitHub App manifest flow, Jira,
webhooks, and the daemon-side commit-SHA join are explicitly out of scope.

## Approach

Token-paste per team, mirroring the existing Resend email-key pattern
(`/api/team/settings/email`): validate against the provider before persisting,
encrypt with AES-256-GCM under `FLEETLENS_ENCRYPTION_KEY`, gate to team admins.
Sync is **polling**, not webhooks — self-hosted instances often have egress but
no ingress. AI attribution for the test run uses `Co-Authored-By` commit
trailers (Claude Code writes them by default), which works with zero daemon
changes; per-session commit-SHA attribution is the later, more precise upgrade.

Alternatives considered: (a) GitHub App manifest flow — better auth but heavier
setup, phase 2; (b) instance-level env-var token — wrong scope, teams map to
different orgs and rotation would need redeploys.

## Components

### 1. Storage (migration `0007_team_integrations.sql`)

`team_integrations` — one row per (team, provider):
- `team_id` FK, `provider` text check `('github','jira','linear')`
- `credentials_enc` text (AES-256-GCM blob, iv:ciphertext:tag — crypto.ts format)
- `config` jsonb — for github: `{ "repos": ["owner/name", …], "sync_days": 60 }`
- `status` text check `('active','error')`, `last_error` text
- `last_sync_at` timestamptz, `created_by` FK user_accounts, `created_at`
- PK `(team_id, provider)`

`github_pull_requests` — synced PR facts, upserted on every sync:
- `team_id`, `repo`, `number` (PK triplet)
- `title`, `author_login`, `state` ('open'|'merged'|'closed')
- `created_at`, `merged_at`, `closed_at`, `first_commit_at`, `first_review_at`
- `additions`, `deletions`, `commits_total`, `commits_ai`
- `ai_assisted` boolean (≥1 AI co-authored commit)
- `synced_at`
- Index `(team_id, merged_at DESC)`

### 2. GitHub client (`src/lib/github.ts`)

- `validateGithubToken(token)` → `GET /user` → `{ login }`, plus per-repo
  visibility check (`GET /repos/{repo}`) when saving.
- `fetchRepoPulls(token, repo, sinceDays)` → GraphQL `repository.pullRequests`
  ordered by `UPDATED_AT DESC`, paginated until `updatedAt < since`. Each node
  carries commits (messages + authoredDate, first 100), first review
  submittedAt, additions/deletions. ~1 API call per 50 PRs.
- Pure helpers (unit-tested): `isAiCommitMessage(message)` — trailer regex for
  Claude / Copilot / Cursor / Codex / Gemini co-authors or bot authors;
  `toPullRow(node)` — GraphQL node → DB row shape.

### 3. Integration lib + routes

`src/lib/integrations.ts`:
- `getIntegration(teamId, provider, pool)` / `saveGithubIntegration(...)`
  (encrypt) / `deleteIntegration(...)`
- `runGithubSync(teamId, pool)` — decrypt token, fetch each configured repo,
  upsert rows, set `last_sync_at` + `status`/`last_error`. Returns
  `{ repos, prs, aiAssisted }` summary.

Routes (all admin-gated via `requireTeamMembership` + `requireAdmin`):
- `GET /api/team/settings/integrations/github?team=slug` — connection status,
  config, last sync, stored-PR counts. Never returns the token.
- `PUT` same path — body `{ token, repos[] }`; 501 without
  `FLEETLENS_ENCRYPTION_KEY`; validates token + repo access before storing;
  fires an initial sync inline and returns its summary.
- `DELETE` same path — removes the row (keeps synced PRs).
- `POST /api/team/settings/integrations/github/sync?team=slug` — manual sync.

Scheduler: hourly `setInterval` calling `runGithubSync` for every
`status='active'` github integration.

### 4. Report surfacing

- `types.ts`: `GithubDeliveryStats` (connected repos; week + prev-week merged
  counts; AI-assisted share; median first-commit→merge hours and
  created→first-review hours, split AI vs non-AI; open count) exposed as
  `live_extras.github_delivery?`.
- `team-report-aggregate.ts`: one query over `github_pull_requests` for the
  report week + previous week; medians computed in TS.
- New `github-delivery` block in `BLOCK_CATALOG` (tier `external-plug-in`),
  rendered in the GroupMomentumReport "Changing how we ship" section; the
  section framing drops the "needs the deferred GitHub integration" caveat when
  data is present. `metric-provenance.ts` entry documents the trailer-based
  attribution honestly (undercounts squash-merges that strip trailers).

### 5. Settings UI

`integrations-panel.tsx` (client) on `/team/[slug]/settings`: token paste,
comma-separated repo list, Connect (PUT), status line (login, repos, last sync,
PR count), Sync now (POST), Disconnect (DELETE).

## Error handling

- Token invalid / repo inaccessible → 400 with the failing repo named.
- Sync failure → integration `status='error'`, `last_error` stored, surfaced in
  settings panel and block footer; next hourly tick retries.
- Missing `FLEETLENS_ENCRYPTION_KEY` → 501 with explicit message (email-route
  precedent).

## Testing

- Vitest: `isAiCommitMessage` trailer matrix, `toPullRow` mapping, median
  helper edge cases (empty, single).
- Local E2E (manual, this session): local Postgres 16 → signup → create group →
  PUT integration with a real `gh` token scoped to orbit → sync → assert DB
  rows → assert the group insights page HTML renders the GitHub block with
  non-zero numbers.

## Out of scope (recorded for the real build)

GitHub App manifest flow; webhook ingestion; session↔commit-SHA join against
daemon rollups; Jira/Linear; change-failure/deploy metrics; PDF inclusion.
