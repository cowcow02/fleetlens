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

## Project skills — read these before the matching task

Battle-tested playbooks live in `.claude/skills/` (Claude Code discovers and
invokes them automatically; Codex and other agents should read the relevant
`SKILL.md` before starting):

- `.claude/skills/dev-loop/` — build & verify a change locally: standalone rebuild flow, smoke tests, the port/cache/worktree-cwd traps.
- `.claude/skills/add-agent-source/` — add a new coding-agent session source end-to-end (the canonical community extension task).
- `.claude/skills/team-server-dev/` — Team Edition: local run, guarded test DB, hand-authored migrations, the fixture-privacy rule.
- `.claude/skills/wrap-up-and-release/` — ship a CLI release: changelog gate → version bump → tag → npm, with the known failure modes.
- `.claude/skills/filing-fleetlens-issues/` — write agent-ready GitHub issues a future session can execute without follow-up questions.

Purpose-built subagents live in `.claude/agents/`: `smoke-qa` (builds and
boots the bundled CLI in isolation, smoke-checks routes, reports evidence)
and `migration-reviewer` (checks DB migrations against the expand/contract
rules).

## Releases

Two independent tracks — CLI (`v*` tags → npm) and team-server (`server-v*`
tags → GHCR). Both hard-fail without a matching `## [<version>]` entry in the
track's CHANGELOG. Exact commands: `CLAUDE.md` → "Release process".

## Conventions

Comments only for WHY. No placeholder abstractions. No feature flags or
backward-compat shims unless asked. Error handling only at system boundaries.
Brand: "Fleetlens" in UI prose, `fleetlens` for the binary/package.
