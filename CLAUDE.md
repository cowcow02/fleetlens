# Fleetlens

Local-only, privacy-first dashboard for **multi-agent** coding fleets. Reads JSONL transcripts from every registered source (Claude Code at `~/.claude/projects/`, Codex CLI at `~/.codex/sessions/`, Gemini CLI at `~/.gemini/tmp/<slug>/chats/`, …) and visualizes agent activity (sessions, parallelism, PR shipping, plan utilization burndown).

Brand: **Fleetlens** (capitalized, proper noun, displayed in UI). CLI binary and npm package: `fleetlens` (lowercase, convention).

---

## Architecture

**Ask CodeGraph, not this file.** The repo is indexed (`.codegraph/`); `codegraph explore "<question>"` returns the relevant symbols' verbatim source, call paths, and blast radius — it answers "where/how does X work" better than prose can (verified 2026-08-09: live-update SSE chain, prepare-cli mechanics, daemon worker internals all graph-sufficient). What the graph can NOT carry is below: build topology, packaging edges, and process knowledge.

pnpm + Turborepo monorepo, `github.com/cowcow02/fleetlens`. Three packages build **in order: `parser → web → cli`**, plus `packages/team-server` (separate Next.js service for the hosted Team Edition; ships as a Docker image to GHCR `ghcr.io/cowcow02/fleetlens-team-server`; own release track — see Versioning).

Constraints and packaging edges the graph doesn't represent:
- **parser** (`@claude-lens/parser`) is deliberately zero-dependency, no fs, no network. The Node-only filesystem scanner is exposed as `@claude-lens/parser/fs` so pure browser consumers never pull in `node:fs` — new parser exports must respect this split. `fs.ts` hosts the `AgentSource` registry: adding the next agent = a new file + one push to `agentSources` + one entry in `agent-metadata.ts`.
- **cli → web is a packaging edge, not an import edge**: web builds with `NEXT_OUTPUT=standalone`, and `scripts/prepare-cli.mjs` copies `.next/standalone` into `packages/cli/app/`. `dist/index.js` (entry binary) and `dist/daemon-worker.js` (detached usage-polling worker) are separate esbuild outputs; both ship inside the single npm package along with the Next standalone output.
- Other scripts: `version-sync.mjs` (root version → sub-packages), `smoke.mjs` (route 5xx check), `generate-mock-usage.mjs`. Release pipeline: `.github/workflows/release.yml`, tag-driven.

---

## Core domain concepts

### Canonical project
A **project** is identified by its `cwd` path with any `/.worktrees/<name>` suffix stripped. Running agents inside `foo/.worktrees/orb-148` and `foo/` both roll up under `foo` — see `canonicalProjectName()` in `parser/src/analytics.ts`. This means `groupByProject` and `listProjects` aggregate all worktree sessions into one project row with a `worktreeCount` badge in the UI.

### Active segments / agent time
A session's raw timestamps are split into **active segments** wherever there's a gap > 3 minutes between events. The sum of segment durations is the session's **agent time** (formerly "air time"). This replaces wall-clock duration as the headline number because it excludes user-away gaps.

Computed in `parser.ts` at parse time and stored on `SessionMeta.activeSegments`. Uses **all timestamped events**, not just conversational — system/summary/sidechain events count too (consistency bug fix in v0.2.x: the earlier conversational-only filter undercounted by up to 100x on sessions with heavy tool use).

### Daily activity bucketing
`dailyActivity(sessions)` splits each session's active segments across **every local day they touch**, not just the day the session started. A session that ran 11 PM → 3 AM contributes to both day-1 and day-2 buckets, weighted by clipped segment duration.

### Concurrency bursts
Raw parallel-run detection produces dozens of sub-minute fragments (every 3-min pause creates a new "run"). `computeParallelismBursts` collapses these with two rules:
1. **Drop overlaps < 1 minute** — kills tab-switch artifacts
2. **Merge overlaps within 10 minutes of each other** — fuses morning bursts into one

A burst is colored **teal** (same-project) or **purple** (cross-project = different repos running at once, the genuinely interesting signal for multi-agent fleet work).

### Dashboard metric unification
- **Sessions** — total count
- **Agent time** — sum of activeSegment durations
- **Tool calls / Turns / Tokens** — session-level rollups
- **Parallelism** — total burst duration + peak concurrency (via `computeBurstsFromSessions` + `summarizeBursts`)
- **Est. cost** — per-model priced (no "upper bound" disclaimer, no ccusage fallback)

---

## Dev commands

```bash
pnpm install
pnpm dev              # Start all packages in watch mode
pnpm build            # parser → web → cli (parallel where possible)
pnpm test             # vitest across all packages (web has --passWithNoTests)
pnpm typecheck        # tsc --noEmit across all packages
pnpm verify           # typecheck + smoke tests (routes must return 200)
pnpm clean            # Remove all build artifacts
pnpm -F fleetlens build   # CLI only (esbuild)
```

