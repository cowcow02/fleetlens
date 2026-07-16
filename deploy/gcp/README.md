# Deploy Fleetlens Team Edition to Google Cloud

[![Open in Cloud Shell](https://gstatic.com/cloudssh/images/open-btn.svg)](https://ssh.cloud.google.com/cloudshell/editor?cloudshell_git_repo=https://github.com/cowcow02/fleetlens&cloudshell_workspace=deploy/gcp&cloudshell_tutorial=TUTORIAL.md)

Click the button. Cloud Shell opens with the repo cloned and a guided walkthrough. The whole deploy takes ~5 minutes and costs ~$10–25/mo.

Fleetlens including Team Edition is MIT-licensed open source — no license keys, no seat gating.

The installer runs in two phases: a **preflight** that inspects your environment (account, project, region, billing, which APIs and resources already exist) and prints every change it would make, then an explicit confirmation prompt before any mutation. Skip the prompt with `--yes` or `ASSUME_YES=1`.

## Three ways to install

| If you want… | Use… |
|---|---|
| One-click deploy from Cloud Shell | The button above (runs `install.sh` interactively) |
| Run the installer locally with full control | [`install.sh`](./install.sh) + [`TUTORIAL.md`](./TUTORIAL.md) |
| Run every gcloud command yourself, with explanations | [`docs/gcp-manual-install.md`](../../docs/gcp-manual-install.md) |

## Stack

- **Cloud Run** — stateless container, autoscales 0→N, public HTTPS
- **Cloud SQL Postgres 15** — `db-f1-micro` by default, connected over Unix socket (no VPC required)
- **Secret Manager** — DB password, encryption key, scheduler shared-secret
- **Cloud Scheduler** — hourly prune of `ingest_log` (Cloud Run request-based CPU makes `setInterval` unreliable)
- **Container image** — `ghcr.io/cowcow02/fleetlens-team-server:latest`, published on every master push by the `publish-team-server-image` workflow. `:latest` tracks master HEAD; for production, pin a release tag such as `ghcr.io/cowcow02/fleetlens-team-server:X.Y.Z` (published from `server-vX.Y.Z` tags — the GHCR tag is the version number without the `server-v` prefix).

## Why this architecture

Railway's runtime + Postgres template maps almost 1:1 onto Cloud Run + Cloud SQL. Two things needed code changes, both committed in this branch:

1. Scheduler extracted into a shared `pruneIngestLog()` + exposed as `POST /api/admin/prune` so Cloud Scheduler can trigger it on a cron. The in-container `setInterval` still runs on Railway and Docker Compose but is a no-op when `FLEETLENS_EXTERNAL_SCHEDULER=1` (set by the installer).
2. Image is pre-built and pushed to GHCR so Cloud Run deploys in ~30 seconds without a Cloud Build round-trip.

## Comparing to the Railway button

| | Railway | GCP |
|---|---|---|
| Click to live URL | ~90s | ~5 min (Cloud SQL provisioning dominates) |
| Manual input | 0 fields | 0 fields (project + region taken from `gcloud config`) |
| Cost idle | ~$15/mo | ~$10/mo (Cloud Run scales to zero) |
| Cost active | ~$25/mo | ~$25/mo |
| Prerequisites | Railway account | GCP project with billing linked |
