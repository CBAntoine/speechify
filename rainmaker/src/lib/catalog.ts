// What the agency sells: done-for-you services built on ElevenLabs.
//
// Every ElevenLabs product family is here (ElevenAgents, ElevenCreative and
// ElevenAPI), packaged as a monthly service the agency runs for the client.
// The client buys an outcome from the agency, not ElevenLabs credits or an
// ElevenLabs account: ElevenLabs' terms don't allow reselling credits, and
// its name and logos aren't the agency's to brand with. See docs/pricing.md.
//
// Prices are the agency's defaults; the owner can change any of them in
// Store & pricing. Costs are estimates of what ElevenLabs (plus telephony and
// Claude) charge at full included usage, from the public price lists checked
// on 2026-11-22. They drive the margin calculator, never the public store.
//
// Pure data and math, no imports with side effects: the store, the CRM and the
// unit tests all load it.

import type { BillingInterval, PriceOverride, StoreSettings } from "./types.ts";

export type CategoryId = "agents" | "content" | "business" | "marketing";

export interface Category {
  id: CategoryId;
  label: string;
  blurb: string;
  /** The ElevenLabs product family behind it (shown only if the owner opts in). */
  engine: string;
}

export const CATEGORIES: Category[] = [
  {
    id: "agents",
    label: "AI voice agents",
    blurb: "Agents that answer, call back and chat with your customers in a natural voice, day and night.",
    engine: "ElevenAgents",
  },
  {
    id: "content",
    label: "Voice, video & creative",
    blurb: "Studio-quality voiceovers, your own brand voice, dubbing, podcasts, music and ad art, made for you every month.",
    engine: "ElevenCreative",
  },
  {
    id: "business",
    label: "Business audio tools",
    blurb: "Transcripts, captions and clean audio, handled for you.",
    engine: "ElevenAPI",
  },
  {
    id: "marketing",
    label: "Ads & growth",
    blurb: "Ad campaigns written for your business, with custom art in your brand colours.",
    engine: "ElevenLabs Image & Video",
  },
];

/** What one unit costs the agency, in US dollars. Sources in docs/pricing.md. */
export const UNIT_COSTS = {
  /** ElevenAgents call minute ($0.08) + LLM (~$0.01) + telephony (~$0.01). */
  agentMinute: 0.1,
  /** Outbound minutes carry a higher carrier rate. */
  outboundMinute: 0.11,
  /** ElevenAgents text message ($0.003) + LLM tokens. */
  chatMessage: 0.004,
  /** A local phone number from Twilio, per month. */
  phoneNumber: 1.15,
  /** Eleven v4 text to speech: $0.08 per 1,000 characters, about a minute of audio. */
  ttsMinute: 0.08,
  /** A finished 60-second voiceover including retakes. */
  voiceover: 0.25,
  /** Scribe v3 transcription ($0.20/hour) plus keyterms. */
  sttHour: 0.25,
  /** Automatic dubbing without watermark. */
  dubMinute: 0.5,
  /** Eleven Music. */
  musicMinute: 0.15,
  /** One sound-effect generation. */
  sfx: 0.04,
  /** Voice Isolator / Voice Changer. */
  audioMinute: 0.12,
  /** Live translation minute (estimate; check your workspace's rate). */
  translateMinute: 0.2,
  /** One ad image (GPT Image 2 / Gemini image models; estimate, billed in credits). */
  image: 0.75,
  /** One short video ad clip (Veo 3.1 Fast; estimate, billed in credits). */
  video: 3,
  /** One talking-presenter video (estimate). */
  avatarVideo: 5,
  /** One full ad campaign written by Claude Opus 5.5. */
  campaign: 1.5,
  /** Scripts, summaries and reports written by Claude. */
  writing: 0.5,
} as const;

export interface CostLine {
  label: string;
  units: number;
  unitCost: number;
}

export interface Faq {
  q: string;
  a: string;
}

export interface Offer {
  /** Stable id: used by orders, price overrides and the sales agent's tools. */
  id: string;
  slug: string;
  kind: "plan" | "product";
  category: CategoryId | "plans";
  name: string;
  tagline: string;
  summary: string;
  icon: string;
  /** Default monthly price in dollars. */
  monthly: number;
  /** Default one-time setup fee in dollars. */
  setup: number;
  /** What the monthly price includes, with quantities. */
  included: string[];
  /** What it does for the business. */
  features: string[];
  howItWorks: string[];
  idealFor: string[];
  /** What the agency hands over during setup. */
  deliverables: string[];
  /** ElevenLabs products used (shown only when the owner opts in). */
  engine: string[];
  timeToLive: string;
  example: string;
  /** Rules the buyer should know (consent, what it isn't for). */
  fineprint?: string;
  faqs: Faq[];
  costs: CostLine[];
  /** For plans: the product ids it bundles. */
  bundles?: string[];
  highlight?: boolean;
  /** Audit findings that make this a natural pitch (signal ids from score.ts). */
  signals?: string[];
  /** Niches where this sells especially well. */
  niches?: string[];
}

const C = UNIT_COSTS;

