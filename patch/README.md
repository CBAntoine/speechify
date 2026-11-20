# Patch: talk to everything on your WiFi

Patch is a small app that runs on your computer, finds every device on your home WiFi, tells you exactly what each one is, and lets you control them and tune up your network by talking or typing to it. The voice is an ElevenLabs agent called **Patch**. It already exists in your ElevenLabs account, with its tools and tests.

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

The agent's ten tools (`list_devices`, `scan_network`, `get_device_status`, `control_device`, `diagnose_device`, `run_tuneup`, `apply_fix`, `run_speed_test`, `network_info`, `open_device_page`) are **client tools**: ElevenLabs asks your browser to run them, and the browser calls the Patch server on your computer. Your home network is never exposed to the internet, and the cloud never connects to your devices.

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
| **Roku** players and Roku TVs | open apps (Roku "channels"), live TV channels by number (Roku TVs), YouTube videos, Roku search, typing, remote buttons, inputs, power (TVs), volume | If it's blocked: Roku *Settings → System → Advanced → Control by mobile apps → Default* |
| **Samsung** smart TVs (Tizen, 2016 on) | power, channels, apps, YouTube, web searches and websites in the TV's browser, typing, remote buttons, inputs, volume | Press **Connect**, then choose **Allow** on the TV. To turn it on from off, enable *Power On with Mobile* in the TV's network settings |
| **LG** smart TVs (webOS) | power, channels by number or name, apps, YouTube, web browser, typing, remote buttons, inputs, volume | Press **Connect**, then choose **Accept** on the TV. To turn it on from off, enable *Turn on via Wi-Fi* |
| **Fire TV** and **Android / Google TV** (Fire TV Stick, Cube, Sony, TCL, Hisense, Nvidia Shield…) | power, apps, YouTube search and videos, web browser (Fire TV: Silk), typing, remote buttons, channels on TVs with a tuner, volume | Turn on *ADB debugging* (Fire TV: *Settings → My Fire TV → Developer options*) or *Network debugging* (Android TV: *Settings → System → Developer options*), then press **Connect** and choose **Allow** on the TV |
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

## Safety and privacy

- **Local only.** The server listens on this computer (`127.0.0.1`) and refuses requests with any other Host header (which blocks DNS-rebinding attacks), cross-site requests, and any API call without the token baked into the page.
- **Only your network.** Patch scans private home address ranges only, and never guesses or cracks passwords. The agent is told to decline requests about other people's networks or devices.
- **Risky actions need your yes.** Cutting power to a plug, unlocking, moving a garage door, restarting, installing firmware, closing a port forward, and switching off more than six things at once all need confirmation. Patch enforces this itself, not just the AI: the agent gets a one-time confirmation token only after **you** speak or tap **Yes**, so it can't confirm on your behalf.
- **Your secrets stay here.** API keys, device passwords, TV pairing tokens, Patch's ADB key and the Home Assistant token are stored in `patch/.data/settings.json` (owner-only permissions, never committed). ElevenLabs sees the conversation and the device names, models and states the agent needs, never passwords or keys.
- **TV access is yours to give.** Each TV asks you on its own screen before Patch can control it. ADB debugging on a Fire TV or Android TV lets any computer you allow control the TV; if you stop using Patch, you can turn it off again in the TV's developer options. Websites and searches opened by voice only ever open web pages (never files or scripts), and text spoken to Patch is passed to TVs as plain text, never as commands.
- **The agent** is private (signed tokens only), keeps no voice recordings, keeps transcripts for 30 days, and is capped at 200 conversations a day and 15 minutes per conversation.
- The manufacturer list (to label devices like "Espressif" or "Sonos") is downloaded once from the public IEEE registry; nothing about your network is sent. You can switch it off in Settings.

## Phones and tablets

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
  test/                 node:test suites
```

`npm test` runs 48 tests: protocol parsers and encoders checked against real-world output and published byte layouts (WebSocket frames, ADB messages and its RSA key format, ONVIF and PlayStation replies, model-code tables), plus end-to-end runs against the simulator. The simulated home includes a Samsung TV (secure WebSocket with the Allow prompt), an LG TV (SSAP with client keys and the pointer socket), a Fire TV (ADB with real key authentication), a PlayStation 5, an Apple TV, an iPhone, a MacBook, a Spotify Connect speaker, an ONVIF camera and a pretend YouTube API. The tests cover discovery and exact identification, TV pairing, channels, apps, YouTube and web search, control by spoken name, the confirmation guard, tune-up fixes and the server's security checks.

**Adding a device type:** create `src/drivers/<name>.mjs` exporting `{ id, detect(host, ctx), refresh(device, ctx), act(device, action, value, ctx) }`, use action names from `src/drivers/common.mjs`, register it in `src/drivers/index.mjs`, and add a simulated device in `sim/` with a test.

**The ElevenLabs agent:** `agent_3201m7wq24r6eq39fk3eq5w5fmf2` ("Patch - Home Network Voice Assistant"): Claude Haiku 5.5, voice "Danny – Calm, Clear & Helpful", the ten client tools above, and fourteen attached behaviour tests (including channels, YouTube search and pick, web search on this computer, TV pairing and describing devices exactly). If you change a tool's name or parameters in `public/voice.js`, change the matching tool in ElevenLabs too.

**Credits:** the LG TV pairing manifest in `src/drivers/lg-pairing.json` is the one LG's own remote app uses, as published in the [lgtv2](https://github.com/hobbyquaker/lgtv2) package (MIT License, Copyright (c) Sebastian Raff).
