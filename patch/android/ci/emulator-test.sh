#!/usr/bin/env bash
# Runs on GitHub's build machine with an Android emulator attached: installs the test build of Patch,
# opens it, and checks that Patch's server starts, scans, shows its dashboard and hands links to Android.
# Usage: emulator-test.sh <test apk> <folder for results>
set -euo pipefail
APK="$1"
mkdir -p "$2"
OUT="$(cd "$2" && pwd)"
HERE="$(cd "$(dirname "$0")" && pwd)"
PKG=app.patch.home
BASE=http://127.0.0.1:4545

# The emulator's graphics driver also writes to the app's output; leave its chatter out.
patch_log() { adb logcat -d -s Patch:V AndroidRuntime:E DEBUG:V libc:F | grep -v -E "s_gl|glUtils|EGL|Vulkan|eglMakeCurrent" | tail -n "${1:-200}"; }
fail() {
  echo "FAILED: $*"
  echo "---- Patch's log ----"
  patch_log 300
  adb exec-out screencap -p > "$OUT/failure.png" || true
  exit 1
}

adb wait-for-device
adb install -r -g "$APK"
adb logcat -c
adb shell am start -W -n "$PKG/.MainActivity"
adb forward tcp:4545 tcp:4545

echo "Waiting for Patch's server…"
for i in $(seq 1 90); do
  if curl -sf -m 3 "$BASE/" -o "$OUT/page.html"; then break; fi
  [ "$i" = 90 ] && fail "Patch's server never answered"
  sleep 2
done
echo "Patch's server answered after about $((i * 2)) seconds."
grep -q '"phone":true' "$OUT/page.html" || fail "the page doesn't know it's on a phone"
TOKEN=$(sed -n 's/.*"token":"\([^"]*\)".*/\1/p' "$OUT/page.html" | head -n 1)
[ -n "$TOKEN" ] || fail "no app token in the page"
api() { curl -sf -m 30 -H "x-patch-token: $TOKEN" -H "content-type: application/json" "$@"; }

echo "Waiting for the first scan…"
for i in $(seq 1 90); do
  api "$BASE/api/state" > "$OUT/state.json" || fail "/api/state didn't answer"
  if node -e 'const s = require(process.argv[1]); process.exit(s.scan.running || !s.network ? 1 : 0)' "$OUT/state.json"; then break; fi
  [ "$i" = 90 ] && fail "the first scan didn't finish"
  sleep 2
done
node -e '
const s = require(process.argv[1]);
console.log(`Platform: ${s.app.platform}. Network: ${s.network.cidr}, router ${s.network.gateway}, this phone ${s.network.address}.`);
if (s.app.platform !== "android") process.exit(1);
' "$OUT/state.json" || fail "Patch doesn't know it's on Android"

api "$BASE/api/devices" > "$OUT/devices.json" || fail "/api/devices didn't answer"
node -e '
const { devices } = require(process.argv[1]);
console.log(`Found ${devices.length} devices:`);
for (const d of devices) console.log(`  - ${d.name}: ${d.what} (${d.ip || "no address"})`);
const me = devices.find((d) => d.self);
if (!me || me.kind !== "phone") { console.error("“This phone” is missing"); process.exit(1); }
' "$OUT/devices.json" || fail "the scan results are wrong"

echo "Looking inside the dashboard…"
PID=$(adb shell pidof "$PKG" | tr -d '\r')
SOCKET=$(adb shell cat /proc/net/unix | tr -d '\r' | grep -o "webview_devtools_remote_${PID}" | head -n 1)
[ -n "$SOCKET" ] || fail "the dashboard's DevTools aren't available"
adb forward tcp:9222 "localabstract:$SOCKET"
node "$HERE/webview-check.mjs" "$OUT" || fail "the dashboard check failed"

echo "Asking Patch to search the web on this phone…"
api -X POST "$BASE/api/control" -d '{"device":"this phone","action":"web_search","value":"weather tomorrow"}' > "$OUT/control.json" || fail "/api/control didn't answer"
cat "$OUT/control.json"
echo
sleep 4
adb logcat -d -s Patch:V | grep -q "Opening www.google.com outside Patch" || fail "the web search didn't reach Android"
echo "The web search was handed to Android."
adb exec-out screencap -p > "$OUT/after-web-search.png" || true

