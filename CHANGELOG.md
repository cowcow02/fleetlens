# Changelog

All notable user-facing changes to the Fleetlens CLI (`fleetlens` on npm) are
recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The team-server has its own log at `packages/team-server/CHANGELOG.md`.

## [Unreleased]

### Fixed
- **The menu bar widget couldn't be installed from an npm install.** 0.15.4 shipped without `menubar/FleetlensMenubar.app`: the bundle is a gitignored build artifact and the release workflow (ubuntu) never built it, so npm silently skipped the `files` entry. `fleetlens menubar install` exited 1 and the web UI's install banner returned a 500. The release pipeline now builds the widget on a macOS runner — as a universal arm64 + x86_64 binary, so Intel Macs work too — runs its Swift tests, and refuses to publish if the bundle is missing from the package. The install banner also no longer offers a one-way trip: on builds without the bundle it stays hidden (the Settings card already explained the state).
- **`pnpm test` destroyed your real usage history.** `packages/entries/test/credentials.test.ts` (shipped in 0.15.4) called `rmSync(cclensPath("usage.jsonl"))` in an `afterEach` without setting `CCLENS_HOME`, so running the test suite deleted `~/.cclens/usage.jsonl` — every plan-utilization snapshot the daemon had ever recorded. It also appended a fake `zai` snapshot to the real log. The entries vitest config now pins `CCLENS_HOME` to a temp dir, and a regression test asserts `cclensHome()` never resolves to the real `~/.cclens`. Contributors only — this never affected installed CLIs.
- **Impossible `>100%` utilization on the previous-cycles trend.** Predicted utilization is a forward extrapolation with no upper anchor, so a heavy-spend stretch with no daemon snapshots drove a cycle's estimated peak past 100% (observed: 149%), overflowing the bar. Estimated peaks are now capped at 100%; real readings are untouched, since extra-usage overage can legitimately exceed 100%.
- **`/usage` hid months of recorded utilization.** The calibration curve — which feeds the previous-cycles trend — started at the first Claude Code transcript event rather than the first usage snapshot. Since Claude Code prunes `~/.claude/projects`, transcripts routinely begin long after the daemon's first snapshot, so every real reading before that point was silently dropped (locally: 4,105 snapshots across 32 days). The curve now always covers the full snapshot range, and `/usage` shows a quarter of 7-day cycles instead of six.

## [0.15.4] — 2026-07-09

Safe upgrade from 0.15.3.

### Added
- **Z.ai (GLM Coding Plan) usage tracking.** A new Z.ai API key section in Settings (`/settings`) lets you add your Z.ai key to track GLM Coding Plan utilization alongside Claude Code and Codex. The key is validated live before saving — a bad/expired key is rejected with a clear error — and on success the `/usage` tab and menu-bar widget populate **instantly** (no waiting for the daemon). Removing the key also prunes the stale usage data immediately. The secure credential store at `~/.cclens/credentials.json` (0o600) is the sole key source; lingering `ZAI_API_KEY` env vars and legacy `~/.config/zai/key.json` files are no longer consulted.
- **Native macOS menu bar widget.** A Swift app (`~/Applications/FleetlensMenubar.app`) shows live Claude Code / Codex / Z.ai plan utilization (5h/7d bars, ideal-pace ticks, reset countdowns, burn-rate, and the monthly web-search meter). Installable via the Settings page or `fleetlens menubar install`.

### Fixed
- **Codex 5-hour window no longer shows stale usage past reset.** Codex only emits a fresh ~0% `token_count` on the next request after a window resets. Previously a quiet post-reset gap would keep showing the prior window's `used_percent` (e.g. 64%) until a new Codex call happened. Expired windows are now treated as fresh (0%), matching the actual reset.
- **Z.ai key removed from Settings actually stays removed.** The daemon's `no_key` branch previously skipped silently, leaving the old `zai` line in `usage.jsonl` — the widget kept showing the stale value after removal. The line is now pruned on both removal and the next daemon tick.
- **Invalid Z.ai keys are no longer saved.** Z.ai returns HTTP 200 even for bad keys (the error lives in the body as `{"code":401,...}`). The Save flow now inspects the response body, not just the HTTP status, so a bogus key is rejected and never persisted.
- **Error messages in the Z.ai Settings section are now colored red** instead of green, so a rejected key is visually distinct from a successful save.

Safe upgrade from 0.15.2.

