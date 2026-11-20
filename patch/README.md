# Patch: talk to everything on your WiFi

Patch is a small app that runs on your computer, finds every device on your home WiFi, and lets you control them and tune up your network, by talking to it. The voice is an ElevenLabs agent called **Patch**. It already exists in your ElevenLabs account, with its tools and tests.

> "Turn off the kitchen lights." · "Put YouTube on the living room TV." · "Make the bedroom cozy." · "Is anything on my network unsafe?" · "Why is my internet slow?" · "Run a tune-up and fix what you can."

## What it does

- **Finds everything on your WiFi.** It uses the same signals your devices already broadcast (Bonjour/mDNS, UPnP, NetBIOS) plus a quick check of common ports, then works out what each thing is: phones, laptops, TVs, speakers, printers, cameras, smart plugs, the router.
- **Controls the devices that allow it** (table below): on/off, brightness, colour, white tone, volume, play/pause, TV apps and remote buttons, thermostats, locks, blinds, vacuums, scenes, restarts and firmware updates.
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
4. **Turn on the voice:** in ElevenLabs, go to *Developers → API keys*, create a key with the **ElevenLabs Agents** permission set to *Write*, and paste it into Patch's **Settings**. The key stays on your computer and is only used to start each conversation. Then click **Talk to Patch** and allow the microphone.

Keep the window that started Patch open while you use it.

### Try it without touching your network

`npm run demo` starts Patch against a **simulated home**: about 20 pretend devices (Hue lights, a Roku TV, Sonos, a Chromecast, Shelly and Kasa plugs, WLED, LIFX, Yeelight, an Elgato light, a Brother printer, Home Assistant with a lock and thermostat, a router with open ports, a camera with Telnet on…), each speaking its real protocol. On macOS, first run `for i in $(seq 1 31); do sudo ifconfig lo0 alias 127.0.10.$i up; done` (Linux and Windows need nothing).

## What it can control

| Device | Works out of the box | Setup |
| --- | --- | --- |
| **Philips Hue** lights, rooms and scenes | on/off, brightness, colour, white tone, scenes, blink, rename, bridge updates and auto-updates | Press the bridge's button, then say "pair the Hue bridge" (or tap **Pair**) |
| **Roku** players and Roku TVs | open apps, remote buttons, search, inputs, power (TVs), volume | If it's blocked: Roku *Settings → System → Advanced → Control by mobile apps → Default* |
| **Sonos** | play, pause, skip, volume, mute (groups handled) | none |
| **Chromecast / Google TV / Google & Nest speakers** | volume, mute, play/pause, stop casting | none |
| Other smart TVs and AV receivers (DLNA) | volume, mute, play/pause | none |
| **Shelly** plugs, relays, dimmers (Gen1 and Gen2+) | on/off, brightness, power use, restart, firmware updates | If you set a password on it, add it on the device's card |
| **TP-Link Kasa** plugs, strips, bulbs, dimmers | on/off, brightness, colour, power use, status light, restart | Newer Tapo/Kasa firmware: use Home Assistant |
| **WLED** LED strips | on/off, brightness, colour, effects, presets, restart | none |
| **LIFX** bulbs | on/off, brightness, colour, white tone, pulse, rename | none |
| **Yeelight** bulbs | on/off, brightness, colour, white tone | Turn on *LAN Control* in the Yeelight app |
| **Elgato** Key Lights | on/off, brightness, white tone, identify | none |
| **Printers** (IPP: most network printers) | status, ink/toner levels, paper jams, beep/identify | none |
| **Router** (UPnP) | internet status, uptime, open port forwards and closing them | UPnP must be on (it usually is) |
| **Home Assistant** | everything it controls: lights, switches, thermostats, locks, blinds, garage doors, vacuums, media players, scenes, scripts, updates | Paste a long-lived access token in **Settings** |
| Computers, phones, NAS, cameras, consoles | identified and named; **Wake-on-LAN** for computers; their settings page one click away | none |

Anything Patch can't control directly (Apple TVs, most cameras, Ring, Nest, Tuya…) still shows up, gets checked by the tune-up, and can usually be controlled through Home Assistant.

