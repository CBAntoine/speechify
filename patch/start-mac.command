#!/bin/bash
# Double-click to start Patch on a Mac. (First time: right-click → Open, because it's a downloaded script.)
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Patch needs Node.js. Install the LTS version from https://nodejs.org, then double-click this file again."
  read -r -p "Press Enter to close…" _
  exit 1
fi
if [ ! -d node_modules/@elevenlabs/client ]; then
  echo "First run: installing the voice library (one time, about 20 seconds)…"
  npm install --no-audit --no-fund || echo "Couldn't install the voice library; the dashboard still works without it."
fi
node server.mjs "$@"
read -r -p "Patch stopped. Press Enter to close…" _
