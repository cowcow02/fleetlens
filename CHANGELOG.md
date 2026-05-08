# Changelog

All notable user-facing changes to the Fleetlens CLI (`fleetlens` on npm) are
recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The team-server has its own log at `packages/team-server/CHANGELOG.md`.

## [0.10.0] — 2026-05-08

### Changed
- **Plan utilization reframed.** High utilization is now "getting plan value" (green); low utilization is "paying for unused headroom" (red). Mirrors how an operator actually looks at the dashboard: the wasteful outcome is paying for a plan and barely touching it, not running near the cap. Applied across `/usage` burndown, gauges, sidebar, and previous-cycles strip.
- **In-progress cycles colored by pace, not peak.** A 50% peak halfway through a 7-day cycle reads on-pace green, not amber — the chart no longer cries wolf on a fresh cycle that just hasn't burnt yet. Completed cycles still use peak tone.
- **Pace label ±15pp band.** "On pace" now covers a ±15pp window around ideal; outside that, label is "below pace" (under-burning) or "may exhaust early" (over-burning). The previous +5/-50 thresholds flipped amber every time the user took a night off.
- **Pace label collapses to three states.** "May exhaust early" / "below pace" / "on pace" — same color tones, one fewer qualifier to read.
- **Wording softened across the utilization views** to describe the pattern rather than judge the user. "Behind schedule" → "below pace"; "on track (+x%)" → "on pace (+xpp vs ideal)".

### Added
- **Conductor multi-agent workspace support.** Sessions inside Conductor's worktree-style agent workspaces (`~/conductor/workspaces/<repo>/<agent>/...`) now group correctly under their parent project, with each agent shown as a separate worktree. Mirrors the existing `.worktrees/` handling.

### Fixed
- Hydration mismatch on `/usage` when pace labels rendered before client mount.

### Notes for operators
- The CLI's team push now ships **only Claude Code usage snapshots** to the team server. Codex snapshots stay local until `plan_utilization` gets a per-agent partition — without one, the team-server's "latest snapshot" pick flips between agents and miscolors the in-progress cycle. Existing rows in `plan_utilization` stay; new pushes are claude-code only.

## [0.9.0] — 2026-05-07

### Added
- **Gemini CLI** as the third agent source. Sessions written to `~/.gemini/tmp/<slug>/chats/session-*.jsonl` are now read, parsed, and rendered alongside Claude Code and Codex. Tool calls (`read_file`, `list_directory`, `glob`, `run_shell_command`, `update_topic`, …) and their results show in the session timeline; thinking blocks, multi-write status replay, `$set` / `$rewindTo` semantics, and the legacy single-JSON file shape all handled. Slug → cwd inversion via `~/.gemini/projects.json`. `✺` glyph + purple accent in the UI.

### Changed
- Session detail timeline drops in-turn idle hatching. Within a turn, every wait — model loading, tool execution, network — is the agent's active time. Only between-turn idle (user reading + composing the next message) renders as hatched.
- Gemini parser anchors `firstTimestamp`, `lastTimestamp`, and `activeSegments` on conversational events only. Login/OAuth `info` records and `metadata.startTime` (file-creation moment) no longer stretch the session bar back to before the first user message.

## [0.7.1] — 2026-05-07

### Fixed
- Cycle-peaks trend no longer renders two bars labeled the same day. When Anthropic's rolling 7-day window slid its anchor between consecutive polls, the daemon's bucketer (hour-rounded) recorded both reset boundaries as distinct cycles. They're now merged within a 12 h tolerance — same fix in `apps/web/lib/cycle-peaks.ts` (used by `/usage`) and in `packages/cli/src/team/sync.ts` (the daemon's team-server push), so both the personal `/usage` chart and the team-server's plan-utilization view stay consistent. 5-hour cycles keep no merge tolerance (their anchor is stable; merging would collapse legitimate distinct cycles).

## [0.6.4] — 2026-05-04

### Fixed
- Cached calibration events per-file so `/usage` warm renders complete in well under a second on large session histories.

## [0.6.3] — 2026-05-04

### Fixed
- Dropped poisoned auto-week locks left behind by interrupted runs; backfill now gates on the live pipeline lock instead.

## [0.6.2] — 2026-05-04

### Added
- Last week's digest auto-generates on launch when AI features are on. Disable in Settings → AI features.

## [0.6.1] — 2026-05-04

### Changed
- Smaller install size — published bundle no longer drags in unused workspace metadata.

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
