# Changelog

All notable user-facing changes to the Fleetlens CLI (`fleetlens` on npm) are
recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The team-server has its own log at `packages/team-server/CHANGELOG.md`.

## [0.12.1] — 2026-06-15

### Fixed
- **Per-day metrics for cross-midnight sessions.** A session that ran past midnight had its agent time split across calendar days but its tokens, tool calls, turns, and session count pinned to the start day — so on the dashboard (and team rollups) the continuation days showed agent time with 0 tokens / 0 sessions. Each tool call, turn, and token is now attributed to the day its own event happened, and a session counts on every local day it worked. The split is sum-preserving (totals are unchanged) and keeps `sum(per-day tokens) === session total` even across subagents that run past midnight.

### Changed
- **Team push carries a `unique_sessions` count.** Because the per-day `sessions` figure is now "session-days" (a cross-midnight session counts on each day it touched), the daemon also pushes the start-day count so the team-server's roster/header/maturity aggregates keep exact unique-session semantics. Requires team-server ≥ 0.12.3; older servers ignore the extra field.

## [0.12.0] — 2026-06-15

### Added
- **Dynamic workflow visualization.** A single `Workflow` tool call collapses a whole fan-out — 200+ spawned agents — into one opaque transcript row. Fleetlens now reads the aggregate journals Claude Code persists per run and surfaces the real fleet work:
  - **Workflows tab** on the session page (next to Transcript / Team / Debug) with a run-count badge. Each run is a card showing status, spawned-agent count, tool calls, tokens, and duration.
  - **Fleet stat** in the session header (`N workflows · M agents`) plus a spawned-agent badge on session-list cards, so workflow-driven sessions stand out at a glance.
  - **Per-phase action tabs** inside each run — the phases the workflow declared (e.g. Build / Panel / Skeptic / Merge), each listing the agents that ran in that phase.
  - **Full per-agent step log.** Clicking an agent opens a right side-sheet with its Task, the complete ordered step list (every tool call — expand any step for the full multi-line command), and the Result. Loaded on demand so even 100+ step, 200+ agent sessions stay fast; sections are collapsed by default.
  - **Workflow lanes** on the timeline minimap (distinct from subagent lanes); click a lane to open that run in the Workflows tab.
- **Workflow execution counts as agent time.** A run's wall-clock span is folded into the session's "agent time" and carved out of the minimap idle bands, so the stretch where the parent waits on a workflow reads as active fleet work, not dead air.

## [0.11.2] — 2026-05-27

### Changed
- **`fleetlens start` and `fleetlens web` no longer auto-launch the browser.** The dashboard URL is printed so you can click it (every modern terminal makes `http://localhost:…` clickable), but no browser tab opens unless you pass the new `--open` flag. Auto-launch was surprising users whose default browser had moved to a different desktop, was a corp-managed profile they didn't want spawned, or was simply already in flow on another window. The previous `--no-open` flag is still accepted as a no-op — existing scripts and aliases keep working without changes.

## [0.11.1] — 2026-05-21

### Added
- **Team workspace seeding script.** Added `scripts/seed-team-workspace.mjs` for local end-to-end telemetry testing.

### Changed
- **Plan page layout grid consistency.** Enhanced the Team Edition Plan page layout grid consistency and renamed the 'Latest cycle' column to 'Current cycle'.
- **Completed cycles alignment.** Modified the completed cycles strip to show a maximum of 4 historical cycles, padded on the left with empty placeholders for visual right-alignment and grid uniformity.

### Fixed
- **Mini-burndown SVG typings and filtering.** Resolved mini-burndown SVG typings and parameterized cycle strip filtering.
- **Active cycle query performance.** Batched active cycle loads in a single query to eliminate N+1 DB lookups.

## [0.11.0] — 2026-05-21

### Added
- **Team-issued commands to the daemon.** When you've paired with a Team Edition server, a team admin can now queue a 30-day activity backfill against your daemon from the team dashboard. The daemon picks the command up on its next 5-minute sync and re-pushes the last 30 days of daily activity rollups (server upserts, fully idempotent). No member-side UI changes — the existing "last sync N ago" tick on `/settings → Team connection` is the only feedback signal. Commands ride piggyback on the existing `/api/ingest/metrics` response; no new connections, no new polling. The privacy boundary holds: the dispatcher's switch has a single case (`backfill-activity`) and only calls existing aggregate-push helpers, so commands can widen the time window but never change the data shape. No transcripts, prompts, or project content can leak through a command. Always-on when paired (pairing implies consent); no opt-out env var. Requires `team-server v0.9.0+` to actually receive any commands; older servers simply don't issue any (the additive `commandResults` field is ignored, no harm).

## [0.10.6] — 2026-05-21

