#!/usr/bin/env bash
# conductor-run.sh — Launch fleetlens (personal) + team-server on
# workspace-allocated ports. Reads ports from .harness/conductor-env
# (written by conductor-setup.sh). Stopping this process stops both
# child dev servers.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f "$ROOT/.harness/conductor-env" ]]; then
  echo "✗ .harness/conductor-env missing — run scripts/conductor-setup.sh first" >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$ROOT/.harness/conductor-env"

# Re-ensure Postgres is up (workspace may have been resumed after laptop sleep)
POSTGRES_PORT="$PG_PORT" docker compose -p "$COMPOSE_PROJECT" -f "$ROOT/docker-compose.yml" up -d --wait

# Personal edition: Next.js dev server bound to WEB_PORT, state in CCLENS_HOME.
export CCLENS_HOME
PORT="$WEB_PORT" CCLENS_PORT="$WEB_PORT" \
  pnpm -F @claude-lens/web dev --port "$WEB_PORT" &
WEB_PID=$!

# Team edition: Next.js dev server bound to TEAM_PORT against the
# per-workspace Postgres. team-server's package.json hardcodes --port 3322
# so we invoke `next dev` directly to override.
DATABASE_URL="postgresql://fleetlens:fleetlens@localhost:${PG_PORT}/fleetlens_team" \
BASE_URL="http://localhost:${TEAM_PORT}" \
  pnpm -F @claude-lens/team-server exec next dev --port "$TEAM_PORT" &
TEAM_PID=$!

cleanup() {
  kill "$WEB_PID" "$TEAM_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT TERM INT

echo "✓ fleetlens on $WEB_PORT (pid $WEB_PID)  team-server on $TEAM_PORT (pid $TEAM_PID)"
echo "  state dir: $CCLENS_HOME"
wait
