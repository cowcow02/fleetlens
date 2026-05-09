#!/usr/bin/env bash
# conductor-setup.sh — Per-workspace bring-up for Conductor.
#
# Allocates 3 free ports (web/team/postgres) and a per-workspace state dir,
# boots an isolated Postgres container, runs migrations, installs deps.
# Idempotent — safe to re-run on workspace resume.
#
# Reads:  $CONDUCTOR_WORKSPACE_NAME, $CONDUCTOR_PORT, $CONDUCTOR_ROOT_PATH
# Writes: .harness/conductor-env (sourced by run/archive scripts)
#         .harness/cclens-state/  (per-workspace personal-edition state)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -z "${CONDUCTOR_WORKSPACE_NAME:-}" ]]; then
  echo "✗ CONDUCTOR_WORKSPACE_NAME is empty — run from a Conductor workspace" >&2
  exit 1
fi

PROJECT="fleetlens-${CONDUCTOR_WORKSPACE_NAME}"
BASE_PORT="${CONDUCTOR_PORT:-3321}"

mkdir -p "$ROOT/.harness"
ENV_OUT="$ROOT/.harness/conductor-env"

# --- 1. Pick 3 free ports ---------------------------------------------------

is_free() { ! lsof -iTCP:"$1" -sTCP:LISTEN -P -n >/dev/null 2>&1; }

next_free() {
  local p=$1
  while ! is_free "$p"; do p=$((p + 1)); done
  echo "$p"
}

if [[ -f "$ENV_OUT" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_OUT"
  echo "✓ Reusing ports: web=$WEB_PORT team=$TEAM_PORT pg=$PG_PORT"
else
  WEB_PORT=$(next_free "$BASE_PORT")
  TEAM_PORT=$(next_free $((WEB_PORT + 1)))
  PG_PORT=$(next_free $((TEAM_PORT + 1)))
  CCLENS_HOME="$ROOT/.harness/cclens-state"
  cat > "$ENV_OUT" <<EOF
WEB_PORT=$WEB_PORT
TEAM_PORT=$TEAM_PORT
PG_PORT=$PG_PORT
COMPOSE_PROJECT=$PROJECT
CCLENS_HOME=$CCLENS_HOME
EOF
  echo "✓ Allocated ports: web=$WEB_PORT team=$TEAM_PORT pg=$PG_PORT"
fi

mkdir -p "$CCLENS_HOME"

# --- 2. Install deps -------------------------------------------------------

if [[ ! -d "$ROOT/node_modules" ]]; then
  pnpm install
fi

# Build internal workspace packages (parser → entries → web standalone) so
# the CLI's `dist/index.js` has a Next.js bundle to serve, and team-server's
# `pnpm dev` finds compiled @claude-lens/parser. Turbo caches the build,
# so re-runs on workspace resume are near-instant.
pnpm build

# --- 3. Boot per-workspace Postgres ---------------------------------------
# team-server auto-applies migrations on boot via instrumentation.ts, so
# we don't run drizzle-kit here — first `conductor-run.sh` launch handles it.

POSTGRES_PORT="$PG_PORT" docker compose -p "$PROJECT" -f "$ROOT/docker-compose.yml" up -d --wait
echo "✓ Postgres ready on $PG_PORT (project=$PROJECT)"

echo ""
echo "✓ Workspace ready."
echo "  fleetlens (personal): http://localhost:$WEB_PORT"
echo "  team-server:          http://localhost:$TEAM_PORT"
echo "  postgres:             localhost:$PG_PORT (compose project: $PROJECT)"
echo "  state dir:            $CCLENS_HOME"