### Added
- **Team-pairing visibility in the Personal Edition dashboard.** When you've paired with a Team Edition server (`fleetlens team join …`), the dashboard now surfaces what's syncing without you having to open a terminal. A sidebar chip with a health dot (green / amber / red — re-derived client-side every 30 s so it ages correctly even when the daemon stops) and a live-aging "synced N ago" label. A `/settings → Team connection` panel showing team metadata, a labeled last-push preview (Agent time / Session count / Tool call count / Turn count / Token total / Plan tier), an explicit "What does NOT leave your machine" block, and a "Sync now" button that spawns `fleetlens team sync` as a subprocess and renders its output inline. A first-run welcome banner on the overview after pairing, dismissable per pairing. The preview also includes a "Show raw JSON payload" disclosure that displays the literal `IngestPayload` from disk — verify byte-for-byte that no transcripts, prompts, or project content leave your machine. Solo users see no change.

### Changed
- **Wire-format types now live in `@claude-lens/parser`.** `IngestPayload`, `DailyRollup`, `LastPushRecord`, and the rest of the daemon→server wire shape moved out of `packages/cli/src/team/push.ts` so the CLI and the dashboard share a single canonical definition — no drift risk on future schema changes. The CLI's `team-config` module also moved to the parser (`@claude-lens/parser/fs`) for the same reason.

## [0.10.5] — 2026-05-21

### Changed
- **Team backfill now rides the consolidated `/api/ingest/metrics` path.** Same endpoint as the daemon's regular 5-min push, just with the optional `snapshotHistory` field set. Removes the need for a separate path-allowlist entry on deployments fronted by a proxy (IAP, WAF, Cloud Run / GLB path matcher), and as a side-effect the old `/api/ingest/usage-history` route is now a thin deprecation shim. Requires `team-server v0.8.4+` — older servers will return 200 without a `snapshotHistory` result block, and the CLI aborts the backfill loudly rather than silently advancing the high-water mark.

### Fixed
- **Backfill no longer silently advances the high-water mark on an older team-server.** Previously, a server that didn't recognize `snapshotHistory` would return 200 (zod `passthrough()` swallows unknown fields), `runTeamSync` would persist `lastSyncedUsageSnapshotAt` as if all rows landed, and the dropped rows would never be retried after the server upgraded. Backfill now requires an explicit `snapshotHistory` result block in the response.

## [0.10.4] — 2026-05-21

### Fixed
- **Fleetlens's own LLM runs no longer show up in the dashboard.** The tmux-driven runner records its enrichment / digest / `/ask` calls as real Claude Code transcripts under `~/.claude/projects/` (cwd `~/.cclens/runtime`), since tailing that transcript is how it reads the model's reply. Those self-generated sessions were surfacing as a `.cclens/runtime` project and inflating session, project, and token-calibration rollups. The tmux runner now deletes each transcript once the response is captured (kill-session before unlink so claude can't rewrite it, gated by `FLEETLENS_TMUX_KEEP_WRAPPER`), and the parser excludes the runtime project dir at the scan chokepoint as a safety net for any transcript that outlives cleanup.

## [0.10.3] — 2026-05-16

### Added
- **Daemon auto-update every 6 hours.** The local daemon now hourly-checks `registry.npmjs.org/fleetlens/latest` and spawns a detached `fleetlens update` child when a newer version exists. Timestamp persisted in `~/.cclens/daemon-update.json` so closing the laptop lid for days and reopening triggers an immediate catch-up check instead of waiting out the interval. Opt-out via `FLEETLENS_DAEMON_AUTO_UPDATE=0`.

### Changed
- **Unified team sync.** `runTeamSync` now drives history backfill, daily activity, live utilization, queue drain, and tier propagation through a single path. `team join` and the daemon's 5-min tick both call the same function — so a user disconnected from the team server for days will autonomously catch up on next sync, no manual `team backfill` needed.
- New `lastSyncedUsageSnapshotAt` high-water mark in `~/.cclens/team.json` means incremental syncs only ship eligible new snapshots. Cold-start full backfill is bypass-able via `fleetlens team backfill --force` (and still runs unconditionally on first pair).
- Team sync cadence is now independent of Claude OAuth polling, so an expired Claude token can no longer turn team sync into a 5-second retry storm.

### Fixed
- `lastSyncedDay` no longer advances past a failed day on partial outage — previously a transient mid-stream 5xx left a permanent hole in the team-server's daily-activity coverage.
- Both `/api/ingest/metrics` and `/api/ingest/usage-history` POSTs now have a 15-second `AbortSignal.timeout` to bound hangs on network stalls.

## [0.10.2] — 2026-05-15

### Fixed
- **Session-detail minimap no longer paints subagent runtime as idle.** Long agent runs that dispatched many subagents were reading as wall-to-wall "Session idle" stripes because the parent's tool_use → tool_result gap (the subagent's actual runtime) was classified as in-turn idle. `rawIdleBands` now carves subagent run spans out of every candidate gap; for in-turn gaps that overlap any subagent run the entire gap is dropped, and between-turn gaps with background subagent activity keep only the genuinely-unwatched residue.
- **First-response thinking stops registering as idle.** Anchors now include every timestamped event (agent-thinking, meta, etc.), and the loop tracks an "awaiting first response" phase across intermediate thinking anchors. A `user → thinking → thinking → agent` sequence where the model takes a while to compose its first reply is now treated as response latency rather than painted as a stripe.
- **Turn duration no longer shows `0ms` for single-row turns.** `buildMegaRows` now anchors a turn's `tOffsetMs` and `durationMs` at the originating user message rather than at the first agent row. Single-row turns show the actual user → agent latency, and the visual span of the turn rectangle on the minimap covers the whole arc.
- **Single `Session idle` divider per band.** A user row and the turn-collapsed row that follows it now share a `tOffsetMs`, so the body's `IdleDivider` emitter dedupes per band to stop two consecutive identical idle markers around the same boundary.

