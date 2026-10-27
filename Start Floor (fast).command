#!/bin/bash
# Floor — fast restart. Skips dependency install and DB checks; use "Start Floor.command" after pulling new code.
cd "$(dirname "$0")" || exit 1
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export PATH="$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null
need_node() { node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit((a>20||(a===20&&b>=19))?0:1)' 2>/dev/null; }
if ! need_node && command -v nvm >/dev/null 2>&1; then nvm use 22 >/dev/null 2>&1; fi
# Self-heal only if something essential is missing, otherwise skip the slow steps.
[ -f packages/core/dist/index.js ] || { echo "Building core (first run)..."; pnpm --filter @floor/core build; }
[ -f apps/api/dev.db ] || { echo "Creating local database (first run)..."; pnpm --filter @floor/api db:setup; }
echo "Starting Floor — API on http://localhost:4000, app on http://localhost:5173"
echo "Keep this window open. Close it (or Ctrl+C) to stop."
(sleep 4; open "http://localhost:5173") &
pnpm -r --parallel --filter ./packages/core --filter ./apps/api --filter ./apps/web dev
