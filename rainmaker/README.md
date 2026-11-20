# Rainmaker

A simpler, AI-first alternative to GoHighLevel for agencies that sell to local businesses. It does three jobs:

1. **Find clients.** Search a niche in any city. Rainmaker pulls the businesses from the map, audits each website, and ranks them by how much they need you and whether they can pay.
2. **Run the pipeline with Claude agents.** Four agents (Prospector, Outreach Writer, Ad Strategist, Chief of Staff) take a goal in plain English, use the CRM's tools, and leave drafts for you to approve.
3. **Make tailored ads.** Ad Studio writes a full campaign for any business: strategy, three Meta ads with creative, a Google search ad with 15 headlines, short-video scripts and landing-page copy, all checked against each platform's limits.

It's built around what agencies complain about in GoHighLevel and around how agencies actually land clients. The research, with sources, is in [docs/research.md](docs/research.md).

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

Add `ANTHROPIC_API_KEY` to switch on Claude. Claude then writes the ads and outreach, researches the web, and runs the agents for real.

| Variable | What it turns on |
|---|---|
| `ANTHROPIC_API_KEY` | Claude: AI ad campaigns, AI outreach sequences, web research, and agents that reason for themselves. Model: `claude-opus-5-5` (`CLAUDE_MODEL` to change). |
| `AGENT_RUNTIME` | `managed` (default) or `messages`. See "How the agents run". |
| `AGENT_RUN_BUDGET_USD` | Hard spending cap per agent run (default $3). |
| `GOOGLE_PLACES_API_KEY` | Google Places API (New): better coverage plus ratings and review counts, which unlock the review-gap signals. |
| `RESEND_API_KEY` + `RESEND_FROM` | Send approved emails from the Inbox, from your own verified domain. Without them, "Open in my email" fills in your own mail app. |
| `APP_PASSWORD` | Puts the whole app behind a sign-in page. **Set it before you deploy anywhere public.** |
| `DATABASE_URL` | Postgres for cloud hosting (required on Vercel). Without it, data goes to a local JSON file. |

## The screens

| Screen | What it does |
|---|---|
| **Today** | Greeting, a "find clients" search box, pipeline value, recurring revenue, hot leads, a "do next" list and agent activity. |
| **Find clients** | Niche + city search. Each result shows an opportunity score (0–100) and the gaps you can sell against. Filter by "No website", "No online booking", "Not running ads", "Few reviews" and more, then add the best ones to the pipeline in one click. The side panel shows what one customer is worth in that niche, offers that convert, and sources. |
| **Pipeline** | Drag-and-drop board (or list view). Click a lead for its website audit, Claude-written outreach (email + 3 follow-ups, text, DM, call script, 45-second video-audit script), sample ads, notes and tasks. |
| **Inbox** | Every message an agent writes lands here. Edit, then send (Resend), open in your mail or Messages app, or mark it sent. Tasks live here too. |
| **Ad Studio** | Brief → campaign, with live feed and search-ad previews, character counters, a creative card you can restyle and download as a PNG in 3 sizes, a Google Ads Editor CSV export, and "copy all". |
| **Agents** | Pick an agent, give it a goal, and watch each step live. Send follow-ups in the same session. Stop a run at any time. Each run shows its cost and links to the session in the Claude Console. |
| **Playbooks** | 13 client-finding plays from agency surveys and practitioner reports, niche cheat sheets, and a table of common GoHighLevel complaints next to what Rainmaker does instead. Every claim links to its source. |
| **Settings** | Agency profile (agents read it every run), connection status, sample data. |

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

## Use it on your Android phone

Rainmaker installs on Android as an app: Chrome adds it to your home screen and app drawer, and it opens full screen like a normal app. Your phone needs to reach it over the internet, so you host it once (free tiers work). You can do every step below from your phone's browser.

**1. Put the code on your default branch.** Vercel deploys a repository's default branch (in this repo, `ccr-e923554b-5tyguk`). Merge the `ccr-461324e6-fulfni` branch into it on GitHub. The pull request page has a Merge button.

**2. Create a Vercel project for Rainmaker.**
- On vercel.com, choose **Add New → Project**, import the `speechify` repository, and set **Root Directory** to `rainmaker`.
- Add these environment variables:
  - `APP_PASSWORD`: pick a password. Required, because anyone could open the site without it.
  - `ANTHROPIC_API_KEY`: switches on Claude for ads, emails and agents. Optional.
  - `GOOGLE_PLACES_API_KEY`: adds ratings and review counts to search. Optional.
- Tap **Deploy**.

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
- **Find clients near me:** tap the target icon in the city field to search around where you're standing. Good for walk-in prospecting.
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
- A phone system or SMS sending
- Funnels or a website builder, calendars or booking pages, payments, or membership sites
- White-label or SaaS reselling
- A Play Store app (it installs from Chrome as an app; [PWABuilder](https://www.pwabuilder.com) can package it for the Play Store if you want one)
- Multi-user accounts (one shared password)

Reporting is basic. Data lives in a single JSON file. Pair Rainmaker with the tools you already use for those jobs.

## Develop

```bash
npm run typecheck
npm test          # 29 unit tests: website audit, scoring, ad limits/CSV, OpenStreetMap parsing, niches, seed data, playbook sources, concurrent storage writes
npm run build
```

Project layout:

```
src/app/                 pages (Today, prospects, pipeline, inbox, ads, agents, playbooks, settings) + api/ routes
src/components/          UI (Sidebar, ProspectFinder, Board + LeadDrawer, Inbox, AdStudio + Creative, AgentConsole, …)
src/lib/prospecting/     OpenStreetMap + Google Places search, website audit, scoring
src/lib/claude/          Claude client, ad campaigns, outreach, web research
src/lib/agents/          agent roster, CRM tools, runtimes (Managed Agents, Messages API, demo)
src/lib/niches.ts        18 niches: map tags, offers, angles, pain points, sourced values
src/lib/playbooks.ts     client-finding playbooks with sources
src/lib/store.ts         storage: Postgres (DATABASE_URL) or a JSON file; repo.ts holds the domain operations
src/app/manifest.ts      installable app (PWA): icons, shortcuts, share target; public/sw.js is the service worker
docs/research.md         the research, with sources and caveats
```
