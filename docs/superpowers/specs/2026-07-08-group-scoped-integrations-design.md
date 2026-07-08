# Group-scoped integrations — design

**Date:** 2026-07-08
**Status:** approved for implementation (driven autonomously per standing direction)
**Scope:** `packages/team-server` only

## Problem

Integrations (GitHub / Jira / Linear) are one-row-per-`(team_id, provider)` —
enforced by the `team_integrations` composite PK — and admin-only. One
privileged account must have visibility over every project in the org, and a
single admin must do all mapping work. Teams whose managers use different
tools, or have visibility over different projects, can't connect their own
accounts. This blocks integration adoption.

## Goal

1. **Many integrations per provider per team**, each with its own credentials,
   label, and source list (repos / Jira projects / Linear teams).
2. **Group managers can connect and manage integrations** from their group's
   settings, without org-admin rights and without seeing anything org-wide.
3. Insight reports keep working, now unioning sources across connections.

Terminology: a row in the new table is an **integration** (the user's word —
the UI drops "data sources" as a tab name). "Sources" remains the word for the
repos/teams/projects *inside* one integration's config.

## Non-goals

- OAuth flows (still token-based connect, per provider, unchanged).
- Per-member integrations (group or org scope only).
- Cleaning up historical stale `group_ids` after group deletion (pre-existing
  behavior; new `owner_group_id` FK does get `ON DELETE SET NULL`).
- Dropping the legacy `team_integrations` table in this release (expand/contract:
  drop lands next release).

## Data model (migration `0015`, expand-only)

The old code path upserts with `ON CONFLICT (team_id, provider)`, so the old
PK cannot be dropped or relaxed while a previous-version container is still
serving. Instead of altering `team_integrations` in place, we create a **new
table** and copy rows — the old container keeps functioning against the old
table during the revision swap; the old table is dropped in the next release
(two-release DROP TABLE pattern from `MIGRATIONS.md`).

```sql
CREATE TABLE integrations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id          uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  provider         text NOT NULL CHECK (provider IN ('github','jira','linear')),
  label            text NOT NULL,
  owner_group_id   uuid REFERENCES groups(id) ON DELETE SET NULL,  -- NULL = org-level
  credentials_enc  text NOT NULL,
  config           jsonb NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','error')),
  last_error       text,
  last_sync_at     timestamptz,
  created_by       uuid REFERENCES user_accounts(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX integrations_team_provider_label_key ON integrations (team_id, provider, label);
CREATE INDEX idx_integrations_team ON integrations (team_id, provider);

INSERT INTO integrations (team_id, provider, label, credentials_enc, config, status, last_error, last_sync_at, created_by, created_at)
SELECT team_id, provider,
       CASE provider WHEN 'github' THEN 'GitHub' WHEN 'jira' THEN 'Jira' ELSE 'Linear' END,
       credentials_enc, config, status, last_error, last_sync_at, created_by, created_at
FROM team_integrations;

ALTER TABLE github_pull_requests ADD COLUMN integration_id uuid REFERENCES integrations(id) ON DELETE CASCADE;
ALTER TABLE linear_issues        ADD COLUMN integration_id uuid REFERENCES integrations(id) ON DELETE CASCADE;
ALTER TABLE jira_issues          ADD COLUMN integration_id uuid REFERENCES integrations(id) ON DELETE CASCADE;
UPDATE github_pull_requests p SET integration_id = i.id FROM integrations i WHERE i.team_id = p.team_id AND i.provider = 'github';
UPDATE linear_issues        l SET integration_id = i.id FROM integrations i WHERE i.team_id = l.team_id AND i.provider = 'linear';
UPDATE jira_issues          j SET integration_id = i.id FROM integrations i WHERE i.team_id = j.team_id AND i.provider = 'jira';
```

Design notes:

- **Fact-table natural keys stay** (`(team_id, repo, number)` / `(team_id,
  identifier)`). Two integrations tracking the same repo upsert the same fact
  rows — no double counting anywhere in reports, because report SQL filters by
  source-name lists, never by integration id. `integration_id` is provenance:
  last sync wins on shared sources.
- **Disconnect deletes that integration's facts** via the FK cascade. If
  another integration also tracks a shared source, its next (hourly) sync
  repopulates — self-healing, acceptable staleness.
- `integration_id` stays **nullable**: rows written by an old-version container
  during the swap window insert without it and are stamped on the next sync
  upsert (`DO UPDATE SET … integration_id = EXCLUDED.integration_id`).
- `group_ids` on each source entry inside `config` keeps its exact semantics
  (`[]` = counts toward every group). **Exception:** a manager-created
  integration defaults its sources to `[owner_group_id]`, not `[]` — a
  manager's connection must not leak into every group's report by default.
- `owner_group_id NULL` = org-level (admin-managed, like today). Non-null =
  owned by that group; its managers hold full control of the connection.
  Deleting the group flips the integration to org-level (`SET NULL`).
- `schema.ts` keeps the `teamIntegrations` definition with a "legacy — dropped
  next release, do not use" comment so drizzle-kit doesn't emit a premature
  `DROP TABLE`.

