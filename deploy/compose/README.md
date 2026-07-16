# Docker Compose deployment

Runs the team server + Postgres + Caddy (TLS termination) on any Linux host.

Fleetlens including Team Edition is MIT-licensed open source — no license keys, no seat gating.

## Setup

```bash
cp .env.example .env
# Edit .env — set POSTGRES_PASSWORD, BASE_URL, DOMAIN, and FLEETLENS_ENCRYPTION_KEY
docker compose up -d
```

### Encryption key

`FLEETLENS_ENCRYPTION_KEY` is required to store GitHub / Linear / Jira / email integration credentials at rest. The app expects a 64-character hex string for AES-256-GCM:

```bash
openssl rand -hex 32
```

Put the result in `.env` as `FLEETLENS_ENCRYPTION_KEY=...`. Without it the server boots, but saving integration or email settings will fail.

Caddy auto-provisions a TLS certificate for `DOMAIN`. If you're running locally without a domain, leave `DOMAIN` unset and access the server at `http://localhost:3322` (Caddy binds to `localhost` by default via `{$DOMAIN:localhost}`).

## Build context

The Dockerfile is built from the monorepo root (`../..`), so run `docker compose` from this directory or pass `-f deploy/compose/docker-compose.yml` from the repo root.

## Upgrading / version pinning

This path **builds from source**, not from a pre-published GHCR image. To pin production to a released team-server version:

```bash
git fetch --tags
git checkout server-vX.Y.Z   # e.g. server-v0.5.0
docker compose up -d --build
```

Database migrations run automatically on boot — no separate migrate step. After upgrading, confirm the UI version and that `/api/auth/preflight` still returns healthy.
