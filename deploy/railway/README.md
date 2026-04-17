# Deploy Fleetlens Team Edition on Railway

One-click template (Postgres + team-server, env vars pre-wired):

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/sGuijx?PORT=3322&NODE_ENV=production&RAILWAY_DOCKERFILE_PATH=packages%2Fteam-server%2FDockerfile)

## What the template provisions

- `fleetlens-team-server` — the Next.js 16 server built from `packages/team-server/Dockerfile`, public domain auto-generated
- `Postgres` — Postgres 18 with a 5 GB volume at `/var/lib/postgresql/data`

## What's pre-wired

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (private network, auto) |
| `BASE_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` (auto after domain is assigned) |
| `NODE_ENV` | `production` |
| `PORT` | `3322` |
| `RAILWAY_DOCKERFILE_PATH` | `packages/team-server/Dockerfile` |

## One value you fill in

`FLEETLENS_ENCRYPTION_KEY` — any 32-byte hex string. Used to encrypt SMTP credentials for invite emails; if you skip SMTP setup entirely, any placeholder works. Generate one locally:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## First-run flow

1. Click the button → Railway provisions both services (~60–90s).
2. Open the generated `*.up.railway.app` URL → `/signup` loads.
3. The first account becomes the admin of team #1.
4. Admin creates invite links or toggles public signup in `/team/<slug>/settings`.
5. On the CLI: `fleetlens team join <server-url> <device-token>` to start pushing metrics.