export const PLANS: Offer[] = [
  {
    id: "plan-launch",
    slug: "launch",
    kind: "plan",
    category: "plans",
    name: "Launch",
    tagline: "Never miss a customer again.",
    summary:
      "An AI receptionist that answers every call 24/7, plus a voice and chat assistant on your website. Every conversation is summarized and sent to you, so no lead slips through.",
    icon: "PhoneCall",
    monthly: 297,
    setup: 497,
    included: [
      "AI phone receptionist, 400 call minutes a month",
      "Website voice & chat assistant, 2,000 messages a month",
      "Answers in English and Spanish",
      "Call summaries and new leads emailed to you after every call",
      "Books appointments, answers FAQs, takes messages, transfers to staff",
      "Monthly report: calls answered, leads captured, top questions",
    ],
    features: [
      "Picks up on the first ring, nights, weekends and holidays",
      "Trained on your website, services, hours and prices",
      "Hands the caller to a person when they ask for one",
    ],
    howItWorks: [
      "Kickoff call (20 minutes): your hours, services, prices and where calls should go.",
      "We build and test your receptionist on your website's information and a voice you choose.",
      "We forward your line (or give you a new number) and add the assistant to your website.",
      "You get a summary of every conversation; we tune the answers every month.",
    ],
    idealFor: ["Dental and medical offices", "Home services", "Salons and spas", "Law firms", "Any business that misses calls"],
    deliverables: ["Configured AI receptionist", "Website widget code", "Call forwarding or a new local number", "Test-call recording"],
    engine: ["ElevenAgents", "Eleven v4 Turbo voices", "Scribe v3 Live"],
    timeToLive: "Live in 3–5 business days",
    example:
      "A dental office misses 30% of calls during lunch and after 5pm. Launch answers each one, books cleanings into open slots and emails the front desk a summary.",
    faqs: [
      { q: "Will callers know it's AI?", a: "Yes. It introduces itself as a virtual assistant and passes callers to a person whenever they ask." },
      { q: "What if I go over 400 minutes?", a: "Extra minutes are billed at the overage rate shown on this page. We tell you before it happens." },
      { q: "Can I keep my phone number?", a: "Yes. We forward your existing number, or set up a new local number for you." },
    ],
    costs: [
      { label: "Call minutes", units: 400, unitCost: C.agentMinute },
      { label: "Chat messages", units: 2000, unitCost: C.chatMessage },
      { label: "Phone number", units: 1, unitCost: C.phoneNumber },
      { label: "Reports and summaries", units: 1, unitCost: C.writing },
    ],
    bundles: ["ai-receptionist", "website-agent"],
    signals: ["no_booking", "no_chat", "no_form", "no_click_to_call"],
  },
  {
    id: "plan-growth",
    slug: "growth",
    kind: "plan",
    category: "plans",
    name: "Growth",
    tagline: "Answer, follow up and advertise, all done for you.",
    summary:
      "Everything in Launch with three times the minutes, plus AI follow-up calls, your own brand voice and a fresh ad campaign with custom art every month.",
    icon: "TrendingUp",
    monthly: 597,
    setup: 997,
    highlight: true,
    included: [
      "Everything in Launch",
      "1,200 call minutes a month, shared between incoming calls and follow-ups",
      "AI follow-up and reminder calls to customers who opted in",
      "Your own brand voice, designed or cloned (with consent)",
      "90+ languages, detected automatically",
      "A new ad campaign every month: Meta and Google ads written for your business",
      "8 custom AI images a month in your brand colours",
      "2 audio ads or voiceovers a month",
      "On-hold music and a sonic logo",
    ],
    features: [
      "Reminder calls that cut no-shows",
      "Review-request and win-back calls to past customers who agreed to hear from you",
      "Ads, art and audio that sound and look like your brand",
    ],
    howItWorks: [
      "Everything in Launch, plus a 30-minute brand session: voice, look, offers.",
      "We design your brand voice and build your first ad campaign and art.",
      "Follow-up calls start once your opted-in customer list is connected.",
      "Every month: new campaign, new art, new audio, and a report.",
    ],
    idealFor: ["Clinics with no-show problems", "Home services with seasonal demand", "Med spas and gyms", "Multi-language neighbourhoods"],
    deliverables: ["Everything in Launch", "Brand voice", "Monthly ad campaign + art", "Audio ads", "On-hold music"],
    engine: ["ElevenAgents", "Batch calling", "Voice Design & Voice Cloning", "Eleven v4", "Eleven Music", "Image & Video"],
    timeToLive: "Live in 5–7 business days",
    example:
      "A roofing company answers every storm-season call, calls back every quote request within a minute, and runs a new before-and-after ad each month in its own colours.",
    fineprint:
      "Follow-up calls only go to people who gave you permission to contact them. Cloning a voice needs the written consent of the person whose voice it is.",
    faqs: [
      { q: "Do you run the ads too?", a: "We write the campaign and make the art and audio every month. You keep your ad accounts and pay the ad budget to Meta or Google directly; we can launch the campaigns in your accounts for you." },
      { q: "What is a brand voice?", a: "A unique voice for your agents and audio. We design one from a description, or clone yours (or your spokesperson's) with their written consent." },
      { q: "Can I switch plans later?", a: "Yes, up or down at any time. Changes apply from your next billing date." },
    ],
    costs: [
      { label: "Call minutes", units: 1200, unitCost: C.agentMinute },
      { label: "Chat messages", units: 3000, unitCost: C.chatMessage },
      { label: "Phone number", units: 1, unitCost: C.phoneNumber },
      { label: "Ad campaign (Claude)", units: 1, unitCost: C.campaign },
      { label: "Ad images", units: 8, unitCost: C.image },
      { label: "Voiceovers", units: 2, unitCost: C.voiceover },
      { label: "Music minutes", units: 6, unitCost: C.musicMinute },
      { label: "Reports and scripts", units: 2, unitCost: C.writing },
    ],
    bundles: ["ai-receptionist", "website-agent", "follow-up-calls", "brand-voice", "multilingual", "ad-campaigns", "voiceovers", "music-jingles"],
    signals: ["no_booking", "no_pixel", "runs_ads", "few_reviews", "no_chat"],
  },
  {
    id: "plan-scale",
    slug: "scale",
    kind: "plan",
    category: "plans",
    name: "Scale",
    tagline: "A full AI front desk and media team.",
    summary:
      "Everything in Growth for up to three locations, plus WhatsApp, weekly ad creative with short videos, video dubbing, a monthly podcast and insights from every call.",
    icon: "Rocket",
    monthly: 1297,
    setup: 1997,
    included: [
      "Everything in Growth",
      "3,000 call minutes a month across up to 3 agents or locations",
      "WhatsApp AI agent",
      "Weekly fresh ad creative: 20 custom images and 4 short video ads a month",
      "30 minutes of video dubbed into other languages each month",
      "4 podcast episodes a month made from your blog or newsletter",
      "\"Listen to this page\" audio on your website",
      "Every call transcribed, with a monthly insights report",
      "Quarterly strategy call and priority support",
    ],
    features: [
      "One consistent voice and brand across phone, web, WhatsApp, ads and video",
      "Content in your customers' languages",
      "Know what customers ask for, from real call data",
    ],
    howItWorks: [
      "Everything in Growth, plus a content plan for video, podcast and dubbing.",
      "Each location or department gets its own agent, phone number and reports.",
      "Weekly creative drops; monthly podcast, dubbing and insights.",
      "Quarterly review of results and next quarter's plan.",
    ],
    idealFor: ["Multi-location businesses", "Franchise owners", "Clinics and firms that publish content", "Brands selling in several languages"],
    deliverables: ["Everything in Growth", "Up to 3 agents", "WhatsApp agent", "Weekly creative", "Dubbed videos", "Podcast", "Insights report"],
    engine: ["ElevenAgents", "WhatsApp", "Image & Video (Veo 3.1)", "Dubbing", "Studio", "Audio Native", "Scribe v3"],
    timeToLive: "Live in 7–10 business days",
    example:
      "A three-location physiotherapy group answers every call in each clinic, sends reminders on WhatsApp, posts weekly video ads and dubs its exercise videos into Spanish and Punjabi.",
    fineprint: "Outbound calls and WhatsApp messages only go to people who opted in. Meta bills WhatsApp conversation fees to your WhatsApp Business account.",
    faqs: [
      { q: "Can I add more locations?", a: "Yes. Each extra location adds an agent and phone number; ask us for a quote." },
      { q: "Who owns the content?", a: "You do. Every voiceover, video, image and episode we make for you is yours to use." },
      { q: "Is there a contract?", a: "No long-term contract. Pay monthly and cancel anytime, or pay yearly and get two months free." },
    ],
    costs: [
      { label: "Call minutes", units: 3000, unitCost: C.agentMinute },
      { label: "Chat messages", units: 5000, unitCost: C.chatMessage },
      { label: "Phone numbers", units: 3, unitCost: C.phoneNumber },
      { label: "WhatsApp messages", units: 2000, unitCost: C.chatMessage },
      { label: "Ad campaigns (Claude)", units: 4, unitCost: C.campaign },
      { label: "Ad images", units: 20, unitCost: C.image },
      { label: "Video ads", units: 4, unitCost: C.video },
      { label: "Dubbing minutes", units: 30, unitCost: C.dubMinute },
      { label: "Podcast audio minutes", units: 60, unitCost: C.ttsMinute },
      { label: "Website audio minutes", units: 50, unitCost: C.ttsMinute },
      { label: "Transcription hours", units: 50, unitCost: C.sttHour },
      { label: "Scripts and reports", units: 8, unitCost: C.writing },
    ],
    bundles: [
      "ai-receptionist", "website-agent", "follow-up-calls", "whatsapp-agent", "brand-voice", "multilingual", "ad-campaigns", "ad-creative",
      "voiceovers", "music-jingles", "video-dubbing", "podcast-studio", "listen-button", "transcription",
    ],
    signals: ["established", "runs_ads"],
  },
];

