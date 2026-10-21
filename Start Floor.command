#!/bin/bash
# Floor — one-click local start (mock mode, no credentials, nothing paid).
cd "$(dirname "$0")" || exit 1
exec > >(tee -a "floor-start.log") 2>&1
echo "=== Floor start $(date) ==="
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export PATH="$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null
pause() { echo; read -r -p "$1 Press Enter to close"; exit 1; }
# Floor needs Node 20.19+ (Prisma 7). Prefer Node 22 via nvm when available.
need_node() { node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit((a>20||(a===20&&b>=19))?0:1)' 2>/dev/null; }
if ! need_node && command -v nvm >/dev/null 2>&1; then
  echo "Switching to Node 22 via nvm..."; nvm use 22 >/dev/null 2>&1 || nvm install 22 >/dev/null 2>&1; nvm use 22 >/dev/null 2>&1
fi
command -v node >/dev/null || pause "Node.js not found. Install it from https://nodejs.org (LTS 22)."
need_node || pause "Node $(node -v) is too old; Floor needs Node 20.19+ (22 recommended). Install it from https://nodejs.org."
echo "Using Node $(node -v)"
if ! command -v pnpm >/dev/null; then echo "Installing pnpm..."; corepack enable 2>/dev/null && corepack prepare pnpm@10.28.0 --activate 2>/dev/null || npm install -g pnpm@10 || pause "Could not install pnpm."; fi
echo "Checking dependencies..."; pnpm install || pause "Install failed."
pnpm --filter @floor/api check-env || { echo "Rebuilding native SQLite driver..."; pnpm rebuild better-sqlite3 && pnpm --filter @floor/api check-env; } || pause "The SQLite driver (better-sqlite3) cannot run on this machine. See floor-start.log."
if [ ! -f apps/api/dev.db ]; then echo "Creating local database..."; pnpm --filter @floor/api db:setup || pause "DB setup failed."; fi
echo; echo "Starting Floor — API on http://localhost:4000, app on http://localhost:5173"; echo "Keep this window open. Close it (or Ctrl+C) to stop."; echo
(sleep 6; open "http://localhost:5173") &
pnpm dev
