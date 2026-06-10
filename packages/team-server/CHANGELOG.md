# Changelog — Team Edition

User-facing changes to the Fleetlens team-server (`ghcr.io/cowcow02/fleetlens-team-server`).
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The personal
CLI has its own log at the repo root `CHANGELOG.md`.

## [0.12.2] — 2026-06-10

### Fixed
- **Update check could not see new releases.** The GHCR tags list is paginated at 100 tags (creation order, newest last); the checker read only the first page, so "Check for updates" froze at an old version (v0.10.0) and never offered anything newer. The checker now follows the pagination chain. **Instances running ≤ 0.12.1 carry the broken checker and need one manual redeploy to this version; self-update works again afterward.**

## [0.12.1] — 2026-06-10

### Security
- **Team-wide insight surfaces removed; insights are group-scoped only.** The team-wide `/team/[slug]/insights` page (and its `/preview` + `/preview/archive` mock routes) rendered every member's L0–L4 maturity portrait — names, level, coaching prose — to *any* team member, with no admin/manager check and no coaching toggle, including via the team-wide PDF export. All three routes are gone; insights now live exclusively at `/team/[slug]/groups/[group]/insights`, where access was already guarded to admin/staff or the group's manager and portraits stay stripped unless `?coaching=1`. `/report/[slug]` and the PDF route now require `?group=` and 404 without it. **If you bookmarked the team-wide insights URL, use your group's insights page instead.**
- **`/report/[slug]` no longer answers browser sessions.** The page exists only as the PDF render target; the export route now mints a short-lived HMAC token over the exact report scope and `/report` 404s without it — even for admins. The token key derives from `FLEETLENS_ENCRYPTION_KEY` when set (set it if you run more than one replica, or PDF export will fail intermittently); session + role checks remain as defense in depth.

## [0.12.0] — 2026-06-03

### Added
- **Per-group momentum dashboard.** `/team/[slug]/groups/[group]/insights` renders a focused, group-scoped momentum report (Game Plan v3) reframed around the three adoption questions — using it / getting better / changing how we ship — aggregate-first. A 4-week momentum trend leads (the primary read for small groups, over noisy single-week WoW), followed by active-rate (7d/30d), week-over-week pulse tiles, the L0–L4 maturity mix, per-member portraits behind a guarded `?coaching=1` toggle, and a downgrade-only seat right-sizing lens. Reached by URL only (not nav-linked); per-group PDF export plus an `?explain=1` provenance overlay and `?mock=1` roster-only data mode are included.
- **Historical insight reports.** Team and group reports — and their PDFs — now accept `?week=<Monday>` and show prev/next week navigation on the report header, bounded by the earliest week with data through the last completed week. Each week is computed live from `rich_daily_rollups`; nothing is persisted, and a bad/blank/future `?week=` falls back to the last completed week.

### Changed
- **Per-project & skill paired-bars cleaned up.** Per-project rows show the short repo-leaf label (full path on hover) instead of an overlapping absolute path, and same-repo-across-harnesses rows fold into one. Week-over-week deltas that divided by ~zero now render as `new` / `gone` / `—` instead of nonsensical percentages, and both the per-project and skill bars drop rows that were idle this week. Deferred tool-loading (`ToolSearch`) no longer shows up as a "skill," de-noising the skill bars and the maturity breadth axis.

### Fixed
- **Members-active header.** The report header counted the full left-joined roster, showing a misleading `N/N`; it now counts only members with agent time in the displayed week (group page and `/report` PDF).
- **Explain banner.** `?explain=1` on a real-data view no longer claims the dashboard is "representative mock data" — that wording now only appears in mock mode.

## [0.11.0] — 2026-05-29

