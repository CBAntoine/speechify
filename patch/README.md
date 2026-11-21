# Patch: talk to everything on your WiFi

Patch is a small app that runs on your computer, or on its own on an Android phone, finds every device on your home WiFi, tells you exactly what each one is, and lets you control them and tune up your network by talking or typing to it. The voice is an ElevenLabs agent called **Patch**. It already exists in your ElevenLabs account, with its tools and tests.

> "What exactly is on my WiFi?" · "Put the living room TV on channel 7.1." · "Search YouTube for cooking videos on the bedroom TV." · "Play the second one." · "Look up tomorrow's weather on the TV." · "Turn off the kitchen lights." · "Is anything on my network unsafe?" · "Run a tune-up and fix what you can."

## What it does

- **Finds everything on your WiFi and says exactly what it is.** It uses the same signals your devices already broadcast (Bonjour/mDNS, UPnP, NetBIOS, WS-Discovery, PlayStation and Spotify Connect discovery) plus a quick check of common ports and each device's own API, then names the exact make and model: "Samsung 65" Q80B Smart TV (model QN65Q80BAFXZA)", "Apple iPhone 14 Pro", "Amazon Fire TV Stick 4K Max", "Reolink RLC-510A camera", "Sony PlayStation 5". Each device also says **how sure** Patch is (the device said so itself, strong clues, or a best guess) and **how it knows**. The **List** view shows everything as a table, and **Export** saves it as a spreadsheet.
- **Controls the devices that allow it** (table below): on/off, brightness, colour, white tone, volume, play/pause, thermostats, locks, blinds, vacuums, scenes, restarts and firmware updates.
- **Runs your TVs:** power, channels (by number or name), apps, YouTube (search on the TV, or pick a result and play it), web searches and websites in the TV's browser, typing into the TV's search box, and remote buttons. Web searches and YouTube also work on the computer running Patch ("look it up on my computer").
- **Tunes up your network.** One check covers waiting firmware updates, risky services (Telnet, FTP, VNC), ports your router has opened to the internet, weak WiFi signals, flaky connections, low ink or batteries, a crowded WiFi channel, a slow DNS server and your internet speed. It gives a score out of 100 and fixes what it can (with your OK).
- **Speaks and listens** through ElevenLabs, or you can type. Everything also works by clicking on the dashboard.

## How it works

```
 Your browser (localhost)                 ElevenLabs cloud
 ┌──────────────────────────┐  voice     ┌───────────────────────┐
 │ Dashboard + voice panel  │◀──────────▶│ "Patch" agent (LLM)   │
 │ runs the agent's tools   │  WebRTC    │ decides what to do    │
 └────────────┬─────────────┘            └───────────────────────┘
              │ local API (this computer only)
 ┌────────────▼─────────────┐   your WiFi   ┌──────────────────────────┐
 │ Patch server (Node.js)   │──────────────▶│ lights, TV, speakers,    │
 │ discovery · drivers ·    │  local APIs   │ plugs, printer, router … │
 │ tune-up · safety checks  │               └──────────────────────────┘
 └──────────────────────────┘
```

The agent's eleven tools (`list_devices`, `scan_network`, `get_device_status`, `control_device`, `diagnose_device`, `run_tuneup`, `apply_fix`, `run_speed_test`, `network_info`, `open_device_page`, `tv_apps`) are **client tools**: ElevenLabs asks your browser to run them, and the browser calls the Patch server on your computer. Your home network is never exposed to the internet, and the cloud never connects to your devices.

## Get started

1. **Install Node.js** (version 20 or newer) from <https://nodejs.org>. The LTS button is fine.
2. **Get this folder** onto the computer that's on your home WiFi (clone the repo, or download it as a ZIP from GitHub and unzip it).
3. **Start Patch:**
   - Mac: double-click `start-mac.command` (the first time, right-click → Open).
   - Windows: double-click `start-windows.bat`.
   - Linux, or any terminal: `npm install` once, then `npm start`.

   Your browser opens at <http://localhost:4545>. Patch scans your network straight away (about 10 seconds).
