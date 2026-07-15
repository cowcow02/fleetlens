---
name: team-server-dev
description: Use when developing the Team Edition server (packages/team-server) — local run, tests against the guarded fleetlens_test database, authoring hand-written DB migrations, demo data, and the fixture-privacy rule.
---

# Team Edition (team-server) development

`packages/team-server/README.md` is the reference (local development,
architecture orientation, env vars). This skill is the working checklist an
agent needs in-loop.

## Run locally

```bash
createdb fleetlens_local
DATABASE_URL=postgres://localhost:5432/fleetlens_local \
FLEETLENS_ENCRYPTION_KEY=$(openssl rand -hex 32) \
BASE_URL=http://localhost:3322 \
pnpm -F @claude-lens/team-server dev
```

Migrations apply automatically on boot; the **first signup becomes the
staff/admin account**. Root `pnpm dev` also boots team-server and crashes the
whole turbo run without `DATABASE_URL` — export first or run per-package.

## Tests

```bash
createdb fleetlens_test    # once
pnpm -F @claude-lens/team-server test
```

The suite defaults to `postgres://localhost:5432/fleetlens_test`, migrates it,
and **truncates every table between tests**. It refuses any database whose
name doesn't contain `test` — do not weaken that guard, and never point
`DATABASE_URL` at a database you care about.

## Authoring a migration

Read `packages/team-server/src/db/MIGRATIONS.md` first. Non-negotiables:

- **Hand-write the SQL file** (`src/db/migrations/NNNN_<desc>.sql`, next free
  number). Do NOT run `drizzle-kit generate` — the journal is frozen at 0008
  and it emits a corrupt migration re-creating existing tables.
- First line must be `-- description: ...` (release pipeline hard-fails
  without it).
- **Expand/contract**: every migration must be safe under the PREVIOUS
  container version still serving. DROP/RENAME take two releases — 0015
  (expand) → 0016 (contract) is the worked example.
- Update `src/db/schema.ts` in the same commit; run the test suite — it
  applies every migration including orphans.
- Use the `migration-reviewer` agent (`.claude/agents/migration-reviewer.md`)
  on the diff before opening the PR.

## Fixture-privacy rule (hard requirement)

All demo/mock/test data in this package is fictional by construction:
project `orbit-shop`, tickets `ORB-<n>`, members Erin/Alice/Bob/Dana, emails
`@example.com`. Never introduce real employer/customer names, real ticket
prefixes, or real people into `insights-mock-data.ts`, seed scripts, or test
fixtures — the `?mock=1` demo view renders this content to real customers,
and scrubbing leaked data once cost a dedicated audit round.

## Releasing

Own track: entry in `packages/team-server/CHANGELOG.md`, then version bump +
`server-v<X.Y.Z>` tag (exact commands in root `CLAUDE.md` → Release process —
the npm-from-subdirectory gotcha is real). Ships to GHCR; customers pin
`:X.Y.Z` tags, `:latest` tracks master.