### Added
- **Real-data team insight report (v8 framework-aligned).** The live `/team/[slug]/insights` page now builds from `rich_daily_rollups` via `buildTeamInsightReport()` instead of mock data, defaulting to a starter block set keyed to the three adoption pillars (usage / getting better / impact): active-rate (7d/30d), per-member maturity portraits, team-pulse WoW, PRs shipped + per active engineer, per-project time, skill usage, and long-autonomous turn texture. The mock report stays available at `/team/[slug]/insights/preview` as a reference.
- **Per-member L0–L4 maturity portraits (v9).** Each member is placed on the L0–L4 adoption ladder (L0 Unaware → L4 Multiplier) from their trailing-30-day signals, with an audit-friendly cadence / breadth / harness-authorship stat strip, qualifying-path and growth-edge chips, and decisive / supporting / near-miss observations. Working-style notes are shown separately and explicitly never grade the level.
- **Real L4 classifier.** A personal-side file-system probe (counts of authored skills / sub-agents / slash-commands and net CLAUDE.md line deltas, shipped as SHA-256 path hashes only — never raw paths or content) feeds new `day_artifact_signals` rows; `team_skill_catalog` reconciliation tracks cross-member adoption. L4 "Multiplier" now fires on real authored-artifact counts and/or verified cross-member adoption rather than a synthetic flag.
- **PDF export points at live data by default.** `GET /api/team/[slug]/insights/pdf` and `/report/[slug]` render the live report; `?source=preview` reproduces the mock reference.

### Changed
- The new insight report and maturity portraits are reachable by **direct URL only — not linked from the team navigation** — so the existing roster / plan / groups experience is unchanged for current users while these dashboards are iterated on.

### Database
- New migration `0006_day_artifact_signals.sql` — **additive only, no existing tables altered.** Adds `day_artifact_signals` (per-member, per-day authored/edited skill, sub-agent and slash-command arrays plus `claudemd_line_delta`, keyed on `(team_id, membership_id, day)`) and `team_skill_catalog` (per-team `path_hash` with monotonic originator + adopter-set tracking for cross-member adoption). Both cascade from `teams` and `memberships`.

## [0.10.0] — 2026-05-21

### Added
- **v7 Insight Report builder.** New report page at `/report/[slug]` with a drag-and-drop, width-snapped (25/50/75/100%), masonry-packed block builder. Widgets are sortable via `@dnd-kit`, resize from a right-edge handle, and content-driven heights are tracked per cell via `ResizeObserver`. Inline `[+]` buttons let users insert structural blocks (divider, title, text) between widgets; dividers force page breaks in PDF mode. Layout state is debounce-persisted to `localStorage` under `fleetlens-builder-v7:<slug>`.
- **Server-rendered A4 PDF export.** New `POST /api/team/[slug]/insights/pdf` route launches headless Chromium via Playwright, seeds the builder layout into `localStorage` before navigation, captures at a 794×1123 viewport with zero PDF margins, and returns the file as a download. Replaces the browser's print dialog (which produced unusable landscape output and ignored masonry).
- **Hidden mock preview routes.** `/team/[slug]/insights/preview` is a shareable mock of the prime report (not linked from nav); `/team/[slug]/insights/preview/archive` keeps v0–v6 prototype variants behind a tabstrip so previously explored metric ideas remain discoverable.
- **Compact report header.** `ReportHeader` renders FLEETLENS · INSIGHT REPORT eyebrow, team name in italic serif, ISO week range, active-member / agent-hours stats, full roster, and generation date — identical between the web view and the PDF capture.
- **Bridge Personal → Team (Phase 1).** Daemon now pushes rich per-day rollups derived from cached Entries (project breakdowns, working shapes, skills, subagent dispatches, plan-mode usage, brainstorm warm-ups, PR/commit/push counts, long-autonomous stats) alongside the existing headline rollup. Live `/team/[slug]/insights` page is backed by `rich_daily_rollups` instead of mock data; same surface available group-scoped under `/team/[slug]/groups/[group]/insights`. Members opt in via the new `/team` consent page (existing memberships stay paired; toggling privacy on a project removes future project labels from the push).

### Changed
- **Cross-midnight session bucketing.** Rich rollup `projects[].agentTimeMs` and parallelism bursts are now clipped to each touched local day, matching the headline `dailyRollup.agentTimeMs` split semantics. Previously a session spanning 11 PM → 1 AM attributed its full agent time to the start day and was missing from the next day's project breakdown.
- **Live insights footnote** now links to `/team/[slug]/insights/preview` (block-builder reference) instead of a `?v=7` query param that 404'd back onto the live page.

