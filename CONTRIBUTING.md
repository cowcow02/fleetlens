# Contributing to Fleetlens

Thanks for your interest in Fleetlens — a local-first, privacy-first observability dashboard for multi-agent coding fleets. This guide covers local setup and pull-request expectations.

## Development setup

Requirements: Node.js 20+ and pnpm.

```bash
pnpm install
```

Common commands (defined in the root `package.json`):

```bash
pnpm dev          # Start all packages in watch mode
pnpm build        # Build parser → web → cli (Turborepo, parallel where possible)
pnpm test         # Run vitest across all packages
pnpm typecheck    # tsc --noEmit across all packages
pnpm verify       # typecheck + smoke tests against a running dev server
pnpm lint         # ESLint across all packages
pnpm clean        # Remove all build artifacts
```

For the bundled-CLI build flow and other developer workflows, see `CLAUDE.md`.

### Postgres prerequisite (team-server)

The Team Edition server needs a local Postgres for dev and tests:

- **Tests**: `createdb fleetlens_test` once, then `pnpm test` works — the
  team-server suite defaults to `postgres://localhost:5432/fleetlens_test`,
  migrates it automatically, and **truncates every table between tests** (it
  refuses databases whose name doesn't contain `test`). Without Postgres
  running, team-server's tests fail with connection errors; every other
  package's tests pass without it.
- **Dev**: the root `pnpm dev` starts team-server too, which crashes at boot
  without `DATABASE_URL`. See `packages/team-server/README.md` → "Local
  development" for the full env setup, or run per-package dev commands.

## Monorepo layout

pnpm + Turborepo monorepo:

- **`packages/parser`** — Pure TypeScript agent adapters, common types, analytics, and filesystem readers. The browser-facing entry has no Node-only dependencies.
- **`packages/entries`** — Day-scoped work units and the day/week/month digest pipelines.
- **`packages/cli`** — The published `fleetlens` binary and its detached daemon worker.
- **`packages/team-server`** — Self-hosted Team Edition service (Docker image, Postgres model). Separate release track.
- **`apps/web`** — The local Next.js dashboard, bundled into the CLI as standalone output.

## Pull requests

Before opening a PR:

- [ ] `pnpm test` passes.
- [ ] `pnpm typecheck` passes — CI runs this and the release will fail otherwise.
- [ ] **CHANGELOG entry added** for every user-facing change.

### Why CHANGELOG entries are mandatory

The release gate (`scripts/check-changelog.mjs`) **hard-fails** if a tag has no matching `## [<version>]` heading. Which file you edit depends on the track:

- CLI / dashboard changes → root **`CHANGELOG.md`** (released via `v*` tags → npm).
- Team-server changes → **`packages/team-server/CHANGELOG.md`** (released via `server-v*` tags → GHCR).

Add your change under a `## [<version>] — YYYY-MM-DD` heading matching the next planned release, following the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) style already used in those files.

## Two independent release tracks

Fleetlens ships on two independent tracks. A PR may touch one or both, but a release on one track never triggers the other:

| Track | Source of truth | Tag | Distribution |
|---|---|---|---|
| **CLI** | root `package.json` | `v<x.y.z>` | npm package `fleetlens` |
| **Team-server** | `packages/team-server/package.json` | `server-v<x.y.z>` | GHCR image `ghcr.io/cowcow02/fleetlens-team-server` |

Never edit sub-package `version` fields manually — use the documented release commands in `CLAUDE.md` → "Release process".

## Code style

Taken from the conventions in `CLAUDE.md`:

- **Comments only for WHY** — hidden invariants, past incidents, non-obvious behavior. Never narrate *what* the code does.
- **No placeholder abstractions.** Three similar lines beats a premature helper.
- **No feature flags or backwards-compat shims** unless explicitly requested. Just change the code.
- **Error handling only at system boundaries.** Trust framework guarantees inside the app.
- **Brand:** "Fleetlens" (capitalized, proper noun) in UI and prose; `fleetlens` (lowercase) for the CLI/npm binary.

## License

By contributing, you agree your contributions are licensed under the project's [MIT license](./LICENSE).
