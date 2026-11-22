#!/data/data/com.termux/files/usr/bin/bash
# Sets Bulwark up in Termux on an Android phone (or an Android TV with Termux installed).
#
#   pkg install -y git && git clone <this repository> && bash <the clone>/bulwark/android/install-termux.sh
#
# It installs Node.js, git and Android's adb tool from Termux's own packages, adds a `bulwark`
# command, and makes home-screen shortcuts for the Termux:Widget app. It doesn't need root, and it
# changes nothing outside Termux.

set -eu

if [ -z "${PREFIX:-}" ] || [ "${PREFIX#*com.termux}" = "$PREFIX" ]; then
  echo "This script is for Termux on Android. On a computer, run ./bulwark from the bulwark folder instead." >&2
  exit 1
fi

HERE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ ! -f "$HERE/bin/bulwark.mjs" ]; then
  echo "Run this script from inside a copy of Bulwark (it lives in bulwark/android/)." >&2
  exit 1
fi

echo "Installing Node.js, git and adb (Termux packages)…"
# Termux wants its packages up to date before adding new ones; keep your own config files.
export DEBIAN_FRONTEND=noninteractive
pkg upgrade -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold
pkg install -y nodejs-lts git android-tools

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Termux installed Node.js $(node -v), but Bulwark needs 22.6 or newer. Try: pkg install nodejs" >&2
  exit 1
fi

echo "Adding the bulwark command…"
cat > "$PREFIX/bin/bulwark" <<EOF
#!$PREFIX/bin/sh
exec "$PREFIX/bin/node" "$HERE/bin/bulwark.mjs" "\$@"
EOF
chmod 755 "$PREFIX/bin/bulwark"

echo "Adding home-screen shortcuts (for the Termux:Widget app)…"
mkdir -p "$HOME/.shortcuts"
chmod 700 "$HOME/.shortcuts"
cat > "$HOME/.shortcuts/Bulwark" <<EOF
#!$PREFIX/bin/sh
# Opens Bulwark's dashboard in the phone's browser.
exec "$PREFIX/bin/bulwark" serve --open
EOF
cat > "$HOME/.shortcuts/Bulwark on the TV" <<EOF
#!$PREFIX/bin/sh
# Lets a TV or tablet on the same Wi-Fi open the dashboard too (it prints a sign-in code).
exec "$PREFIX/bin/bulwark" serve --lan --open
EOF
chmod 700 "$HOME/.shortcuts/Bulwark" "$HOME/.shortcuts/Bulwark on the TV"

cat <<'EOF'

Bulwark is ready.

  bulwark scan                  check this phone and its Termux packages
  bulwark serve --open          open the dashboard in the phone's browser
  bulwark scan --network        also check the other devices on your Wi-Fi
  bulwark android               connect your TV, or this phone itself, to check and fix more
  bulwark serve --lan --open    let the TV's browser open the dashboard too

With the Termux:Widget app (from F-Droid, like Termux), add its widget to your home screen
to start Bulwark with one tap.
EOF
