# Fleetlens — agent & contributor orientation

**`CLAUDE.md` at the repo root is the single source of truth** for architecture,
domain concepts, dev commands, versioning, and the release process. Read it
first — this file intentionally repeats only the essentials so it can't drift.

## What this is

Local-first, privacy-first dashboard for multi-agent coding fleets. The CLI
(`fleetlens` on npm) reads JSONL transcripts written by coding agents (Claude
Code at `~/.claude/projects/`, Codex CLI at `~/.codex/sessions/`, Gemini CLI,
Grok, and other registered sources) and serves a local Next.js dashboard.
The Team Edition (`packages/team-server`) is a separate self-hosted service
shipped as a Docker image (`ghcr.io/cowcow02/fleetlens-team-server`).

## Layout

- `packages/parser` — pure JSONL parsing + analytics (`@claude-lens/parser`; internal workspace names keep the old brand deliberately).
- `packages/entries` — day-scoped Entry + day/week/month digest pipelines.
- `packages/cli` — the published `fleetlens` binary + usage daemon.
- `packages/team-server` — Team Edition server. See `packages/team-server/README.md` for local dev, tests, architecture, and `src/db/MIGRATIONS.md` for migrations.
- `apps/web` — the local dashboard, bundled into the CLI as Next.js standalone output.

## Commands

```bash
pnpm install
pnpm typecheck        # tsc across all packages
pnpm test             # vitest across all packages — team-server needs local Postgres (see below)
pnpm build            # parser → web → cli
pnpm dev              # watch mode — crashes without team-server's DATABASE_URL; see below
```

Team-server needs Postgres for dev and tests: `createdb fleetlens_test` for
tests (the suite migrates it automatically and truncates it between tests) and
a `DATABASE_URL` for `pnpm dev`. Details: `packages/team-server/README.md`.

## Releases

Two independent tracks — CLI (`v*` tags → npm) and team-server (`server-v*`
tags → GHCR). Both hard-fail without a matching `## [<version>]` entry in the
track's CHANGELOG. Exact commands: `CLAUDE.md` → "Release process".

## Conventions

Comments only for WHY. No placeholder abstractions. No feature flags or
backward-compat shims unless asked. Error handling only at system boundaries.
Brand: "Fleetlens" in UI prose, `fleetlens` for the binary/package.