export const PRODUCTS: Offer[] = [
  // ── AI voice agents (ElevenAgents) ──────────────────────────
  {
    id: "ai-receptionist",
    slug: "ai-receptionist",
    kind: "product",
    category: "agents",
    name: "AI Phone Receptionist",
    tagline: "Answers every call in a natural voice, 24/7.",
    summary:
      "A virtual receptionist that picks up on the first ring, answers questions from your own information, books appointments, takes messages and transfers urgent calls to your team.",
    icon: "PhoneCall",
    monthly: 247,
    setup: 497,
    included: ["300 call minutes a month", "Unlimited FAQs and services", "Call summaries emailed after every call", "Monthly tuning"],
    features: [
      "Answers instantly, so callers never hit voicemail",
      "Knows your services, prices, hours, policies and location",
      "Books, reschedules and confirms appointments",
      "Transfers to a person on request or for emergencies",
      "Takes detailed messages and texts or emails them to you",
      "Detects voicemail and spam so you don't pay for robocalls",
    ],
    howItWorks: [
      "Tell us your hours, services, prices and transfer number on a short call.",
      "We train the receptionist on your website and that information, and pick a voice.",
      "You test it by calling it yourself; we adjust anything you want changed.",
      "We forward your line to it (always, after hours, or when you're busy).",
    ],
    idealFor: ["Dentists and clinics", "Plumbers, HVAC and roofers", "Salons and med spas", "Law and accounting firms", "Restaurants (reservations)"],
    deliverables: ["Configured receptionist", "Call forwarding or new local number", "Your call summary email"],
    engine: ["ElevenAgents", "Eleven v4 Turbo", "Scribe v3 Live", "Knowledge base"],
    timeToLive: "Live in 3–5 business days",
    example: "A plumber in a storm week gets 60 calls a day. The receptionist answers all of them, books the urgent jobs, and sends him a list of who needs a callback.",
    fineprint: "Not an emergency service: the receptionist tells callers to dial emergency services when a situation is urgent and dangerous.",
    faqs: [
      { q: "Does it sound robotic?", a: "No. It uses ElevenLabs' latest real-time voices, which pause, laugh and change tone like a person." },
      { q: "Can it use my calendar?", a: "Yes, for most booking tools. Tell us yours on the kickoff call; if it has no live connection we take the request and send it to you." },
      { q: "What happens to calls it can't handle?", a: "It transfers them to the number you choose, or takes a message and sends it to you straight away." },
    ],
    costs: [
      { label: "Call minutes", units: 300, unitCost: C.agentMinute },
      { label: "Phone number", units: 1, unitCost: C.phoneNumber },
    ],
    signals: ["no_booking", "no_click_to_call", "no_form", "established"],
  },
  {
    id: "website-agent",
    slug: "website-voice-chat-agent",
    kind: "product",
    category: "agents",
    name: "Website Voice & Chat Agent",
    tagline: "Turns website visitors into booked customers.",
    summary:
      "An assistant on your website that visitors can talk to or type to. It answers questions in seconds, recommends the right service and captures their details for you.",
    icon: "MessageSquare",
    monthly: 147,
    setup: 297,
    included: ["2,000 chat messages a month", "150 voice minutes a month", "Lead capture straight to your inbox"],
    features: [
      "Voice or text: visitors choose how they want to talk",
      "Trained on every page of your website",
      "Collects name, phone and what they need, then sends it to you",
      "Matches your brand colours and greeting",
    ],
    howItWorks: [
      "We train the agent on your website and the answers you want it to give.",
      "You approve its greeting and tone.",
      "We add one line of code to your site (or do it for you on most site builders).",
      "Leads land in your inbox; we review conversations and improve it monthly.",
    ],
    idealFor: ["Any business with a website", "Businesses that get questions after hours", "Real estate and legal (lead capture)"],
    deliverables: ["Configured agent", "Website widget installed", "Lead notification setup"],
    engine: ["ElevenAgents widget", "Eleven v4 Turbo", "Knowledge base (RAG)"],
    timeToLive: "Live in 2–3 business days",
    example: "A med spa's site gets 2,000 visitors a month but few bookings. The agent answers price and downtime questions at 11pm and books consultations.",
    faqs: [
      { q: "Does it work on any website?", a: "Yes. WordPress, Wix, Squarespace, Shopify, Webflow and custom sites all work." },
      { q: "Can it hand over to a human?", a: "Yes. It takes the visitor's details and tells them when to expect a call or email back." },
    ],
    costs: [
      { label: "Chat messages", units: 2000, unitCost: C.chatMessage },
      { label: "Voice minutes", units: 150, unitCost: C.agentMinute },
    ],
    signals: ["no_chat", "no_form", "no_booking"],
  },
  {
    id: "follow-up-calls",
    slug: "ai-follow-up-calls",
    kind: "product",
    category: "agents",
    name: "AI Follow-Up & Reminder Calls",
    tagline: "Calls back every lead and reminds every appointment.",
    summary:
      "An AI agent that makes outbound calls for you: appointment reminders, quote follow-ups, review requests and win-back calls, to customers who agreed to hear from you.",
    icon: "PhoneOutgoing",
    monthly: 297,
    setup: 497,
    included: ["750 outbound call minutes a month", "Call campaigns scheduled for you", "Results and callback list after every campaign"],
    features: [
      "Calls new web leads back within a minute",
      "Confirms appointments and reschedules no-shows",
      "Asks happy customers for a review and sends the link",
      "Leaves a short voicemail when nobody answers",
    ],
    howItWorks: [
      "You share an opted-in contact list or connect your booking tool.",
      "We write the call scripts with you and pick the voice.",
      "Campaigns run on a schedule you approve.",
      "You get a list of who confirmed, who needs a callback and who asked to stop.",
    ],
    idealFor: ["Clinics with no-shows", "Home services sending quotes", "Gyms and studios (win-backs)", "Auto shops (service reminders)"],
    deliverables: ["Outbound agent", "Call scripts", "Campaign schedule", "Results reports"],
    engine: ["ElevenAgents", "Batch calling", "Voicemail detection"],
    timeToLive: "Live in 5 business days",
    example: "A chiropractor's no-show rate drops after every patient gets a friendly reminder call the day before, with one-tap rescheduling.",
    fineprint:
      "We only call people who gave you permission to contact them, during local calling hours, and we honour every do-not-call request. The agent always says it is an automated assistant.",
    faqs: [
      { q: "Is this legal?", a: "Yes, when it follows consent rules: calls go only to people who opted in, the agent identifies itself, and anyone can ask to stop. We set it up that way." },
      { q: "Can it call cold lists?", a: "No. We don't make AI calls to people who haven't agreed to hear from you." },
    ],
    costs: [{ label: "Outbound minutes", units: 750, unitCost: C.outboundMinute }],
    signals: ["few_reviews", "low_rating", "established"],
  },
  {
    id: "whatsapp-agent",
    slug: "whatsapp-ai-agent",
    kind: "product",
    category: "agents",
    name: "WhatsApp AI Agent",
    tagline: "Answers your WhatsApp messages instantly, in any language.",
    summary: "Your AI agent on WhatsApp: answers questions, books appointments, sends confirmations and handles voice notes, using the same knowledge as your receptionist.",
    icon: "MessageCircle",
    monthly: 197,
    setup: 297,
    included: ["3,000 messages a month", "Connected to your WhatsApp Business number", "Same knowledge and voice as your other agents"],
    features: ["Replies in seconds, day and night", "Understands voice notes", "Sends booking confirmations and reminders", "Hands over to your team in the same chat"],
    howItWorks: [
      "We connect your WhatsApp Business account (we'll help you create one).",
      "We load your services, prices and answers.",
      "You test it from your own phone.",
      "We review conversations monthly and improve the answers.",
    ],
    idealFor: ["Restaurants and takeout", "Salons and beauty", "Tourism and rentals", "Businesses with international customers"],
    deliverables: ["WhatsApp agent", "Business profile setup", "Message templates"],
    engine: ["ElevenAgents WhatsApp channel"],
    timeToLive: "Live in 3–5 business days",
    example: "A restaurant takes reservation requests on WhatsApp in English, Spanish and Portuguese without anyone watching the phone.",
    fineprint: "Meta bills WhatsApp conversation fees to your WhatsApp Business account directly.",
    faqs: [{ q: "Do I need a new number?", a: "You need a number registered to WhatsApp Business. It can be your current business number if it isn't already on the regular WhatsApp app." }],
    costs: [{ label: "Messages", units: 3000, unitCost: C.chatMessage }],
    niches: ["restaurant", "salon", "med_spa"],
  },
  {
    id: "multilingual",
    slug: "multilingual-agent",
    kind: "product",
    category: "agents",
    name: "Multilingual Add-On",
    tagline: "Your agents speak your customers' language: 90+ of them.",
    summary: "Adds automatic language detection to any of your agents. Callers speak Spanish, Mandarin, Punjabi, Arabic or 90+ other languages and the agent answers in kind.",
    icon: "Languages",
    monthly: 97,
    setup: 0,
    included: ["90+ languages on all your agents", "Your business terms and names pronounced correctly", "Translated call summaries in English"],
    features: ["Detects the caller's language in the first sentence", "Switches mid-call if the caller does", "Summaries always arrive in your language"],
    howItWorks: ["Tell us your customers' top languages.", "We add language detection and test each language.", "We add your brand and product names to a pronunciation dictionary."],
    idealFor: ["Diverse cities", "Clinics and legal offices", "Tourism and hospitality"],
    deliverables: ["Language setup on your agents", "Pronunciation dictionary"],
    engine: ["ElevenAgents language detection", "Eleven v4 Turbo (90+ languages)", "Pronunciation dictionaries"],
    timeToLive: "Live in 1–2 business days",
    example: "A Brampton dental office answers in English, Punjabi and Hindi without hiring bilingual staff for every shift.",
    faqs: [{ q: "Does it need a separate agent per language?", a: "No. One agent handles every language and switches automatically." }],
    costs: [{ label: "Language setup and pronunciation", units: 1, unitCost: C.writing }],
  },
  {
    id: "live-interpreter",
    slug: "live-ai-interpreter",
    kind: "product",
    category: "agents",
    name: "Live AI Interpreter",
    tagline: "Talk to any customer, in any language, in real time.",
    summary: "A live interpreter for your front desk, phone and video calls. You speak your language, your customer hears theirs, and the other way around.",
    icon: "Globe",
    monthly: 197,
    setup: 297,
    included: ["200 minutes of live translation a month", "Phone, tablet and video-call setup", "Transcript of every session"],
    features: ["Natural-sounding speech in both directions", "Works at the counter on a tablet or over the phone", "Transcripts for your records"],
    howItWorks: ["We set up the interpreter on your devices.", "We add your industry terms so they translate correctly.", "Staff training: 15 minutes."],
    idealFor: ["Clinics and pharmacies", "Legal and immigration offices", "Hotels and tourism", "Auto dealers"],
    deliverables: ["Interpreter setup", "Staff quick-start guide", "Industry term list"],
    engine: ["ElevenLabs Realtime Translation"],
    timeToLive: "Live in 3 business days",
    example: "A walk-in clinic serves Spanish- and Tagalog-speaking patients at reception without waiting for a phone interpreter.",
    fineprint: "Not a certified interpreter: for legal proceedings or consent to medical treatment, use a certified human interpreter.",
    faqs: [{ q: "Which languages?", a: "All the major ones. Tell us yours and we'll test them before you pay." }],
    costs: [{ label: "Translation minutes", units: 200, unitCost: C.translateMinute }],
  },

  // ── Voice, video & creative (ElevenCreative) ────────────────
  {
    id: "voiceovers",
    slug: "studio-voiceovers",
    kind: "product",
    category: "content",
    name: "Studio Voiceovers & Audio Ads",
    tagline: "Radio-quality voiceovers without the studio.",
    summary: "Professional voiceovers for ads, videos, on-hold messages, phone menus and explainers. We write the script, pick or design the voice and deliver finished audio.",
    icon: "Mic",
    monthly: 147,
    setup: 0,
    included: ["8 finished voiceovers a month, up to 60 seconds each", "Scripts written for you", "Unlimited revisions within the month", "Multi-voice dialogue ads"],
    features: ["Thousands of voices, or your own brand voice", "Emotion and pacing directed line by line", "MP3 and WAV files ready for radio, Spotify, YouTube and social"],
    howItWorks: ["Tell us what each piece is for.", "We write the script and send you voice options.", "You approve, we deliver the finished files, and fix anything you want changed."],
    idealFor: ["Local radio and streaming ads", "Social video", "Phone menus and on-hold messages", "Course creators"],
    deliverables: ["Finished audio files", "Scripts"],
    engine: ["Eleven v4", "Text to Dialogue", "Voice Library"],
    timeToLive: "First voiceovers in 2 business days",
    example: "A car dealership runs a new 30-second Spotify ad every week for its monthly offers, with two voices bantering like a real radio spot.",
    faqs: [
      { q: "Can I use them commercially?", a: "Yes. Everything we deliver comes with commercial rights for your business." },
      { q: "Which languages?", a: "Over 70 languages and accents." },
    ],
    costs: [
      { label: "Voiceovers", units: 8, unitCost: C.voiceover },
      { label: "Scripts", units: 1, unitCost: C.writing },
    ],
    signals: ["runs_ads"],
  },
  {
    id: "brand-voice",
    slug: "custom-brand-voice",
    kind: "product",
    category: "content",
    name: "Custom Brand Voice",
    tagline: "A voice that's yours alone, everywhere you speak to customers.",
    summary: "We design a unique voice from a description of your brand, or clone yours or your spokesperson's with consent. Then we use it on your phone agent, ads, videos and podcast.",
    icon: "AudioLines",
    monthly: 97,
    setup: 497,
    included: ["One designed or professionally cloned voice", "Used on all your agents and audio", "Pronunciation dictionary for your names and terms", "Voice kept private to your account"],
    features: ["Designed voices: describe it ('warm, confident, slight Southern accent') and pick from options", "Professional clone: studio-grade copy of a real voice, with the speaker's consent", "Consistent sound across phone, web, ads and video"],
    howItWorks: [
      "Pick designed or cloned.",
      "Designed: we send you 3–5 candidates to choose from. Cloned: the speaker records 30 minutes of clean audio and confirms consent.",
      "We tune pronunciation of your names and terms.",
      "We roll the voice out to everything we make for you.",
    ],
    idealFor: ["Owner-led brands", "Franchises that need one voice", "Podcasters and coaches"],
    deliverables: ["Brand voice", "Voice style guide", "Pronunciation dictionary"],
    engine: ["Voice Design", "Professional Voice Cloning", "Instant Voice Cloning", "Pronunciation dictionaries"],
    timeToLive: "Designed: 2 days. Cloned: 5–7 days after recording",
    example: "A personal-injury firm's founder records once; his voice greets every caller and narrates every TV and radio spot.",
    fineprint: "We only clone a voice with the written consent of the person it belongs to, and ElevenLabs verifies professional clones.",
    faqs: [{ q: "Can someone else use my cloned voice?", a: "No. It stays private in our account, used only for your business, and we delete it if you cancel." }],
    costs: [{ label: "Voice management and pronunciation", units: 2, unitCost: C.writing }],
  },
  {
    id: "video-dubbing",
    slug: "ai-video-dubbing",
    kind: "product",
    category: "content",
    name: "AI Video Dubbing",
    tagline: "Your videos in 29+ languages, in your own voice.",
    summary: "We translate and dub your videos (ads, tutorials, testimonials and courses) so they keep the original speaker's voice and emotion in the new language.",
    icon: "Clapperboard",
    monthly: 297,
    setup: 0,
    included: ["30 minutes of video dubbed a month (standard)", "or 10 minutes of premium dubbing in 92 languages", "Translated subtitles included", "Human-reviewed timing"],
    features: ["Keeps each speaker's voice, tone and timing", "Multiple speakers detected automatically", "Subtitles in the new language"],
    howItWorks: ["Send us your videos or links.", "We pick the languages with you and dub them.", "We review sync and names, then deliver the files."],
    idealFor: ["Course creators and coaches", "Brands with international customers", "Clinics with multilingual patients", "YouTube channels"],
    deliverables: ["Dubbed video files", "Subtitle files"],
    engine: ["Dubbing v1 (29 languages)", "Dubbing v2 (92 languages)"],
    timeToLive: "First videos in 3 business days",
    example: "A fitness coach dubs her course into Spanish and Portuguese and opens two new markets without re-recording anything.",
    faqs: [{ q: "Does it sound like me?", a: "Yes. The dub keeps your voice and emotion; premium dubbing preserves them most closely." }],
    costs: [{ label: "Dubbed minutes", units: 30, unitCost: C.dubMinute }],
  },
  {
    id: "podcast-studio",
    slug: "podcast-audiobook-studio",
    kind: "product",
    category: "content",
    name: "Podcast & Audiobook Studio",
    tagline: "A podcast every week, without a microphone.",
    summary: "We turn your blog posts, newsletters or expertise into a polished podcast with two natural-sounding hosts, published for you. Audiobook narration on request.",
    icon: "Podcast",
    monthly: 297,
    setup: 297,
    included: ["4 episodes a month, up to 15 minutes each", "Scripts written from your content", "Cover art and show notes", "Published to Spotify and Apple Podcasts"],
    features: ["Two-host conversation format, or solo narration in your brand voice", "Intro and outro music made for your show", "Audiobook chapters and long-form narration available"],
    howItWorks: ["Share your blog, newsletter or talking points.", "We write each episode and send it for approval.", "We produce, mix and publish it to your feed."],
    idealFor: ["Professionals building authority", "Coaches and consultants", "Clinics educating patients", "Authors (audiobooks)"],
    deliverables: ["Podcast feed setup", "Episodes", "Cover art", "Show notes"],
    engine: ["Studio", "Create Podcast", "Eleven v4", "Eleven Music"],
    timeToLive: "First episode in 5 business days",
    example: "A financial planner's weekly newsletter becomes a 10-minute Monday podcast clients listen to on the drive to work.",
    faqs: [{ q: "Will it say anything wrong?", a: "Every script comes from your content and goes to you for approval before we produce it." }],
    costs: [
      { label: "Audio minutes", units: 60, unitCost: C.ttsMinute },
      { label: "Scripts", units: 4, unitCost: C.writing },
      { label: "Cover art", units: 2, unitCost: C.image },
    ],
    signals: ["no_social"],
  },
  {
    id: "listen-button",
    slug: "listen-to-this-page",
    kind: "product",
    category: "content",
    name: "\"Listen to This Page\" Website Audio",
    tagline: "Let visitors listen to your articles and pages.",
    summary: "Adds an audio player to your blog and key pages that reads them aloud in a natural voice, and updates itself when you edit the page.",
    icon: "Headphones",
    monthly: 49,
    setup: 99,
    included: ["Up to 20 pages or articles narrated a month", "Player styled to match your site", "Updates automatically when pages change"],
    features: ["Visitors stay longer and absorb more", "Accessible to people who prefer listening", "Your brand voice, or one from the library"],
    howItWorks: ["We pick the pages to narrate with you.", "We add the player to your site.", "New articles are narrated as you publish them."],
    idealFor: ["Blogs and publishers", "Law and medical sites with long explainers", "Accessibility-minded brands"],
    deliverables: ["Audio player installed", "Narrated pages"],
    engine: ["Audio Native"],
    timeToLive: "Live in 2 business days",
    example: "A law firm's long guides to divorce and wills get a play button, and visitors listen on their commute.",
    faqs: [{ q: "Does it work with my site builder?", a: "Yes: WordPress, Ghost, Webflow, Wix and most others." }],
    costs: [{ label: "Narration minutes", units: 100, unitCost: C.ttsMinute }],
    signals: ["weak_seo", "stale_site"],
  },
  {
    id: "music-jingles",
    slug: "custom-music-jingles",
    kind: "product",
    category: "content",
    name: "Custom Music, Jingles & Sonic Logo",
    tagline: "Music made for your brand, licensed for business.",
    summary: "Original music for your ads, on-hold line, videos and podcast, plus a sonic logo people remember. Made to your brief and cleared for commercial use.",
    icon: "Music",
    monthly: 147,
    setup: 0,
    included: ["10 tracks a month, up to 3 minutes each", "Custom sound effects", "A sonic logo (3–5 second audio signature)", "Commercial licence"],
    features: ["Any genre and mood, with or without vocals", "On-hold loops, ad beds, intros and outros", "Sound effects for videos and apps"],
    howItWorks: ["Describe the feel or send reference songs.", "We create options for you to pick from.", "You get finished, mixed files."],
    idealFor: ["Businesses running audio or video ads", "Podcasts and YouTube", "Phone systems (on-hold music)", "Gyms and studios"],
    deliverables: ["Music files", "Sonic logo", "Licence note"],
    engine: ["Eleven Music", "Sound Effects"],
    timeToLive: "First tracks in 2 business days",
    example: "A gym gets an upbeat on-hold loop, a 4-second sonic logo for the end of every ad, and new class playlists every month.",
    faqs: [{ q: "Can I use the music on YouTube and in ads?", a: "Yes. The music is made for you and cleared for commercial use." }],
    costs: [
      { label: "Music minutes", units: 30, unitCost: C.musicMinute },
      { label: "Sound effects", units: 20, unitCost: C.sfx },
    ],
    signals: ["runs_ads"],
  },
  {
    id: "ad-creative",
    slug: "ai-ad-images-video",
    kind: "product",
    category: "marketing",
    name: "AI Ad Images & Video",
    tagline: "Scroll-stopping ad creative in your brand colours, every week.",
    summary: "Custom images and short video ads made for your business and brand, sized for Facebook, Instagram, TikTok, YouTube and Google. No stock photos.",
    icon: "Image",
    monthly: 297,
    setup: 0,
    included: ["20 custom images a month", "4 short video ads a month (up to 8 seconds each)", "Every size: feed, story, banner", "Your colours, offers and logo placement"],
    features: ["Made from your brand colours and style", "Text and offers added cleanly, ready to post", "Video ads with sound and voiceover"],
    howItWorks: ["We read your website and brand colours and agree the look with you.", "Weekly drops of fresh creative.", "You approve, download and post, or we post them for you."],
    idealFor: ["Businesses running Meta or TikTok ads", "Restaurants and retail", "Real estate listings", "Events and promotions"],
    deliverables: ["Images in every ad size", "Short video ads"],
    engine: ["ElevenLabs Image & Video", "GPT Image 2", "Veo 3.1"],
    timeToLive: "First creative in 2 business days",
    example: "A bakery posts a new photo-quality ad of its weekly special every Monday, plus a short video of steam rising off fresh bread.",
    fineprint: "We never fake reviews or results, and AI-made people are never presented as your real customers or staff.",
    faqs: [{ q: "Do you put my logo on them?", a: "Yes. Send your logo and we place it on every piece." }],
    costs: [
      { label: "Images", units: 20, unitCost: C.image },
      { label: "Video clips", units: 4, unitCost: C.video },
    ],
    signals: ["runs_ads", "no_social", "stale_site"],
  },
  {
    id: "ai-spokesperson",
    slug: "ai-spokesperson-videos",
    kind: "product",
    category: "content",
    name: "AI Spokesperson Videos",
    tagline: "A presenter for your videos, without filming.",
    summary: "Talking-presenter videos for ads, FAQs and social, made from one photo (yours, with consent, or an AI presenter) and your brand voice.",
    icon: "Video",
    monthly: 397,
    setup: 297,
    included: ["6 videos a month, up to 60 seconds each", "Scripts written for you", "Captions burned in", "Vertical and horizontal versions"],
    features: ["Lip-synced to your script and voice", "Explain offers, answer FAQs, welcome new customers", "Ready for Reels, TikTok, YouTube and your website"],
    howItWorks: ["Choose a presenter: your photo with consent, or an AI presenter.", "We write the scripts and send them for approval.", "We produce and caption the videos."],
    idealFor: ["Real estate agents", "Clinics explaining treatments", "Coaches and consultants", "E-commerce product explainers"],
    deliverables: ["Finished videos", "Scripts", "Captions"],
    engine: ["ElevenLabs Image & Video (Creatify Aurora)", "Eleven v4"],
    timeToLive: "First videos in 3–5 business days",
    example: "A realtor posts a 45-second listing tour every week, presented by her own likeness, without booking a videographer.",
    fineprint: "We only use a real person's face or voice with their written consent, and label AI presenters where platforms require it.",
    faqs: [{ q: "Is it obviously AI?", a: "The quality is high, and we label AI video where the platform requires it. Being upfront keeps your brand trusted." }],
    costs: [
      { label: "Presenter videos", units: 6, unitCost: C.avatarVideo },
      { label: "Voice tracks", units: 6, unitCost: C.voiceover },
    ],
    niches: ["real_estate", "med_spa", "law_pi"],
  },

  // ── Business audio tools (ElevenAPI) ────────────────────────
  {
    id: "transcription",
    slug: "transcription-insights",
    kind: "product",
    category: "business",
    name: "Call & Meeting Transcription + Insights",
    tagline: "Every call and meeting, in writing, with what it means.",
    summary: "Highly accurate transcripts of your calls, meetings and recordings with speaker labels and summaries, plus a monthly report on what customers ask for and why deals are lost.",
    icon: "FileText",
    monthly: 97,
    setup: 0,
    included: ["100 hours of audio a month", "Speaker labels and timestamps", "Summaries and action items", "Monthly insights report"],
    features: ["90+ languages", "Your product names and terms recognized", "Searchable archive"],
    howItWorks: ["Connect your call recordings or upload files.", "Transcripts and summaries arrive automatically.", "Monthly, we send what customers asked about most."],
    idealFor: ["Sales teams", "Clinics (dictation)", "Law firms", "Consultants"],
    deliverables: ["Transcripts", "Summaries", "Monthly insights report"],
    engine: ["Scribe v3", "Scribe v2 Medical (on request)"],
    timeToLive: "Live in 1 business day",
    example: "A home-services company learns from 400 transcribed calls that 1 in 5 callers asks about financing, and adds a financing offer to its ads.",
    fineprint: "Medical or HIPAA work needs a signed BAA and a compliant setup; ask us before sending patient recordings.",
    faqs: [{ q: "How accurate is it?", a: "Scribe is among the most accurate speech-recognition models available, and handles accents and crosstalk well." }],
    costs: [
      { label: "Transcription hours", units: 100, unitCost: C.sttHour },
      { label: "Insights report", units: 2, unitCost: C.writing },
    ],
  },
  {
    id: "captions",
    slug: "captions-subtitles",
    kind: "product",
    category: "business",
    name: "Captions & Subtitles",
    tagline: "Perfectly timed captions for every video.",
    summary: "Word-accurate captions and subtitles for your videos and podcasts, timed to the word, in 90+ languages, as SRT, VTT or burned into the video.",
    icon: "Captions",
    monthly: 79,
    setup: 0,
    included: ["20 hours of video a month", "SRT and VTT files", "Burned-in captions for social"],
    features: ["Timed to each word", "Your brand names spelled right", "Translations on request"],
    howItWorks: ["Upload or share links.", "We caption and check names and terms.", "Download your files."],
    idealFor: ["Social video", "Courses", "Webinars", "Accessibility requirements"],
    deliverables: ["Caption files", "Captioned videos"],
    engine: ["Scribe v3", "Forced Alignment"],
    timeToLive: "Live in 1 business day",
    example: "A dental practice captions every Instagram Reel so it works with the sound off, which is how most people watch.",
    faqs: [{ q: "Can you translate captions?", a: "Yes, into 90+ languages." }],
    costs: [{ label: "Caption hours", units: 20, unitCost: C.sttHour }],
  },
  {
    id: "audio-cleanup",
    slug: "audio-cleanup-voice-changer",
    kind: "product",
    category: "business",
    name: "Audio Cleanup & Voice Changer",
    tagline: "Studio-clean audio from any recording.",
    summary: "Removes background noise, echo and hum from your videos, podcasts and calls, and converts recordings into a different voice when you need it.",
    icon: "Waves",
    monthly: 79,
    setup: 0,
    included: ["120 minutes of audio a month", "Noise, echo and music removal", "Voice conversion into any library or brand voice"],
    features: ["Rescue recordings made on a phone", "Keep your delivery, change the voice", "Files up to an hour long"],
    howItWorks: ["Send your files.", "We clean or convert them.", "Download the finished audio."],
    idealFor: ["Podcasters", "Video creators", "Training and HR videos"],
    deliverables: ["Cleaned audio files"],
    engine: ["Voice Isolator", "Voice Changer"],
    timeToLive: "Live in 1 business day",
    example: "A contractor's job-site testimonial videos lose the generator noise and sound like they were recorded in a studio.",
    faqs: [{ q: "Can it remove music?", a: "Yes, it separates voices from music and background sound." }],
    costs: [{ label: "Audio minutes", units: 120, unitCost: C.audioMinute }],
  },

  // ── Ads & growth ────────────────────────────────────────────
  {
    id: "ad-campaigns",
    slug: "done-for-you-ad-campaigns",
    kind: "product",
    category: "marketing",
    name: "Done-For-You Ad Campaigns",
    tagline: "A full Meta and Google campaign written for your business every month.",
    summary: "Every month we research your market and write a complete campaign: strategy, Facebook and Instagram ads, Google search ads, short-video scripts and landing-page copy, with custom images in your brand colours.",
    icon: "Megaphone",
    monthly: 397,
    setup: 297,
    included: [
      "1 complete campaign a month",
      "3 Meta ads, 15 Google headlines, 4 descriptions and keywords",
      "2 short-video scripts and landing-page copy",
      "8 custom images in your brand colours",
      "Launch in your ad accounts on request",
    ],
    features: ["Written around your real offers, reviews and gaps", "Checked against each platform's character limits and ad rules", "Google Ads Editor file included"],
    howItWorks: ["We audit your website and competitors.", "We write the campaign and make the art.", "You approve; we launch it in your ad accounts or hand it to your team.", "Monthly: new angles based on what worked."],
    idealFor: ["Home services", "Clinics and med spas", "Gyms", "Any business ready to spend on ads"],
    deliverables: ["Campaign document", "Ad images", "Google Ads Editor CSV"],
    engine: ["Claude (writing)", "ElevenLabs Image & Video (art)"],
    timeToLive: "First campaign in 3 business days",
    example: "A med spa launches a Botox-consult campaign with three Meta angles and 15 Google headlines, and the art uses its own lilac-and-gold palette.",
    fineprint: "Ad spend is paid by you to Meta or Google directly. We never make up reviews, prices or results.",
    faqs: [{ q: "How much should I spend on ads?", a: "Most local businesses start at $20–$40 a day per platform. The campaign includes a budget plan." }],
    costs: [
      { label: "Campaign writing (Claude)", units: 1, unitCost: C.campaign },
      { label: "Ad images", units: 8, unitCost: C.image },
    ],
    signals: ["no_pixel", "runs_ads", "few_reviews"],
  },
];

