# Mainstreet

A crew of AI agents that sells ready-made websites to local businesses, plus **Atlas**, an ElevenLabs voice agent you can ask what's going on and give orders to.

The crew works around the clock:
1. It scans Google Maps in the cities you pick for businesses with no website, a dead link, only a Facebook page, or a site from 2014.
2. It builds each one three designs of a new site with their real hours, phone number and reviews.
3. It films a 10-second vertical video of that site scrolling on a phone, with an ElevenLabs voiceover and captions.
4. It pitches the business, handles the replies, takes payment and launches the site.

You talk to Atlas. Only two things wake you up: a deal over your approval limit, and a response rate below your floor.

## Better than the original

| The viral version | Mainstreet |
|---|---|
| Seven free-running agents share loose files | One code-controlled pipeline with a SQLite database. Each agent makes one structured Claude call with a fixed output schema. Restarts pick up where they left off, and Atlas can answer "how many replies this week?" instantly. |
| Generic AI mockups and AI b-roll video | Mockups use the business's real name, hours, phone, rating and Google reviews (quoted word for word, never invented). The video shows *their* new site scrolling on a phone. |
| A pitch with links | One proposal page per business: three designs to tap through, the video, what we noticed, the price, and a **Claim this website** button (Stripe Checkout). Payment launches the site at `/live/<name>/` automatically. |
| "Pitcher sends 30 messages across 4 channels" | Email goes out automatically, inside your send window, with a warm-up and a daily cap. Calls, texts and DMs are prepared for you to send with one tap from your phone, because automated cold texts and DMs break carrier rules, platform terms and anti-spam law. |
| Checker estimates render costs | The Checker also enforces daily, monthly and per-lead budgets, reads your ElevenLabs balance, and strips any invented testimonial, award or "since 1998" out of the sites. It blocks any email missing your postal address or unsubscribe link. |
| No reply handling | The Closer reads every reply and does what it calls for: answers questions, sends the payment link, books calls, unsubscribes people, and escalates big deals. |
| Text logs | A live dashboard you can install on your phone, an activity feed, push notifications, and Atlas by voice. Atlas can phone you about an escalation if you turn that on. |

## The crew

| Agent | Does | Uses |
|---|---|---|
| **Atlas** (orchestrator) | Runs the loop, sets the day's targets, enforces quotas, sends your morning brief, reviews results daily and suggests changes to the plan, and decides when to wake you | Claude for the daily strategy review |
| **Scout** | Scans one niche in one city at a time, checks each website (respecting robots.txt) and scores the opportunity from 0 to 100 | Google Places; its own website audit |
| **Diagnoser** | Writes what's wrong and what it costs the business, using only facts from the listing and the site | Claude |
| **Builder** | Plans the content and gets a hero photo. Renders three designs (Bold, Classic, Fresh) and phone screenshots | Claude, ElevenLabs Image API, headless Chromium |
| **Filmer** | Writes a 30–40 word script, voices it, and renders a 1080×1920 video with captions in about 10 seconds | Claude, ElevenLabs text-to-speech with word timings, FFmpeg |
| **Pitcher** | Writes the email, two follow-ups, a text, a DM and a call script. Queues the email (or waits for your yes) and sends inside your window and cap | Claude, Resend |
| **Checker** | Pre-flights every paid call against your budgets and ElevenLabs credits. Fact-checks sites and checks every email for compliance | – |
| **Closer** | Classifies replies, drafts answers, sends the payment link, escalates big deals, launches paid sites and sends the welcome email | Claude, Stripe |

Without keys, every Claude step falls back to a written template, so the whole crew still runs in demo mode.

## Atlas, the voice agent

Open the dashboard and tap the orb (or type instead). Things you can say:

- "What's going on?" / "Anything I need to deal with?" / "How's the response rate this week?"
- "Tell me about Bright Smile Dental." / "Who replied today?"
- "Approve the first one." / "Send the pitch to the roofer in Boise." / "Draft a reply to Bright Smile saying we'll connect their domain."
- "Scout med spas in Asheville, North Carolina." / "Add Fort Collins to the targets." / "Redo the video for Summit Ridge Roofing."
- "Pause the pitcher." / "Set pitches per day to 40." / "Raise the price to 600."
- "I called Hayes Plumbing. They're interested; call back Friday."
- "How much did we spend today?" / "Give me my call list."

