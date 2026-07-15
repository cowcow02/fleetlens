# Deploy Fleetlens Team Edition on Railway

Fleetlens including Team Edition is MIT-licensed open source — no license keys, no seat gating.

Zero-config template (Postgres + team-server, every variable pre-filled):

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/sGuijx)

## What the template provisions

- `fleetlens-team-server` — the Next.js 16 server built from `packages/team-server/Dockerfile`, public domain auto-generated
- `Postgres` — Postgres 18 with a 5 GB volume at `/var/lib/postgresql/data`

## Everything is pre-wired

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (private network) |
| `BASE_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` |
| `NODE_ENV` | `production` |
| `PORT` | `3322` |
| `RAILWAY_DOCKERFILE_PATH` | `packages/team-server/Dockerfile` |
| `FLEETLENS_ENCRYPTION_KEY` | `${{ secret(64, 'abcdef0123456789') }}` — unique per deploy |

Postgres variables (`POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`, etc.) are all defaulted or auto-generated.

## First-run flow

1. Click the button → Railway provisions both services (~60–90s).
2. Open the generated `*.up.railway.app` URL → `/signup` loads.
3. The first account becomes the admin of team #1.
4. Admin creates invite links or toggles public signup in `/team/<slug>/settings`.
5. On the CLI: `fleetlens team join <server-url> <device-token>` to start pushing metrics.

## Self-update (optional, recommended)

From team-server `v0.5.0` onward, staff users can click **Apply update** in
`/admin/updates` to roll the service to a newer `ghcr.io/cowcow02/fleetlens-team-server`
image without any shell access. For that to work, the service needs four
extra environment variables so it can call Railway's API on itself:

| Variable | Where to find it |
|---|---|
| `RAILWAY_TOKEN` | **Railway dashboard → your profile (top-right) → Account Settings → Tokens → Create Token**. Scope it to the project that hosts team-server (NOT an account-wide token). Copy the value shown once — it is not retrievable later. |
| `RAILWAY_PROJECT_ID` | Railway auto-injects this. Set variable value to `${{RAILWAY_PROJECT_ID}}` to reference it. |
| `RAILWAY_SERVICE_ID` | Railway auto-injects this. Set variable value to `${{RAILWAY_SERVICE_ID}}` to reference it. |
| `RAILWAY_ENVIRONMENT_ID` | Railway auto-injects this. Set variable value to `${{RAILWAY_ENVIRONMENT_ID}}` to reference it. |

**Steps (takes ~2 min):**

1. Open the `fleetlens-team-server` service → **Variables** tab.
2. Add `RAILWAY_TOKEN` with the project-scoped API token you just created.
3. Add `RAILWAY_PROJECT_ID` / `RAILWAY_SERVICE_ID` / `RAILWAY_ENVIRONMENT_ID`, each set to the matching `${{...}}` reference above.
4. Railway redeploys automatically once you save.
5. Sign in as staff, open `/admin/updates` — the banner now offers one-click upgrades instead of "Self-update is not configured".

**Security note:** `RAILWAY_TOKEN` grants redeploy rights on every service in
the project it's scoped to. Keep team-server in its own Railway project (the
one-click template does this by default) so a leak can't redeploy unrelated
services. Only users with `is_staff = true` can trigger updates inside the
app — see the repo's `docs/superpowers/specs/2026-04-22-team-edition-self-update-design.md`
for the full threat model.

If these variables are missing, the service boots normally but
`/admin/updates` shows "Self-update is not configured — your template needs
the RAILWAY_* variables". Non-fatal; everything else keeps working.