export const OFFERS: Offer[] = [...PLANS, ...PRODUCTS];

export function getOffer(idOrSlug: string | undefined): Offer | undefined {
  if (!idOrSlug) return undefined;
  const k = idOrSlug.toLowerCase();
  return OFFERS.find((o) => o.id === k || o.slug === k);
}

// ── Pricing ──────────────────────────────────────────────────

export const ANNUAL_MONTHS = 10;

export const DEFAULT_STORE: StoreSettings = {
  enabled: true,
  currency: "usd",
  headline: "Your AI receptionist, voice and marketing team, *done for you*.",
  subheadline:
    "We build, launch and run AI phone agents, voiceovers, dubbing, podcasts and ads for your business. Ask our AI assistant anything: it'll explain every product in detail.",
  assistantName: "Ava",
  showEngine: true,
  annual: true,
  waiveSetupOnAnnual: true,
  overagePerMinute: 0.25,
  prices: {},
};

export interface Price {
  monthly: number;
  setup: number;
  /** Price per billing interval. */
  recurring: number;
  /** Setup fee actually charged for this interval. */
  setupCharged: number;
  interval: BillingInterval;
  /** Yearly saving vs paying monthly. */
  annualSaving: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function clean(n: unknown, fallback: number): number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? round2(n) : fallback;
}