### Running the local dev server
```bash
# 1. Build the web standalone into the CLI's app dir
rm -rf apps/web/.next packages/cli/app
NEXT_OUTPUT=standalone pnpm -F @claude-lens/web build
node scripts/prepare-cli.mjs

# 2. Start the CLI which spawns the bundled Next.js server
node packages/cli/dist/index.js stop     # kill any previous
lsof -ti:3321 | xargs kill -9 2>&1       # defensive; port can hang around
node packages/cli/dist/index.js web usage
# → http://localhost:3321/usage
```

This is the flow I use after any change to parser, web, or CLI. Without `prepare-cli.mjs` the CLI still serves the old bundle.

---

## Versioning

**Two independent version tracks:**

| Track | Source of truth | Synced to | Released as | Distribution |
|---|---|---|---|---|
| **CLI** | root `package.json` | `packages/parser`, `packages/cli`, `apps/web` via `scripts/version-sync.mjs` | `v<X.Y.Z>` tag | npm (`fleetlens` package) |
| **Team-server** | `packages/team-server/package.json` (self-contained) | nothing — team-server stands alone | `server-v<X.Y.Z>` tag | GHCR image |

**Never edit sub-package version fields manually.** Always go through the right release command:

- CLI: `npm version <patch|minor|major>` at the repo root.
- Team-server: bump the version and create the commit + tag manually — from the repo root:
  ```bash
  (cd packages/team-server && npm version <patch|minor|major> --no-git-tag-version)
  V=$(jq -r .version packages/team-server/package.json)
  git add packages/team-server/package.json
  git commit -m "$V"
  git tag -a "server-v$V" -m "server-v$V"
  ```
  `--no-git-tag-version` is required because `npm version` relies on `@npmcli/git`'s `is()` check (a `stat()` for `.git` at its own cwd) which returns false from any subdirectory — so npm silently drops the commit + tag step. Tagging manually sidesteps that. The `tag-version-prefix=server-v` in `packages/team-server/.npmrc` is kept for convention and would be used if a future npm release fixes the sub-directory detection.

The web UI reads its version via `import pkg from "../package.json" with { type: "json" }` in `apps/web/app/layout.tsx` and passes it to the sidebar. The team-server UI reads `process.env.APP_VERSION`, baked into the Docker image at build time from `packages/team-server/package.json`.

---

## Release process

**When to release:** after a user-facing change (feature, fix, visible improvement) on `master`.

**Version bump rules:**
- `patch` (0.x.N) — bug fixes, small tweaks, doc polish
- `minor` (0.N.0) — new features, new commands, notable improvements
- `major` (N.0.0) — breaking changes (held until 1.0)

The CLI and team-server release on independent tracks. The CLI workflow does NOT trigger image builds; the team-server workflow does NOT trigger npm publishing.

### Releasing the CLI (`fleetlens` npm package)

