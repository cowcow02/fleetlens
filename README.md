# fleetlens

**Local-only dashboard and usage tracker for [Claude Code](https://claude.com/claude-code).**

`fleetlens` reads your `~/.claude/projects/*.jsonl` transcripts, polls your plan's utilization directly from Anthropic, and visualises everything — live burndown charts, activity heatmaps, per-project stats, parallel agent runs, PR shipping metrics, and a beautiful session transcript view modeled on Claude's own managed-agents UI.

Nothing leaves your machine.

> Published to npm as `fleetlens`. The binary is `fleetlens` — short enough for tab-completion, descriptive enough to explain itself.

## Team Edition (self-hosted)

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/sGuijx?PORT=3322&NODE_ENV=production&RAILWAY_DOCKERFILE_PATH=packages%2Fteam-server%2FDockerfile)

One click spins up the Fleetlens team server + Postgres on Railway. Postgres + private-network DB connection + public domain are all pre-wired. Fill in one `FLEETLENS_ENCRYPTION_KEY` (any 32-byte hex string — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`), hit Deploy, and you'll have a signup page live at your `*.up.railway.app` URL in ~90 seconds. The first account to sign up becomes the admin of team #1. Full setup notes in [`deploy/railway/`](./deploy/railway/README.md). Docker Compose and AWS Terraform alternatives live under [`deploy/`](./deploy).

## What makes it different

There are [several](https://github.com/ryoppippi/ccusage) [excellent](https://github.com/chiphuyen/sniffly) [Claude Code](https://github.com/FlorianBruniaux/ccboard) [dashboards](https://github.com/d-kimuson/claude-code-viewer) already. `fleetlens` focuses on four things they don't cover well:

1. **Real plan utilization, not approximations.** Most tools estimate your 5h/7d usage from token counts in JSONL. `fleetlens` calls `api.anthropic.com/api/oauth/usage` with your Claude Code OAuth token, so the numbers match exactly what `/usage` shows inside Claude Code.
2. **Burndown visualisation.** A sprint-burndown chart per cycle shows remaining budget, a dashed "sustainable burn" reference line, and a live label telling you if you're on track or behind. Drops the jargon — you can see instantly whether you'll hit the wall.
3. **Parallel agent run detection.** No other tool robustly detects when you had 2+ Claude Code sessions running simultaneously (against worktrees, multi-agent fleets, etc.). We compute this via sweep-line over session intervals and surface peaks, burst durations, and the % of agent time spent in parallel.
4. **Per-session PR shipping attribution.** Scans `gh pr create` Bash calls to link individual sessions to the PRs they produced, plotting "position in session" as a proxy for how well your harness is tuned.

Plus: a full transcript UI modeled on Claude's managed-agents view (mini-map timeline, turn collapsing, pretty tool cards), because nobody else makes reading a session a pleasant experience.

## Quickstart

Install globally from npm:

```bash
npm install -g fleetlens
fleetlens start
# → http://localhost:3321 — dashboard + usage daemon both running
```

That's it. `fleetlens start` brings up both the dashboard web server and the background usage daemon in one call. Any future `fleetlens update` will auto-restart both against the new code.

Or build from source:

```bash
git clone https://github.com/cowcow02/fleetlens.git
cd fleetlens
pnpm install
NEXT_OUTPUT=standalone pnpm build
node scripts/prepare-cli.mjs
node packages/cli/dist/index.js start
```

## CLI

```bash
# Common
fleetlens start [--port N] [--no-open] [--no-daemon]   # Start dashboard + usage daemon
fleetlens stop                           # Stop dashboard + usage daemon
fleetlens status                         # Server + daemon + latest snapshot, one glance
fleetlens update                         # Upgrade to latest; stops + re-exec's cleanly

# Terminal-only (no server needed)
fleetlens stats [--live] [-s D] [--days N]   # ccusage-style daily token table
fleetlens usage [--save]                 # Plan utilization (5h/7d) printed once

# Advanced
fleetlens web [page] [--no-open]         # Open the dashboard in a browser (auto-starts server only)
fleetlens start --no-daemon              # Start only the web server (skip the daemon)
fleetlens daemon start|stop|status|logs  # Manage the usage daemon by itself

fleetlens version
```

`fleetlens start` and `fleetlens stop` manage **both** the web server and the usage daemon as one unit — that's the common path. Use the `daemon` subcommand or `--no-daemon` flag only when you want to manage the two independently.

### Auto-update

Running `fleetlens start` checks npm for a newer version. If one exists, it:

1. Stops any running web server + daemon
2. Runs `npm install -g fleetlens@latest`
3. Reports where it actually installed and warns if your `PATH` resolves `fleetlens` to a different Node install (the classic nvm / homebrew multi-install trap)
4. Re-exec's straight into the newly-installed `dist/index.js` so `PATH` lookups can't land on the old binary
5. The new process then launches a fresh server + daemon

`fleetlens update` is the explicit version — same flow, but only tears down running services on a real version bump (reinstalling the same version is a no-op so it doesn't disrupt an open dashboard tab).

### The usage daemon

Running `fleetlens daemon start` spawns a detached background poller that hits the Claude Code OAuth usage endpoint every 5 minutes and appends a snapshot to `~/.cclens/usage.jsonl`. The dashboard's `/usage` page reads that log to render:

- **Current cycle burndown** — remaining budget over time, with a sustainable-burn reference diagonal and warning bands at <10% and <30%
- **Multi-cycle historical view** — click expand on any chart → fullscreen modal with date range picker (Current cycle · 24H · 7D · 30D · 90D · Custom datetime range)
- **Cycle boundaries** — vertical markers between each 5h / 7d reset, with the per-cycle peak called out
- **Gap-aware lines** — missing data periods (daemon was offline) don't render as straight interpolations
- **Always-visible sidebar widget** — current 5h/7d/Sonnet% with reset countdowns on every page

All polling is driven by the OAuth token Claude Code already stores in your macOS Keychain (service `Claude Code-credentials`) — no API key needed, no login flow, no config.

## Web dashboard

### Overview (`/`)

- **6 headline metric cards** (Sessions, Agent time, Tool calls, Parallelism, Code changes, Est. cost) with two-line subs showing headline + detail
- **GitHub-style contribution heatmap** — every day you coded with Claude
- **Daily activity chart** with sortable metrics (sessions / agent time / tool calls / turns / input / output / cache read)
- **Top projects** and **recent sessions** panels at a glance
- **Date range filter** (7D / 30D / 90D / All)

### Session / Project views

- **`/sessions`** — all sessions with card *or* sortable-table toggle (persisted per-page), search + filter + sort-by
- **`/projects`** — project rollups with the same card/table toggle; worktree projects fold into their parent repo
- **`/projects/[slug]`** — per-project dashboard reusing the overview layout (shared `DashboardView` component) + PR timeline + parallel runs strip + full session list

### Session detail

Modeled on Claude's managed-agents Sessions view:

- **Mini-map timeline** — adaptive, selectable, scroll-tracked
- **Turns mode** — collapses agent work between user inputs into compact "turn" cards with first message, middle steps, and heuristic-selected conclusion
- **Pretty tool cards** — diff view for Edit, file path + content for Write, command block for Bash, compact summaries for Grep/Glob/Skill/TodoWrite/MCP tools
- **Markdown rendering** via `react-markdown` + `remark-gfm`
- **Token chips** with fresh-input / cached breakdown tooltips

### Timeline (`/parallelism`)

Gantt chart of every session's active segments stacked per day, with burst detection overlays. Date picker + calendar heatmap for navigation.

### Usage (`/usage`)

Historical burndown charts described above.

## Architecture

pnpm monorepo with Turborepo:

```
fleetlens/
├── packages/
│   ├── parser/              # @claude-lens/parser — pure JSONL parser + analytics
│   └── cli/                 # fleetlens — published CLI + bundled standalone Next.js app
├── apps/
│   └── web/                 # Next.js 16 dashboard (standalone output bundled into cli/)
├── scripts/
│   ├── prepare-cli.mjs      # copies Next.js standalone output into packages/cli/app/
│   ├── generate-mock-usage.mjs  # produces 30 days of realistic mock usage snapshots
│   ├── version-sync.mjs     # propagates root version to all sub-packages
│   └── smoke.mjs            # basic route health check
└── CLAUDE.md                # agent-facing project guide + release process
```

### The parser package

[`@claude-lens/parser`](./packages/parser/README.md) is a pure TypeScript library that turns raw Claude Code JSONL into:

- **Structured events** (`SessionEvent[]`) with roles, timestamps, offsets, token usage
- **Presentation rows** — noise filtered, tool calls merged, task notifications parsed
- **Mega rows** — collapsing agent loops into "turns" between user inputs
- **Analytics** — daily buckets, parallel-run detection (sweep-line), PR detection, high-level metrics, canonical project rollups (worktrees fold into parent repo)

No fs or network. A `/fs` subpath exports the filesystem scanner for Node.

### The CLI package

`packages/cli/` is bundled with esbuild into a single binary that embeds:

- The parser (for `fleetlens stats` and `fleetlens usage`)
- A detached daemon worker (`dist/daemon-worker.js`) that polls the OAuth usage endpoint
- The Next.js `apps/web` standalone output (pre-built and copied into `cli/app/`)

Everything ships as one npm package. Global install gets a fully-working dashboard + CLI with zero additional setup.

### Live updates

A single SSE stream (`/api/events`) watches both `~/.claude/projects/` (session files) and `~/.cclens/usage.jsonl` (daemon snapshots). Both feed `LiveRefresher`, which calls `router.refresh()` on any change so the entire RSC tree (including the sidebar usage widget) re-reads fresh data without manual reload.

### Shared preferences

`usePersistentBoolean(key, default)` is a small hook backed by localStorage + a custom `fleetlens:persistent-boolean` event. It's the mechanism behind:

- The Sonnet chart show/hide (main page and sidebar stay in sync)
- The cards/table view toggle on `/sessions` and `/projects`

## Features

### Plan utilization

- **Exact numbers from the OAuth usage endpoint**, not token estimates
- Daemon polls every 5 minutes and appends to `~/.cclens/usage.jsonl`
- Burndown chart per cycle with remaining budget and sustainable-burn diagonal
- Multi-cycle historical view with gap detection and cycle-boundary markers
- Always-visible sidebar widget

### Smart JSONL parsing

- **Token dedup** — Claude Code splits one API response into multiple JSONL lines, each carrying identical `usage`. The parser sums once per `message.id` so totals aren't doubled.
- **Canonical project rollup** — sessions in `/.worktrees/<name>` subdirs fold into their parent repo so all activity on a project shows under one entry.
- **Out-of-order timestamps** — attachments can flush after their triggering event with earlier timestamps. Session bounds use `min(ts)`, not `first(ts)`.
- **Multi-day session splitting** — long-running sessions spanning multiple local days contribute activity to each day.
- **Task-notification codas** — background `gh pr create` replies like "Acknowledged" are skipped when picking a turn's "conclusion" message.
- **Slash-command prettification** — `<command-name>/implement</command-name><command-args>AGE-9</command-args>` renders as `/implement AGE-9`.
- **Skill-injection hiding** — skill docs auto-injected as user blocks are filtered out.
- **Cache-aware cost estimation** — per-model pricing table with separate rates for input / output / cache-read / cache-write.

### Parallel run detection + Concurrency bursts

Sweep-line over session active segments finds peaks and contiguous parallel regions. Raw overlaps are noisy — a morning of back-and-forth work creates dozens of sub-minute artifacts. The Timeline page collapses them into **concurrency bursts** with two rules:

- **Drop overlaps under 1 minute** (filters tab-switch noise)
- **Merge overlaps within 10 minutes of each other** (fuses morning bursts into one)

Each burst is colored **teal** (same-project) or **purple** (cross-project — genuinely interesting signal for multi-agent fleet work). The Timeline page shows:

- A **Concurrency panel** with the day's bursts (first 3 by default, click to expand)
- A **burst detail modal** with a focused mini-Gantt showing only the involved sessions, numbered tracks you can click to scroll to the matching session card, and per-session active-time percentages within the burst window
- A **burst ribbon** at the top of the main Gantt that sticky-scrolls with the chart

The overview's Parallelism metric card shows total parallel time + peak concurrency + % of agent time spent in parallel.

### PR shipping metrics

Scans Bash tool calls for `gh pr create`, extracts titles from `--title "..."`, and plots them against session duration — so you can measure "on average, how early does Claude ship the PR?" as a proxy for how well your harness is tuned.

### Agent time (not wall clock)

The headline duration metric is **not** wall-clock session duration. It's the summed event-to-event gap under an idle threshold (default 3 min), approximating how long the Claude agent was actually working vs. waiting for user input or sitting idle.

### Pinned projects

Projects you pin (star button in the sidebar) get promoted to a "Pinned" section at the top. Persisted in localStorage — no server state.

## Configuration

Zero config by default. Environment overrides when needed:

| Variable | Default | Purpose |
|---|---|---|
| `CCLENS_DATA_DIR` | `~/.claude/projects` | Where to scan for JSONL sessions |
| `CCLENS_PORT` | `3321` | Dashboard port (overridden by `--port`) |
| `CCLENS_USAGE_LOG` | `~/.cclens/usage.jsonl` | Path for the usage daemon's append-only snapshot log |
| `NEXT_OUTPUT` | — | Set to `standalone` when building for CLI bundling |

## Development

```bash
pnpm install
pnpm dev                                  # start web app in dev mode
pnpm -F @claude-lens/parser test          # run parser tests
pnpm -F fleetlens test                       # run CLI tests
pnpm typecheck                            # typecheck everything
pnpm verify                               # typecheck + smoke tests
pnpm build                                # build parser + web + cli

# Build a fresh standalone bundle for `fleetlens web`
NEXT_OUTPUT=standalone pnpm build
node scripts/prepare-cli.mjs
node packages/cli/dist/index.js web --no-open
```

### Mock usage data

Need to see what the dashboard looks like with 30 days of realistic data?

```bash
node scripts/generate-mock-usage.mjs
```

Backs up your existing `~/.cclens/usage.jsonl` to `.bak` first. To restore real data:

```bash
mv ~/.cclens/usage.jsonl.bak ~/.cclens/usage.jsonl
```

## Privacy

Everything runs on `localhost:3321` against your local filesystem. The usage daemon calls Anthropic's own OAuth endpoint (the same one `/usage` in Claude Code hits) using the token Claude Code already stores locally — no new auth, no third parties. Session transcripts never leave your machine.

## License

[MIT](./LICENSE)

## Credits

Built on top of [Claude Code](https://claude.com/claude-code), [Next.js 16](https://nextjs.org), [Tailwind v4](https://tailwindcss.com), [lucide-react](https://lucide.dev), [react-markdown](https://github.com/remarkjs/react-markdown), and [remark-gfm](https://github.com/remarkjs/remark-gfm).

Inspiration + mechanism credits:

- [ccusage](https://github.com/ryoppippi/ccusage) — the daily token table layout
- [usage4claude](https://github.com/f-is-h/usage4claude) — showed that the claude.ai private API was the right path for real numbers
- [claude-meter](https://github.com/francisbrero/claude-meter) — the definitive find that the Claude Code OAuth token + `/api/oauth/usage` + `anthropic-beta: oauth-2025-04-20` header is a clean authoritative data source
