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

## Migrations

Database migrations live under [`src/db/migrations/`](./src/db/migrations) and are managed with Drizzle. For the author workflow and expand/contract rules, see [`src/db/MIGRATIONS.md`](./src/db/MIGRATIONS.md).

Each migration SQL file must begin with a `-- description: ...` header so the release pipeline can build a human-readable `migrations-manifest.json`.

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