### Database
- New migration `0005_rich_daily_rollups.sql` — `rich_daily_rollups` table keyed on `(team_id, membership_id, day)` with JSONB blocks for project breakdowns, working-shape histograms, skills/subagent rollups, and aggregate counters. Cascades from `teams` and `memberships`. Added to `_journal.json` so `scripts/seed-team-demo.mjs` and other journal-driven paths apply it alongside Drizzle's runtime fallback.

## [0.9.0] — 2026-05-21

### Added
- **Admin-issued commands to member daemons.** A new "Request 30-day backfill" button on the member detail page lets a team admin queue a command that re-pushes the member's last 30 days of daily activity rollups. The member's daemon picks it up on its next 5-minute sync, executes serially against the existing aggregate-push helpers (no transcripts, prompts, or project content can leak through), and reports completion back via the existing ingest channel. Server-side dedup: an identical pending command (same type + same params) returns the existing row instead of creating a duplicate. Capped at 10 pending commands per ingest response. Requires `fleetlens v0.11.0+` on the member side; older CLIs ignore the `commands` field in the response and the command stays pending until the member upgrades.

### Changed
- **`/api/ingest/metrics` response now carries pending member commands.** Additive — older daemons that don't look at `commands` simply don't dispatch anything. Symmetrically, `commandResults` is a new optional field on the incoming payload; the server marks the corresponding `member_commands` rows complete when it sees them.

### Database
- New migration `0005_member_commands.sql` — `member_commands` table with `(membership_id, completed_at)` partial index for pending lookup and `(team_id, issued_at DESC)` for any future admin history view. Cascades from `teams` and `memberships`; `issued_by_id` has no cascade (audit trail).

## [0.8.6] — 2026-05-21

