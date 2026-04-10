# Claude Lens CLI & Release Automation Design

**Date:** 2026-04-10
**Status:** Approved

## Overview

Transform claude-lens from a `curl | bash` installer into a proper npm-distributed CLI tool, modeled after Claude Code's UX. The CLI manages the dashboard server lifecycle, provides terminal usage statistics, handles auto-updates, and ships via GitHub release automation.

This design also establishes the foundation for future team features: a local daemon for continuous session upload, authentication flows, and team dashboards.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Distribution model | Single npm package with bundled Next.js standalone output | Simplest UX: `npm i -g claude-lens && claude-lens start`. No git/pnpm needed on user machine. |
| npm package name | `claude-lens` (unscoped) | Clean install command. Root workspace renamed to `claude-lens-workspace`. |
| Stats output | ccusage-style daily token table + live TUI mode | Matches existing ecosystem expectations. Parser already has all required data. |
| Auto-update strategy | Check + auto-apply on every `claude-lens start` | Always on latest. Graceful fallback if network/update fails. |
| Release trigger | Git tag (`v*`) pushed to master | Standard open-source pattern. Works with `npm version` command. Agent-driven, no human trigger needed. |
| Version sync | All packages share one version, synced by preversion script | Single version number across CLI, parser, and web app. |

## 1. Package Structure

The monorepo gains a new package: `packages/cli/`.

```
packages/cli/
  src/
    index.ts              # Entry point, command router
    commands/
      start.ts            # Start the dashboard server
      stop.ts             # Stop the running server
      update.ts           # Self-update via npm
      stats.ts            # Terminal statistics
    server.ts             # Manages the Next.js standalone server process
    updater.ts            # Version check + auto-update logic
    pid.ts                # PID file management (~/.claude-lens/pid)
  package.json            # name: "claude-lens", bin: { "claude-lens": "./dist/index.js" }
  tsconfig.json
```

**Root package.json** renamed from `claude-lens` to `claude-lens-workspace` (private, not published).

**State directory:** `~/.claude-lens/` stores PID file, config, and logs.

### CLI Commands

| Command | Behavior |
|---------|----------|
| `claude-lens start` | Check for updates, auto-apply if available, start server on port 3321, open browser |
| `claude-lens stop` | Read PID file, kill server process, clean up |
| `claude-lens update` | Force update to latest via `npm install -g claude-lens@latest` |
| `claude-lens stats` | Daily token usage table (ccusage-style) |
| `claude-lens stats --live` | Auto-refreshing TUI with daily breakdown + active sessions |
| `claude-lens stats -s YYYYMMDD` | Filter stats since a specific date |
| `claude-lens stats --days N` | Filter stats to last N days |
| `claude-lens version` | Print current version |

## 2. Next.js Standalone Bundling & Server Management

### Standalone Output

Add `output: 'standalone'` to `apps/web/next.config.ts`. At build time (CI), Next.js produces a self-contained `.next/standalone/` directory with its own minimal `node_modules` and a `server.js` entry point (~15-20MB).

### Published Package Layout

```
claude-lens (npm package)
  dist/                   # Compiled CLI code
  app/                    # Next.js standalone output
    server.js             # Entry point
    node_modules/         # Only what the server needs
    .next/
      static/             # CSS, JS bundles
    public/               # Static assets (if any)
  package.json
```

### Server Management

- `claude-lens start` spawns `node app/server.js` as a detached child process, writes PID to `~/.claude-lens/pid`
- The server runs in the background; the CLI exits after confirming the server is healthy (HTTP check)
- `claude-lens stop` reads PID, sends SIGTERM, waits for graceful shutdown, removes PID file
- Stale PID files (process dead) are cleaned up automatically
- Port defaults to 3321, configurable via `--port` flag or `CLAUDE_LENS_PORT` env var

### Startup Flow (`claude-lens start`)

1. Check for updates (fetch `npm view claude-lens version`, 3s timeout)
2. If newer version exists: run `npm install -g claude-lens@latest`, re-exec self
3. Check if server already running (PID file + process alive check)
4. If running: print URL, open browser, exit
5. Spawn `node app/server.js`, write PID
6. Wait for health check (poll `http://localhost:PORT` up to 10s)
7. Print URL, open browser, exit

## 3. Auto-Update Mechanism

### Version Check

- On every `claude-lens start`, run `npm view claude-lens version` to get the latest published version
- Compare against locally installed version from own `package.json`
- If network unavailable, skip silently (3s timeout)

### Auto-Update Flow

```
claude-lens start
  -> fetch latest version (3s timeout)
  -> if same version: proceed to start server
  -> if newer version:
       print "Updating claude-lens 0.1.0 -> 0.2.0..."
       run: npm install -g claude-lens@latest
       if success:
         print "Updated successfully"
         re-exec: claude-lens start (the new binary)
       if failure:
         warn "Update failed, starting with current version"
         proceed to start server
```

### Manual Update

`claude-lens update` runs the same logic but always attempts the install, even if already on latest. Useful if installation is corrupted.

### Re-exec Detail

After `npm install -g claude-lens@latest` replaces the binary, the CLI uses `process.execPath` with the same args to restart itself with the new code, ensuring the new version's startup logic runs.

No background polling for now. Update check only on `claude-lens start` and `claude-lens update`. The future daemon can take over periodic checks.

## 4. Stats Commands

### `claude-lens stats` (Light Summary)

Reads `~/.claude/projects/` directly using `@claude-lens/parser` (bundled in CLI). No running server required.