How it works:
- **Shared commands.** Atlas's tools are the same commands the dashboard buttons and the MCP endpoint use (`src/commands/`): 22 commands, plus `open_screen` for the app.
- **Confirmation.** Anything that sends, spends, changes prices or budgets, or approves a deal comes back as "needs confirmation" until you say yes. The server enforces this, not just the prompt.
- **Background jobs.** Long jobs like building, filming and scanning run in the background. When they finish, the dashboard tells Atlas mid-conversation.
- **Private agent.** Atlas only accepts conversations started with a one-time token from your server.

**Set it up:** add `ELEVENLABS_API_KEY` to `.env`, then run `npm run voice:sync`, or use Settings → Voice → Sync Atlas. That creates Atlas in your workspace with Claude Sonnet 5.5 as its LLM. Sonnet is fast enough for live voice; change it with `ELEVENLABS_AGENT_LLM`. Put the printed id in `ELEVENLABS_AGENT_ID`.

**On the phone.** Once the app has a public https address (`PUBLIC_URL`), sync again: Atlas's tools then run as webhooks on your server, so it can work on a phone call too.
- **Calling Atlas:** attach a phone number to Atlas in ElevenLabs. On a call, Atlas only takes orders from numbers in `OWNER_PHONES`, and asks for `OWNER_VOICE_PIN` before anything that sends, spends or approves.
- **Atlas calling you:** for the two wake-up events, set `ELEVENLABS_PHONE_NUMBER_ID` and turn on "Call me" in Settings.

## Run it

Needs Node 22.13+ and FFmpeg (`brew install ffmpeg` on a Mac).

```bash
cd mainstreet
npm install
npm run setup      # checks FFmpeg, installs headless Chromium, creates .env, builds the dashboard
npm run demo       # try it: fictional businesses, two weeks of history, nothing is sent
```

Open http://localhost:8787 and watch the crew work.

**Demo mode:**
- **Data:** demo data lives in `data/demo`. `npm run demo -- --reset` starts it over.
- **Time:** a follow-up "day" is two minutes, so you can watch the whole cycle.
- **Replies and payment:** fictional replies arrive on their own, and the Claim button offers a simulated payment.

For real, add keys to `.env` and run `npm start`:

| Key | Turns on |
|---|---|
| `GOOGLE_PLACES_API_KEY` | Real businesses (Places API (New)). Without it, the Scout uses fictional ones |
| `ANTHROPIC_API_KEY` | Claude for every judgment step (`claude-opus-5-5` by default, `CLAUDE_MODEL` to change). Calls use structured outputs and server-side refusal fallback |
| `ELEVENLABS_API_KEY` | Voiceovers, hero images (Image API: Pro plan and up) and Atlas |
| `RESEND_API_KEY` + `MAIL_FROM` | Real email from your verified domain. Without them, emails land in `data/outbox/` |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | The Claim button takes card payments. Payment launches the site |
| `PUBLIC_URL` | Proposal links that work for prospects, webhooks, and Atlas on the phone |
| `APP_PASSWORD` | Sign-in. **Required as soon as the app is reachable from the internet** |
| `NTFY_TOPIC` | Push notifications on your phone (free ntfy app) |
| `MCP_TOKEN` | `/mcp`: run the business from Claude (below) |

Also set these in Settings → You: your name, email and **postal address**. Emails don't go out without the address.

`npm run doctor` shows what's connected, using free checks only. All variables are explained in [.env.example](.env.example).

## What a day looks like

1. **Scan.** The Scout works through your cities × niches, oldest first, until it hits the day's scan quota (default 220). Each business gets a website check and a score.
2. **Pick.** The day's best qualified leads go forward, up to your daily lead quota (default 30).
3. **Build and film.** Each lead goes Diagnoser → Builder → Filmer → Pitcher, a few at a time.
4. **Pitch.**
   - **Review mode (default):** every first email waits for your yes (tap or say "approve"). Approving a pitch approves its two follow-ups.
   - **Auto mode:** emails go out spaced 6–14 minutes apart inside your send window, ramping up over two weeks to protect your domain.
5. **Follow up and reply.**
   - **Follow-ups:** on days 3 and 7, until they reply. After the full sequence with no reply, the lead is closed and never contacted again.
   - **Replies:** each one is read by the Closer within seconds. Routine answers wait for your yes, or go out on their own if you turn on auto-replies.
6. **Get paid.** When they pay through Claim, the site launches and they get a welcome email.
7. **Morning brief** at 8 am. Every day Atlas also reviews the last two weeks and proposes changes to targets or quotas for you to approve.