### Added
- **Reusable invite share links.** One link onboards the whole team — every redemption mints a fresh membership without consuming the link. Active links are listed in team settings with redemption counts; managers can revoke at any time. Dedup rule: at most one active link per `(role, group_set)` config per team — creating a duplicate returns 409 with a "revoke first" prompt.
- **Per-team email-domain allowlist.** New "Sign-up policy" section in team settings accepts a comma-separated allowlist (e.g. `acme.com, acme.io`). New sign-ups via invite link or `/api/team/join` must match. Empty = no restriction (previous behavior). The 403 returned on mismatch is intentionally generic and does **not** echo the configured domains.
- **Admin-only visibility for admin-role invites.** A new `isInviteInManagerScope` predicate gates both the GET `/api/team/[slug]/invites` listing and the revoke endpoint: non-admin callers never see admin-role links or team-default links (those carry the highest privilege and are admin/staff-only). Previously a manager of group X could have listed and copied the plaintext token of an admin-role link scoped to {X} and self-elevated.
- **`POST /api/team/[slug]/invites/[id]/revoke`** for explicit link revocation. Authz mirrors the list endpoint (admins/staff can revoke any; managers can revoke member-role links whose `group_ids` is a non-empty subset of theirs).
- **`GET /api/team/[slug]/invites`** lists active links scoped to the caller's visibility, including `token`/`joinUrl` for re-copy and a derived `redemptionCount`.
- **Proper in-app modals** for invite creation and revoke confirmation on both the admin settings and group-manager invite pages. Replaces an inline form (whose group multi-select wasn't responding to clicks) and `window.confirm()`. Group chips toggle visibly, the Copy action shows a "COPIED!" pulse, and Revoke routes through a dismissable modal.

### Changed
- **Allowlist enforcement is shared between `/api/auth/signup` and `/api/team/join`.** A new `denySignupForTeamDomain` helper is the single gate; previously the allowlist could be bypassed by an already-registered outside-domain user hitting the join route directly with a leaked multi-use token.
- **Action buttons in the active-links list are borderless link-style** (Copy link / Revoke), in line with the table-row aesthetic. Less visual ticker noise next to the data.
- `redeemInvite` distinguishes single-use (email-scoped) invites from multi-use share links via `email IS NULL`: single-use auto-revokes on first redemption; multi-use stays open until an admin revokes.
- Allowlist lookup short-circuits at the SQL layer (`cardinality(allowed_signup_domains) > 0`) so the common empty-allowlist case adds no round-trip to the signup hot path.

### Migration
- `0005_multi_use_invites.sql` adds `invites.token` (plaintext, for re-display in the admin UI; `token_hash` remains the canonical lookup), `invites.revoked_at`, `invites.label`, and a partial index on `(team_id, role) WHERE email IS NULL AND revoked_at IS NULL`. Also adds `teams.allowed_signup_domains text[] NOT NULL DEFAULT '{}'`.
- **Pre-upgrade invites are blanket-revoked** via `UPDATE invites SET revoked_at = now() WHERE revoked_at IS NULL`. Recipients of an unredeemed invite need a fresh one; this trades a one-time recreate cost for a clean slate with no hash-only zombies in the new admin list UI.

## [0.8.5] — 2026-05-21

### Changed
- **`/team/<slug>/groups` is now self-maintainable.** The page absorbed everything from the old admin-only `/team/<slug>/settings/groups` (which is removed): create new groups, rename, delete, add/remove members, toggle the group-manager flag. The Groups link in `/settings` now points at `/groups` itself.
- **Editorial redesign of the Groups page.** GROUP / NN eyebrow, italic-serif group names that are themselves links to the roster, slug pill, italic-numeral member/manager counts, prominent terracotta "Open roster →" CTA per card, `•••` overflow menu (Rename / Delete) instead of equal-weight buttons. Sidebar order changed to Roster / Plan / Groups / Settings.
- **Create new group is a modal.** A `+ Add new group` button in the top-right of `/groups` opens a Compose modal: display name, slug (auto-derived from name until edited), and an optional searchable multi-pick of members to place at creation time. Each selected member gets a per-row ☆ Member / ★ Manager pill — tap to promote individuals.
- **Invite-to-group is a modal.** Per-card `+ Invite someone` opens an inline invite modal with email + place-in-groups multi-select (source group locked-checked) + copyable result link. The old `/team/<slug>/groups/<g>/invite` page is kept for the non-admin manager path.
- **Add members modal with per-row manager pick.** Per-card add affordance is a dashed `+ Add members · N available` button that opens a modal hosting the same picker + per-row ☆/★ toggle.
- **Two-click confirm for removing a group member.** First × click morphs the button into a red `CONFIRM ×` pill with a soft pulse; auto-dismisses after 4 s. Group deletion still uses native confirm.
- **Rolling 7/30/90-day roster windows.** Replaced the Monday-start week bucket with the same rolling `today + N−1 prior calendar days` cutoff used by the local dashboard, so 7d totals now match between the personal and team views. The team roster and group detail pages gain a `7D / 30D / 90D` toggle (`?range=` URL param, default `7d`); `/api/team/roster` honors the same parameter. Helpers renamed: `weekStartIso` → `rangeStartIso(days)`, `loadRoster(teamId, pool)` → `loadRoster(teamId, days, pool)`, `loadGroupRoster(groupId, pool)` → `loadGroupRoster(groupId, days, pool)`, `week_*` → `range_*`.
- **Range toggle on the member Daily activity chart.** `/team/<slug>/members/<id>` gains the same `7D / 30D / 90D` segmented control, scoped to just the "Daily activity" chart + "Daily breakdown" table so admins can widen or narrow the per-day exploration without disturbing the cycle-anchored plan-fit block above. Default is `30D` on this page to match the plan-fit context; the 30-day header card stays pinned regardless of toggle, and its labels were renamed from "30-day engagement / agent time / sessions / tokens" to "Last 30 days · …" for clarity.

### Fixed
- **Back navigation no longer breaks Groups page interactivity.** Switched the in-app links on `/groups` from plain `<a href>` to `next/link` so the React tree stays hydrated when the user navigates `/groups → /groups/<slug> → back`. Previously the kebab menu and add-member control silently stopped responding until a hard refresh.
- **Member chart range now agrees with the roster card.** `loadMemberRollups` was computing its cutoff from `Date.now() - days * 86400000` (UTC-anchored) while `loadRoster` / `loadGroupRoster` used `rangeStartIso` (local-midnight anchored). At noon UTC the two could land on different calendar dates, so the member chart could show one extra/fewer day than the roster card for the same selected range. Routed through `rangeStartIso` for a single cutoff calculation.
- **Range toggle preserves scroll position.** `router.replace` defaulted to scrolling to top, which yanked the chart out from under the cursor that had just reached for the button. Passed `{ scroll: false }` since the toggle is a chart-zoom action, not a navigation.

## [0.8.4] — 2026-05-21

### Added
- **Consolidated daemon→server ingest path.** `/api/ingest/metrics` now accepts an optional `snapshotHistory: WireUsageSnapshot[]` field, processed by the same `processIngest` handler as the rest of the daemon payload. The older `/api/ingest/usage-history` route remains as a thin shim around the consolidated handler for older CLIs. New CLIs (`fleetlens@0.10.5`+) route their backfill batches through `/api/ingest/metrics`, so deployments fronted by a path-allowlist proxy (IAP, WAF, Cloud Run / GLB path matcher) no longer need a separate allowlist entry for backfill — anything the daemon ever wants to forward rides on the one already-allowlisted path. Past incident: backfill silently 401'd at the proxy layer for ~3 weeks on one deployment because the new route was never added to the bypass list; the user-visible symptom was a "COLLECTING DATA" badge on the plan-utilization panel that never cleared.

### Changed
- **Snapshot-history writes are one round-trip per HTTP batch instead of 500.** `processIngest` now uses a single multi-row `INSERT ... ON CONFLICT DO NOTHING` for the snapshot batch (with intra-batch dedup on `captured_at` to sidestep PG's cardinality-violation rule). On managed-Postgres deployments with non-trivial RTT this is a several-seconds-per-batch win that also shortens the held-transaction window.

## [0.8.3] — 2026-05-21

### Fixed
- **Stale "update available" banner after an upgrade.** `/admin/updates` could show "Team-server vX.Y.Z is available. You're running vX.Y.Z." immediately after an image upgrade and stay that way until the next scheduled check. `getStatus()` was reading `current_version` live from the running process but trusting the cached `update_available` boolean from the previous check. It now recomputes the flag against the live version using the same `semver.gt` rule as the scheduled check, so the banner clears on the next page load.

## [0.8.2] — 2026-05-21

### Fixed
- **Re-inviting an existing user no longer 409s.** An admin can now send a fresh invite (e.g. promoting a member to admin) to someone who already has an account. The invitee uses their existing password to redeem; wrong password returns 401 with actionable copy. Previously the duplicate-email check rejected the signup attempt before the invite was redeemed.
- **Role updates land on re-invite.** `redeemInvite`'s `ON CONFLICT` clause now updates `role` via a CASE: post-revoke rejoin respects the invite's role, active admins are never silently downgraded by a member-role invite, and member→admin upgrade works.
- **Reactivate path for revoked members.** New admin-only `PATCH /api/team/members/[id] { reactivate: true }` flips `revoked_at` and mints a fresh device token. Rejected for already-active members so a stray PATCH can't silently rotate a working daemon's bearer token. UI: revoked rows in `/team/<slug>/settings` show a **Reactivate** button that inline-displays the new `fleetlens team join` command.

### Healing previously-bugged state
Existing stuck installations need no manual SQL — a previously-bugged "stuck" member just clicks their unused admin invite again; a revoked user takes one admin click to come back.

## [0.8.1] — 2026-05-16

### Added
- **Team groups & manager-scoped visibility.** Admins can create named groups (e.g., "Platform Squad", "Growth Team") and place members into them. A group member with `is_manager = true` becomes a manager of that group — they see only their group's members on the dashboard and can invite new people into groups they manage. Plain members continue to see only their own profile.
- **Group affiliation chips** on the admin roster, with a ★ marker for group managers.
- **`/team/<slug>/groups`** picker and **`/team/<slug>/groups/<group>`** detail pages with their own roster grid and an "Invite to this group" action.
- **`/team/<slug>/settings/groups`** for admin group management (create, rename, delete; add/remove members; toggle the manager flag).
- **Admin invite form** gains an optional "Place in groups" multi-select; the placement is carried server-side on the invite and applied on redemption.
- **Manager invite form** at `/team/<slug>/groups/<group>/invite` with role locked to member, current group pre-checked and disabled, only manager-managed groups selectable.

### Changed
- `requireAdmin` route helper now honours `is_staff`; staff users who are regular members of a team can manage group state.
- `addGroupMember` no longer takes an `isManager` option — add and promote are distinct operations, so an idempotent re-add cannot silently change the manager flag.
- Manager invite endpoint returns the same response shape as the admin invite (`{ inviteId, joinUrl, tokenPlaintext, expiresAt }` at 201).

### Migration
- `0004_team_groups.sql` adds `groups`, `group_members`, and an `invites.group_ids uuid[]` column. Purely additive — no changes to `memberships.role`, no backfill required.

## [0.8.0] — 2026-05-08

### Changed
- **Plan utilization reframed across the team views.** High utilization now reads as "getting plan value" (green); low utilization is "paying for unused headroom" (red). Same flip as the personal edition. Member detail page, plan view, and member-burndown chart all updated.
- **In-progress cycles colored by pace, not peak.** A 50% peak halfway through a 7-day cycle reads on-pace green, not amber. Completed cycles still use peak tone.
- **Pace label ±15pp band.** "On pace" covers a ±15pp window around ideal. Outside the band: "below pace" (under-burning) or "may exhaust early" (over-burning). The previous +5/-50 thresholds flipped amber every time the user took a night off.
- **Pace label collapses to three states.** "May exhaust early" / "below pace" / "on pace" — same color tones, one fewer qualifier to read.
- Wording softened across the utilization views to describe the pattern rather than judge the user.

### Internal
- `advisory-tone.ts` extracted so `member-plan-block.tsx` and `optimizer-card.tsx` share one `AdvisoryTone` + `advisoryColor()` lookup. Distinct from `utilization-tone.ts`: utilization tone is "% used" (3 states); advisory tone is "what the operator should do about this" (4 states, including non-actionable info).

### Compatibility note
The CLI now ships only Claude Code usage snapshots to the team-server (Codex stays local). Existing `plan_utilization` rows from older CLI versions remain; nothing to do server-side. Once `plan_utilization` gets a per-agent partition, the CLI filter can lift.

## [0.7.4] — 2026-05-07

### Fixed
- `_journal.json` now lists `0003_membership_cycle_peaks` (the planned 0.7.3 edit didn't make it into the bundled image, so production kept relying on the dir-scan fallback to apply the migration on every boot). With the journal correctly listing all four entries, drizzle's normal migrator path handles 0003 directly — the fallback stays as a safety net but no longer fires under normal operation.
- Trimmed the boot-time `[migrate-debug]` per-row hash dump that v0.7.2/0.7.3 emitted on every restart. Replaced with a one-line summary (`[migrate] before/after drizzle — applied=N expected=N pending=N`) plus the existing fallback warnings only when something exceptional happens.
- `scripts/version-sync.mjs` no longer accidentally bumps `packages/team-server/package.json` from the root `npm version` script. Comment in the file already said this was intentional; the targets array contradicted it. The CLI track and team-server track are now genuinely independent.

### Notes for operators on legacy deployments
If your team-server image predates the in-app updater (anything before `server-v0.5.0`), bootstrap by manually rolling once:

```sh
gcloud run services update <SERVICE-NAME> \
  --region=<REGION> \
  --image=ghcr.io/cowcow02/fleetlens-team-server:0.7.4
```

After that, future updates appear in **Server admin → Updates** and ship via the in-app **Apply** button — no shell access needed thereafter.

## [0.7.3] — 2026-05-07

### Fixed
- `0003_membership_cycle_peaks.sql` now actually applies on production. Diagnostics from v0.7.2 revealed the root cause: when the migration was added (commit `60f92e2`, 2026-04-29), `drizzle-kit generate` was not run, so the SQL file was committed without a corresponding entry in `_journal.json`. Drizzle's migrator reads the journal — only 3 entries, all already applied — and reported "complete" without ever touching 0003. The journal now includes the missing entry with the migration's actual creation timestamp.
- Hardened the fallback applier to **scan SQL files directly** (not just journal entries) so any future migration committed without `drizzle-kit generate` still gets applied. Logs `[migrate] orphan SQL files not in _journal.json: …` if any are detected.

## [0.7.2] — 2026-05-07

### Fixed
- Self-healing migration runner. v0.7.1 correctly resolved the migrations folder path on production, but drizzle's `migrate()` still returned in 449ms without applying `0003_membership_cycle_peaks` — implying the production `drizzle.__drizzle_migrations` tracking table is in a state where drizzle thinks everything is already applied even though tables are missing. The runner now: (1) logs the full applied-vs-expected hash diff before and after drizzle's own pass for forensic visibility, and (2) **manually applies any expected migration whose hash isn't in the tracking table** after drizzle finishes. Idempotent — if drizzle does its job, the fallback finds nothing to do. If schema already exists (e.g. test-environment tracker resets), it records the hash without re-running the DDL.

## [0.7.1] — 2026-05-06

### Fixed
- Database migrations now actually ship with the production Docker image. Earlier releases unintentionally excluded the SQL files from the Next.js standalone bundle, so the startup hook reported `[instrumentation] migrations complete` without applying anything. Migrations introduced from v0.6.0 onward (e.g. `0003_membership_cycle_peaks`) silently skipped on every Cloud Run deploy, leaving production schemas drifting behind the running code.
- `migrate.ts` now resolves the migrations folder against `process.cwd()` as well as the source `__dirname`, and **throws loudly** if `_journal.json` isn't found at either candidate. Future bundling regressions will fail boot loudly instead of pretending success.

## [0.7.0] — 2026-05-06

### Added
- In-app `/changelog` route with hand-curated release notes; reachable from the team nav under About, with a red dot when an unread version exists.
- Server-update notice now surfaces inside the team Settings page (admin-only) instead of a global page banner. Operators see current vs. latest version, "Last checked" time, and a "Review update →" link to the existing review screen.

### Changed
- Unified left-nav across team, admin, and changelog pages: TEAM / SERVER ADMIN (staff only) / ACCOUNT sections in the body, email + Changelog · Sign out footer cluster, full-width divider above the footer.
- `/admin/updates` and `/admin/staff` share the team-shell chrome rather than carrying their own bespoke masthead and nav.
- App shell bound to viewport via flex-column body — only the main pane scrolls, footer is always reachable without scrolling.

### Fixed
- Server-update review screen at `/admin/updates/<version>` now filters out migrations already applied to the running database. An operator on v0.6.0 reviewing v0.6.3 sees "1 new migration" instead of the previous misleading "4 migrations".

## [0.6.3] — 2026-05-04

### Changed
- Plan utilization view follow-up polish on the Finance dashboard.

## [0.6.2] — 2026-05-04

### Fixed
- Snapshot ingestion correctness fixes for the plan-utilization pipeline.

## [0.6.1] — 2026-05-04

### Fixed
- Self-update review screen no longer crashes when no migrations are pending.

## [0.6.0] — 2026-04-30

### Added
- Plan utilization end-to-end: Finance dashboard, member burndown chart, optimizer card, plan-tuning form. CLI clients ingest 5-min snapshots into the team-server, which aggregates per-member, per-team views.
- Member profile page with personal burndown sparkline and per-tier configuration.

## [0.5.6] — 2026-04-24

### Added
- GCP Artifact Registry remote repository for mirroring GHCR images, so Cloud Run deployments don't burn cross-cloud egress on every cold start.

## [0.5.5] — 2026-04-23

### Changed
- Bumped to demonstrate the self-update button against a real version delta.

## [0.5.4] — 2026-04-23

### Fixed
- GHCR anonymous token exchange for the tags-list API; self-update now correctly discovers newer versions.

## [0.5.3] — 2026-04-23

### Changed
- Bumped to demonstrate the self-update button against a real version delta.

## [0.5.2] — 2026-04-23

### Fixed
- GCP Cloud Run adapter now derives image repo from the current spec instead of from a hard-coded path.

## [0.5.1] — 2026-04-22

### Changed
- Bumped as a target for the self-update button demo.

## [0.5.0] — 2026-04-22

### Added
- Self-update UI: staff users see an "Apply v…" review screen at `/admin/updates/<version>` showing migrations to be applied, with a one-click apply for supported platforms.
- Platform adapters for Railway and GCP Cloud Run.
- Staff management surface.

## [0.4.0] — 2026-04-15

### Added
- Versioning decouple from the personal CLI track; team-server now ships under `server-v*` tags with a self-contained `package.json`.
- Drizzle-managed migrations under `src/db/migrations/` with the expand/contract workflow documented in `MIGRATIONS.md`.
- GCP Cloud Run one-click installer.

## [0.3.0] — 2026-04-01

### Added
- Initial team-server release. Multi-tenant team accounts, member onboarding, CLI pairing flow, snapshot ingestion endpoint, basic team roster + settings views.