### Changed
- **Projects now aggregate by Git repo identity.** Project identity resolves from the nearest `.git` metadata instead of path patterns, so a linked worktree checked out anywhere on disk — not just under `.worktrees/` — rolls up into its main repo, and a session started in a subdirectory (`<repo>/packages/cli`) stops appearing as its own project named `cli`. When an origin remote is available, the project key uses the upstream repo name, so a local checkout folder like `claude-lens` can show up consistently as `fleetlens`. The walk stops at your home directory, so a dotfiles repo at `$HOME` can't swallow unrelated folders into one project.
- **Team-sync project keys move with that definition.** Sessions now key to the repo they belong to. If you previously excluded a folder from team sync by a name that was really a worktree, subdirectory, or local checkout folder rather than the repo key, that entry no longer matches anything and the folder now syncs under the repo's key. Check Settings → Team sync after upgrading if you rely on per-project exclusions.
- **Sessions use the same project key everywhere.** `/sessions?project=` accepts both legacy raw-path links and the new project key, the project filter is ordered by total token usage, and session cards/table rows show the resolved project key instead of the local checkout path.

### Added
- **Project detail folder inspector.** Project pages include a Local folders view listing the aggregated local folders and why each one rolled up, with guarded “Open folder” support for existing directories.
- **Repo context on session pages.** Session headers can show the current folder's remote, worktree badge, and current branch. The branch is explicitly the folder's current branch, not guaranteed to be the branch the historical session ran on.

## [0.15.2] — 2026-07-08

Safe upgrade from 0.15.1.

### Fixed
- **Reboot no longer risks skipping the daemon (or server) on login.** PID files survive a reboot and macOS reassigns low PIDs early, so the login LaunchAgent could find an unrelated boot process wearing the old daemon PID and skip startup with "already running". Liveness checks now verify the process identity (ps command line) — a reused PID reads as stale, and stale entries are cleaned instead of trusted or killed.

## [0.15.1] — 2026-07-08

Two upgrade-path fixes surfaced by the 0.15.0 rollout. Safe upgrade from 0.15.0.

### Fixed
- **Existing installs now actually get the full-stack login item.** Upgrading npm packages never rewrites `~/Library/LaunchAgents`, so machines paired before 0.15.0 kept the old daemon-only job — after a reboot the daemon returned but the dashboard didn't. `fleetlens start` (and team join/sync paths) now detect the pre-0.15 plist shape and rewrite it to launch the full stack.
- **Auto-update no longer trusts npm's stale metadata right after a publish.** The updater verifies against the registry directly, but `npm install` resolved `latest` from its own ~5-minute packument cache and could reinstall the old version ("Expected X but got Y"). Install now runs with `--prefer-online`.

## [0.15.0] — 2026-07-08

Team onboarding, rebuilt around a browser wizard — pairing now explains what leaves the machine, lets you pick which projects sync, and streams first-sync progress live. The Team page becomes the single home for sync management, and paired machines keep reporting across reboots. Safe upgrade from 0.14.x; pairs best with team-server 0.15.0.

### Added
- `fleetlens team join` now opens a browser onboarding wizard: explains exactly what data leaves the machine, lets you choose which projects sync to the team, and streams first-sync progress as a timestamped log. `--no-browser` keeps the old terminal-only behavior.
- The Team page is the single home for team-sync management: pairing status, sync activity (last push details + raw payload + Sync now), and the synced-projects editor. Changing the selection re-pushes your **full history** under the new filter and streams a live log: excluded projects disappear from the team server (days left with no synced activity are overwritten with empty rollups), newly included ones backfill.
- Settings gains a **Daemon auto-start** toggle showing the real LaunchAgent state — on after team pairing, with a durable opt-out.
- `fleetlens team sync --progress-json` — machine-readable NDJSON progress events.
- `team join` captures a first plan-usage snapshot before opening the wizard, so the first sync ships usage data even when the daemon's first poll loses a 429 race.
- The synced-projects editor defaults to a read-only summary — "Syncing N of M projects" with chips linking to each project's dashboard page — and the full picker sits behind an Edit button. The server URL on the Team page opens the team dashboard in a new tab.

### Changed
- Team sync pushes days **newest-first**, so a long first sync fills the team dashboard with the freshest data immediately.
- The project picker orders by **agent time** (busiest first), and the Team/Settings/wizard surfaces adopt the dashboard's design system — warm cards, teal-accent buttons, theme-aware borders (no more harsh black outlines from Tailwind v4's currentColor default).
- Auto-start is **opt-out for team members** (macOS): `team join` and `fleetlens start` install the login LaunchAgent automatically on paired machines. The agent now launches the **full stack** (`fleetlens start`: dashboard + daemon), so both reporting and the dashboard survive reboots. `fleetlens autostart uninstall` records a durable opt-out that join/start never override.

