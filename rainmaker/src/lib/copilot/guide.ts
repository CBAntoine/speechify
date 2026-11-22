// What the copilot knows about Rainmaker: one entry per screen or workflow,
// with the real button and field names. The copilot's how_to tool reads it,
// and the copilot answers from it locally when the AI isn't connected.
// Shared by the server (the agent prompt lists the topics) and the browser.

export interface GuideTopic {
  id: string;
  title: string;
  /** Words people use when they ask about it. */
  keywords: string[];
  text: string;
}

export const GUIDE: GuideTopic[] = [
  {
    id: "overview",
    title: "What Rainmaker does",
    keywords: ["overview", "what", "can", "do", "features", "help", "start", "everything"],
    text: "Rainmaker is a CRM for an agency that sells done-for-you services to local businesses anywhere in North America. It finds clients (map search, website audits, an opportunity score), runs the pipeline with Claude agents, sends outcome proposals priced under what staff would cost, and delivers seven services per client in order from the Clients screen: website, past-customer win-back, reviews and referrals, instant lead follow-up, every call answered, sales coaching, then paid ads. It also makes ad campaigns, sells ElevenLabs-powered services through a public store with Stripe and PayPal, and runs Autopilot daily. Screens: Today, Find clients, Pipeline, Inbox, Clients, Ad Studio, Agents, Autopilot, Sales, Store & pricing, Playbooks, Settings.",
  },
  {
    id: "today",
    title: "Today (home dashboard)",
    keywords: ["today", "home", "dashboard", "summary", "attention", "next"],
    text: "Today shows a greeting, a quick search (pick a niche, province, state or country and city, then Find clients), open pipeline value, monthly recurring revenue, hot leads (score 70+), what's waiting on you (drafts and tasks), a Delivering card (clients, their retainers, services live, client messages that need you), a Selling card (store revenue, money collected this month, Autopilot's last run), a Do next list and recent activity. Buttons at the top: Run an agent and Find clients.",
  },
  {
    id: "find_clients",
    title: "Find clients (prospecting)",
    keywords: ["find", "clients", "prospects", "search", "leads", "niche", "city", "near", "businesses", "prospecting"],
    text: "Find clients searches a niche in a city anywhere in North America: pick the Niche, the Province, state or country (Canada, the US with Puerto Rico and the US Virgin Islands, Mexico's 32 states, Central America and the Caribbean) and the City (or the target icon for near me), set Radius, then Search. Results come from OpenStreetMap, city business-licence lists, Claude web research (with an Anthropic key) and Rainmaker's crawler, or Google Places with GOOGLE_PLACES_API_KEY. Each result has an opportunity score 0-100 and the gaps you can sell against (no website, no online booking, slow site, not running ads, few reviews...). Filter with the Show only chips, then add the best ones to the pipeline. The side panel shows what a customer is worth in that niche and offers that convert.",
  },
  {
    id: "scoring",
    title: "How prospects are scored",
    keywords: ["score", "scoring", "hot", "warm", "opportunity", "audit", "gaps", "signals"],
    text: "The website audit checks HTTPS and mobile, speed, online booking (24 tools), chat and text widgets, ad pixels and analytics, contact form and tap-to-call, schema markup, copyright year, social profiles and the site platform. Each gap becomes a signal with a severity and the service it sells. The score adds need (gaps) and ability to pay (reviews, an existing ad pixel, the niche's typical retainer). Hot is 70+, warm is 45+.",
  },
  {
    id: "pipeline",
    title: "Pipeline and leads",
    keywords: ["pipeline", "lead", "leads", "stage", "board", "move", "deal", "kanban", "won", "lost", "contacted"],
    text: "Pipeline is a board (or list) with stages New, Contacted, Replied, Meeting, Proposal, Won and Lost. Drag cards between stages, or open a lead and change the Stage dropdown. A lead opens in a side panel with tabs Overview (quick actions, contact name, email, phone, website, deal value per month, next step, website check), Outreach (Claude-written email plus 3 follow-ups, text, DM, call script and video-audit script), Ads (sample campaigns for them) and Notes. Its Sell section suggests store products from the audit, gives checkout links that tie a purchase to the lead (so it moves to Won automatically), and builds a demo AI receptionist from their website with a private link to send them.",
  },
  {
    id: "inbox",
    title: "Inbox (approvals and tasks)",
    keywords: ["inbox", "drafts", "approve", "send", "email", "message", "tasks", "todo", "follow up"],
    text: "Every message an agent or Autopilot writes lands in the Inbox as a draft: tabs Waiting, Sent and Discarded. Open one, edit To, Subject and Message, then Send (through Resend when RESEND_API_KEY and RESEND_FROM are set), Open in my email (your own mail app), Copy, Mark as sent, or Discard. Nothing is sent without your approval unless Autopilot auto-send is on. Tasks (to-dos with due dates) are in the Inbox too.",
  },
  {
    id: "ad_studio",
    title: "Ad Studio (campaigns, art, audio)",
    keywords: ["ads", "ad", "studio", "campaign", "creative", "meta", "google", "facebook", "instagram", "art", "image", "voiceover", "audio"],
    text: "Ad Studio turns a brief (business, niche, city, website, goal, offer, notes) into a campaign: strategy, three Meta ads with a creative card, a Google search ad with 15 headlines and 4 descriptions (checked against character limits), short-video scripts and landing-page copy. Restyle the creative card and download it as a PNG in three sizes, export a Google Ads Editor CSV, or copy all. With ElevenLabs: Custom AI art paints the card background in the business's brand colours (Image & Video API, Pro plan or above), and the Audio tab records the audio-ad script as an MP3 in the voice you pick.",
  },
  {
    id: "agents",
    title: "Agents (Claude team)",
    keywords: ["agent", "agents", "prospector", "outreach writer", "ad strategist", "chief of staff", "goal", "run", "team"],
    text: "Four Claude agents take a goal in plain English and use the CRM's tools: Prospector (finds and saves businesses), Outreach Writer (drafts messages for approval), Ad Strategist (campaigns) and Chief of Staff (reviews the pipeline and plans). Pick one, type the goal, and watch each step live; send follow-ups in the same session or stop it. Each run has a spending cap (AGENT_RUN_BUDGET_USD, default $3). Agents never send anything: their messages wait in the Inbox. Without ANTHROPIC_API_KEY they follow a fixed demo script.",
  },
  {
    id: "autopilot",
    title: "Autopilot (runs every day)",
    keywords: ["autopilot", "automatic", "daily", "cron", "auto send", "run now", "cities", "niches", "schedule"],
    text: "Autopilot runs once a day (Vercel Cron with CRON_SECRET) or when you press Run now. It searches the next niche and city in rotation (Cities to prospect, one per line; Niches chips), audits websites, saves businesses above the Minimum score, and for the best few (Personal work per run): builds a demo AI receptionist from their website, writes a personal email and a 3-step follow-up sequence, and builds a sample ad campaign with custom art. It drafts follow-ups on days 3, 7 and 14, nudges unfinished checkouts, onboards new paying clients and can email you a summary. Switches: Autopilot is on, Build a demo AI receptionist, Write the first email and a 3-step follow-up sequence, Build a sample ad campaign, Add custom ad art, Draft follow-ups when they're due, Onboard new paying clients, Send emails without waiting for my approval (email only, needs Resend and your postal address, daily cap), Email me a summary. It never calls or texts anyone. The Run log shows every run.",
  },
  {
    id: "store",
    title: "Store & pricing (your public sales page)",
    keywords: ["store", "pricing", "price", "prices", "sales page", "products", "plans", "headline", "currency", "yearly", "sell", "storefront"],
    text: "Store & pricing controls the public store at /store: Store is open, Headline (wrap words in *asterisks* to grey them), Subheadline, AI assistant's name, Currency, Offer yearly billing (10 months' price for 12), Waive setup fees on yearly, Say products are built on ElevenLabs, and Extra call minutes price. Prices and margins lists every plan and product with its monthly price, setup fee, hide switch and the margin at full included usage. Press Save store and prices. Plans: Launch $297/mo + $497 setup, Growth $597 + $997, Scale $1,297 + $1,997; 18 single services from $49 to $397 a month. The AI sales assistant card shows whether the store's voice and chat assistant is live and has Sync prompt and tools.",
  },
  {
    id: "payments",
    title: "Taking payments (Stripe and PayPal)",
    keywords: ["stripe", "paypal", "payments", "checkout", "webhook", "card", "pay", "billing", "connect", "test mode", "live"],
    text: "Add STRIPE_SECRET_KEY and/or PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to the hosting's environment variables and redeploy, then in Store & pricing > Payments press Connect webhook for each (the app must be on a public https address). Test keys (sk_test_, PayPal sandbox) show a test-mode banner on the store; Stripe's test card is 4242 4242 4242 4242. Stripe Checkout charges the monthly or yearly price plus the setup fee on the first invoice; PayPal subscriptions include the setup fee. Webhooks mark orders paid, record renewals, flag failed payments and cancellations, move the lead to Won and start onboarding. Switch to live keys and PAYPAL_MODE=live when ready.",
  },
  {
    id: "sales",
    title: "Sales (orders and revenue)",
    keywords: ["sales", "orders", "revenue", "mrr", "recurring", "churn", "clients", "onboarding", "billing portal", "cancel", "record a sale"],
    text: "Sales shows monthly recurring revenue, money collected this month, lifetime revenue, cancellations and unfinished checkouts, then every order with its payment status and onboarding steps. Per order: Lead, Run onboarding or Retry onboarding, Billing portal (Stripe customers), and Cancel. Record a sale adds an order made outside the store. Onboarding builds the client's AI agent from their website (or promotes their demo), writes their launch campaign with art, adds an onboarding checklist to the Inbox and sends the welcome email.",
  },
  {
    id: "settings",
    title: "Settings (agency profile and connections)",
    keywords: ["settings", "profile", "agency", "name", "address", "booking link", "keys", "connections", "sample data", "voice"],
    text: "Settings holds the agency profile the agents and emails use: Agency name, Your name (signs messages), Reply-to email, Home city, Website, Booking link, Postal address for email footers (required for auto-send), Core offer, Services, Pricing, Phone, Proof and results, Writing voice and Target niches. It also shows which services are connected and lets you remove the sample businesses.",
  },
  {
    id: "keys",
    title: "Which key turns on what",
    keywords: ["key", "keys", "api", "environment", "env", "connect", "anthropic", "claude", "elevenlabs", "resend", "google", "database", "password", "cron", "site url"],
    text: "ANTHROPIC_API_KEY: Claude for ads, outreach, research, real agents, client websites and replies to clients' customers. ELEVENLABS_API_KEY: the store's sales assistant, this copilot's voice, demo and client receptionists, call transcription, practice calls, voiceovers and ad art. TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN: texts, WhatsApp and calls for clients. STRIPE_SECRET_KEY, PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET: payments. RESEND_API_KEY + RESEND_FROM: sending email. GOOGLE_PLACES_API_KEY: Google ratings. DATABASE_URL: Postgres (needed on Vercel). APP_PASSWORD: sign-in. SITE_URL: public address for links and webhooks. CRON_SECRET: daily Autopilot and client runs. Set them in the hosting provider's environment variables, then redeploy.",
  },
  {
    id: "playbooks",
    title: "Playbooks",
    keywords: ["playbook", "playbooks", "learn", "how to get clients", "referrals", "cold email", "tips"],
    text: "Playbooks lists 14 plays from agency surveys and practitioner reports (selling the outcome priced under a person, referral engine, gap-first cold email, free sample ads and more), niche cheat sheets and common GoHighLevel complaints next to what Rainmaker does instead. Every claim links to its source, and each play links to the screen that does it.",
  },
  {
    id: "install",
    title: "Install on a phone",
    keywords: ["phone", "android", "install", "app", "mobile", "pwa", "home screen"],
    text: "Open the hosted app in Chrome on Android, sign in, then tap Install in the top bar or Chrome's menu > Install app. On phones the screens are Today, Find, Pipeline, Inbox and More at the bottom; the copilot button sits above them.",
  },
  {
    id: "compliance",
    title: "Rules Rainmaker follows",
    keywords: ["consent", "law", "legal", "compliance", "spam", "can-spam", "tcpa", "casl", "opt out", "voice clone", "disclosure", "a2p", "10dlc", "quiet hours"],
    text: "Commercial email includes the business's address and an unsubscribe link (CAN-SPAM, CASL). Marketing texts only go to contacts who agreed to texts (in the US, prior express written consent); replies to someone who texted, called or filled in a form are fine. Opt-outs are honoured in English, Spanish and French (STOP, ALTO, BAJA, ARRET, plain requests). Automated messages only go out in each client's sending hours and days (US default 10:00-18:00, no Sundays; French territories weekdays only), with a daily cap. US texting numbers need A2P 10DLC registration in Twilio. Review requests go to every customer, never only happy ones, and never with a reward (FTC and Google rules). Voice agents say they're virtual assistants when asked. Details per country are in Clients > Settings and docs/compliance.md. Not legal advice.",
  },
  {
    id: "copilot",
    title: "What the copilot can do",
    keywords: ["copilot", "assistant", "you", "voice", "talk", "help me", "can you"],
    text: "The copilot can open any screen, read what's on it, click buttons, fill in fields and point at things, and it can search for businesses, save leads, update leads, draft messages, write ad campaigns, create tasks, research the web and start agent runs. It asks before anything that sends, deletes, cancels or spends money. Open it with the Copilot button or Ctrl+K (Cmd+K on a Mac); talk with the mic or type.",
  },
  {
    id: "clients",
    title: "Clients: seven services, deployed in order",
    keywords: ["clients", "client", "workspace", "seven", "7", "services", "deliver", "roadmap", "order", "setup", "live", "approval", "approve"],
    text: "Clients holds every business you deliver to. Add one with Add client (from a pipeline lead or a new business) or it's created when a proposal is paid. Each workspace shows the seven steps in order across the top: 1 Website, 2 Win-back, 3 Reviews, 4 Lead follow-up, 5 Calls, 6 Coaching, 7 Ads, plus Overview, Messages, Customers and Settings tabs. Each step has a status: Not started, Setting up (everything it would send is saved as a draft to check), Live (it runs) or Paused. Settings > Send without waiting for my approval decides whether live steps send on their own. Overview shows this month's results, what the same work would cost with staff, the next step and a setup checklist. Run now sends everything that's due.",
  },
  {
    id: "website",
    title: "Step 1: the client's website",
    keywords: ["website", "site", "landing", "page", "build", "publish", "html", "domain"],
    text: "In a client's Website tab, give a short brief (services, a real offer, notes) and press Build the website: Claude writes a one-page site in the client's language from the brief and their current site (the template is used without Claude). Edit the headline, services, FAQ, real customer reviews, hours and colours, then Publish. It's hosted at /s/<name>, loads fast on phones, has tap-to-call and a short form, and every form goes straight to step 4. Download HTML gives one file to host anywhere; its form still sends leads here.",
  },
  {
    id: "winback",
    title: "Step 2: win back past customers",
    keywords: ["win back", "winback", "reactivation", "past customers", "database", "import", "csv", "list", "old leads"],
    text: "In the Win-back tab, upload or paste the client's customer list (CSV with name, mobile, email, last visit; English, Spanish or French headers), press Check the list, say what they agreed to (email for past customers; texts only with permission), then Import. Edit the win-back messages or press Rewrite (Claude), add a real offer if there is one, pick how long since their last visit, and press Start the win-back. It sends up to the client's daily cap in their sending hours; any reply stops the sequence and goes to the AI or you, steered to a booking.",
  },
  {
    id: "reviews",
    title: "Step 3: reviews and referrals",
    keywords: ["reviews", "review", "google review", "referral", "referrals", "stars", "reputation", "job done"],
    text: "In the Reviews tab, paste the client's Google review link (Google Business Profile > Ask for reviews), set the delay after a job and an optional referral reward, then mark finished jobs: add a customer, pick customers on file, use Job done in Messages, or have their software POST to the intake address with event job_done. Every customer gets the same request and one reminder (never only happy ones, never a reward for a review). Opening the review page starts the referral ask; the customer's referral link credits any lead it brings.",
  },
  {
    id: "speed_to_lead",
    title: "Step 4: instant lead follow-up",
    keywords: ["lead", "leads", "follow up", "speed to lead", "instant", "form", "webhook", "zapier", "intake", "google ads lead form", "nurture"],
    text: "In the Lead follow-up tab, every new lead from the client's website, the intake address (Zapier, Make, Meta lead ads, Google Ads lead forms with the key) or added by hand gets an answer in seconds: Claude writes it from what they asked, in their language; then follow-ups on day 1, 3 and 7 until they reply. Replies are answered too, and leads who want to book or ask for a person are handed to the client by text or email. Send a test lead to see it work. The tab shows leads this month, median first reply and how many were answered within 5 minutes.",
  },
  {
    id: "missed_calls",
    title: "Step 5: every call answered",
    keywords: ["calls", "call", "missed calls", "phone", "twilio", "number", "forward", "forwarding", "receptionist", "text back", "voice agent"],
    text: "In the Calls tab, enter the client's Twilio number and press Connect the number to Rainmaker (it points the number's texts and calls here). Choose how calls arrive: the business forwards unanswered calls to it (carrier codes like **61*number# are in the tab), or it's their main number and rings staff first. Build their agent: an ElevenLabs voice receptionist trained on their website, set up for phone audio. Calls nobody takes go to the agent; if it can't take them, the caller hears an apology and gets the text-back message. Simulate a missed call tries it without a phone. The call log shows every call.",
  },
  {
    id: "coaching",
    title: "Step 6: sales coaching",
    keywords: ["coaching", "coach", "sales training", "practice", "role play", "roleplay", "call review", "scorecard", "transcript", "recording"],
    text: "In the Coaching tab, paste a call or chat transcript (or upload a recording, transcribed with who said what) and press Score it: it rates opening, discovery, listening, objections, asking for the booking and next step, with what to say instead (Claude) or the built-in rules. Practise with a tough customer starts a voice or chat role-play with an AI customer (price shopper, not sure yet, urgent, burned before, past customer) in the client's language and scores it when it ends. History shows every review and each person's average.",
  },
  {
    id: "client_ads",
    title: "Step 7: paid ads for a client",
    keywords: ["client ads", "paid ads", "ads for client", "cost per booking", "ad spend", "roas", "advice", "scale"],
    text: "The Ads tab comes last on purpose: it shows whether the website, lead follow-up and calls are live first, because ads only pay when every lead is answered and every call is picked up. Write a campaign makes Meta and Google ads in Ad Studio landing on their site; ad leads come in through the intake address or the site form and get step 4. Record each month's spend, leads, bookings and revenue to see cost per lead, cost per booking and return, then Get advice for what to change next month.",
  },
  {
    id: "proposals",
    title: "Outcome proposals and pricing",
    keywords: ["proposal", "proposals", "pitch", "price", "pricing", "quote", "labor", "labour", "human cost", "outcome", "sell"],
    text: "Open a lead in Pipeline and use Sell the outcome: pick the services, press Make a proposal, and send the private link. The proposal is in the prospect's language and currency: what's costing them customers (from the audit), the services in the order they go live, what people doing the same work would cost where they are (wage data for every North American country), and the price, which stays at or below that. It never leads with the technology. They can pay by card or PayPal; paying opens their client workspace and drafts their website. They signed: make them a client does the same without payment.",
  },
  {
    id: "reports",
    title: "Results reports for clients",
    keywords: ["report", "reports", "results", "monthly report", "roi", "show results"],
    text: "Each client has a private results report (header button Results report, or Settings > Links): leads who reached out and how fast they were answered, calls caught, past customers back, review requests and referrals, bookings and what they're worth, hours of work done, website visits, coaching and ads, each next to last month, in the client's language. Send it every month; it's how you prove the outcomes you sell.",
  },
  {
    id: "north_america",
    title: "Selling across North America",
    keywords: ["north america", "countries", "country", "mexico", "caribbean", "central america", "canada", "spanish", "french", "currency", "language", "markets"],
    text: "Rainmaker targets Canada, the US (with Puerto Rico and the US Virgin Islands), Mexico's 32 states, all of Central America and the Caribbean, Bermuda, Greenland and Saint Pierre and Miquelon. A client's place sets their language (Spanish, French, English and more), currency, time zone, phone format, sending hours and consent rules. Websites, messages, proposals and reports are written in their customers' language. Prices scale to local wages; where delivery costs more than a local worker, the quote says so. WhatsApp is the main channel in Mexico, Central America and the Caribbean.",
  },
];

export function guideTopicIds(): string[] {
  return GUIDE.map((t) => t.id);
}

/** Best guide entries for a question or topic id. */
export function searchGuide(query: string, max = 2): GuideTopic[] {
  const q = query.toLowerCase().trim();
  const exact = GUIDE.find((t) => t.id === q.replace(/\s+/g, "_"));
  if (exact) return [exact];
  const words = q.split(/[^a-z0-9+]+/).filter((w) => w.length > 2);
  const scored = GUIDE.map((t) => {
    let s = 0;
    for (const k of t.keywords) if (q.includes(k)) s += k.includes(" ") ? 3 : 2;
    for (const w of words) if (t.title.toLowerCase().includes(w)) s += 1;
    return { t, s };
  })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  return scored.slice(0, max).map((x) => x.t);
}