export function priceOf(offer: Offer, settings: Pick<StoreSettings, "prices" | "waiveSetupOnAnnual">, interval: BillingInterval = "month"): Price {
  const o: PriceOverride = settings.prices[offer.id] ?? {};
  const monthly = clean(o.monthly, offer.monthly);
  const setup = clean(o.setup, offer.setup);
  const recurring = interval === "year" ? round2(monthly * ANNUAL_MONTHS) : monthly;
  const setupCharged = interval === "year" && settings.waiveSetupOnAnnual ? 0 : setup;
  return { monthly, setup, recurring, setupCharged, interval, annualSaving: round2(monthly * (12 - ANNUAL_MONTHS)) };
}

export function isVisible(offer: Offer, settings: Pick<StoreSettings, "prices">): boolean {
  return !settings.prices[offer.id]?.hidden;
}

/** Estimated monthly cost to deliver at full included usage. */
export function monthlyCost(offer: Offer): number {
  return round2(offer.costs.reduce((sum, c) => sum + c.units * c.unitCost, 0));
}

export function margin(price: number, cost: number): number {
  if (price <= 0) return 0;
  return Math.round(((price - cost) / price) * 1000) / 10;
}

/** Sum of the parts a plan bundles, at their default prices: the "worth" line on plan cards. */
export function bundleWorth(plan: Offer, settings: Pick<StoreSettings, "prices" | "waiveSetupOnAnnual">): number {
  return (plan.bundles ?? []).reduce((sum, id) => {
    const p = getOffer(id);
    return p ? sum + priceOf(p, settings).monthly : sum;
  }, 0);
}