### Changed
- Minimap idle threshold raised from 10s to 30s. Ordinary tool latency (slow Bash, big-file Read, between-anchor model thinking) no longer registers as idle.

## [0.10.1] — 2026-05-14

### Added
- **Alternative claude runtime via tmux.** When `tmux` is on PATH, both the LLM pipeline (digest synth, entry enrichment, top-session perception) and the `/ask` feature now drive `claude` through a detached tmux session instead of `claude -p`. Sessions produced this way carry `entrypoint: cli` in their JSONL, which is also extracted by the parser and surfaced as a small badge on `/sessions/<id>` next to the model chip — green for `cli` / `claude-desktop`, amber for `sdk-*`. The path falls back to `claude -p` whenever tmux is unavailable or the run errors; set `FLEETLENS_FORCE_PRINT_MODE=1` to disable the tmux path entirely.
- **`CCLENS_HOME` env override.** All `~/.cclens/` state (pid file, daemon log, perception state, usage snapshot log, llm-runs traces) is now reached through a shared `cclensHome()` helper that honors `CCLENS_HOME`. Lets multiple installs / workspaces run side-by-side without stomping on each other's state.

### Fixed
- `/api/runs` rendered every successful tmux-driven run as `status=error`. Tmux runs have no subprocess exit code (the session is killed by cleanup), and the runs viewer was treating a missing code as failure. End records now stamp `exit_code: 0` on success and the active-process filter no longer requires the literal `claude -p` flag, so tmux-driven processes also show up in the "active" panel while they're running.
- `JobQueueWidget`'s `/api/jobs` polling effect listed `jobs` in its deps, so each tick re-armed the effect on the freshly-set state ref — effective cadence collapsed to a 1–4 ms refetch loop. Now tracks `hasActive` in a closure-local var and runs the effect once on mount.

### Conductor
- New `conductor.json` + `scripts/conductor-{setup,run,archive}.sh` so each Conductor workspace allocates its own 3-port band (web / team-server / postgres) and boots its own `fleetlens-<workspace>` Compose stack against `.harness/cclens-state`. Replaces ~30 hard-coded `join(homedir(), ".cclens", …)` call sites with the shared `cclensHome()/cclensPath()` helper so a second workspace can boot without colliding with the user's primary install.

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

## [0.7.0] — 2026-05-06

### Added
- **Multi-agent observability — Codex as the first non-Claude adapter.** The parser now defines an `AgentSource` registry; new agents land as a single file plus one registry entry. Codex CLI rollouts at `~/.codex/sessions/` flow through the same pipeline as Claude Code: their sessions appear in the dashboard, timeline, calendar, and per-project rollups alongside Claude sessions, with `agent: "codex"` carried through every event so consumers can split or aggregate.
- **Per-agent representation in the UI.** Each session row carries an agent badge; top-sessions guarantees a multi-agent representation when both agents are active; the Gantt rail uses a per-agent glyph and outcome pills.
- **Usage page is now agent-tabbed.** Switch between Claude and Codex views; cross-agent comparisons stay readable rather than smashed onto a single chart.
- **Codex sessions blend into the day + week digest narratives** so the insights pipeline summarises across agents instead of treating Codex as a footnote.
- **`fleetlens` → "Ask"** (agent-neutral). Previously labelled "Ask Claude"; the underlying prompt-routing stays Claude-backed, but the surface name no longer implies single-agent.

### Changed
- Dashboard default time range moved to **90 d** to match how multi-agent fleets actually use the tool — week-only views were truncating Codex activity that lands in week-old session files.
- `AgentSource` interface opened up so future agents (OpenCode, Gemini CLI, …) are pure additive plug-ins; no parser core changes required.
- Daemon auto-backfills *yesterday's* day digest on boot when `ai_features.auto_backfill_yesterday` is on, so `--no-daemon` users still get a yesterday digest on first homepage visit.

### Fixed
- **Codex calibration math no longer pollutes the Claude window.** Non-Claude snapshots are excluded from the Claude-side cycle-peaks calibration that drives plan-fit advice — previously a Codex-heavy run skewed the projected exhaustion line.
- **Minimap idle bands** are now derived from raw event timestamps (not row kind) and coalesced per turn, so Codex sessions with sub-minute back-and-forth no longer paint as wall-to-wall idle.
- Sessions filter state preserved in the URL so refresh / share doesn't lose the active filter.
- `/insights` persists forced current-week digests so the page actually shows them on next load.

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
