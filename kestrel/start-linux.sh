#!/bin/sh
# Start Kestrel on Linux: ./start-linux.sh   (add --demo to watch it trade a simulated market)
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Kestrel needs Node.js 20 or newer: https://nodejs.org (or your package manager)."
  exit 1
fi
if [ ! -d node_modules/ccxt ]; then
  echo "First run: installing Kestrel's parts (one time, about a minute)…"
  npm install --no-audit --no-fund || { echo "Couldn't install. Check the internet connection and try again."; exit 1; }
fi
exec node server.mjs "$@"
