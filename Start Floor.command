#!/bin/bash
# Floor — one-click local start (mock mode, no credentials, nothing paid).
cd "$(dirname "$0")" || exit 1
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null
export PATH="$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null; then echo "Node.js not found. Install it from https://nodejs.org (LTS) and run this again."; read -r -p "Press Enter to close"; exit 1; fi
if ! command -v pnpm >/dev/null; then echo "Installing pnpm..."; corepack enable 2>/dev/null && corepack prepare pnpm@10.28.0 --activate 2>/dev/null || npm install -g pnpm@10; fi
if [ ! -d node_modules ]; then echo "Installing dependencies (first run, ~1-2 min)..."; pnpm install || { read -r -p "Install failed. Press Enter to close"; exit 1; }; fi
if [ ! -f apps/api/dev.db ]; then echo "Creating local database..."; pnpm --filter @floor/api db:setup || { read -r -p "DB setup failed. Press Enter to close"; exit 1; }; fi
echo; echo "Starting Floor — API on http://localhost:4000, app on http://localhost:5173"; echo "Keep this window open. Close it (or Ctrl+C) to stop."; echo
(sleep 6; open "http://localhost:5173") &
pnpm dev
