# Fleetlens

Local-only, privacy-first dashboard for **multi-agent** coding fleets. Reads JSONL transcripts from every registered source (Claude Code at `~/.claude/projects/`, Codex CLI at `~/.codex/sessions/`, Gemini CLI at `~/.gemini/tmp/<slug>/chats/`, …) and visualizes agent activity (sessions, parallelism, PR shipping, plan utilization burndown).

Brand: **Fleetlens** (capitalized, proper noun, displayed in UI). CLI binary and npm package: `fleetlens` (lowercase, convention).

---

## Architecture

pnpm + Turborepo monorepo. Three packages that build in order: `parser → web → cli`.

```
fleetlens/                            ← github.com/cowcow02/fleetlens
├── packages/
│   ├── parser/   (@claude-lens/parser)   Pure JSONL parser + analytics. No fs, no network.
│   └── cli/      (fleetlens)             Published to npm. Bundles parser + web standalone.
├── apps/
│   └── web/      (@claude-lens/web)      Next.js 16 dashboard. Bundled into CLI as standalone output.
├── scripts/
│   ├── prepare-cli.mjs                   Copies .next/standalone into packages/cli/app/
│   ├── version-sync.mjs                  Propagates root version → all sub-packages
│   ├── smoke.mjs                         Hits each route on a running dev server, fails on 5xx
│   └── generate-mock-usage.mjs           30 days of realistic fake usage snapshots
└── .github/workflows/release.yml         Tag-driven release pipeline
```