export const CURRENCIES: { id: StoreSettings["currency"]; label: string; symbol: string }[] = [
  { id: "usd", label: "US dollars", symbol: "$" },
  { id: "cad", label: "Canadian dollars", symbol: "$" },
  { id: "gbp", label: "British pounds", symbol: "£" },
  { id: "eur", label: "Euros", symbol: "€" },
  { id: "aud", label: "Australian dollars", symbol: "$" },
];

export function dollars(n: number, opts: { cents?: boolean; currency?: StoreSettings["currency"] } = {}): string {
  const cents = opts.cents ?? !Number.isInteger(n);
  const symbol = CURRENCIES.find((c) => c.id === opts.currency)?.symbol ?? "$";
  return `${symbol}${n.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`;
}

// ── Recommendations ──────────────────────────────────────────

/** Healthcare and legal niches get the multilingual and transcription pitch. */
const CARE_NICHES = new Set(["dentist", "chiropractor", "physical_therapy", "veterinarian", "med_spa", "law_pi", "accountant"]);
const TRADE_NICHES = new Set(["roofer", "hvac", "plumber", "landscaping", "pest_control", "auto_repair", "cleaning"]);

export interface Recommendation {
  offer: Offer;
  reason: string;
}

/**
 * The best things to pitch a business, from its audit findings and niche.
 * Always starts with the receptionist or a plan, because missed calls are the
 * most common and easiest problem to prove.
 */