## Safety and privacy

- **Local only.** The server listens on this computer (`127.0.0.1`) and refuses requests with any other Host header (which blocks DNS-rebinding attacks), cross-site requests, and any API call without the token baked into the page.
- **Only your network.** Patch scans private home address ranges only, and never guesses or cracks passwords. The agent is told to decline requests about other people's networks or devices.
- **Risky actions need your yes.** Cutting power to a plug, unlocking, moving a garage door, restarting, installing firmware, closing a port forward, and switching off more than six things at once all need confirmation. Patch enforces this itself, not just the AI: the agent gets a one-time confirmation token only after **you** speak or tap **Yes**, so it can't confirm on your behalf.
- **Your secrets stay here.** API keys, device passwords and the Home Assistant token are stored in `patch/.data/settings.json` (owner-only permissions, never committed). ElevenLabs sees the conversation and the device names and states the agent needs, never passwords.
- **The agent** is private (signed tokens only), keeps no voice recordings, keeps transcripts for 30 days, and is capped at 200 conversations a day and 15 minutes per conversation.
- The manufacturer list (to label devices like "Espressif" or "Sonos") is downloaded once from the public IEEE registry; nothing about your network is sent. You can switch it off in Settings.

## Phones and tablets

Start with `npm run lan` (or tick the option in Settings and restart). Patch prints an address like `http://192.168.1.23:4545` and a 6-digit access code. Browsers only allow the microphone on secure (HTTPS) pages or on the computer itself, so on phones you can use the dashboard and type to Patch, and talk to it on the computer.

## Troubleshooting

- **A device is missing:** make sure this computer is on the same WiFi (not a guest network, and with any VPN switched off), then press **Scan**. Mesh systems with "AP/client isolation" turned on hide devices from each other.
- **Patch picked the wrong network** (e.g. a VPN or Docker one): set it in *Settings → Network to scan*, such as `192.168.1.0/24`.
- **"Port 4545 is busy":** Patch is already running. Open <http://localhost:4545>, or start with `node server.mjs --port 4546`.
- **Voice says the agent can't be found:** your API key is from a different ElevenLabs account than the agent. Use a key from the account that has the "Patch - Home Network Voice Assistant" agent, or set your own agent ID in *Settings → Advanced*.

## For developers

```
patch/
  server.mjs            entry point (flags: --demo, --lan, --port, --no-open)
  src/app.mjs           HTTP server, API, live events, ElevenLabs token minting, security checks
  src/scanner.mjs       discovery pipeline     src/inventory.mjs   device list + spoken-name matching
  src/controller.mjs    actions, confirmations, diagnostics     src/tuneup.mjs   health/security check
  src/net/              ARP, NetBIOS, TCP probes, mDNS/DNS-SD, SSDP/UPnP/SOAP, XML, WiFi, speed test, OUI
  src/drivers/          one file per brand/protocol; generic.mjs classifies everything else
  public/               dashboard (app.js) and voice panel (voice.js): plain ES modules, no build step
  sim/                  simulated home network used by demo mode and tests
  agent/prompt.md       the agent's system prompt (kept in sync with ElevenLabs)
  test/                 node:test suites
```

`npm test` runs 32 tests: protocol parsers and encoders checked against real-world output, plus end-to-end runs against the simulator covering discovery, control by spoken name, the confirmation guard, tune-up fixes and the server's security checks.

**Adding a device type:** create `src/drivers/<name>.mjs` exporting `{ id, detect(host, ctx), refresh(device, ctx), act(device, action, value, ctx) }`, use action names from `src/drivers/common.mjs`, register it in `src/drivers/index.mjs`, and add a simulated device in `sim/` with a test.

**The ElevenLabs agent:** `agent_3201m7wq24r6eq39fk3eq5w5fmf2` ("Patch - Home Network Voice Assistant"): Claude Haiku 5.5, voice "Danny – Calm, Clear & Helpful", the ten client tools above, and eight attached behaviour tests. If you change a tool's name or parameters in `public/voice.js`, change the matching tool in ElevenLabs too.