## [0.14.0] — 2026-07-08

Team-sync overhauled around one idea: a fresh pairing syncs **everything**, and every run leaves a story you can read. Safe upgrade from 0.13.x; pairs best with team-server 0.14.0.

### Added
- **One rich `[sync]` line per run** in the daemon log: `status · trigger(auto|boot|pair|manual) · pushed N days (range) · usage +N · server accepted <blocks> · duration · next ~Nm` — including the server's own accepted/skipped verdict, so the log shows both what was sent and what the server did with it. Uploaded per-member to the Team Edition.
- **Pair backfill is complete and deterministic.** `team join` now pushes rich rollups (projects, skills, sub-agents, working shapes) for the whole backfilled history — perception entries are built on the spot at push time, no LLM required. Historical 7d cycle peaks now cover up to 26 cycles (was 12).
- **Dropped-day self-heal**: a day rejected by an older server is remembered and retried once per sync until accepted (`recovered N dropped days`), instead of being lost.

### Fixed
- Re-pairing a machine to a different team no longer uploads the previous team's sync-log history.
- The sync-log watermark only advances when the server actually accepted the log batch; oversized lines are truncated instead of poisoning the batch; long backlogs drain oldest-first so an outage's onset is never lost.
- Manual `fleetlens team sync` runs now appear in the member's sync story (tagged `manual`).
- Perception sweep no longer re-parses entry-less transcripts every 5 minutes; a transient transcript read failure no longer blocks a session's entries until daemon restart.

## [0.13.2] — 2026-06-29

Timeline and session-view polish, plus the second half of the session-view modularization. Mostly day-scope refinements — jumping into a session now lands on the right day, and the minimap and idle dividers read far more cleanly on long multi-day runs. Safe upgrade from 0.13.1.

### Added
- **Click a session, land on the day you were looking at.** Opening a session from the Day view or a Concurrency gantt now pins it to *that* day instead of the session's most-recent day — and actually scrolls the transcript there. Previously the day selector moved but the transcript stayed at the very top, a latent bug that also affected the plain last-day jump. Days that are entirely background-agent work — which live in the Workflows tab, not the transcript — fall back to the nearest rendered content instead of getting stuck at the top.
- **Idle gaps that cross a day now show when work resumed.** A "Session idle · 1d" divider told you how long but not when; for a gap that picks back up on a later day it now reads "Session resumed Jun 18, 11:02 AM". Sub-day gaps keep their duration, since the pause length is the useful signal there.