## Permissions

| Action | Who |
|---|---|
| List / create / manage **org-level** integrations (org settings tab) | admin / staff (unchanged) |
| Create integration **owned by group G** (from G's settings) | admin / staff / manager of G (`requireGroupManager`) |
| Update / delete / sync / reconfigure integration X | admin / staff; if `X.owner_group_id` set, also managers of that group — new helper `requireIntegrationManager(ctx, integrationId)` |
| Toggle which of an integration's sources count toward group G | admin / staff / manager of G (existing `requireGroupManager` semantics, now per-integration) |
| See credentials | nobody (unchanged — write-only) |
| Provider "list my repos/projects/teams" pickers with a **fresh token in body** | admin / staff / manager of ≥1 group |
| Same pickers using a **stored token** (`?id=`) | `requireIntegrationManager` |

A manager never sees other groups' inclusion state, other groups' owned
integrations, or any credential — org-level integrations appear in their group
view only as source lists with per-source "counts toward my group" booleans
(exactly today's data-sources view).

## API surface

Org scope (existing paths, reworked to be id-keyed):

- `GET /api/team/settings/integrations?team=` — **new**: all integrations
  (id, provider, label, owner group, status, last sync, source counts).
- `POST /api/team/settings/integrations/{provider}?team=` — create org-level
  (admin). Body: label, credentials, sources.
- `PUT|DELETE /api/team/settings/integrations/{provider}?team=&id=` — update /
  disconnect one integration (`requireIntegrationManager`).
- `POST …/{provider}/sync?team=&id=` — manual sync (`requireIntegrationManager`).
- `POST …/{provider}/{repos|teams|projects}?team=[&id=]` — pickers, per the
  permission table above.

Group scope (replaces the `data-sources` route; the old path is deleted, its
`applyDesired` logic moves to the new handler):

- `GET /api/team/[slug]/groups/[group]/integrations` — integrations visible to
  this group: org-level ones + this group's own, each with per-source
  `{counts, via_all_groups}` for this group; group-owned ones also carry
  status/last-sync/manage capability flags.
- `POST /api/team/[slug]/groups/[group]/integrations` — manager connect flow;
  body `{provider, label, credentials…, sources}`; created with
  `owner_group_id = group.id`, sources defaulting to `group_ids=[group.id]`.
- `PUT /api/team/[slug]/groups/[group]/integrations/[id]/sources` — toggle
  this group's inclusion per source (ports `applyDesired`).

## Read path (insight reports)

`loadIntegrationConfigs` returns `Row[]` per provider instead of one-or-none.
`scopedSourceNames`, `githubDelivery`, `workTimeline`'s `inScope`,
`linearVelocity`, `jiraVelocity` accept arrays: filter each integration's
sources by `group_ids`, union and dedupe the resulting name/key lists, keep
the SQL `= ANY($names)` unchanged. Ticket↔PR AI-linkage joins stay
team-scoped on purpose — a PR on one connection may legitimately reference a
ticket synced by another. "Last synced" surfaces show the most recent
`last_sync_at` across a provider's connections.

Sync: `syncAllIntegrations` iterates `SELECT id FROM integrations WHERE
status='active'`; each `run*Sync(integrationId)` fetches its own credentials
by id and stamps `integration_id` on upserts.

## UI

- **Org settings → Integrations** (admin, unchanged gating): each provider
  section becomes a list of connection cards + "Add another". Cards are
  today's cards parameterized by `{id, label, ownerGroup}`; group-owned
  connections show an owner badge. GitHub's inline card is extracted from
  `integrations-panel.tsx` into its own component for parity with
  `linear-card.tsx` / `jira-card.tsx`.
- **Group settings modal**: "Data sources" tab renamed **Integrations**.
  Contents: per-integration sections — org-level = source toggles only (as
  today); group-owned = toggles + status strip + sync/reconfigure/disconnect
  + connect forms ("Connect GitHub / Jira / Linear for this group") for
  managers. The empty state stops pointing managers at the admin; it offers
  the connect flow directly.

## Testing

- `test/db/migrate.test.ts` — 0015 creates `integrations`, copies legacy rows,
  backfills `integration_id` on all three fact tables.
- `test/lib` — multi-integration union/dedupe in `scopedSourceNames` and
  velocity scoping; save-with-id keep-token path; manager-default
  `group_ids=[owner]`; `applyDesired` unchanged semantics at its new call site.
- `test/api` — authz matrix: manager can create/manage own-group integration,
  gets 404 on other groups' and 403/404 on org-level manage; admin passes all;
  source-toggle flows across two connections of the same provider.
- Existing tests that seed `team_integrations` move to `integrations`.
- `pnpm -F @claude-lens/team-server test` + typecheck green.

## Rollout

- Ships as team-server `0.15.0` (CHANGELOG entry included in the PR).
- Next release: migration `0016` drops `team_integrations` (tracked, not here).
- No CLI/parser/apps-web changes — zero overlap with the onboarding-wizard
  worktree (verified: that branch touches CLI join/sync/push, local dashboard,
  and two copy strings in team-server components this feature doesn't touch).
