# Fleetlens

Fleetlens is a local-first observability dashboard for coding-agent fleets. It reads the session history already written by your agents, normalizes it into a common model, and shows where agent time, tools, projects, concurrency, usage, and shipped work are accumulating.

The published CLI and npm package are lowercase: `fleetlens`. The product name in the UI is **Fleetlens**.

## Start locally

Requirements: Node.js 20 or newer.

```bash
npm install -g fleetlens
fleetlens start --open
```

Open `http://localhost:3321` if the browser does not open automatically. `fleetlens start` launches the local dashboard and usage daemon together. Use `fleetlens start --no-daemon` when you only want the web server.

For a visual walkthrough, see the [Fleetlens user guide PDF](./output/pdf/fleetlens-user-guide.pdf) or the [public platform documentation](https://cowcow02.github.io/fleetlens/).

## What the local edition does

- Reads local session history from Claude Code, Codex, Gemini CLI, Antigravity, Cowork, and Grok Build adapters.
- Presents a common session model across agent sources: sessions, transcript detail, turns, tool calls, tokens, models, and projects.
- Computes agent time from active event segments rather than treating every wall-clock gap as work.
- Rolls worktrees into canonical projects while retaining worktree context.
- Shows daily activity, project rollups, estimated cost, PR signals, code changes, and concurrency bursts.
- Stores usage snapshots, entries, digests, and daemon state under `~/.cclens`.
- Provides local Insights and Agent surfaces when optional AI features are enabled.

Raw transcripts stay on the machine in the local edition. No Fleetlens account or database is required.

## Dashboard map

| Surface | Route | Answers |
|---|---|---|
| Overview | `/` | How much happened, and where? |
| All sessions | `/sessions` | What did a particular run do? |
| Projects | `/projects` | Which repositories are consuming attention? |
| Day | `/day` | When did work overlap or go idle? |
| Insights | `/insights` | What patterns are emerging over a closed period? |
| Agent | `/agent` | What does my local session history say? |
| Usage | `/usage` | How is provider capacity changing over time? |
| Settings | `/settings` | How should local services and AI features behave? |
| Team | `/team` | What is this machine sharing? |

## Team Edition

Team Edition is a self-hosted shared server with Postgres. An admin deploys it, creates a team and invite token, and each member pairs a local CLI:

```bash
fleetlens team join https://your-fleetlens.example <invite-token>
fleetlens team status
fleetlens team sync
```

Members select which projects sync. Team ingest receives derived rollups, usage snapshots, and optional enriched extras. Raw prompts, assistant responses, absolute paths, file contents, and excluded projects are not part of the sync contract.

Deployment paths:

- [Railway one-click template](./deploy/railway/README.md)
- [Google Cloud installer](./deploy/gcp/README.md)
- [Docker Compose](./deploy/compose/README.md)
- [AWS Terraform module](./deploy/terraform/aws/README.md)

## Architecture

This is a pnpm + Turborepo monorepo:

```text
fleetlens/
├── packages/
│   ├── parser/        # agent adapters, types, analytics, filesystem readers
│   ├── entries/       # day-scoped work units and digest pipelines
│   ├── cli/           # published fleetlens binary and detached daemon
│   └── team-server/   # self-hosted Team Edition server + Postgres model
├── apps/
│   ├── web/           # local Next.js dashboard
│   └── menubar/       # native macOS usage widget
├── deploy/            # Railway, GCP, Compose, and AWS paths
├── site/              # static GitHub Pages documentation site
└── scripts/           # build, smoke, fixture, and release helpers
```

The local data path is:

```text
agent transcript roots
        |
        v
parser adapters -> common session model -> analytics / entries
        |                                  |
        v                                  v
local dashboard                    local digests and Agent
        |
        +--> optional Team Edition sync (derived rollups only)
```

## Local state and configuration

| Setting | Default | Purpose |
|---|---|---|
| `CCLENS_PORT` | `3321` | Default dashboard port |
| `CCLENS_HOME` | `~/.cclens` | Local state directory |
| `GROK_HOME` | `~/.grok` | Alternate Grok Build home |
| `NEXT_OUTPUT` | unset | `standalone` when building the bundled web app |

Important local state files include:

```text
~/.cclens/pid          web PID, port, and version
~/.cclens/daemon.pid   usage daemon PID
~/.cclens/usage.jsonl  provider usage snapshots
~/.cclens/daemon.log   daemon, perception, update, and sync logs
~/.cclens/entries/     day-scoped entry artifacts
~/.cclens/digests/     saved day, week, and month digests
```

## CLI reference

```text
fleetlens start [--port N] [--open] [--no-daemon]
fleetlens stop
fleetlens status
fleetlens update
fleetlens web [page] [--open]
fleetlens usage [--save]
fleetlens usage --history [-s D] [--days N]
fleetlens entries [--day D|--session ID|--all] [--json]
fleetlens digest day|week|month ...
fleetlens daemon start|stop|status|logs
fleetlens team join|status|sync|backfill|logs|leave
fleetlens autostart install|uninstall|status
fleetlens menubar install|uninstall|open|status
```

Run `fleetlens help` for the installed build's exact flags.

## Build and verify from source

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

The normal verification flow uses an already-running local web server:

```bash
pnpm verify
```

For a fresh bundled CLI build:

```bash
NEXT_OUTPUT=standalone pnpm build
node scripts/prepare-cli.mjs
node packages/cli/dist/index.js start
```

The root `package.json` is the version source of truth. Use `npm version` at the repository root when releasing; do not edit sub-package versions manually.

## Public documentation site

The `site/` directory is a static GitHub Pages site covering the platform, local setup, Team Edition, privacy boundary, and operations. `.github/workflows/pages.yml` deploys it on pushes to `master` once the repository's Pages source is set to **GitHub Actions**.

Local preview:

```bash
python3 -m http.server 4173 --directory site
```

## License

MIT. See [LICENSE](./LICENSE).