### Fixed
- **The minimap no longer shreds a long run into idle slivers.** A collapsed turn now owns its internal idle (model thinking, long tool calls, a workflow it's waiting on) instead of fragmenting into a stutter of hatched bars; consecutive idle bands fuse into one; the gap between two days no longer leaks across the day-window edge as a giant block; and a day no longer opens on the overnight gap leading into it (which could be 60–70% of the whole bar) — the day's actual activity now fills the timeline.
- **Cleaner day boundaries.** When a resume divider already names the new day, the redundant "Start of \<day\>" jump marker below it is dropped — the boundary is just the resume band plus an "End of \<prev day\>" back-nav, instead of three stacked elements restating the same date.
- **Two workflow-panel bugs.** WorkflowPhaseTabs now reactively falls back to the first phase with agents until you pick one (and resets per run); WorkflowAgentDrawer paints synchronously from its detail cache on reopen, and a failed revalidation no longer blanks an already-shown detail.

### Changed
- **Internal: session-view.tsx modularization, part two.** The session-scoped Minimap (~1,580 LOC) and the WorkflowsPanel cluster (~940 LOC) were extracted into colocated `session-view/` modules. Pure code moves — `tsc --noEmit` clean throughout. Plus small review-surfaced cleanups: three dead imports removed, the gantt day-param simplified to the already-canonical date string, and a tail-mode effect dependency corrected.

## [0.13.1] — 2026-06-26

A quality-and-correctness release rolled up from a full code audit, plus the timeline scroll-follow polish from PR #73. No new surface — every change either fixes a bug, removes dead weight, or makes the codebase easier to work in. Safe upgrade from 0.13.0.

### Fixed
- **Day-scoped timeline now actually follows scroll across days, without flicker.** The minimap's selected day used to revert to the previous day when you scrolled into a new one on a long session, because the day-jump's `scrollIntoView` undershot tall preceding turn-blocks and the scroll-spy then read that block's offset as "still on the old day." The follower now reads from the same playhead signal the minimap already uses, the day-jump self-corrects against the live header height across a few frames so the next day's strip lands exactly at the header line, and live sessions skip the mount day-jump entirely so tail-follow can land on the latest tail without being yanked back. Live-follow scrolls are now instant (not smooth) so they don't self-cancel mid-animation. (PR #73)
- **Inline cross-day jump shortcuts.** New "↓ Start of \<day\>" and "↑ End of \<day\>" buttons sit at each day boundary in the transcript, so reading across a long idle gap is one click — not a hand-scroll across thousands of pixels. (PR #73)
- **Searchable project filter on the sessions list.** The `<select>` project picker is replaced with a filterable combobox: type to filter, arrow keys + Enter/Escape to navigate, Tab to close. Painful with dozens of project folders before; now a few keystrokes. (PR #73)
- **Six correctness bugs surfaced by a full audit:**
  - `INSTRUCTION_RE` in `extractUserInstructions` leaked `lastIndex` across calls. Once a turn hit the 5-cap break, later entries got truncated or empty `user_instructions` until the module re-loaded. Fixed; regression test added.
  - Linear/Jira ticket-ref matching was anchored only at the end of the identifier, so `\m` matched `XKIP-315` against `KIP-315` — inflating AI-linked PR share and joining unrelated PRs into work-timeline cycle stats. Both `\m` and `\M` now anchor both sides.
  - **Usage dedup re-introduced 2–3× token inflation** on transcripts where two JSONL lines for the same `message.id` differed in whether they carried `requestId` (`msg_1:` vs `msg_1:req_a` keyed as distinct messages). Dedup now keys on `mid` alone — the comment already called it the stable identifier. Regression test added.
  - `loadUsageByDay`'s early break assumed strictly chronological JSONL; out-of-order timestamps from sleep-resume clock skew or backfill silently terminated the scan and dropped later in-range snapshots. Switched to a continue.
  - `enrichmentStatusBySession` depended on filesystem iteration order — a session whose newest day was pending could surface as enriched (or vice versa). Now reads from the most-recent entry after explicitly sorting by `local_day` desc.
  - `runDaemonUpdateCheck` could leave `updateCheckInFlight=true` forever if a registry fetch hung past its 3-second timeout, blocking all future update checks behind the 5-second watchdog tick. The in-flight return path now advances `nextUpdateCheckAtMs` properly.

### Changed
- **Five dead exports removed** surfaced by the audit (zero callers anywhere, verified by ripgrep): `predictUtilization` + `dollarsInWindow` from `parser/src/calibration.ts`; `parseDateArg` from `cli/src/args.ts`; `lastCompletedMonth` from `apps/web/lib/entries.ts`; `coworkSessionLocalDay` + its `parser/src/fs.ts` re-export.
- **Type-safety + perf cleanups** to load-bearing primitives surfaced by the audit (no behavior change, but the code is now easier to refactor without surprises).
- **Internal: six large files split for maintainability.** Pure code moves — every chunk landed with `tsc --noEmit` clean and the parser's `entries --all --json` output byte-identical to master.
  - `apps/web/app/sessions/[id]/session-view.tsx` 6,612 → 5,208 LOC, with 11 colocated modules extracted under `session-view/`.
  - `apps/web/app/parallelism/gantt-chart.tsx` 1,774 → 888 LOC, with `gantt-chart-utils.ts`, `concurrency-info-modal.tsx`, `burst-detail-modal.tsx` extracted.
  - `apps/web/app/sessions/[id]/team-tab/team-minimap.tsx` 682 → 427 LOC, with `minimap-shared.ts`, `minimap-idle-band.tsx`, `minimap-hover-card.tsx` extracted.
  - `packages/team-server/src/lib/team-report-aggregate.ts` 1,713 → 1,559 LOC, with `ticket-velocity.ts` extracted.
  - `apps/web/app/api/digest/{day,week,month}/[…]/route.ts` thinned to ~30 LOC each via a shared `digest-route-helpers.ts`.
  - `apps/web/components/{week,month}-digest-view.tsx` deduplicated through a shared `digest-actions.tsx`.
- **Parser `antigravity.ts` tightened** from `any[]` to `unknown[]` with a local `RawEvent` / `RawToolCall` record cast (16 implicit-any property accesses eliminated). Verified byte-identical `SessionEvent` dump on a fixture exercising every parser branch.
- **+83 unit tests** backfilling load-bearing primitives that had no coverage: `formatTokens`, `formatGap`, `formatDuration`, `prettyProjectName`, `formatUsage`, `mondayFor`, plus the parser/team-server regression tests for the dedup and word-boundary fixes above. Total: 1,275 → 1,358.

## [0.13.0] — 2026-06-18

### Added
- **Day-scoped session timeline.** A long-running session that spans several days no longer crams every day into one unreadable strip. The timeline map gives you Prev/Next day controls (with the day's date) to step through the run one day at a time, and as you scroll the transcript the timeline follows along — auto-advancing to whichever day you're reading. Each day's perception digest card now sits inline at that day's first entry instead of stacked at the top, so the summary travels with the work it describes.
- **LIVE now sees background agents and workflows.** A session whose main transcript has gone quiet but is still running background subagents or a workflow now correctly reads as live: liveness is computed from the newest activity across the session's nested subagent/workflow transcripts, not just the main JSONL. The live badge, the Running/Idle state, and the live-sessions widget all reflect in-flight background work, and the dashboard auto-refreshes when a background agent writes.
- **Keep the usage daemon running across reboots (macOS).** New `fleetlens autostart <install|uninstall|status>` installs a launchd LaunchAgent that runs `fleetlens daemon start` at login, so usage polling survives a restart. `fleetlens start` offers to set this up the first time (a simple Y/n, with "don't ask again"); it's daemon-only and entirely opt-in. On non-macOS it prints how to add a login item manually.
- **Per-member CLI version reported to Team Edition.** The daemon now stamps its installed Fleetlens CLI version into each team push, so the team roster can show who's up to date. Harmless to older servers, which ignore the field.

### Changed
- **Session view tabs renamed** to Timeline / Workflows / Log (from Transcript / Workflows / Debug).

### Fixed
- **Harness-injected lines no longer render as your messages.** Post-compact continuation summaries ("This session is being continued…") and session-scoped Stop-hook notices arrive with a user role but aren't things you typed — they're now hidden from the transcript and excluded from turn counts and digests, like other framework boilerplate.
- **Sessions list hydration error** on pending session cards (a nested link inside the card link) is gone.

## [0.12.3] — 2026-06-15

### Fixed
- **Opening a session under-counted its tokens everywhere afterward.** Viewing a session that spawned subagents returned parent-only token totals and overwrote the shared in-memory cache with them, so the dashboard, estimated cost, daily heatmap, and project rollups all dropped that session's subagent tokens until the server restarted. The detail path now applies the same subagent-inclusive recompute as the list path, so totals stay correct and consistent no matter which page you open first.
- **`fleetlens usage --history` cost accuracy.** A single session on an unpriced model (e.g. `<synthetic>`) no longer nulls a whole day's cost — each day now sums the cost of its priced sessions and marks the figure as a lower bound (`≥`) when some sessions couldn't be priced. The Total row sums every priced day (it previously dropped them while still counting their tokens) and is likewise marked `≥` when any usage was unpriced, so Total cost and Total tokens no longer imply different scopes.
- **`fleetlens usage --history` model labels.** A day with two minor model versions could render a duplicated/inconsistent label (e.g. `opus-4, opus-4`); model names now use one normalization for both de-duplication and display.
- **Sidebar project count matches the Projects page.** The sidebar nav badge and footer counted Claude Code projects only, disagreeing with the all-source `/projects` page and omitting Codex / Cowork / Gemini / Antigravity projects. Both now reflect every agent source.
- **A stale or corrupt digest file no longer 500s the dashboard.** Cached day/week/month digests are now validated on read (schema version + shape); an incompatible or damaged file is ignored and the page renders without it, honoring the "a schema bump regenerates digests" contract.
- **A failed stale-server restart can't leave an invisible orphan.** If the replacement server can't take the port, `fleetlens start`/`web` now escalate to a force-kill and re-record the old server's pid so `status`/`stop` can still see and stop it, instead of leaving an untracked process serving the old bundle.
- **Live-sessions count hydration.** The "Live · N" badge is time-derived and could briefly mismatch between server render and hydration; it's now marked so React doesn't warn.

## [0.12.2] — 2026-06-15

### Fixed
- **A stale web server could survive an update and serve a broken dashboard.** After `fleetlens` updated itself, the CLI binary and usage daemon came up on the new version, but a web server that was already running kept serving the old build. Once npm removed the previous install directory, any dashboard route the old server hadn't already loaded into memory returned a 500 (Insights was the usual casualty). `fleetlens start` and `fleetlens web` now record the running server's version in the pid file and automatically restart it when it no longer matches the installed CLI; `fleetlens status` shows the served version and warns when it's stale.

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
