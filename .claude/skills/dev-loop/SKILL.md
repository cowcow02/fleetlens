---
name: dev-loop
description: Use after changing parser, web, or CLI code to see the change actually running, and before claiming any change works — covers the standalone rebuild flow, smoke verification, and the port/cache/worktree traps that repeatedly bite agents in this repo.
---

# Fleetlens dev loop — build, run, verify

## When to use

Any change to `packages/parser`, `packages/entries`, `apps/web`, or
`packages/cli` that you intend to call done. A green typecheck is not a
working feature: **exercise the real artifact and show the observed output.**

For team-server changes use the `team-server-dev` skill instead.

## The loop

```bash
cd <repo-root>   # ALWAYS explicit — see "Worktree cwd drift" below

# 1. Build the web standalone into the CLI's app dir
rm -rf apps/web/.next packages/cli/app
NEXT_OUTPUT=standalone pnpm build
node scripts/prepare-cli.mjs

# 2. Boot the bundled CLI (kill leftovers first; the port lingers)
node packages/cli/dist/index.js stop
lsof -ti:3321 | xargs kill -9 2>/dev/null
node packages/cli/dist/index.js web usage
# → http://localhost:3321/usage
```

Without `prepare-cli.mjs` the CLI silently serves the **old** bundle — if your
change "isn't showing up", this is the first thing to check.

## Verifying

- `pnpm verify` = typecheck + smoke tests against the **already-running** dev
  server (every route must return 200). Never rebuild just to validate — if
  smoke fails, the running server's logs tell you what broke; a rebuild only
  hides the evidence.
- For UI changes, load the affected page and describe what you actually saw.
  For CLI changes, run the actual command and paste the real output.
- `pnpm test` runs vitest across all packages. Team-server's suite needs a
  local Postgres with a `fleetlens_test` database (`createdb fleetlens_test`
  once); every other package passes without it.

## Traps (each of these has burned a session)

- **Worktree cwd drift.** In a worktree, the shell's cwd can silently reset
  to the primary checkout after any `cd` away. Greps, seds, `git status`, and
  builds then run against the WRONG TREE and lie convincingly. Prefix every
  build/test/grep command with an explicit `cd <abs-worktree-path> &&`, and
  if a result is surprising, run `pwd` before believing it.
- **Standalone cache.** The turbo `build` task keys its cache on
  `NEXT_OUTPUT`. If `apps/web/.next/standalone` is missing after a build, the
  env var wasn't set; `pnpm build --force` is the escape hatch if the cache
  ever misbehaves.
- **Zombie server.** `fleetlens stop` + the `lsof` kill above before every
  boot. A stale server on old code is indistinguishable from "my fix didn't
  work".
- **Root `pnpm dev` includes team-server**, which crashes the whole turbo run
  at boot without `DATABASE_URL`. Export the env (see
  `packages/team-server/README.md` → Local development) or run per-package
  dev commands.