**What wakes you:**
- **A big deal:** a reply or claim worth more than your limit (default $3,000) is held until you decide. You get an urgent push and, if you've turned it on, a call from Atlas.
- **A falling response rate:** the 7-day rate drops under your floor (default 12%, judged after 40 pitches). The Pitcher can also pause itself when that happens.

## Compliance

This isn't legal advice, but the crew is built to stay on the right side of CAN-SPAM (US) and CASL (Canada).
- **Where CASL applies:** CASL covers anything sent from Canada.
- **Who gets email:** businesses that publish an address on their own site, with no "no solicitations" notice. That's implied consent by conspicuous publication. Where the address was found is recorded on the lead.
- **What every email carries:** your name, agency, postal address and a working unsubscribe link (plus one-click `List-Unsubscribe` headers). The Checker blocks anything without them, or with a leftover placeholder.
- **Opting out:** unsubscribes and "please stop" replies go on a do-not-contact list that every agent checks before acting. The Scout skips chains and franchises.
- **Calls, texts and DMs:** prepared, but sent by you, one tap at a time.
- **Calling prospects:** Atlas never calls prospects. AI-voiced cold calls are illegal in the US without consent.

## Costs

Rough, per fully built lead, at default settings. The Checker tracks the real numbers, and Atlas will tell you ("how much did we spend today?").
- **Google:** a few cents for the search and reviews.
- **Claude Opus 5.5:** about 20–40 cents across the four writing steps.
- **ElevenLabs:** about 4 cents of voice, and a few cents for the hero image (plan dependent).

So 30 leads a day runs roughly $10–18. The default daily budget is $15, the monthly budget $300, and there's a $1.50 cap per lead. Change them in Settings or by voice.

## Deploy

The crew is a long-running process with a headless browser and FFmpeg, so it needs a computer or a small server, not serverless hosting.
- **Your computer:** `npm start`, plus a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) for a public https address. Set `PUBLIC_URL` to it.
- **A server:** `docker compose up -d` builds an image with Node, FFmpeg and Chromium and keeps data in a volume. It works on any VPS, Railway, Fly.io or Render with a persistent disk. Set `APP_PASSWORD`.
- **Stripe webhook:** `https://YOUR-SITE/webhooks/stripe`, event `checkout.session.completed`.
- **Replies:** forward inbound email to `https://YOUR-SITE/webhooks/inbound-email?secret=INBOUND_SECRET`. Resend inbound works, or any service that POSTs JSON with `from`, `to`, `subject` and `text`. With `REPLY_TO=replies@your-inbound-domain`, pitches use `replies+<token>@…`, so every reply matches its lead.
- **On your phone:** open the dashboard in Chrome or Safari and add it to your home screen.

## Control it from Claude (MCP)

Set `MCP_TOKEN`, then:

```bash
claude mcp add --transport http mainstreet https://YOUR-SITE/mcp --header "Authorization: Bearer $MCP_TOKEN"
```

Claude gets the same 22 commands Atlas has, with the same confirmations.

## Develop

```bash
npm run dev        # server (restarts on change) + dashboard with hot reload on :5173
npm test           # 44 tests: website audit and scoring, mockup renderer, video, commands, Atlas's tools, the Checker, Stripe signatures
npm run typecheck
```

```
src/crew/          the agents: scout, diagnoser, builder, filmer, pitcher, checker, closer, orchestrator, prompts
src/commands/      the command registry shared by the dashboard, Atlas and MCP
src/voice/         Atlas: prompt, tools (generated from the commands), ElevenLabs sync
src/site/          website audit and scoring; mockup templates, design system and the proposal page
src/video/         captions, offline voice, the 9:16 composer
src/providers/     Claude, Google Places (+ demo businesses), ElevenLabs, Resend, Stripe, notifications, browser, FFmpeg
src/api/           dashboard API, public pages, webhooks, MCP
web/               the dashboard (React + Vite) with the Atlas panel
docs/contracts.md  how the parts talk to each other
```

## Not built yet

- **Domains:** connecting a client's own domain is a manual step. The welcome email asks for it, and you point it at your server.
- **Inbound phone and SMS:** none, beyond what you set up in ElevenLabs.
- **Accounts:** one owner, one password.
- **Other places:** the Scout works anywhere Google Places does. The demo cities are in the US and Ontario.