```
Claude Code Token Usage Report - Daily

Date        Models              Input    Output    Cache      Cache       Total       Cost
                                                   Create     Read        Tokens      (USD)
2025-04-10  opus-4, sonnet-4    1,257    47,773    705,365    15,800,...  16,555,...   $14.17
2025-04-09  opus-4, sonnet-4    9,358    26,086    947,715    16,997,...  17,980,...   $11.48
2025-04-08  opus-4, sonnet-4    4,585    17,794    3,016,0..  12,514,...  15,552,...   $24.40
...
Total                           76,368   304,715   13,155,..  269,138..   282,675,..  $212.82

  -> 3 sessions today . 12 projects active (7d)
```

Quick, scriptable, exits immediately.

### `claude-lens stats --live` (Rich TUI)

Auto-refreshing terminal UI (every 2s), raw ANSI codes with `process.stdout.write` (no extra dependencies). Shows:

- The same daily token table, auto-refreshing
- Active sessions currently streaming
- Top projects by token usage (7d)
- Press `q` to quit

### Date Filtering

- `claude-lens stats -s 20250401` — since a specific date
- `claude-lens stats --days 7` — last N days

### Cost Estimation

A pricing table mapping model IDs to per-token costs (input, output, cache read, cache write). Hardcoded current Anthropic pricing, updated with each release. Same approach as ccusage with LiteLLM pricing.

### Data Source

The parser already extracts all required fields:
- Model names (`SessionMeta.model`)
- Input/output tokens (`Usage.input`, `Usage.output`)
- Cache read/write (`Usage.cacheRead`, `Usage.cacheWrite`)
- All deduped per `message.id` matching ccusage's approach

## 5. GitHub Release Automation

### Release Workflow

Tag-driven. Pushing a `v*` tag triggers the GitHub Action.

**`.github/workflows/release.yml`:**

```yaml
# Trigger: push tag v*

# Job 1: build
#   - Checkout repo
#   - Setup Node 20 + pnpm
#   - pnpm install --frozen-lockfile
#   - pnpm build (parser + web)
#   - Copy Next.js standalone output into packages/cli/app/
#   - Copy .next/static into packages/cli/app/.next/static
#   - Build CLI (tsc)
#   - Run tests + typecheck

# Job 2: publish (needs: build)
#   - npm publish packages/cli/ (with NPM_TOKEN secret)

# Job 3: release (needs: publish)
#   - Create GitHub Release from tag
#   - Auto-generate changelog from commits since last tag
```

### Version Sync

A root-level `scripts/version-sync.mjs` hooks into npm's `version` lifecycle via `preversion` script. When `npm version minor` runs at the root:

1. npm bumps root `package.json`
2. `preversion` script syncs the version to `packages/cli/package.json`, `packages/parser/package.json`, and `apps/web/package.json`
3. npm creates the commit and tag

### Developer Workflow

```bash
npm version patch|minor|major    # bumps all packages, commits, tags
git push --follow-tags           # triggers CI -> npm publish -> GitHub Release
```

### NPM_TOKEN

Stored as a GitHub repository secret. Generated once via `npm token create`.

## 6. Agent-Driven Release Process

### CLAUDE.md Release Instructions

The repo's `CLAUDE.md` includes a release process section so any Claude Code session (human or scheduled agent) knows when and how to release.

### Release Criteria

An agent should trigger a release when:
- A user-facing change is complete (new feature, bug fix, UX improvement)
- Tests pass (`pnpm verify`)
- The change is on `master`

### Version Bump Rules

| Bump | When | Example |
|------|------|---------|
| `patch` | Bug fixes, small tweaks | 0.1.0 -> 0.1.1 |
| `minor` | New features, new commands, notable improvements | 0.1.0 -> 0.2.0 |
| `major` | Breaking changes | 0.x -> 1.0 (not until v1) |

### Agent Release Commands

```bash
pnpm verify                      # tests + typecheck pass
npm version patch|minor          # bumps all packages, commits, tags
git push --follow-tags           # triggers CI -> npm publish -> GitHub Release
```

The agent does not need npm credentials. It pushes the tag; GitHub Actions handles the actual publish with the stored `NPM_TOKEN`.

## 7. CLAUDE.md Contents

The `CLAUDE.md` file at repo root will include:

- **Project overview:** What claude-lens is, local-only dashboard for Claude Code sessions
- **Architecture:** Monorepo layout (packages/cli, packages/parser, apps/web)
- **Dev commands:** `pnpm dev`, `pnpm build`, `pnpm verify`, `pnpm test`
- **Package roles:** CLI (npm-distributed entry point), parser (JSONL parsing + analytics), web (Next.js dashboard)
- **Version sync:** All packages share one version; use `npm version` at root, never edit package.json versions manually
- **Release process:** The criteria and commands described in section 6
- **Testing:** `pnpm verify` runs typecheck + smoke tests; parser has vitest unit tests
- **Port:** Default 3321

## Future Extensibility

This design explicitly supports future team features without architectural changes:

- **`claude-lens daemon start/stop`** — another managed process, same PID pattern as the server
- **`claude-lens login`** — auth tokens stored in `~/.claude-lens/config.json`
- **`claude-lens team`** — team dashboard commands
- **Background auto-update** — the daemon can periodically check for updates

The CLI is the control plane; new features are new commands and new managed processes.

## Migration

The existing `install.sh` remains for users who prefer the current approach. It can be updated to suggest `npm install -g claude-lens` as the recommended method. No breaking changes to existing installations.
