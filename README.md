# GTA 6 Secrets Map: the talking map of Leonida

> **Also in this repo: [Bulwark](bulwark/README.md)**, in `bulwark/`. It finds security holes in your devices and software and fixes them: it audits the computer it runs on and its installed software, checks your code projects' dependencies for known vulnerabilities, checks the other devices on your network (router, cameras, NAS, TVs), and applies fixes you can review first and undo later. No dependencies; run it with `cd bulwark && ./bulwark scan`.

> **Also in this repo: [Rainmaker](rainmaker/README.md)**, a separate app in `rainmaker/`. It's an AI-first agency CRM (a simpler GoHighLevel alternative) that finds local-business clients, runs your pipeline with Claude agents and builds tailored ads. It has its own `package.json`; run it with `cd rainmaker && npm install && npm run dev`.

An unofficial GTA VI companion site. Players talk to **Sol**, a voice guide built on ElevenLabs Agents. Sol flies the map to any secret, pin or street and opens a popup that explains it. It can also draw a route with turn-by-turn directions, give tips with confidence labels, and read out the day's news. The news and community pins update every day on their own.

> GTA 6 Secrets Map is a fan site. It is not affiliated with Rockstar Games or Take-Two Interactive. The map is **real-world Florida** (the place Leonida parodies) standing in for the game world. It never copies Rockstar's in-game map.

## What's in it

| Area | How it works |
| --- | --- |
| Map | MapLibre GL (WebGL). The state view is built from Natural Earth plus AWS seafloor data, self-hosted in `public/geo`. From about zoom 10 it shows every street, building, shop and house number from OpenStreetMap through OpenFreeMap vector tiles, with 3D buildings when you tilt. Label fonts are self-hosted. |
| Voice guide | ElevenLabs agent `agent_7001m7t6yy2fekkta6jf0fnq0t14` ("Sol"). It has 8 client tools that drive the map in the browser (`src/components/voice/voice-tools.ts`). |
| Fly-to + popups | `show_location` (pins) and `go_to_place` (pins, regions, or any real street or landmark via `/api/geocode`) fly the camera in and open a popup. |
| Routes | `plan_route` and the popup's "Route from…" button use `/api/route`, which proxies any OSRM server. The route card offers drive, walk or bike and lists every step. If routing is down, the site draws a straight line and says so. |
| Daily updates | `.github/workflows/daily-intel.yml` runs at 10:17 UTC. It pulls RSS feeds (`data/sources.json`), dedupes, tags and writes `data/news.json`, plus an AI brief if `ANTHROPIC_API_KEY` is set. It also publishes community pins a curator approved. |
| Money | AdSense slots (house ads until configured), Amazon affiliate links, the **Crew Pass** membership (Stripe Payment Link: more voice time, no ads), and a Resend newsletter. |

## Run it locally

```bash
npm install
cp .env.example .env.local   # fill in what you have; everything optional degrades gracefully
npm run dev                  # http://localhost:3000
npm test                     # pipeline + routing unit tests
```

## Deploy (Vercel)

1. Import the repo in Vercel (vercel.com/new) and add `ELEVENLABS_API_KEY`: an ElevenLabs key with **ElevenLabs Agents: Write** access. That is the only required variable; the agent ID, site URL and cookie secret have working defaults (setting `SESSION_SECRET` is still recommended). The agent is private, so the site mints short-lived conversation tokens server-side. Other variables in `.env.example` switch on each money feature.
2. Merge to the default branch. Scheduled GitHub Actions only run there. Add `ANTHROPIC_API_KEY` as a repository secret if you want AI-written briefs. Run the workflow once by hand from the Actions tab to check it.
3. Stripe: create a Payment Link for Crew Pass and set "After payment" to redirect to `https://YOUR-DOMAIN/crew-pass/success?session_id={CHECKOUT_SESSION_ID}`.
4. Before heavy traffic, point `GEOCODER_URL` and `ROUTING_URL_*` at your own (or paid) Nominatim/OSRM. The public OpenStreetMap servers are for light use. Responses are cached in memory and at the CDN.

## The voice agent

Tools on the agent and the handlers that serve them:

| Tool | Does |
| --- | --- |
| `show_location` | Fly to a pin by id, open its popup and guide |
| `go_to_place` | Fly to a pin, region or real street or landmark at street level, with a popup |
| `plan_route` | Draw a route with directions (origin optional) |
| `search_map`, `focus_region`, `get_tips`, `get_latest_news`, `reset_map` | Search and highlight pins, region overviews, tips, today's news, reset |

At connect time the page sends Sol the date, the player's tier, what they're viewing, and the live pin directory, so new pins work the same day. Five agent tests cover pin fly-to, street fly-to, routing, news and refusing piracy, and all five pass. Re-run them in the ElevenLabs dashboard after changing the prompt. `.claude/settings.json` pre-approves agent-config edits for Claude Code sessions in this repo.

## Community pins

"Pin a find" files a GitHub issue labelled `submission`. A curator edits its JSON block if needed and adds the `approved` label. The next daily run publishes the pin, comments and closes the issue.

## Data and credits

Map data © OpenStreetMap contributors (ODbL) via OpenFreeMap and OpenMapTiles. Natural Earth (public domain). AWS Terrain Tiles. News headlines link to the original publishers; the site never republishes articles. Pins carry confidence labels: **Confirmed**, **Reported** or **Theory**. Theories are the site's own inferences and are labelled as such.
