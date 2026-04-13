#!/usr/bin/env bash
#
# Fleetlens — one-line installer (from-source, legacy path)
#
# The recommended install is:
#   npm install -g fleetlens
#
# This script is for hacking on the repo itself. It clones from master
# and runs the dev server.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/cowcow02/fleetlens/master/install.sh | bash
#

set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

INSTALL_DIR="${FLEETLENS_DIR:-$HOME/fleetlens}"
REPO="https://github.com/cowcow02/fleetlens.git"
PORT=3321

info()  { echo -e "${CYAN}→${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}!${NC} $*"; }
fail()  { echo -e "${RED}✗${NC} $*"; exit 1; }

echo ""
echo -e "${BOLD}Fleetlens${NC} — Claude Code fleet analytics dashboard"
echo -e "${DIM}https://github.com/cowcow02/fleetlens${NC}"
echo ""

# ─── Check Node.js ────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install it from https://nodejs.org (v20+)"
fi
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  fail "Node.js $NODE_VERSION found, but v20+ is required. Upgrade at https://nodejs.org"
fi
ok "Node.js $(node -v)"

# ─── Check pnpm ──────────────────────────────────────────────────
if ! command -v pnpm &>/dev/null; then
  warn "pnpm not found. Installing via corepack..."
  if command -v corepack &>/dev/null; then
    corepack enable
    corepack prepare pnpm@latest --activate
  else
    info "Installing pnpm via npm..."
    npm install -g pnpm
  fi
  if ! command -v pnpm &>/dev/null; then
    fail "Could not install pnpm. Install manually: https://pnpm.io/installation"
  fi
fi
ok "pnpm $(pnpm -v)"

# ─── Check Claude Code data ──────────────────────────────────────
CLAUDE_DIR="$HOME/.claude/projects"
if [ -d "$CLAUDE_DIR" ]; then
  SESSION_COUNT=$(find "$CLAUDE_DIR" -name "*.jsonl" 2>/dev/null | wc -l | tr -d ' ')
  ok "Found $SESSION_COUNT session files in ~/.claude/projects"
else
  warn "No ~/.claude/projects found — dashboard will be empty until you run Claude Code"
fi

# ─── Clone or update ─────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  info "Updating existing installation at $INSTALL_DIR..."
  cd "$INSTALL_DIR"
  git pull --ff-only origin master 2>/dev/null || warn "Could not pull latest (offline?)"
else
  info "Cloning claude-lens to $INSTALL_DIR..."
  git clone --depth 1 "$REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi
ok "Source ready at $INSTALL_DIR"

# ─── Install dependencies ────────────────────────────────────────
info "Installing dependencies..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
ok "Dependencies installed"

# ─── Build ───────────────────────────────────────────────────────
info "Building (this takes ~15s on first run)..."
pnpm -F @claude-lens/parser build >/dev/null 2>&1
pnpm -F @claude-lens/web build >/dev/null 2>&1
ok "Production build ready"

# ─── Check if already running ────────────────────────────────────
if curl -s --max-time 2 "http://localhost:$PORT/" >/dev/null 2>&1; then
  ok "Claude Lens is already running on http://localhost:$PORT"
  echo ""
  if command -v open &>/dev/null; then
    open "http://localhost:$PORT"
  elif command -v xdg-open &>/dev/null; then
    xdg-open "http://localhost:$PORT"
  else
    info "Open http://localhost:$PORT in your browser"
  fi
  exit 0
fi

# Check if something else is using the port.
if lsof -i ":$PORT" >/dev/null 2>&1; then
  OTHER_PID=$(lsof -ti ":$PORT" 2>/dev/null | head -1)
  OTHER_CMD=$(ps -p "$OTHER_PID" -o comm= 2>/dev/null || echo "unknown")
  warn "Port $PORT is in use by $OTHER_CMD (PID $OTHER_PID)"
  # Try the next port.
  PORT=$((PORT + 1))
  info "Trying port $PORT instead..."
fi

# ─── Start server ────────────────────────────────────────────────
info "Starting dashboard on http://localhost:$PORT ..."
echo ""

# Open browser after a short delay (background)
(sleep 4 && {
  if command -v open &>/dev/null; then
    open "http://localhost:$PORT"
  elif command -v xdg-open &>/dev/null; then
    xdg-open "http://localhost:$PORT"
  else
    echo -e "${CYAN}→${NC} Open http://localhost:$PORT in your browser"
  fi
}) &

# Run production server in foreground so Ctrl+C stops it cleanly.
# `next start` serves the pre-built .next output — no Turbopack
# compilation per request, optimized React bundles, ~3x faster.
cd "$INSTALL_DIR/apps/web"
npx next start -p "$PORT"