4. **Turn on the voice:** in ElevenLabs, go to *Developers → API keys*, create a key with the **ElevenLabs Agents** permission set to *Write*, and paste it into Patch's **Settings**. The key stays on your computer and is only used to start each conversation. Then click **Talk to Patch** and allow the microphone, or just type in the box under the conversation: typed chat uses the same agent and tools, no microphone needed.
5. **Connect your TVs** (once each): press **Connect** on the TV's card and answer the question on the TV screen (details below).
6. **Optional, for YouTube by name:** add a free YouTube Data API key in **Settings → YouTube search** so Patch can find a video ("play lo-fi beats on the TV") and read out the results. Without it, TVs show YouTube's own search results instead.

Keep the window that started Patch open while you use it.

### Try it without touching your network

`npm run demo` starts Patch against a **simulated home**: about 20 pretend devices (Hue lights, a Roku TV, Sonos, a Chromecast, Shelly and Kasa plugs, WLED, LIFX, Yeelight, an Elgato light, a Brother printer, Home Assistant with a lock and thermostat, a router with open ports, a camera with Telnet on…), each speaking its real protocol. On macOS, first run `for i in $(seq 1 31); do sudo ifconfig lo0 alias 127.0.10.$i up; done` (Linux and Windows need nothing).

## What it can control

