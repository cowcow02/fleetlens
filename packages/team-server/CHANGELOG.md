# Changelog — Team Edition

User-facing changes to the Fleetlens team-server (`ghcr.io/cowcow02/fleetlens-team-server`).
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The personal
CLI has its own log at the repo root `CHANGELOG.md`.

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
