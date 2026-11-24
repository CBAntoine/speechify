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
    text: "Rainmaker is a CRM for an AI agency that sells to local businesses. It finds clients (map search plus website audits and an opportunity score), runs the pipeline with Claude agents that draft outreach for approval, makes tailored ad campaigns with custom art and audio, sells every ElevenLabs-powered service through a public store with Stripe and PayPal subscriptions and an AI sales assistant, and runs Autopilot every day to prospect, pitch, follow up and onboard paying clients. Screens: Today, Find clients, Pipeline, Inbox, Ad Studio, Agents, Autopilot, Sales, Store & pricing, Playbooks, Settings.",
  },
  {
    id: "today",
    title: "Today (home dashboard)",
    keywords: ["today", "home", "dashboard", "summary", "attention", "next"],
    text: "Today shows a greeting, a quick search (pick a niche, province or state and city, then Find clients), open pipeline value, monthly recurring revenue, hot leads (score 70+), what's waiting on you (drafts and tasks), a Selling card (store revenue, money collected this month, Autopilot's last run), a Do next list and recent activity. Buttons at the top: Run an agent and Find clients.",
  },
  {
    id: "find_clients",
    title: "Find clients (prospecting)",
    keywords: ["find", "clients", "prospects", "search", "leads", "niche", "city", "near", "businesses", "prospecting"],
    text: "Find clients searches a niche in a city: pick the Niche, Province or state and City (or the target icon for near me), set Radius, then Search. Results come from OpenStreetMap, city business-licence lists, Claude web research (with an Anthropic key) and Rainmaker's crawler, or Google Places with GOOGLE_PLACES_API_KEY. Each result has an opportunity score 0-100 and the gaps you can sell against (no website, no online booking, slow site, not running ads, few reviews...). Filter with the Show only chips, then add the best ones to the pipeline. The side panel shows what a customer is worth in that niche and offers that convert.",
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
    text: "Pipeline is a board (or list) with stages New, Contacted, Replied, Meeting, Proposal, Won and Lost. Drag cards between stages, or open a lead and change the Stage dropdown. A lead opens in a side panel with tabs Overview (quick actions, contact name, email, phone, website, deal value per month, next step, website check), Outreach (Claude-written email plus 3 follow-ups, text, DM, call script and video-audit script), Ads (sample campaigns for them) and Notes. Its Sell section suggests store products from the audit, gives checkout links that tie a purchase to the lead (so it moves to Won automatically), builds a demo AI receptionist from their website with a private link to send them, and has the AI website guide offer (see the ai_guide topic).",
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
    text: "Settings holds the agency profile the agents and emails use: Agency name, Your name (signs messages), Reply-to email, Home city, Website, Booking link, Postal address for email footers (required for auto-send), Core offer, Services, Pricing, Phone, Proof and results, Writing voice and Target niches. It also shows which services are connected, lets you remove the sample businesses, and has Start fresh: it deletes every lead with its drafts, tasks, ad campaigns and activity, and their demo receptionists and AI guides in ElevenLabs, after you type DELETE (paying clients, orders and settings stay).",
  },
  {
    id: "keys",
    title: "Which key turns on what",
    keywords: ["key", "keys", "api", "environment", "env", "connect", "anthropic", "claude", "elevenlabs", "resend", "google", "database", "password", "cron", "site url"],
    text: "ANTHROPIC_API_KEY: Claude for ads, outreach, research and real agents. ELEVENLABS_API_KEY: the store's sales assistant, this copilot's voice, demo and client receptionists, voiceovers and ad art. STRIPE_SECRET_KEY, PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET: payments. RESEND_API_KEY + RESEND_FROM: sending email from the Inbox and Autopilot. GOOGLE_PLACES_API_KEY: Google ratings and review counts. DATABASE_URL: Postgres (needed on Vercel). APP_PASSWORD: puts the CRM behind a sign-in (set it before going public). SITE_URL: your public address for links and webhooks. CRON_SECRET: lets Autopilot run daily. Keys are set in the hosting provider's environment variables, then redeploy.",
  },
  {
    id: "playbooks",
    title: "Playbooks",
    keywords: ["playbook", "playbooks", "learn", "how to get clients", "referrals", "cold email", "tips"],
    text: "Playbooks lists 14 client-finding plays: 13 from agency surveys and practitioner reports (referral engine, gap-first cold email, free sample ads and more) and the AI website guide free trial from your own playbook, niche cheat sheets and common GoHighLevel complaints next to what Rainmaker does instead. Research claims link to their source, and each play links to the screen that does it.",
  },
  {
    id: "install",
    title: "Install on a phone",
    keywords: ["phone", "android", "install", "app", "mobile", "pwa", "home screen"],
    text: "Open the hosted app in Chrome on Android, sign in, then tap Install in the top bar or Chrome's menu > Install app. On phones the screens are Today, Find, Pipeline, Inbox and More at the bottom; the copilot is the round button at the top right.",
  },
  {
    id: "compliance",
    title: "Rules Rainmaker follows",
    keywords: ["consent", "law", "legal", "compliance", "spam", "can-spam", "tcpa", "casl", "opt out", "voice clone", "disclosure"],
    text: "Commercial email must include your postal address and an opt-out line (CAN-SPAM); Autopilot's auto-send refuses emails without them. No automated calls or texts to people who haven't opted in (TCPA, CASL), so Autopilot only emails. Voice clones need the written consent of the person whose voice it is. AI receptionists and assistants say they're AI when asked; AI website guides introduce themselves as an AI. The store sells your agency's services, not ElevenLabs credits, and never uses ElevenLabs as your brand.",
  },
  {
    id: "ai_guide",
    title: "AI website guide offer",
    keywords: ["ai guide", "website guide", "guide", "chat widget", "voice widget", "website chat", "knowledge base", "trial", "demo page", "five questions", "retainer"],
    text: "A chat and voice guide on a business's website that answers visitors from their own site and passes the business every lead. It lives in a lead's Overview, section AI website guide, in six steps. 1 Is it worth it: enter Website visitors a month (from Semrush, Similarweb or their Google Analytics) and One lead is worth; it shows chats (5% of visitors), new leads (2.5%), their value and what to charge ($300 to $4,000+ a month, plus a setup fee for big sites). Need-to-have businesses (HVAC, plumbing, roofing, auto repair) convert best; want-to-have ones (med spas, salons) least. 2 Build AI guide reads their site (services, pricing, FAQs, booking, contact) and builds the guide in ElevenLabs plus a private demo page, a one-page copy of their site with the guide above the fold and \"Click here for a quick answer\" with a waving hand; buttons Open demo, Print with link and Share. If the site blocks automated reading, use Paste details instead. 3 Five questions to ask it in front of the owner: Test all asks each one and flags weak answers; Edit changes them; Copy prompt for ChatGPT. 4 Write the pitch drafts an email, a text and a cold call script in the Inbox. 5 Free trial on their website: enter their domain and length, Start trial, then send them the two lines of embed code. 6 Monthly upkeep: Load report shows conversations, captured leads and unanswered questions; add answers or Teach it something new. The guide always says it's an AI.",
  },
  {
    id: "copilot",
    title: "What the copilot can do",
    keywords: ["copilot", "assistant", "you", "voice", "talk", "help me", "can you"],
    text: "The copilot can open any screen, read what's on it, click buttons, fill in fields and point at things, and it can search for businesses, save leads, update leads, draft messages and cold call scripts, write ad campaigns, create tasks, research the web, start agent runs, and run the AI website guide offer (size it, build it, test it, pitch it, start the trial and report on it). It asks before anything that sends, deletes, cancels or spends money. Open it with the Copilot button or Ctrl+K (Cmd+K on a Mac); talk with the mic or type.",
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
