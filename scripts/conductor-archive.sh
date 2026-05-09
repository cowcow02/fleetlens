#!/usr/bin/env bash
# conductor-archive.sh — Tear down per-workspace Postgres on workspace archive.
#
# Removes containers AND volumes (down -v) so the per-workspace database is
# fully reclaimed. The workspace's git branch survives — push it to the
# remote first (or merge the PR) before archiving if you want to keep work.
# Per-workspace state under .harness/cclens-state/ is removed with the
# workspace directory itself.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ ! -f "$ROOT/.harness/conductor-env" ]]; then
  exit 0
fi

# shellcheck disable=SC1091
source "$ROOT/.harness/conductor-env"

docker compose -p "$COMPOSE_PROJECT" -f "$ROOT/docker-compose.yml" down -v
echo "✓ Tore down Postgres (project=$COMPOSE_PROJECT)"