export function recommend(input: { niche?: string; signals?: { id: string; label: string; positive?: boolean }[] }, max = 3): Recommendation[] {
  const ids = new Set((input.signals ?? []).map((s) => s.id));
  const out: Recommendation[] = [];
  const add = (id: string, reason: string) => {
    const offer = getOffer(id);
    if (offer && !out.some((r) => r.offer.id === id)) out.push({ offer, reason });
  };
  const niche = input.niche ?? "";

  if (ids.has("no_booking") || ids.has("no_form") || ids.has("no_click_to_call")) {
    add("ai-receptionist", "No easy way to book online, so every booking depends on someone answering the phone.");
  } else {
    add("ai-receptionist", "Most local businesses miss a share of calls at lunch, after hours and on weekends.");
  }
  if (ids.has("runs_ads") || ids.has("established")) add("plan-growth", "Already investing in growth: follow-up calls, ads and a brand voice compound it.");
  if (ids.has("no_chat")) add("website-agent", "Their website has no chat, so after-hours visitors leave without asking.");
  if (ids.has("no_pixel")) add("ad-campaigns", "No ad tracking on the site: they aren't running measurable ads yet.");
  if (ids.has("few_reviews") || ids.has("low_rating")) add("follow-up-calls", "Few or weak reviews: automated review-request calls to happy customers fix that.");
  if (CARE_NICHES.has(niche)) add("multilingual", "Patients and clients call in many languages; one agent can answer in all of them.");
  if (TRADE_NICHES.has(niche)) add("follow-up-calls", "Trades win on speed: calling back quote requests within a minute books more jobs.");
  if (niche === "restaurant") add("whatsapp-agent", "Diners message for reservations and takeout; WhatsApp answers instantly.");
  if (niche === "real_estate") add("ai-spokesperson", "Weekly listing videos without filming.");
  if (ids.has("weak_seo") || ids.has("stale_site")) add("listen-button", "An audio version of their pages keeps visitors on the site longer.");
  add("plan-launch", "The simplest way to start: receptionist plus website assistant for one price.");
  return out.slice(0, max);
}