```bash
pnpm test && pnpm verify      # Must pass — CI runs these and will fail the release otherwise
# Write the CHANGELOG.md entry for the NEW version BEFORE tagging — the release
# workflow's first step (scripts/check-changelog.mjs) hard-fails the publish if
# the tagged version has no `## [<version>]` heading. This killed the 0.16.3 and
# 0.16.5 releases; 0.16.5 was never published because of it.
npm version patch             # or minor/major — bumps root + syncs parser/cli/web
git push origin master
git push origin v<version>    # pushing the tag triggers .github/workflows/release.yml
```

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which:
1. Runs tests + typecheck
2. Builds parser → web standalone → prepares CLI → builds CLI
3. Publishes to npm via `NPM_TOKEN` (GitHub secret, set with `gh secret set NPM_TOKEN`)
4. Creates a GitHub Release with auto-generated notes

The agent does not need npm credentials. The workflow runs with the stored token.

### Releasing team-server (`ghcr.io/cowcow02/fleetlens-team-server` image)

```bash
pnpm -F @claude-lens/team-server test                              # team-server tests must pass
# Same CHANGELOG gate as the CLI: packages/team-server/CHANGELOG.md needs a
# `## [<version>]` entry for the new version or the image publish fails.
(cd packages/team-server && npm version patch --no-git-tag-version) # or minor/major — bumps team-server only
V=$(jq -r .version packages/team-server/package.json)
git add packages/team-server/package.json
git commit -m "$V"
git tag -a "server-v$V" -m "server-v$V"
git push origin master
git push origin "server-v$V"                                        # pushing the server-v* tag triggers publish-team-server-image.yml
```

See the "Versioning" section above for why `--no-git-tag-version` + manual git commit/tag is necessary (npm can't create commits from a sub-directory).

Pushing a `server-v*` tag triggers `.github/workflows/publish-team-server-image.yml`, which:

1. Reads `APP_VERSION` from `packages/team-server/package.json`.
2. Asserts the tag suffix equals the `package.json` version; fails otherwise.
3. Builds the Docker image with `APP_VERSION` baked in.
4. Publishes the image to GHCR as `:<X.Y.Z>` + `:latest` + `:<sha7>`.
5. Builds `migrations-manifest.json` from `packages/team-server/src/db/migrations/` and publishes it as a GitHub Release asset on `server-v<version>`.

Each migration SQL file must begin with a `-- description: ...` header so the manifest captures a human-readable summary. See `packages/team-server/src/db/MIGRATIONS.md` for the author workflow and expand/contract rules. Migrations are managed by Drizzle and run at server boot (`runMigrations` via `instrumentation.ts`).

### Publishing gotchas (learned the hard way)
- **npm's similarity check rejects names close to existing packages.** `cclens` was blocked by `cc-lens`, then `claudelens` was blocked by `claude-lens`. The fix is either (a) a scoped package `@<user>/<name>` or (b) a distinctively different name. `fleetlens` passed because no `fleet-lens` existed.
- **Always check both the bare name AND the hyphenated variant** with `npm view <name>` before committing to a rename — the similarity check compares against known packages, so if `foo-bar` exists, `foobar` will probably be blocked.
- **Do not paste tokens in chat.** Set `NPM_TOKEN` via `gh secret set NPM_TOKEN` which prompts for the value and sends it directly to GitHub. Tokens shared inline are burned.

---

## Auto-update

Mechanism lives in `checkForUpdate()` / `reExec()` (`packages/cli`) — ask the graph for the current flow. The scar tissue that shaped it:

- **"Updated to X.Y.Z" but `--version` still showed old** — the running process is itself the old binary. `reExec` now uses the freshly-installed file path directly (bypassing PATH and shell hashes) so the handoff is reliable.
- **False-positive "DIFFERENT install" warning** — earlier version compared the bin symlink against the package dir with `startsWith`; they're siblings. Fixed via `realpathSync`.
- **Zombie old server** — old flow installed the new binary but left the old server running. New flow stops server + daemon before installing so the re-exec'd binary brings everything up fresh.
- `fleetlens update` (forceUpdate) only tears down running services on a real version bump — reinstalling the same version must not disrupt an open dashboard tab.

---

## Server watchdog

The daemon HTTP-probes the web server's `/api/health` every 60 s (`runServerHealthCheck` in `daemon-worker.ts`; verdict logic in `watchdog.ts`, unit-tested). Process liveness is never trusted — a GC-livelocked next-server keeps its pid and port while serving nothing (2026-07-18 incident). Any completed response counts as alive (old bundles 404 the route; a wedged loop can't answer at all); only timeouts/refusals count as failures. Three consecutive failed probes → SIGKILL + relaunch on the same port; SIGTERM is pointless because a starved event loop never runs the handler. Restarts cap at 3/hour (re-wedging pages would otherwise cause flap loops), then the watchdog stands down until the window slides. Failure runs reset per server instance (pid change); an observed stop (pid file gone) re-arms the cap too. No pid file = intentionally stopped = never touched. `fleetlens status` runs the same probe and reports "running but UNRESPONSIVE" instead of trusting the pid; startup's `waitForHealth` still gates on `/` so a broken bundle fails `fleetlens start` loudly.

---

## Insights pipeline (V2 perception layer)

`/insights` renders weekly and monthly digests synthesized from per-day perception entries. The chain is strictly hierarchical so each layer only talks to the one immediately below it (file locations: ask the graph — `packages/entries/src/*`, digest routes under `apps/web/app/api/digest/`):

```
JSONL (~/.claude/projects)    ──► parseTranscript ──► SessionDetail
SessionDetail                 ──► entryBuilder    ──► Entry (one per session × local-day)
Entry[]                       ──► enrichEntry     ──► Entry with LLM brief_summary, friction, outcome
Entry[] for one day           ──► generateDayDigest   ──► DayDigest
DayDigest[] for Mon-Sun       ──► generateWeekDigest  ──► WeekDigest (trajectory, standout days)
WeekDigest[] for a month      ──► generateMonthDigest ──► MonthDigest (trajectory, standout weeks)
```

Key invariants:
- **Raw JSONL enters the pipeline only at entry-build time.** After that, every layer sees the digest one level below it — never raw transcripts, never sessions.
- **Past-period digests are immutable on disk.** `~/.cclens/digests/{day,week,month}/<key>.json`. Schema-version bump is the only permitted regeneration trigger.
- **Current period uses 10-min in-memory TTL.** Today's day digest, this week's week digest, this month's month digest are never persisted; they live in-process and recompute on expiry.
- **Auto-fire covers yesterday + last week.** Yesterday's day digest auto-fires on daemon boot (and on homepage load as a fallback for `--no-daemon`). Last week's week digest auto-fires on daemon boot and on first `/insights` visit while its cache is empty. Monthly stays manual. The interactive pipeline lock (`~/.cclens/llm-interactive.lock`, heartbeat-refreshed every 30 s) is the single source of truth for "currently running" across all auto-fire paths — there's no separate fire-once file. A half-completed run leaves no digest and no fresh lock, so the next caller naturally retries. Daemon-side backfill opt-outs: `ai_features.auto_backfill_last_week` / `ai_features.auto_backfill_yesterday`.
- **Persistence keys are sortable.** `week-YYYY-MM-DD` (Monday) / `month-YYYY-MM`. Lexical sort = reverse-chronological.

## State directory

`~/.cclens/` (not `~/.fleetlens/` — preserved for backward compat with any existing local dev state):

```
~/.cclens/
├── pid                Web server PID + port
├── daemon.pid         Usage daemon PID
├── daemon.log         Daemon stderr (last 20 lines shown by `fleetlens daemon logs`)
└── usage.jsonl        Append-only log of plan utilization snapshots (5-min polling)
```

Dashboard / Timeline / Calendar all read session JSONL from `~/.claude/projects/` — that's Claude Code's native location, not ours. Only the daemon's usage snapshot log lives in `~/.cclens/`.

---

## CLI command surface

Full surface: `fleetlens --help`. Design decisions that aren't in the help text:

- **`start` and `stop` manage both the web server AND the usage daemon in one call.** That's the common path. Power users manage them separately via `fleetlens daemon <subcommand>` or `--no-daemon`.
- `fleetlens web [page]` ensures the dashboard server is running, then **prints** the page URL (default print-only — auto-opening a browser surprised users in some terminals; `--open` to launch).
- **`fleetlens digest week` / `month` reproduce the same digests served at `/insights`.** Each consumes the layer immediately below — `digest week` reads day digests (auto-filling missing past-day digests), `digest month` reads week digests. `--json` is byte-equal to the corresponding `/api/digest/{week,month}/<key>` GET response.
- Port: default 3321. Override with `--port N` or `CCLENS_PORT`.

---

## Testing conventions

- **Parser**: real unit tests via vitest (`packages/parser/test/*.test.ts`). Run with `pnpm -F @claude-lens/parser test`. Covers `parseTranscript`, `dailyActivity`, `groupByProject`, `computeBurstsFromSessions`, etc.
- **CLI**: unit tests for pure helpers (`pid.test.ts`, `updater.test.ts`, `pricing.test.ts`). Integration testing is via the smoke script.
- **Web**: `--passWithNoTests` — no vitest tests yet. Validation happens via `scripts/smoke.mjs` which hits each route on a running dev server. Run via `pnpm verify`.
- **Never rebuild the cache for validation.** Run the already-running dev server and use `pnpm verify` which drives smoke tests against it. If smoke fails, the dev server logs show what broke — that's more informative than re-running builds.

---

## Code style + conventions

- **Kept deliberately brief.** No multi-paragraph docstrings, no comments explaining WHAT the code does. Comments only for WHY — hidden invariants, past incidents, workarounds, non-obvious behavior.
- **No feature flags or backwards-compat shims** unless the user asks for them. Just change the code.
- **No placeholder abstractions.** Three similar lines beats a premature helper.
- **Error handling only at system boundaries.** Trust framework guarantees inside the app.
- **Project identity is the canonical cwd path**, not the raw `~/.claude/projects/<encoded>` directory. URLs use `encodeURIComponent(canonicalName)` as the slug. The parser's `SessionMeta.projectDir` is still the raw encoded form (filesystem reality), but rollups and UI links use the canonical.
- **Concurrency over parallelism.** The timeline page uses the term "Concurrency" throughout. `×N` in teal = same-project, `×N` in purple = cross-project (genuinely interesting signal).
- **Agent time, not active time.** Renamed in v0.2.x for clarity — "agent time" is more specific than "active time" and less overloaded with other meanings.

---

## Brand vs command naming

- **UI**: `Fleetlens` (capitalized, proper noun). Sidebar header, page title, metric card labels in prose.
- **CLI / npm / imports**: `fleetlens` (lowercase). Convention for Unix commands and npm packages. The `bin` entry in `packages/cli/package.json` is a single `fleetlens` binary.
- **GitHub repo**: `cowcow02/fleetlens`. Internal workspace package names (`@claude-lens/parser` / `@claude-lens/web`) are still the old brand — they're private, never published to npm, and renaming them would churn every import across the codebase for zero user-visible benefit.
