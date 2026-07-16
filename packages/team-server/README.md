# Fleetlens Team Server

The Team Server is the self-hosted **Team Edition** of Fleetlens. It is a standalone Next.js service backed by Postgres that ingests derived rollups, usage snapshots, and optional enriched extras synced from each member's local CLI. Raw prompts, assistant responses, absolute paths, file contents, and excluded projects are **not** part of the sync contract.

It ships as a Docker image:

```
ghcr.io/cowcow02/fleetlens-team-server
```

Members pair a local CLI with a deployed server via:

```bash
fleetlens team join https://your-fleetlens.example <invite-token>
fleetlens team status
fleetlens team sync
```

## Deploy

Deployment paths (each has its own README):

- Railway one-click template — [`../../deploy/railway/README.md`](../../deploy/railway/README.md)
- Google Cloud installer — [`../../deploy/gcp/README.md`](../../deploy/gcp/README.md)
- Docker Compose — [`../../deploy/compose/README.md`](../../deploy/compose/README.md)
- AWS Terraform module — [`../../deploy/terraform/aws/README.md`](../../deploy/terraform/aws/README.md)

## Local development

Prerequisites: Node 20+, pnpm, and a local Postgres.

```bash
createdb fleetlens_local

DATABASE_URL=postgres://localhost:5432/fleetlens_local \
FLEETLENS_ENCRYPTION_KEY=$(openssl rand -hex 32) \
BASE_URL=http://localhost:3322 \
pnpm -F @claude-lens/team-server dev
```

Open `http://localhost:3322`. Migrations run automatically on every boot
(`src/instrumentation.ts` → `src/db/migrate.ts`), and the **first account to
sign up becomes the staff/admin account** — there is no separate bootstrap
step. Keep `FLEETLENS_ENCRYPTION_KEY` stable across restarts once you've
stored integration credentials (GitHub/Linear/Jira/email); rotating it makes
them unreadable.

Heads-up: the root `pnpm dev` starts every package's watcher **including
team-server**, so without `DATABASE_URL` exported the whole turbo run crashes
at boot. Export the variables above first, or run per-package dev commands.

To pair a member CLI against a local server for a dev loop, create an invite
in the UI and run `fleetlens team join http://localhost:3322 <invite-token>`.

Demo data: `node scripts/seed-team-demo.mjs --reset` (repo root) builds a
seeded demo database. The script replays only the Drizzle-journaled migrations
(through 0008); boot the server once against that database so the migration
runner's orphan fallback applies the rest (0009+) before you inspect tables.

## Running the tests

```bash
createdb fleetlens_test
pnpm -F @claude-lens/team-server test
```

The suite defaults to `postgres://localhost:5432/fleetlens_test`, applies all
migrations automatically, and **truncates every table between tests**. As a
guard, it refuses to run against a database whose name doesn't contain
`test` — never point `DATABASE_URL` at a database you care about.

## Migrations

Database migrations live under [`src/db/migrations/`](./src/db/migrations) and are managed with Drizzle. For the author workflow and expand/contract rules, see [`src/db/MIGRATIONS.md`](./src/db/MIGRATIONS.md).

Each migration SQL file must begin with a `-- description: ...` header so the release pipeline can build a human-readable `migrations-manifest.json`.

## Architecture orientation

Each area is one library module plus the API routes that call it — start from
these files and follow the imports:

- **Ingest** — [`src/lib/ingest.ts`](./src/lib/ingest.ts) + [`src/app/api/ingest/`](./src/app/api/ingest). Member CLIs push derived daily rollups, plan-utilization snapshots, and optional enriched extras. Raw transcripts never reach the server; each push is logged to `member_sync_log` for the admin-visible sync history.
- **Read-side queries** — [`src/lib/queries.ts`](./src/lib/queries.ts), [`src/lib/plan-queries.ts`](./src/lib/plan-queries.ts), [`src/lib/rollup-join.ts`](./src/lib/rollup-join.ts) power the team dashboard pages.
- **Insights reports** — [`src/lib/team-report-aggregate.ts`](./src/lib/team-report-aggregate.ts) and [`src/lib/insights-aggregate.ts`](./src/lib/insights-aggregate.ts) build the weekly team/group reports rendered by `src/components/insights-variants/`. A sample report (`?mock=1`, admin-only) is served from `src/lib/insights-mock-data.ts`.
- **Integrations** — [`src/lib/integrations.ts`](./src/lib/integrations.ts) with per-provider modules (`github.ts`, `jira.ts`, `linear.ts`). Group-scoped, many per provider; credentials are encrypted at rest with `FLEETLENS_ENCRYPTION_KEY`.
- **Auth** — [`src/lib/auth.ts`](./src/lib/auth.ts). Session cookies + bearer tokens for CLI ingest; first signup is auto-promoted to staff.
- **Self-update** — [`src/lib/self-update/`](./src/lib/self-update). Discovers released image tags on GHCR and can redeploy in place on Railway and Cloud Run.
- **Boot path** — `src/instrumentation.ts` runs migrations on every start; `src/scheduler.ts` hosts in-process recurring jobs (disable with `FLEETLENS_EXTERNAL_SCHEDULER=1`).

Historical design documents (point-in-time, not current-state reference) live
under `docs/superpowers/specs/` at the repo root.

## Configuration

The service is configured via environment variables.

Required:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (used by the connection pool and the migration runner) |
| `BASE_URL` | Public base URL of the deployed server; used for OAuth/redirect URLs, device-token pairing, and logout |
| `FLEETLENS_ENCRYPTION_KEY` | Encryption key for integration secrets (GitHub, Linear, Jira, email settings) and device tokens. Use a strong random value and keep it stable |

Build-time:

| Variable | Purpose |
|---|---|
| `APP_VERSION` | Baked into the image from `package.json` during the Docker build; drives the in-app self-update check |

Optional / platform-specific:

| Variable | Purpose |
|---|---|
| `FLEETLENS_EXTERNAL_SCHEDULER` | Set to `1` to disable the in-process scheduler (when running an external cron) |
| `FLEETLENS_SCHEDULER_SECRET` | Shared secret for the `/api/admin/prune` scheduler endpoint |
| `GCP_PROJECT_ID`, `GCP_REGION`, `K_SERVICE` | Used on Google Cloud Run for self-update / redeploy detection |
| `RAILWAY_TOKEN` | Used on Railway for self-update / redeploy detection |

## Release track

The team server is on its **own independent release track**, separate from the CLI/npm `fleetlens` package:

- Source of truth: `packages/team-server/package.json` (self-contained version)
- Tag shape: `server-v<x.y.z>`
- Distribution: GHCR image tags `:<x.y.z>`, `:latest`, `:<sha7>`

Pushing a `server-v*` tag triggers `.github/workflows/publish-team-server-image.yml`, which asserts the tag suffix matches `package.json`, bakes `APP_VERSION` into the image, and publishes to GHCR. See `CLAUDE.md` → "Release process" for the exact release commands.
