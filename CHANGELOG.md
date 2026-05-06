# Changelog

All notable user-facing changes to the Fleetlens CLI (`fleetlens` on npm) are
recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The team-server has its own log at `packages/team-server/CHANGELOG.md`.

## [0.6.4] — 2026-05-04

### Fixed
- Cached calibration events per-file so `/usage` warm renders complete in well under a second on large session histories.

## [0.6.3] — 2026-05-04

### Fixed
- Dropped poisoned auto-week locks left behind by interrupted runs; backfill now gates on the live pipeline lock instead.

## [0.6.2] — 2026-05-04

### Added
- Daemon now auto-backfills last week's narrative on boot. First successful perception sweep fires the week-digest pipeline if AI is on, the digest isn't cached, entries exist, and no interactive lock is fresh. Opt-out via `ai_features.auto_backfill_last_week`.

## [0.6.1] — 2026-05-04

### Fixed
- Moved `@claude-lens/entries` to devDependencies so the published bundle no longer drags in unused workspace metadata.

## [0.6.0] — 2026-04-30

### Added
- V2 perception layer. Daily, weekly, and monthly digests synthesized from per-session entries via a strict hierarchical pipeline (entry → day → week → month). Past-period digests are immutable on disk; current-period digests use a 10-min in-memory TTL.
- `/insights` route with on-demand week and month digest generation, picker history, and force-regen.
- `fleetlens digest day | week | month [--json]` — CLI surface that reproduces the same digests served at `/insights`.
- `fleetlens entries [--day | --session | --all] [--json]` — inspect the per-session entry primitive.

### Changed
- Renamed "active time" to "agent time" across the dashboard and CLI for clarity.

## [0.4.1] — 2026-04-23

### Added
- Concurrency view on `/parallelism` page. Bursts colored teal for same-project and purple for cross-project (the genuinely interesting fleet-work signal).
- Plan utilization sparkline on the sidebar, fed by the usage daemon's 5-min snapshots.

### Fixed
- Auto-update no longer leaves a zombie web server on the old binary; both server and daemon are torn down before re-exec.

## [0.4.0] — 2026-04-18

### Added
- Usage daemon (`fleetlens daemon …`) polls `/api/oauth/usage` every 5 min and appends snapshots to `~/.cclens/usage.jsonl`. `fleetlens start` and `fleetlens stop` manage server + daemon together.
- `fleetlens usage --history` for inspecting past plan utilization.

## [0.3.0] — 2026-04-10

### Added
- Project rollups with worktree aggregation. Sessions inside `<project>/.worktrees/<name>` roll up under their parent canonical project with a `+N wt` badge.
- Pinned projects in the sidebar (per-browser via localStorage).

## [0.2.0] — 2026-04-01

### Changed
- Active-segment computation now uses all timestamped events (system + summary + sidechain + conversational) instead of conversational-only. Earlier filter undercounted by up to 100x on tool-heavy sessions.

## [0.1.0] — 2026-03-15

### Added
- Initial release. Local-only dashboard for Claude Code sessions: timeline, projects, daily activity bucketing, parallelism detection, per-model cost estimation. Reads JSONL transcripts from `~/.claude/projects/`.
