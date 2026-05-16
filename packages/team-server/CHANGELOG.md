# Changelog — Team Edition

User-facing changes to the Fleetlens team-server (`ghcr.io/cowcow02/fleetlens-team-server`).
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The personal
CLI has its own log at the repo root `CHANGELOG.md`.

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
