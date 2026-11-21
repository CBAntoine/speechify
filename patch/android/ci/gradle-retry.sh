#!/usr/bin/env bash
# Runs Gradle, and tries again when the build couldn't fetch its tools: Maven Central and Google's
# servers sometimes turn build machines away for a minute ("429 Too Many Requests"). Anything else
# that fails (a mistake in the code) fails straight away.
# Usage: gradle-retry.sh <gradle arguments>
set -uo pipefail
LOG="$(mktemp)"
for attempt in 1 2 3 4; do
  gradle --no-daemon "$@" 2>&1 | tee "$LOG"
  status="${PIPESTATUS[0]}"
  [ "$status" = 0 ] && exit 0
  if [ "$attempt" = 4 ] || ! grep -qE "Too Many Requests|status code (429|5[0-9][0-9])|Could not (GET|HEAD) |Connection (reset|refused|timed out)|Read timed out|Remote host terminated the handshake" "$LOG"; then
    exit "$status"
  fi
  wait=$((attempt * 60))
  echo
  echo "The build couldn't fetch its tools (attempt $attempt of 4). Trying again in $wait seconds…"
  sleep "$wait"
done
