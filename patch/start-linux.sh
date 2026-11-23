#!/bin/sh
# Start Patch on Linux: ./start-linux.sh   (add --demo to try it on a simulated home network)
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Patch needs Node.js 20 or newer: https://nodejs.org (or your package manager)."
  exit 1
fi
[ -d node_modules/@elevenlabs/client ] || npm install --no-audit --no-fund || echo "Couldn't install the voice library; the dashboard still works without it."
exec node server.mjs "$@"