echo "Keeping Patch listening while a conversation is going…"
# A conversation starts on Patch's own screen (Android only lets an app start listening while it's
# in front), and the web search above left the browser in front.
adb shell am start -W -n "$PKG/.MainActivity" > /dev/null
sleep 2
node "$HERE/cdp-eval.mjs" "window.PatchAndroid.voiceStarted(), 'started'" || fail "couldn't start listening"
sleep 3
adb shell dumpsys activity services "$PKG" | grep -q "ListeningService" || fail "the listening service didn't start"
adb shell dumpsys notification --noredact | grep -q "Patch is listening" && echo "The 'Patch is listening' notification is showing."
node "$HERE/cdp-eval.mjs" "window.PatchAndroid.voiceStopped(), 'stopped'" || fail "couldn't stop listening"
sleep 3
if adb shell dumpsys activity services "$PKG" | grep -q "ListeningService"; then fail "the listening service didn't stop"; fi
echo "Listening starts and stops with the conversation."

echo "Turning on screen access (the person does this once in Settings → Accessibility)…"
[ "$(node "$HERE/cdp-eval.mjs" "window.PatchAndroid.screenAccess()")" = "false" ] || fail "screen access should start off"
adb shell settings put secure enabled_accessibility_services "$PKG/$PKG.PatchAccessibility"
adb shell settings put secure accessibility_enabled 1
for i in $(seq 1 30); do
  adb logcat -d -s Patch:V | grep -q "Screen access is on" && break
  [ "$i" = 30 ] && fail "screen access didn't turn on"
  sleep 1
done
[ "$(node "$HERE/cdp-eval.mjs" "window.PatchAndroid.screenAccess()")" = "true" ] || fail "the dashboard can't tell screen access is on"

phone() { api -X POST "$BASE/api/control" -d "{\"device\":\"this phone\",$1}" || fail "/api/control didn't answer"; }
expect() { # expect <name> <json> <node condition on r>
  echo "$2" > "$OUT/$1.json"
  node -e "const r = require(process.argv[1]); console.log('  ' + (r.screen || r.message).split('\\n').join('\\n  ')); process.exit(($3) ? 0 : 1)" "$OUT/$1.json" || fail "$1"
}

echo "Opening Settings by name…"
expect open-settings "$(phone '"action":"launch_app","value":"Settings"')" 'r.ok && /Settings/.test(r.message)'
sleep 3
echo "Reading the screen…"
expect read-settings "$(phone '"action":"read_screen"')" 'r.ok && /Network|Battery|Apps/.test(r.screen)'
echo "Tapping “Network & internet”…"
expect tap-network "$(phone '"action":"tap","value":"Network & internet"')" 'r.ok && /Network/.test(r.message)'
sleep 2
expect read-network "$(phone '"action":"read_screen"')" 'r.ok && /Internet|Airplane|Hotspot|SIM|Wi.?Fi/i.test(r.screen)'
adb exec-out screencap -p > "$OUT/settings-network.png" || true
expect back "$(phone '"action":"press_button","value":"back"')" 'r.ok'
expect home "$(phone '"action":"press_button","value":"home"')" 'r.ok'
sleep 1
echo "Opening an app while Patch is in the background…"
expect open-again "$(phone '"action":"launch_app","value":"Settings"')" 'r.ok'
sleep 3
expect read-again "$(phone '"action":"read_screen"')" 'r.ok && /Network|Battery|Apps/.test(r.screen)'
expect scroll "$(phone '"action":"scroll","value":"down"')" 'r.ok'
expect home-again "$(phone '"action":"press_button","value":"home"')" 'r.ok'
echo "Music: no Spotify on this emulator, so Patch should say so."
expect no-spotify "$(phone '"action":"play_music","value":"Bohemian Rhapsody on Spotify"')" '!r.ok && /Spotify/.test(r.message)'
expect volume "$(phone '"action":"volume_up"')" 'r.ok && /Volume \d+%/.test(r.message)'

echo "---- Patch's log ----"
patch_log 120
echo "All emulator checks passed."