| Device | Works out of the box | Setup |
| --- | --- | --- |
| **Philips Hue** lights, rooms and scenes | on/off, brightness, colour, white tone, scenes, blink, rename, bridge updates and auto-updates | Press the bridge's button, then say "pair the Hue bridge" (or tap **Connect**) |
| **Roku** players and Roku TVs | open apps (Roku "channels"), list them and add new ones from the Channel Store, live TV channels by number (Roku TVs), YouTube videos, Roku search, typing, remote buttons, inputs, power (TVs), volume | If it's blocked: Roku *Settings → System → Advanced → Control by mobile apps → Default* |
| **Samsung** smart TVs (Tizen, 2016 on) | power, channels, apps (list them, add well-known ones), YouTube, web searches and websites in the TV's browser, your own TV apps (in its browser), typing, remote buttons, inputs, volume | Press **Connect**, then choose **Allow** on the TV. To turn it on from off, enable *Power On with Mobile* in the TV's network settings |
| **LG** smart TVs (webOS) | power, channels by number or name, apps (list them, open LG's app store), YouTube, web browser, your own TV apps (in its browser), typing, remote buttons, inputs, volume | Press **Connect**, then choose **Accept** on the TV. To turn it on from off, enable *Turn on via Wi-Fi* |
| **Fire TV** and **Android / Google TV** (Fire TV Stick, Cube, Sony, TCL, Hisense, Nvidia Shield…) | power, apps (list, install from the store or an app file, remove), seeing and using the TV's screen, searching inside apps, your own TV apps (installed with their own icon), YouTube search and videos, web browser (Fire TV: Silk), typing, remote buttons, channels on TVs with a tuner, volume | Turn on *ADB debugging* (Fire TV: *Settings → My Fire TV → Developer options*) or *Network debugging* (Android TV: *Settings → System → Developer options*), then press **Connect** and choose **Allow** on the TV |
| **Sonos** | play, pause, skip, volume, mute (groups handled) | none |
| **Chromecast / Google TV / Google & Nest speakers** | volume, mute, play/pause, stop casting, open YouTube and other Cast apps on screens | none |
| **This computer** | web searches, websites and YouTube open in its browser | none |
| Other smart TVs and AV receivers (DLNA) | volume, mute, play/pause | none |
| **Shelly** plugs, relays, dimmers (Gen1 and Gen2+) | on/off, brightness, power use, restart, firmware updates | If you set a password on it, add it on the device's card |
| **TP-Link Kasa** plugs, strips, bulbs, dimmers | on/off, brightness, colour, power use, status light, restart | Newer Tapo/Kasa firmware: use Home Assistant |
| **WLED** LED strips | on/off, brightness, colour, effects, presets, restart | none |
| **LIFX** bulbs | on/off, brightness, colour, white tone, pulse, rename | none |
| **Yeelight** bulbs | on/off, brightness, colour, white tone | Turn on *LAN Control* in the Yeelight app |
| **Elgato** Key Lights | on/off, brightness, white tone, identify | none |
| **Printers** (IPP: most network printers) | status, ink/toner levels, paper jams, beep/identify | none |
| **Router** (UPnP) | internet status, uptime, open port forwards and closing them | UPnP must be on (it usually is) |
| **Home Assistant** | everything it controls: lights, switches, thermostats, locks, blinds, garage doors, vacuums, media players (including TV apps, inputs and channels), scenes, scripts, updates | Paste a long-lived access token in **Settings** |
| Computers, phones, tablets, NAS, cameras, consoles | identified by make and model (iPhones, iPads, Macs, Apple TVs and HomePods by exact model; Samsung and Pixel phones, Windows PCs and PlayStations from what they announce; ONVIF cameras by maker and model); **Wake-on-LAN** for computers; their settings page one click away | none |

Anything Patch can't control directly (Apple TVs, Vizio TVs, cable boxes, most cameras, Ring, Nest, Tuya…) still shows up with what Patch knows about it, gets checked by the tune-up, and can usually be controlled through Home Assistant.

### Connecting your TVs

TVs only take commands from apps you've allowed, so each one asks once:

- **Samsung:** press **Connect** on the TV's card and choose **Allow** in the box that appears on the TV. Patch keeps the TV's token, so it won't ask again.
- **LG:** press **Connect** and choose **Accept** on the TV.
- **Fire TV:** first turn on *ADB debugging*: *Settings → My Fire TV → Developer options* (no Developer options? *Settings → My Fire TV → About*, then select the device name 7 times). Then press **Connect**, tick *Always allow from this computer* on the TV, and choose **Allow**.
- **Android TV / Google TV:** *Settings → System → About*, select *Android TV OS build* 7 times, then in *Settings → System → Developer options* turn on *USB debugging* and *Network debugging*. Then **Connect** as for Fire TV. (Some newer Google TV devices only offer *Wireless debugging* with a pairing code, which Patch doesn't support yet; their volume and casting still work through Google Cast.)
- **Roku** needs nothing; **Chromecast** needs nothing.

Channels: on Roku TVs, Samsung, LG and Android TVs with an antenna, Patch tunes the TV's own tuner. If you watch through a cable or satellite box, change the channel on the box (Patch can't reach most boxes; Home Assistant can control some).

### Apps on your TVs

Open a TV's card and scroll down to **Apps on this TV**, or just ask:

- **"What apps are on the TV?"** lists them. Tap one to open it.
- **"Install Plex on the TV"** opens the app's page in the TV's own store and chooses **Install** (or **Get**) when it's free. If it costs money, Patch leaves that choice to you. On a Roku it opens the channel's page in the Channel Store (press OK to add it); on Samsung TVs it installs the well-known apps it knows by name; on LG TVs it opens the store for you to search.
- **An app file from your phone** (Android TV, Google TV and Fire TV): tap **Install an app file (APK)** and choose it. Patch asks before installing it, because it doesn't come from the TV's store. Only install apps you trust.
- **"Remove Plex from the TV"** removes it (after you say yes). Apps that came with the TV can't be removed.
- **Use an app fully:** "open YouTube and search for Bluey" searches inside the app; then "down", "OK", "back" and typing work like the remote.
- **See the TV's screen** (Android TV, Google TV and Fire TV): "what's on the TV?" reads what's there as a numbered list and says where the remote is; "select the second one" or "choose Install" picks it. Apps that draw their own picture (Netflix, YouTube) can't be read; Patch says so and uses the remote buttons instead.

## Your own TV apps

Patch can make apps for your TVs. Tap **Make a TV app** on the dashboard (or say "make a photo frame app for the TV"), pick what kind, fill in a line or two, and choose **Install on** your TV:

| Kind | What it is | What you give it |
| --- | --- | --- |
| 🎬 Video channel | your own channel of videos, picked with the remote | YouTube links, playlists or video links |
| 🖼️ Photo frame | a slideshow with the time | photos from your phone (Patch makes them TV-sized) |
| 🕰️ Clock & weather | a big clock and the week's weather | your town |
| 📝 Notes board | notes and reminders for everyone | one note per line |
| ⏳ Countdown | days to go, then a celebration | what for, and the date |
| 📻 Radio | internet radio stations | station names (looked up in the free Radio Browser directory) |
| 🧩 App shortcuts | big buttons for the TV apps you use most | app names (Android TV and Fire TV) |
| ❓ Quiz | a quiz to play with the remote | questions, or ask Patch to write them |
| 🌐 Website | any site, full screen, with a pointer you move with the remote | its address |
| 💻 Your own code | any page you (or Patch) write | HTML |

On **Android TV, Google TV and Fire TV** the app is installed like any other, with its own name and icon in the TV's apps list, and it keeps working when your phone is off. Change it any time (**Change**, then **Update on** the TV): the new version installs over the old one. On **Samsung and LG TVs** it opens in the TV's web browser, served by Patch over your WiFi, so keep Patch open while you use it (bookmark it in the TV's browser to come back).

In apps: the arrows move, **OK** chooses, **Back** goes back. In a website app the arrows move a pointer and **OK** clicks; the **Menu** button turns the pointer off for sites that work with the arrows.

## Apps Claude builds for you

Anything that isn't one of the kinds above, Claude can build: describe it and Claude (Anthropic's Claude Opus 5.5) writes the whole app, then Patch puts it on your TV like the apps it makes itself. Games for the kids, a chores board, a scoreboard for family game night, a bedtime routine, a dashboard: whatever you can describe.

1. **Get an Anthropic API key**: in the [Anthropic Console](https://console.anthropic.com/settings/keys), create a key and add some credit under Billing.
2. **Add it to Patch**: Settings → **Claude** → paste the key → **Save & test**.
3. **Ask for an app.** Say or type it ("ask Claude to build a snake game for the kids on the Fire TV"), or tap **Build with Claude** under TV apps, describe it, and choose where it goes.

Claude takes two to four minutes. You can keep using Patch meanwhile: the app shows what Claude is doing (planning, writing, putting it on the TV), and Patch tells you when it's ready (out loud, in a conversation). Then ask for changes the same way ("make the snake faster", "add a high score"), or type them under **Ask Claude to change it**: Claude rewrites the app and Patch updates it on your TVs.

- **Where they run:** on Android TV, Google TV and Fire TV, as a real app with its own icon; on Samsung and LG TVs, in the TV's browser while Patch is running; and in the browser of the phone or computer running Patch.
- **What it costs:** each build or change uses your Anthropic account, usually well under a dollar. Patch shows roughly what each one cost.
- **What's sent to Anthropic:** your description, the app's name, which TV it's for (its name and model), and for a change, the app's current code. Nothing else about your network. The key stays with Patch and is only ever sent to Anthropic.
- If Claude declines a request or something goes wrong (no credit left, the key isn't accepted, Claude is busy), the app says why, with **Try again**. Patch asks Claude to write apps that work with a remote, fit any TV screen, run on older TVs and work without an internet connection unless they need one.

## Safety and privacy

- **Local only.** The server listens on this computer (`127.0.0.1`) and refuses requests with any other Host header (which blocks DNS-rebinding attacks), cross-site requests, and any API call without the token baked into the page.
- **Only your network.** Patch scans private home address ranges only, and never guesses or cracks passwords. The agent is told to decline requests about other people's networks or devices.
- **Risky actions need your yes.** Cutting power to a plug, unlocking, moving a garage door, restarting, installing firmware, closing a port forward, installing an app file that isn't from a TV's store, removing an app from a TV, choosing anything on a screen that could buy, send or delete, and switching off more than six things at once all need confirmation. Patch enforces this itself, not just the AI: the agent gets a one-time confirmation token only after **you** speak or tap **Yes**, so it can't confirm on your behalf.
- **Your secrets stay here.** API keys, device passwords, TV pairing tokens, Patch's ADB key and the Home Assistant token are stored in `patch/.data/settings.json` (owner-only permissions, never committed). ElevenLabs sees the conversation and the device names, models and states the agent needs, never passwords or keys.
- **TV access is yours to give.** Each TV asks you on its own screen before Patch can control it. ADB debugging on a Fire TV or Android TV lets any computer you allow control the TV; if you stop using Patch, you can turn it off again in the TV's developer options. Websites and searches opened by voice only ever open web pages (never files or scripts), and text spoken to Patch is passed to TVs as plain text, never as commands.
- **The agent** is private (signed tokens only), keeps no voice recordings, keeps transcripts for 30 days, and is capped at 200 conversations a day and 15 minutes per conversation.
- **Claude** is only used when you ask it to build or change an app, with your own Anthropic key, which Patch keeps with its settings and only ever sends to Anthropic. Patch sends Claude your description, the app's name, which TV it's for, and for a change the app's current code; nothing else about your network. The apps Claude writes run like your other TV apps: the dashboard's preview is sandboxed, and on a TV they can only use the TV's web browser, open its apps and keep the screen on.
- **Your TV apps** are signed with a key Patch makes for you (kept with Patch's settings), so only your copy of Patch can update them. On Samsung and LG TVs they're served over your WiFi only, at an address with a long random secret in it. Patch's preview of an app runs sandboxed, apart from the dashboard. Text from YouTube, radio stations and websites is always shown as text, never run.
- The manufacturer list (to label devices like "Espressif" or "Sonos") is downloaded once from the public IEEE registry; nothing about your network is sent. You can switch it off in Settings.

## On your Android phone

Patch also runs on an Android phone by itself, with no computer needed. The app carries Patch's own server, so the phone finds what's on your WiFi, runs your TVs, lights and plugs, and you can talk or type to it.

1. On the phone, open the [Patch for Android release](https://github.com/CBAntoine/speechify/releases/tag/patch-android) and tap **Patch.apk**.
2. Open the download. The first time, Android asks you to allow installs from your browser (or Files app): allow it, then tap **Install**. If Google Play Protect says it doesn't recognise the app, choose **More details → Install anyway**.
3. Open **Patch** from your apps while you're on your home WiFi. It scans straight away.
4. **Voice:** add your ElevenLabs key in **Settings** as on a computer, then tap **Talk to Patch** and allow the microphone.

Good to know:
- "Search the web on my phone" or "play it here" opens the browser or the YouTube app.
- Patch works while it's open, and while you're talking to it. When you switch to another app mid-conversation, a "Patch is listening" notification keeps it going; tap **Stop** there to end. Otherwise Android pauses it in the background, so it doesn't use your battery.
- It needs Android 7 or newer, and it only scans WiFi (never the mobile-data network).
- Each new version is signed afresh, so to update, uninstall Patch and install the new one. You'll add your ElevenLabs key and connect your TVs again.

### Let Patch see and use your phone's screen

To read web pages, tap what's on screen, open apps and pick songs, Patch needs Android's screen access. This is the same permission voice-control apps use. You turn it on once:

1. In Patch, tap **Turn on** under "Let Patch see and use your screen". Android's Accessibility settings open.
2. Tap **Patch** (it may be under "Downloaded apps" or "Installed apps"), switch it on and choose **Allow**.
3. If Patch is greyed out (Android 13 and later do this for apps installed from a file): back in Patch, tap **App info**, then **⋮** (top right) → **Allow restricted settings**. Then do step 2 again.

Then just ask:
- "What's on my screen?" · "Open the second result." · "Scroll down." · "Type pizza near me and search." · "Go back." · "Open Maps."
- "Play Bohemian Rhapsody on Spotify." · "Next song." · "Turn it up." · "Put it on the kitchen speaker." Patch opens Spotify's device list and picks the speaker, so any Spotify Connect speaker works.

Patch never reads or types passwords, and it asks you first before tapping anything that buys, sends or deletes something. Text that apps and websites put on the screen never counts as an instruction to Patch. When you ask what's on your screen, the words on it go to the voice service (ElevenLabs and its AI model) so it can answer.

### Opening a computer's Patch from another phone or tablet

Start with `npm run lan` (or tick the option in Settings and restart). Patch prints an address like `http://192.168.1.23:4545` and a 6-digit access code. Browsers only allow the microphone on secure (HTTPS) pages or on the computer itself, so on phones you can use the dashboard and type to Patch, and talk to it on the computer.

## Troubleshooting

- **A device is missing:** make sure this computer is on the same WiFi (not a guest network, and with any VPN switched off), then press **Scan**. Mesh systems with "AP/client isolation" turned on hide devices from each other.
- **Patch picked the wrong network** (e.g. a VPN or Docker one): set it in *Settings → Network to scan*, such as `192.168.1.0/24`.
- **"Port 4545 is busy":** Patch is already running. Open <http://localhost:4545>, or start with `node server.mjs --port 4546`.
- **A TV asks to be connected again:** the TV forgot Patch (after a reset or update). Press **Connect** and allow it once more.
- **Fire TV or Android TV "refused the connection":** ADB debugging is off, or the TV restarted and turned it off. Turn it back on in Developer options.
- **"Search YouTube" opens the TV's browser instead of the YouTube app:** that's the fallback without a YouTube key. Add one in **Settings → YouTube search** to get results read out and played in the YouTube app.
- **Voice says the agent can't be found:** your API key is from a different ElevenLabs account than the agent. Use a key from the account that has the "Patch - Home Network Voice Assistant" agent, or set your own agent ID in *Settings → Advanced*.

## For developers

```
patch/
  server.mjs            entry point (flags: --demo, --lan, --port, --no-open)
  src/app.mjs           HTTP server, API, live events, ElevenLabs token minting, security checks
  src/scanner.mjs       discovery pipeline     src/inventory.mjs   device list + spoken-name matching
  src/controller.mjs    actions, confirmations, diagnostics     src/tuneup.mjs   health/security check
  src/net/              ARP, NetBIOS, TCP probes, mDNS/DNS-SD, SSDP/UPnP/SOAP, XML, WiFi, speed test, OUI
  src/identify.mjs      "what exactly is it?": facts from every clue, plus the one-line description
  src/drivers/          one file per brand/protocol; tv.mjs has the shared TV logic (channels, apps,
                        YouTube, web); generic.mjs classifies everything else
  src/net/              …also websocket.mjs (Samsung/LG), adb.mjs (Fire TV/Android TV), youtube.mjs,
                        wsd.mjs (ONVIF cameras), ddp.mjs (PlayStation), models.mjs (model-code names)
  public/               dashboard (app.js) and voice panel (voice.js): plain ES modules, no build step
  sim/                  simulated home network used by demo mode and tests
  agent/prompt.md       the agent's system prompt (kept in sync with ElevenLabs)
  android/              the Android app: a WebView plus Node.js for Android running server.mjs
  src/platform.mjs      computer or phone: what the Android app passes in, "this phone", links via the app
  src/tvapps/           the TV app maker: kinds.mjs (what each kind needs), index.mjs (apps, building,
                        installing, serving to TV browsers), runtime/ (tvkit.js and .css, shown on the TV),
                        claude.mjs (Claude writing apps: Anthropic's SDK, streamed, structured output)
  src/apk/              Android app files: zip.mjs, axml.mjs (binary manifest and resources), sign.mjs
                        (JAR and APK Signature Scheme v2 signing), index.mjs (read an APK, build a TV app)
  src/net/uitree.mjs    an Android TV's screen (uiautomator) as numbered items
  android/tvapp/        the TV app template: a WebView activity Patch turns into each TV app
  test/                 node:test suites
```

`npm test` runs 69 tests: protocol parsers and encoders checked against real-world output and published byte layouts (WebSocket frames, ADB messages and its RSA key format, ONVIF and PlayStation replies, model-code tables), plus end-to-end runs against the simulator. The simulated home includes a Samsung TV (secure WebSocket with the Allow prompt), an LG TV (SSAP with client keys and the pointer socket), a Fire TV (ADB with real key authentication), a PlayStation 5, an Apple TV, an iPhone, a MacBook, a Spotify Connect speaker, an ONVIF camera and a pretend YouTube API. The tests cover discovery and exact identification, TV pairing, channels, apps, YouTube and web search, control by spoken name, the confirmation guard, tune-up fixes, the server's security checks, and running inside the phone app. The simulated Fire TV also receives files over ADB's sync protocol, installs and removes apps (checking their signatures and versions) and shows a screen Patch can read; the TV app tests make every kind of app, check the preview and the WiFi serving, and install, update and remove a photo frame on it. The Claude tests use a stand-in for Anthropic's API (`sim/claude-api.mjs`, a streamed Messages API that answers like the real one, nothing reaches Anthropic): checking a key, building an app from a description and installing it on the simulated Fire TV, changing it, refusals, a fallback mid-answer, errors in plain words, stopping, trying again and the two-at-a-time limit. Signing is checked with independent verifiers and, in the Android build, with Google's apksigner and aapt2.

**Adding a device type:** create `src/drivers/<name>.mjs` exporting `{ id, detect(host, ctx), refresh(device, ctx), act(device, action, value, ctx) }`, use action names from `src/drivers/common.mjs`, register it in `src/drivers/index.mjs`, and add a simulated device in `sim/` with a test.

**The Android app** (`android/`): a small Java app that runs Patch's own server on Node.js for Android ([nodejs-mobile](https://github.com/nodejs-mobile/nodejs-mobile), Node 18) and shows the dashboard in a WebView. A tiny JNI bridge (`app/src/main/cpp`) starts Node and sends its output to logcat (`adb logcat -s Patch`). The app passes in what Android hides from programs (WiFi address, router, DNS servers, the phone's name) as `PATCH_*` variables and keeps `network.json` current as the phone changes networks. What only Android can do goes through `PhoneBridge`, a tiny HTTP server on 127.0.0.1 with a secret that only Patch's server is given (`PATCH_PHONE_BRIDGE`, `PATCH_PHONE_TOKEN`; client in `src/net/phone.mjs`). It opens pages, apps and music (`MEDIA_PLAY_FROM_SEARCH`, which Spotify, YouTube Music and others accept), sends media keys and sets the volume. With the accessibility service `PatchAccessibility` switched on, it also reads the screen as numbered items and taps, scrolls, types and goes back or home. `ListeningService` is a microphone foreground service that runs while a voice conversation is on, so Patch keeps listening in other apps. The workflow `.github/workflows/patch-android.yml` runs the tests on Node 18, builds the TV app template and the APK, tries it on an Android 14 emulator (server, scan, dashboard and links through Chrome DevTools; screen control; the dashboard's file buttons, choosing an app file in Android's file picker and checking it reaches Patch whole; and TV apps made by Patch, sent and installed with Patch's own ADB client, then opened and read back), checks the app's copy of Anthropic's SDK loads and streams a build (on the phone's Node.js too), and publishes it with the template. To build it yourself, you need the Android SDK and NDK. Run `npm ci` and `node android/prepare-assets.mjs`, unzip nodejs-mobile's Android build into `android/app/libnode`, then run `gradle -p android :app:assembleRelease`. To let new versions install over old ones, give the workflow a signing key as the `PATCH_KEYSTORE_B64` and `PATCH_KEYSTORE_PASSWORD` repository secrets.

**The ElevenLabs agent:** `agent_3201m7wq24r6eq39fk3eq5w5fmf2` ("Patch - Home Network Voice Assistant"): Claude Haiku 5.5, voice "Danny – Calm, Clear & Helpful", the eleven client tools above, and twenty-nine attached behaviour tests (including channels, YouTube search and pick, web search on this computer, TV pairing, describing devices exactly, the phone's screen, TV apps, and asking Claude to build and change apps). If you change a tool's name or parameters in `public/voice.js`, change the matching tool in ElevenLabs too.

**Credits:** the LG TV pairing manifest in `src/drivers/lg-pairing.json` is the one LG's own remote app uses, as published in the [lgtv2](https://github.com/hobbyquaker/lgtv2) package (MIT License, Copyright (c) Sebastian Raff).
