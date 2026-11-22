# Rainmaker

A simpler, AI-first alternative to GoHighLevel for agencies that sell to local businesses. It does five jobs:

1. **Find clients.** Search a niche in any city. Rainmaker pulls the businesses from the map, audits each website, and ranks them by how much they need you and whether they can pay.
2. **Run the pipeline with Claude agents.** Four agents (Prospector, Outreach Writer, Ad Strategist, Chief of Staff) take a goal in plain English, use the CRM's tools, and leave drafts for you to approve.
3. **Make tailored ads.** Ad Studio writes a full campaign for any business: strategy, three Meta ads with creative, a Google search ad with 15 headlines, short-video scripts and landing-page copy, all checked against each platform's limits. With ElevenLabs it also paints custom ad art in the business's brand colours and records audio ads.
4. **Sell every ElevenLabs product as your own service.** A public store (`/store`) sells 18 done-for-you services and 3 plans (AI receptionists, voice and chat agents, voiceovers, dubbing, podcasts, music, ad creative, transcription…) with monthly prices, setup fees and yearly billing. An ElevenLabs voice and chat assistant explains each product to visitors and opens checkout. Clients pay by card (Stripe) or PayPal, and subscriptions, renewals and cancellations flow back into the CRM.
5. **Run itself.** Autopilot runs every day: it finds businesses, builds each one a demo AI receptionist from their own website, writes the pitch and a follow-up sequence, makes sample ads with custom art, follows up, and onboards new paying clients.
6. **Do what you say.** The copilot (Ctrl+K, or Cmd+K on a Mac) is an ElevenLabs voice and chat agent that runs the app for you: tell it what to do and it opens screens, reads them, clicks, fills things in, finds clients, works your pipeline and writes ads. It knows every feature and what's happening in your account right now.

It's built around what agencies complain about in GoHighLevel and around how agencies actually land clients. The research, with sources, is in [docs/research.md](docs/research.md). How the store is priced, with costs, margins and ElevenLabs' terms, is in [docs/pricing.md](docs/pricing.md).

## Run it

```bash
cd rainmaker
npm install
cp .env.example .env.local     # optional: add keys (see below)
npm run dev                    # http://localhost:3100
```

With no keys, it runs in **demo mode**:
- Search, website audits, scoring, the pipeline, the inbox, playbooks and template-based ads and emails all work.
- Search uses free OpenStreetMap data, or fictional sample businesses if the map service can't be reached.
- Agents follow a fixed script that uses the real tools.
- The first run creates a small workspace of fictional sample businesses. Remove them in Settings.

Add a Claude API key to switch on Claude. Claude then writes the ads and outreach, researches the web, and runs the agents for real.

### Adding API keys

Paste them in **Settings → API keys** and press **Save**. A saved key:
- **stays until you press Remove**, through restarts and redeploys. It's stored in your database (Postgres table `rainmaker_secrets`, or `.data/secrets.json`), apart from the CRM data, so no page, export or agent ever sees it;
- is **encrypted** with AES-256-GCM, and only a masked preview (`sk-ant-••••Ab12`) is ever shown again;
- **is used instead of** the same key in your hosting settings. Remove it and the hosting one comes back;
- takes effect right away on that server, and on your other server instances within 30 seconds.

**Check** asks the service whether it accepts the key (and, for Stripe and PayPal, whether the webhook is connected). On a public deployment, saving needs `APP_PASSWORD` on, so nobody else with your link can change your keys. Keys you can save there: Claude, ElevenLabs, Stripe (secret key, webhook secret), PayPal (client ID, secret, mode, webhook ID), Resend (API key, send-from address) and Google Places. `DATABASE_URL`, `APP_PASSWORD`, `SITE_URL`, `CRON_SECRET` and `SECRETS_KEY` stay in your hosting settings.

Without `SECRETS_KEY`, the encryption key is created on the first save and kept next to the saved keys: that keeps them unreadable in a copied file or log, not from someone with full database access. Set `SECRETS_KEY` (any long random text) in your hosting settings to keep the encryption key out of the database; keys saved earlier are re-encrypted with it automatically. Keep it: if it changes, saved keys can't be unlocked and need pasting again.

Environment variables still work as before:

| Variable | What it turns on |
|---|---|
| `ANTHROPIC_API_KEY` | Claude: AI ad campaigns, AI outreach sequences, web research (including finding clients in any town), and agents that reason for themselves. Model: `claude-opus-5-5` (`CLAUDE_MODEL` to change). |
| `AGENT_RUNTIME` | `managed` (default) or `messages`. See "How the agents run". |
| `AGENT_RUN_BUDGET_USD` | Hard spending cap per agent run (default $3). |
| `GOOGLE_PLACES_API_KEY` | Google Places API (New): better coverage plus ratings and review counts, which unlock the review-gap signals. |
| `RESEND_API_KEY` + `RESEND_FROM` | Send approved emails from the Inbox, from your own verified domain. Without them, "Open in my email" fills in your own mail app. |
| `APP_PASSWORD` | Puts the whole app behind a sign-in page. **Set it before you deploy anywhere public.** |
| `DATABASE_URL` | Postgres for cloud hosting (required on Vercel). Without it, data goes to a local JSON file. |
| `ELEVENLABS_API_KEY` | The copilot, the store's AI sales assistant (voice and chat), demo receptionists for prospects, receptionists for paying clients, ad voiceovers and custom ad art. |
| `STRIPE_SECRET_KEY` | Card payments and subscriptions in the store. A `sk_test_` key puts the store in test mode. |
| `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` | PayPal subscriptions in the store (`PAYPAL_MODE=live` when you're ready; sandbox by default). |
| `SITE_URL` | Your public address, for checkout return links, webhooks and links in Autopilot's emails. Vercel's domain is used if empty. |
| `CRON_SECRET` | Lets Vercel Cron start Autopilot once a day. |
| `SECRETS_KEY` | Optional. Encrypts the keys saved in Settings → API keys with a key that isn't stored in the database. |

All of them, with defaults and optional overrides, are in [.env.example](.env.example).

## The screens

| Screen | What it does |
|---|---|
| **Today** | Greeting, a "find clients" search box, pipeline value, recurring revenue, hot leads, a "do next" list and agent activity. |
| **Find clients** | Pick a niche, a province or state, and a city: every Canadian province and territory and every US state, each with its main cities, plus "Other city or town" and "Somewhere else" for anywhere. Places are looked up inside their country, so London, ON never lands in England. Results come from Rainmaker's own finder (below). Each result shows an opportunity score (0–100) and the gaps you can sell against. Filter by "No website", "No online booking", "Not running ads", "Few reviews" and more, then add the best ones to the pipeline in one click. The side panel shows what one customer is worth in that niche, offers that convert, and sources. |
| **Pipeline** | Drag-and-drop board (or list view). Click a lead for its website audit, Claude-written outreach (email + 3 follow-ups, text, DM, call script, 45-second video-audit script), sample ads, notes and tasks. Its **Sell** section suggests what to pitch from the store (from the audit and niche), gives checkout links that tie a purchase to the lead, and builds a demo AI receptionist from their website with a private link to send them. |
| **Inbox** | Every message an agent writes lands here. Edit, then send (Resend), open in your mail or Messages app, or mark it sent. Tasks live here too. |
| **Ad Studio** | Brief → campaign, with live feed and search-ad previews, character counters, a creative card you can restyle and download as a PNG in 3 sizes, a Google Ads Editor CSV export, and "copy all". With ElevenLabs: custom AI art behind the creative card in the business's brand colours, and an **Audio** tab that records the audio-ad script as an MP3 in the voice you pick. |
| **Agents** | Pick an agent, give it a goal, and watch each step live. Send follow-ups in the same session. Stop a run at any time. Each run shows its cost and links to the session in the Claude Console. |
| **Autopilot** | Turn it on, pick cities and niches, choose what it does (demo receptionists, outreach, sample ads, art, follow-ups, onboarding, auto-send), and see every run's log. "Run now" runs it on the spot. |
| **Sales** | Orders from the store: monthly recurring revenue, money collected this month, lifetime revenue, cancellations and unfinished checkouts. Each order shows its payment status and onboarding steps. Run or retry onboarding, open Stripe's billing portal for the client, cancel a subscription, or record a sale made outside the store. |
| **Store & pricing** | Turn the store on, set every price and setup fee (with the margin at full usage beside each), hide products, pick the currency, yearly billing, headline and assistant name. Connect Stripe and PayPal webhooks with one button each, and sync the AI sales assistant. |
| **Playbooks** | 13 client-finding plays from agency surveys and practitioner reports, niche cheat sheets, and a table of common GoHighLevel complaints next to what Rainmaker does instead. Every claim links to its source. |
| **Settings** | Agency profile (agents read it every run), **API keys** (saved until you remove them), connection status, sample data. |

### How a prospect is scored

The audit fetches the business's site and checks:
- HTTPS and mobile viewport
- Response time
- Online booking (24 tools, e.g. Zocdoc, Vagaro, ServiceTitan, Calendly)
- Chat and text widgets
- Ad pixels (Meta, Google Ads, TikTok, …) and analytics
- Contact form and tap-to-call
- Schema markup
- Copyright year
- Social profiles
- The site platform, including GoHighLevel sites

Each gap becomes a signal with a severity and the service it sells, for example "No online booking → Online booking with reminders". The **score** adds up need (the gaps) and ability to pay (established reviews, an existing ad pixel, the niche's typical retainer). Hot is 70+, warm is 45+. The code is `src/lib/prospecting/score.ts`; tests are in `tests/`.

## How the agents run

The agents are defined in `src/lib/agents/roster.ts` (prompts) and `src/lib/agents/tools.ts` (12 tools).

**Shared rules:**
- Agents can't send anything. Messages become drafts in your Inbox.
- They must not invent facts.
- Text from websites and tool results is treated as data, never as instructions.

The tools:

| Tool | Does |
|---|---|
| `pipeline_summary` | Counts per stage, value, drafts waiting, overdue tasks |
| `find_businesses` | Map search plus website audits plus scoring |
| `audit_website` | Full audit, optionally saved on a lead |
| `save_leads` | Add businesses to the pipeline, skipping duplicates |
| `list_leads`, `get_lead`, `update_lead` | Read and update leads |
| `draft_message` | Save an email, text, DM or call script for approval |
| `create_ad_campaign` | Write and save a full campaign (calls Ad Studio's generator) |
| `create_task`, `list_tasks` | To-dos |
| `research_web` | Live web research through Claude's web search and fetch tools |

**Runtimes** (`AGENT_RUNTIME`):

- **`managed` (default): [Claude Managed Agents](https://platform.claude.com/docs).**
  - Anthropic hosts the agent loop. Your server answers the CRM tool calls (custom tools) while it streams the session.
  - On the first run, Rainmaker creates one environment (no network access; the agents only use Rainmaker's tools) and one agent per role. It stores their IDs in the database, and it updates the agent (a new version) when a prompt or tool changes. Settings has a button to do this ahead of time.
  - Every session gets a hard budget (`AGENT_RUN_BUDGET_USD`) and can be opened in the Claude Console.
  - Managed Agents is in **beta**. It bills session runtime on top of tokens, and it keeps session history until you delete it.
- **`messages`:** the same agents and tools, with the loop running on your server over the Messages API. Use it if Managed Agents isn't enabled for your key, or if you'd rather host the loop yourself.
- **Demo** (no key): a fixed script per agent that calls the real tools, so you can see the workflow.

**Single Claude calls** (ads, outreach, research):
- They go through the Messages API with structured outputs (Zod schemas) and adaptive thinking.
- Ad generation streams its progress to the browser.
- Every call sets **server-side refusal fallback** (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`): if the model declines a request on policy grounds, the API retries on a fallback model inside the same call. Remove `FALLBACK` in `src/lib/claude/client.ts` to turn it off.
- Platform limits are enforced after generation (Google headlines ≤30 characters, descriptions ≤90, Meta headlines ≤40), and the UI shows counters.

## Sell ElevenLabs services: the store

The store sells what ElevenLabs makes possible as **your agency's done-for-you services**: you build and run the AI, the client pays you monthly. It never resells ElevenLabs credits or uses ElevenLabs as your brand; [docs/pricing.md](docs/pricing.md) explains why, with the terms quoted.

**Public pages** (no sign-in, even with `APP_PASSWORD`; the CRM stays locked):
- `/store`: the sales page. Three plans with a monthly/yearly switch, all 18 products by category (AI agents, content, business tools, marketing), how it works, a comparison with do-it-yourself platforms, and an FAQ. Signed-out visitors to `/` land here.
- `/store/<product>`: one page per product: what it does, what's included each month, how it works, who it's for, an example, price, setup fee and FAQ.
- `/store/thanks`, `/store/terms` (terms and refunds), `/store/privacy`.
- `/demo/<token>`: a prospect's private demo receptionist (hidden from search engines).

**The look.** Black and white on a warm off-white page, hairline rules, pill buttons, light display type and grainy gradient orbs as the only colour, in the style of ElevenLabs' own site, under your agency's name and logo (it doesn't copy their logo, fonts or wording). The home page has an orb carousel of services by category; the plans follow a pricing-page layout with the featured plan on a gradient card. Colours and type are the tokens at the top of `src/app/globals.css` (the CRM uses them too, in light and dark mode); the store's layout is `src/app/store/store.css`.

**The AI sales assistant.** Visitors can talk to it ("Talk to Ava") or type ("Chat instead") on every store page. It's an ElevenLabs agent with six tools that run in the visitor's browser: it reads the live catalog and prices (so it never quotes an old price), puts a product on screen, opens checkout, saves the visitor as a lead in your pipeline (after asking permission), and opens your booking link (Settings → Booking link). The agent is private: the browser gets a one-conversation token from the server, and each network is rate-limited.
- Its prompt and tools are in `src/lib/elevenlabs/sales-spec.ts`. **Store & pricing → AI sales assistant → Sync prompt and tools** pushes them to ElevenLabs, or creates the agent if your key belongs to another workspace.
- The agent is already built in this agency's ElevenLabs workspace (`agent_2301m80gw6zvekktsm8d0sr9gwe3`: Claude Sonnet 5.5 as its LLM, the "Amber" voice, and it only accepts conversations started with a token from your server). Five tests (loads the catalog before quoting a price, fetches a product's details, opens checkout, refuses card numbers in chat, promises no results) passed 10 of 10 runs. They're attached to the agent, so you can rerun them in ElevenLabs.

**Checkout.** The buyer picks monthly or yearly, enters their business name, name, phone, email and website, then pays:
- **Card, through Stripe Checkout:** a subscription for the monthly or yearly price, with the setup fee added to the first invoice. Nothing to set up in Stripe's product catalog: each checkout carries its own price.
- **PayPal:** Rainmaker creates the PayPal product and billing plan the first time (setup fee included), then sends the buyer to PayPal to approve.
- **Webhooks** (signature-checked, each event handled once) mark the order paid, record renewals, flag failed payments and cancellations, move the lead to Won and start onboarding.

**After someone pays,** Rainmaker onboards them by itself (or from **Sales**):
1. Builds their AI agent from their website, or turns the demo receptionist they tried into their real one.
2. Writes their launch ad campaign, with custom art.
3. Adds their onboarding checklist to your Inbox: the steps that need a person, such as forwarding their phone line and assigning it to their agent in ElevenLabs, or collecting written consent for a voice clone.
4. Sends the welcome email.

**Connect payments:**
1. Paste your Stripe secret key, and/or your PayPal client ID and secret, in **Settings → API keys** and press **Save** (or set `STRIPE_SECRET_KEY`, `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` in your hosting settings). Start with test keys (Stripe `sk_test_…`, a PayPal sandbox app): the store shows a test-mode banner and no real money moves.
2. In **Store & pricing → Payments**, press **Connect webhook** for each. Rainmaker registers `https://YOUR-SITE/api/payments/stripe/webhook` and `https://YOUR-SITE/api/payments/paypal/webhook` and keeps the signing secret. This needs the app on a public https address.
3. Buy a plan with Stripe's test card `4242 4242 4242 4242` (any future date, any CVC) or a PayPal sandbox buyer. The order appears in **Sales**.
4. Replace them with live keys in **Settings → API keys** (and set PayPal's **Mode** to Live), then press **Connect webhook** again.

**Prices.** Launch $297/mo + $497 setup, Growth $597/mo + $997 setup, Scale $1,297/mo + $1,997 setup; products from $49 to $397 a month. Yearly billing is 10 months' price for 12, with the setup fee waived. At full included usage, the gross margin is 69–99% (Scale is the lowest). Change any price in **Store & pricing**; the full table, unit costs and sources are in [docs/pricing.md](docs/pricing.md).

## Autopilot

Once a day (Vercel Cron calls `/api/cron/autopilot` at 13:17 UTC with your `CRON_SECRET`; see `vercel.json`), or whenever you press **Run now**, Autopilot:
1. Searches the next niche and city in rotation, audits each website, and saves the businesses above your minimum score.
2. For the best few new leads: builds a demo AI receptionist from their website (a private link, up to 12 conversations a day), writes a personal email and a 3-step follow-up sequence pitching the product their audit points to, and builds a sample ad campaign with custom art in their brand colours.
3. Drafts follow-ups on days 3, 7 and 14 until they reply, and a nudge to anyone who started checkout but didn't finish.
4. Onboards new paying clients (above).
5. Emails you a summary.

Everything waits in your Inbox for approval unless you turn on auto-send. Auto-send is email only. It needs Resend and your postal address in Settings, only sends emails that include that address and an opt-out line and have no `[placeholders]` left, and stops at your daily cap. Autopilot never calls or texts anyone.

## The copilot

Open it from **Copilot** at the top of the sidebar, the orb in the phone's top bar, or Ctrl+K (Cmd+K on a Mac). Press the mic and talk, or type. It stays open while it moves you between screens, so one conversation can cover several jobs: "Find 20 dentists in Toronto that need a website, save the best five and draft an email to the top one."

**What it can do**
- **Drive the screen:** open any screen (a lead, a campaign, a search, an agent goal), read what's on it, click buttons, tabs and switches, type into fields, pick from dropdowns, and point at things when you ask where something is.
- **Work the CRM directly:** find businesses, audit websites, save leads, update stages and notes, draft messages for your approval, write ad campaigns, add tasks, research the web and start the Claude agents. These are the same tools, rules and validation the agents use: messages become drafts, nothing is sent on its own.
- **Know the software and your account:** a built-in guide covers every screen, button and workflow (`src/lib/copilot/guide.ts`), and a live snapshot covers your pipeline, inbox, tasks, Autopilot, store, prices, sales and which keys are connected.

**What it won't do without you:** it asks before anything that sends, deletes or discards, cancels a subscription, changes prices, charges money or turns on auto-send, and those clicks are refused unless it has your yes. It never reads, types or repeats passwords or API keys: ask it to add a key and it opens that key's field in Settings for you to paste into. It acts as you, through the app's own sign-in-protected endpoints, so it can't do anything you couldn't.

**How it works:** an ElevenLabs agent (Claude Sonnet 5.5 inside) with 19 tools that run in your browser. Screen tools act on the page; CRM tools call `/api/copilot/tool`; the snapshot comes from `/api/copilot/state`. The agent is private: your signed-in browser gets a one-conversation token from `/api/copilot/session`. The agent is already built in this agency's ElevenLabs workspace (`agent_6701m80nkwe4ekh9nkkcjbtj81ns`), and six tests (checks the live state, opens the pipeline, searches with the right niche and city, opens the prices screen, refuses API keys, asks before cancelling) passed 12 of 12 runs. They're attached to the agent, so you can rerun them in ElevenLabs.
- Its prompt and tools are in `src/lib/copilot/spec.ts`. **Settings → Connections → Copilot → Sync copilot** pushes them to ElevenLabs, or creates the copilot if your key belongs to another workspace.
- Without `ELEVENLABS_API_KEY` it still opens screens, answers how-to questions from the guide and points at things on the screen.

## Use it on your Android phone

Rainmaker installs on Android as an app: Chrome adds it to your home screen and app drawer, and it opens full screen like a normal app. Your phone needs to reach it over the internet, so you host it once (free tiers work). You can do every step below from your phone's browser.

**1. Put the code on your default branch.** Vercel deploys a repository's default branch (in this repo, `ccr-e923554b-5tyguk`). Merge the `ccr-1339edef-a0joj9` branch into it on GitHub with a pull request. The pull request page has a Merge button.

**2. Create a Vercel project for Rainmaker.**
- On vercel.com, choose **Add New → Project**, import the `speechify` repository, and set **Root Directory** to `rainmaker`.
- Add these environment variables:
  - `APP_PASSWORD`: pick a password. Required, because anyone could open the site without it.
  - `ANTHROPIC_API_KEY`: switches on Claude for ads, emails and agents. Optional.
  - `GOOGLE_PLACES_API_KEY`: adds ratings and review counts to search. Optional.
  - `ELEVENLABS_API_KEY`: the store's AI sales assistant, demo receptionists, voiceovers and ad art. Optional.
  - `STRIPE_SECRET_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`: take payments in the store. Optional; see "Connect payments" above.
  - `CRON_SECRET`: any long random string, so Autopilot runs every day. Optional.
- Tap **Deploy**.
- If opening the site shows a Vercel sign-in page instead of Rainmaker's, Vercel's own login wall is on. New projects put it in front of `.vercel.app` addresses too. In the project, open **Settings → Deployment Protection** and limit **Vercel Authentication** to preview deployments, or turn it off. `APP_PASSWORD` still locks the app.

Your GTA site is a separate Vercel project and isn't affected.

**3. Add a database.**
- In the new project, open **Storage → Create Database → Neon (Postgres)** and connect it to the project. This sets `DATABASE_URL`.
- Open **Deployments**, then **Redeploy**.

Without a database, Vercel forgets your data whenever its servers restart. The app shows a warning until you connect one.

**4. Install it.**
- Open your Vercel URL in **Chrome** on Android and sign in.
- Tap **Install** in the top bar, or Chrome's **⋮ menu → Install app**.
- Rainmaker now has its own icon and opens without the browser bar. Long-press the icon for shortcuts to Find clients, Pipeline, Inbox and Ad Studio.

### What's built for the phone

- **Tab bar** at the bottom (Today, Find, Pipeline, Inbox, More), with large tap targets and room for Android's gesture bar.
- **Find clients near me:** tap the target icon next to the city to search around where you're standing, and tap it again to go back to the city. Good for walk-in prospecting. The app remembers the last place you searched.
- **Rainmaker's own client finder, no Google needed.** It never scrapes Google Maps or directories (their terms forbid it, and they block it). Instead it combines:
  - **OpenStreetMap**, the free world map, searched through Nominatim. Good for dentists, salons, gyms, restaurants, vets, lawyers, realtors and accountants.
  - **City business-licence lists**, published as open data by Toronto, Vancouver, Calgary and Edmonton. They include the contractors OpenStreetMap lacks: Edmonton alone lists 122 licensed roofing businesses. Toronto's list also covers GTA contractors licensed to work in Toronto, so Oakville or Vaughan searches use it too.
  - **Claude web research**, with an `ANTHROPIC_API_KEY`. When the free sources find fewer than 20 businesses (a small town, say), Claude searches the web for the niche in that town. Roughly 10–30 cents a search.
  - **Rainmaker's crawler**, which visits each business's own website: it finds sites no listing had (by trying the domains the name suggests and checking the page), reads the phone, email and address from the homepage and contact page, and audits the gaps you sell against. It identifies itself and follows each site's robots.txt.
- Google Places stays available as an option (`GOOGLE_PLACES_API_KEY`) if you ever want Google's ratings and review counts.
- **Pipeline:** one stage at a time, with swipeable stage tabs and a **Move to** menu on each card. Drag-and-drop doesn't work with touch, so this replaces it.
- **Lead screen:** big **Call, Text, Email, Website, Directions and Share** buttons. They open your phone's dialer, Messages, Gmail and Google Maps.
- **Inbox:** tap a message to read it full screen, then send it from your own email or Messages app, or **Share** it to WhatsApp or any other app.
- **Ad Studio:** **Share image** sends the finished ad creative straight to Instagram, WhatsApp or Gmail.
- **Share to Rainmaker:** in Google Maps or Chrome, tap Share on a business and pick Rainmaker. You can turn it into a lead (with a website audit) or make sample ads for it.
- **Stays signed in** for 6 months. An **offline screen** appears when you lose signal, and the app refreshes when you switch back to it.

On Vercel's free plan, each agent run is limited to 5 minutes, which covers typical runs. Every step is saved as it happens. If a run outlives its server, it's marked stopped instead of hanging.

## Deploying elsewhere

- **With Postgres** (`DATABASE_URL`): any Node host works, serverless included. Data is shared by every server instance. All writes are compare-and-set, so simultaneous edits from your phone, your laptop and running agents don't overwrite each other.
- **Without a database:** data lives in one JSON file (`.data/db.json`, or `DATA_DIR`). Use this on your own computer or a single server with a persistent disk:

  ```bash
  npm run build && npm start      # port 3100
  ```

  To install it on your phone from your own computer, the phone needs an HTTPS address. A tunnel such as Cloudflare Tunnel provides one.

**Set `APP_PASSWORD`** on any public deployment. Without it, anyone with the URL can use your data and your API credits.

## Not built yet

Rainmaker is deliberately smaller than GoHighLevel. It does **not** have:
- A phone system or SMS sending. AI receptionists answer calls through ElevenLabs; you connect the phone numbers (yours or Twilio's) in ElevenLabs, from the onboarding checklist.
- Funnels or a website builder, calendars or booking pages, invoices or one-off payment links, or membership sites. Payments cover the store's subscriptions only.
- White-label or SaaS reselling of the software itself. The store sells your services, not Rainmaker logins.
- A client portal. Clients manage card billing in Stripe's billing portal (you open it from Sales) and PayPal billing in PayPal.
- A Play Store app (it installs from Chrome as an app; [PWABuilder](https://www.pwabuilder.com) can package it for the Play Store if you want one)
- Multi-user accounts (one shared password)

Reporting is basic. Data lives in a single JSON file. Pair Rainmaker with the tools you already use for those jobs.

## Develop

```bash
npm run typecheck
npm test          # 90 unit tests: website audit, scoring, ad limits/CSV, OpenStreetMap search (Nominatim and Overpass), city licence data, the crawler (robots.txt, contacts, website finding), Claude research parsing, provinces/states and place parsing, niches, seed data, playbook sources, concurrent storage writes, the store catalog and margins, yearly pricing and price overrides, Stripe form encoding and webhook signatures, sales stats, onboarding plans, Autopilot's targeting, follow-up timing and auto-send rules, the copilot's screen matching, guide and live snapshot, saved API keys (encryption, masking, save and remove), and which pages are public
npm run build
```

Project layout:

```
src/app/                 pages (Today, prospects, pipeline, inbox, ads, agents, autopilot, sales, sell, playbooks, settings) + api/ routes
src/app/store/           the public store: home, product pages, thanks, terms, privacy (store.css is its stylesheet)
src/app/demo/            a prospect's private demo receptionist
src/components/          UI (Sidebar, ProspectFinder, Board + LeadDrawer, Inbox, AdStudio + Creative, AgentConsole, …)
src/components/store/    store UI: the AI assistant (ElevenLabs React SDK), checkout, plan and product cards
src/components/copilot/  the copilot panel and its screen tools (read, click, fill, point)
src/lib/copilot/         the copilot's prompt and tools, guide, screen map and live snapshot
src/lib/catalog.ts       what the store sells: plans, products, prices, unit costs, margins, recommendations
src/lib/payments/        Stripe and PayPal (REST, no SDKs), orders, webhooks, onboarding after payment
src/lib/elevenlabs/      agents (sales assistant, receptionists, demos), text to speech, image art
src/lib/autopilot/       the daily run: plan.ts decides (pure, tested), run.ts does
src/lib/prospecting/     OpenStreetMap + Google Places search, website audit, scoring
src/lib/claude/          Claude client, ad campaigns, outreach, web research
src/lib/agents/          agent roster, CRM tools, runtimes (Managed Agents, Messages API, demo)
src/lib/niches.ts        18 niches: map tags, offers, angles, pain points, sourced values
src/lib/playbooks.ts     client-finding playbooks with sources
src/lib/store.ts         storage: Postgres (DATABASE_URL) or a JSON file; repo.ts holds the domain operations
src/app/manifest.ts      installable app (PWA): icons, shortcuts, share target; public/sw.js is the service worker
docs/research.md         the research, with sources and caveats
docs/pricing.md          store pricing: costs, margins, sources, ElevenLabs' terms, compliance
vercel.json              the daily Autopilot schedule
```