**Parser (`packages/parser`)** — zero-dependency TypeScript. `claude-code.ts` turns a Claude Code JSONL line into a `SessionEvent`. `codex.ts` does the same for Codex CLI rollouts; `gemini.ts` for Gemini CLI chat transcripts. `analytics.ts` aggregates sessions into daily buckets, parallelism points, concurrency bursts, project rollups (works on any agent source). `fs.ts` is the Node-only filesystem scanner (exposed as `@claude-lens/parser/fs` so pure browser consumers don't accidentally pull in `node:fs`) and hosts the `AgentSource` registry — adding the next agent (OpenCode, …) is a new file plus one push to `agentSources` plus one entry in `agent-metadata.ts`.

**CLI (`packages/cli`)** — esbuild-bundled. `dist/index.js` is the entry binary; `dist/daemon-worker.js` is the detached usage-polling worker. Both get shipped inside a single npm package along with the Next.js standalone output.

**Web (`apps/web`)** — Next 16 App Router. Server components read from `@claude-lens/parser/fs` per request, `LiveRefresher` subscribes to `/api/events` SSE and calls `router.refresh()` on file changes.

**Team-server (`packages/team-server`)** — separate Next.js service for the hosted Team Edition. Ships as a Docker image to GHCR (`ghcr.io/cowcow02/fleetlens-team-server`). Has its own release track: `server-v*` tags, self-contained `packages/team-server/package.json` version, migrations under `src/db/migrations/` managed by Drizzle. See the "Versioning" and "Release process" sections below.

---

## Core domain concepts

### Canonical project
A **project** is identified by its `cwd` path with any `/.worktrees/<name>` suffix stripped. Running agents inside `foo/.worktrees/orb-148` and `foo/` both roll up under `foo` — see `canonicalProjectName()` in `parser/src/analytics.ts`. This means `groupByProject` and `listProjects` aggregate all worktree sessions into one project row with a `worktreeCount` badge in the UI.

### Active segments / agent time
A session's raw timestamps are split into **active segments** wherever there's a gap > 3 minutes between events. The sum of segment durations is the session's **agent time** (formerly "air time"). This replaces wall-clock duration as the headline number because it excludes user-away gaps.

Computed in `parser.ts` at parse time and stored on `SessionMeta.activeSegments`. Uses **all timestamped events**, not just conversational — system/summary/sidechain events count too (consistency bug fix in v0.2.x: the earlier conversational-only filter undercounted by up to 100x on sessions with heavy tool use).

### Daily activity bucketing
`dailyActivity(sessions)` in `analytics.ts` splits each session's active segments across **every local day they touch**, not just the day the session started. A session that ran 11 PM → 3 AM contributes to both day-1 and day-2 buckets, weighted by clipped segment duration.

### Concurrency bursts
Raw parallel-run detection produces dozens of sub-minute fragments (every 3-min pause creates a new "run"). `computeParallelismBursts` in `analytics.ts` collapses these with two rules:
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

Each migration SQL file must begin with a `-- description: ...` header so the manifest captures a human-readable summary. See `packages/team-server/src/db/MIGRATIONS.md` for the author workflow and expand/contract rules.

### Publishing gotchas (learned the hard way)
- **npm's similarity check rejects names close to existing packages.** `cclens` was blocked by `cc-lens`, then `claudelens` was blocked by `claude-lens`. The fix is either (a) a scoped package `@<user>/<name>` or (b) a distinctively different name. `fleetlens` passed because no `fleet-lens` existed.
- **Always check both the bare name AND the hyphenated variant** with `npm view <name>` before committing to a rename — the similarity check compares against known packages, so if `foo-bar` exists, `foobar` will probably be blocked.
- **Do not paste tokens in chat.** Set `NPM_TOKEN` via `gh secret set NPM_TOKEN` which prompts for the value and sends it directly to GitHub. Tokens shared inline are burned.

---

## Auto-update

`checkForUpdate()` runs at the start of `fleetlens start` (skipped in dev mode, detected by the `packages/cli/` path in `argv[1]`). Flow:

1. Query `registry.npmjs.org/fleetlens/latest` with a 3-second timeout
2. If newer version exists:
   - **Stop any running web server + daemon** (so the re-exec lands on fresh processes, not a zombie server on old code)
   - `npm install -g fleetlens@latest`
   - `reportInstallOutcome()` prints where it actually landed and warns if `PATH` resolves to a different install (nvm / homebrew / system multi-Node trap)
   - `reExec()` spawns the freshly-installed `<npm root -g>/fleetlens/dist/index.js` directly — bypasses PATH and shell command hashes entirely
3. The re-exec'd process sees `__FLEETLENS_UPDATED=1`, skips the update check, and proceeds to launch server + daemon normally

`fleetlens update` (forceUpdate) behaves the same way but only tears down running services on a real version bump — reinstalling the same version is a no-op and shouldn't disrupt an open dashboard tab.

### Why auto-update used to be broken
- **"Updated to X.Y.Z" but `--version` still showed old** — the running process is itself the old binary. `reExec` now uses the freshly-installed file path directly so the handoff is reliable.
- **False-positive "DIFFERENT install" warning** — earlier version compared the bin symlink (`<prefix>/bin/fleetlens`) against the package dir (`<prefix>/lib/node_modules/fleetlens`) with `startsWith`. They're siblings, not parent/child. Fixed by following the symlink via `realpathSync` and checking if it lands inside the package dir.
- **Zombie old server** — old flow installed the new binary but left the old server running. New flow stops server + daemon before installing so the re-exec'd new binary brings up everything fresh.

---

## Insights pipeline (V2 perception layer)

`/insights` renders weekly and monthly digests synthesized from per-day
perception entries. The chain is strictly hierarchical so each layer only
talks to the one immediately below it:

```
JSONL (~/.claude/projects)    ──► parseTranscript ──► SessionDetail
SessionDetail                 ──► entryBuilder    ──► Entry (one per session × local-day)
Entry[]                       ──► enrichEntry     ──► Entry with LLM brief_summary, friction, outcome
Entry[] for one day           ──► generateDayDigest   ──► DayDigest
DayDigest[] for Mon-Sun       ──► generateWeekDigest  ──► WeekDigest (trajectory, standout days)
WeekDigest[] for a month      ──► generateMonthDigest ──► MonthDigest (trajectory, standout weeks)
```

Files:
- `packages/entries/src/build.ts` — `SessionDetail → Entry[]`, deterministic.
- `packages/entries/src/enrich.ts` — `Entry → enriched Entry` via `claude -p`.
- `packages/entries/src/digest-day.ts` — `Entry[] → DayDigest`.
- `packages/entries/src/digest-week.ts` — `DayDigest[] → WeekDigest`.
- `packages/entries/src/digest-month.ts` — `WeekDigest[] → MonthDigest`.
- `packages/entries/src/digest-{day,week,month}-pipeline.ts` — async-generator SSE pipelines that auto-fill missing dependencies, persist past-period digests to disk, and stream events to the route handler.
- `apps/web/app/api/digest/{day,week,month}/[key]/route.ts` — GET (read cached) + POST (run pipeline, stream SSE).
- `apps/web/app/api/digest/{week,month}-index/route.ts` — picker source for the history list.
- `apps/web/app/insights/page.tsx` — server component. Auto-fires last-completed-week digest when the cache is empty and no interactive pipeline lock is currently fresh.
- `packages/cli/src/perception/backfill.ts` — daemon-side counterpart: after the first successful perception sweep on each boot, fires both the week-digest pipeline (last completed ISO week) and the day-digest pipeline (yesterday) if AI is on, the digest isn't cached, entries exist, and no interactive lock is fresh. Opt-out via `ai_features.auto_backfill_last_week` and `ai_features.auto_backfill_yesterday` respectively. The homepage `AutoGenerateYesterday` trigger remains as a fallback so users running with `--no-daemon` still get yesterday's digest on first homepage visit.
- `apps/web/components/{week,month}-digest.tsx` — presentational. Pure functions of their digest type.
- `apps/web/components/{week,month}-digest-view.tsx` — client wrappers that handle SSE generation + force-regen.

Key invariants:
- **Raw JSONL enters the pipeline only at entry-build time.** After that, every layer sees the digest one level below it — never raw transcripts, never sessions.
- **Past-period digests are immutable on disk.** `~/.cclens/digests/{day,week,month}/<key>.json`. Schema-version bump is the only permitted regeneration trigger.
- **Current period uses 10-min in-memory TTL.** Today's day digest, this week's week digest, this month's month digest are never persisted; they live in-process and recompute on expiry.
- **Auto-fire covers yesterday + last week.** Yesterday's day digest auto-fires on daemon boot (and on homepage load as a fallback for `--no-daemon`). Last week's week digest auto-fires on daemon boot and on first `/insights` visit while its cache is empty. Monthly stays manual. The interactive pipeline lock (`~/.cclens/llm-interactive.lock`, heartbeat-refreshed every 30 s) is the single source of truth for "currently running" across all auto-fire paths — there's no separate fire-once file. A half-completed run leaves no digest and no fresh lock, so the next caller naturally retries.
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

```bash
fleetlens start [--port N] [--open] [--no-daemon]
fleetlens stop
fleetlens status
fleetlens update
fleetlens entries [--day D|--session ID|--all] [--json]
fleetlens digest day   [--date D|--yesterday|--today] [--json]
fleetlens digest week  [--week D|--last-week|--this-week] [--json]
fleetlens digest month [--month YYYY-MM|--last-month|--this-month] [--json]
fleetlens usage [--save]
fleetlens usage --history [-s D] [--days N]
fleetlens web [page] [--open]
fleetlens daemon <start|stop|status|logs>
fleetlens version
```

**Design:** `start` and `stop` manage **both** the web server AND the usage daemon in one call. That's the "common path" — almost everyone wants them together. Power users who want to manage them separately can use `fleetlens daemon <subcommand>` directly, or pass `--no-daemon` to `start`.

`fleetlens web [page]` ensures the dashboard server is running, then prints the requested page URL. Opening that URL establishes the live connection that can recover a stopped daemon; the command itself does not start the daemon. Pass `--open` to also launch the URL in a browser; the default is print-only because auto-opening a browser surprised users in some terminals.

**`fleetlens digest week` / `month` reproduce the same digests served at `/insights`.** Each consumes the layer immediately below — `digest week` reads day digests (auto-filling missing past-day digests), `digest month` reads week digests. Use `--json` for byte-equal output to the corresponding `/api/digest/{week,month}/<key>` GET response.

```bash
fleetlens digest week --json    # last completed week
fleetlens digest week --week 2026-04-13 --json
fleetlens digest month --json   # last completed month
```

### Port
Default 3321. Override with `--port N` or `CCLENS_PORT` env var.

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
