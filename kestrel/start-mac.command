#!/bin/bash
# Double-click to start Kestrel on a Mac. (First time: right-click → Open, because it's a downloaded script.)
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Kestrel needs Node.js. Install the LTS version from https://nodejs.org, then double-click this file again."
  read -r -p "Press Enter to close…" _
  exit 1
fi
if [ ! -d node_modules/ccxt ]; then
  echo "First run: installing Kestrel's parts (one time, about a minute)…"
  if ! npm install --no-audit --no-fund; then
    echo "Couldn't install. Check the internet connection and try again."
    read -r -p "Press Enter to close…" _
    exit 1
  fi
fi
node server.mjs "$@"
read -r -p "Kestrel stopped. Press Enter to close…" _
