// Shared domain types for Mainstreet. Server, crew, renderers and the
// dashboard (web/) all speak these shapes. Keep this file free of runtime
// imports so the browser bundle can import it too.

// ── Leads ────────────────────────────────────────────────────────────────

/** Where a lead is in the pipeline. The crew moves it forward one stage at a time. */
export type LeadStatus =
  | "new" // Scout found it; website not checked yet
  | "qualified" // website checked and scored; worth building for
  | "skipped" // not a fit (good site already, chain, closed, low score)
  | "diagnosed" // Diagnoser wrote the diagnosis
  | "built" // Builder made the mockups
  | "filmed" // Filmer made the video
  | "ready" // Pitcher drafted the outreach; waiting to send or for approval
  | "pitched" // first touch sent
  | "replied" // they wrote back
  | "negotiating" // interested, in conversation
  | "won" // paid
  | "lost" // said no, or no reply after the full sequence
  | "dnc"; // do not contact

export const PIPELINE: LeadStatus[] = ["new", "qualified", "diagnosed", "built", "filmed", "ready", "pitched", "replied", "negotiating", "won"];

/** What the Scout found where the website should be. */
export type WebsiteState =
  | "none" // no website on the listing
  | "social_only" // the "website" is a Facebook/Instagram/Yelp/Linktree page
  | "dead" // the link is broken, parked, expired or shut down (e.g. old business.site pages)
  | "outdated" // works, but looks like 2014: no mobile layout, old copyright, no HTTPS…
  | "weak" // works and is recent-ish, but misses basics (booking, tap-to-call, speed)
  | "modern"; // a decent site already: usually skipped

export type Country = "US" | "CA";

export interface Review {
  author: string;
  rating: number;
  text: string;
  when?: string;
}

export interface SiteAudit {
  url?: string;
  finalUrl?: string;
  fetchedAt: string;
  reachable: boolean;
  status?: number;
  error?: string;
  https: boolean;
  responseMs?: number;
  bytes?: number;
  title?: string;
  description?: string;
  mobileViewport: boolean;
  copyrightYear?: number;
  generator?: string;
  cms?: string;
  oldTech: string[]; // e.g. "Flash", "jQuery 1.4", "table layout", "<font> tags"
  booking: string[];
  hasClickToCall: boolean;
  hasContactForm: boolean;
  emails: string[];
  emailPage?: string; // the page an email was found on, when it wasn't the homepage
  phones: string[];
  socials: { facebook?: string; instagram?: string; yelp?: string };
  noSolicitation: boolean; // page asks not to be sent unsolicited offers
  brandColors: string[];
  parked: boolean;
  findings: string[]; // plain-English facts, each one checkable against the page
}

export interface Diagnosis {
  headline: string; // one line: the problem in their terms
  evidence: string[]; // facts from the listing and audit only
  impact: string; // what it costs them, without invented numbers
  angle: "no_site" | "dead_link" | "social_only" | "outdated" | "mobile" | "booking" | "trust";
  hooks: string[]; // personal details worth using ("4.9 stars from 212 reviews", "open Saturdays")
  corePitch: string; // 2-3 sentences the Pitcher builds every channel's message from
  tone: "friendly" | "professional" | "premium";
  fit: "pursue" | "skip";
  skipReason?: string;
  suggestedPriceCents: number; // base price unless the business clearly needs more
}

// ── Mockups ──────────────────────────────────────────────────────────────

export type VariantId = "bold" | "classic" | "fresh";

export type PaletteId =
  | "harbor" // deep navy + sea blue + warm sand (trust: dental, legal, finance)
  | "clinic" // clean white + teal + mint (medical, dental, physio)
  | "forest" // deep green + moss + cream (landscaping, outdoor, organic)
  | "ember" // charcoal + safety orange + warm grey (trades: roofing, HVAC, auto)
  | "citrus" // bright coral + sunny yellow + white (food, cafés, kids)
  | "blush" // soft rose + plum + ivory (salons, spas, beauty)
  | "slate" // graphite + electric blue + ice (tech, repair, modern trades)
  | "gold" // black + brass gold + bone (premium: law, luxury, barbers)
  | "terracotta" // clay + olive + linen (restaurants, bakeries, home goods)
  | "sky"; // airy blue + navy + white (cleaning, pools, plumbing)

export type FontPairId =
  | "modern" // Inter Tight headings / Inter body
  | "editorial" // Fraunces / Inter
  | "friendly" // Nunito / Nunito Sans
  | "strong" // Archivo Black / Archivo
  | "elegant" // Cormorant Garamond / Lato
  | "geometric"; // Outfit / DM Sans

export type IconName =
  | "tooth"
  | "heart"
  | "shield"
  | "star"
  | "clock"
  | "calendar"
  | "phone"
  | "map"
  | "wrench"
  | "bolt"
  | "drop"
  | "flame"
  | "leaf"
  | "home"
  | "car"
  | "scissors"
  | "sparkle"
  | "paw"
  | "utensils"
  | "coffee"
  | "dumbbell"
  | "briefcase"
  | "scale"
  | "check"
  | "users"
  | "sun"
  | "snowflake"
  | "hammer"
  | "brush"
  | "camera";

/** The Builder's content plan for one business. Renderers turn it into HTML. */
export interface SiteSpec {
  businessName: string;
  tagline: string; // ≤ 60 chars
  heroHeadline: string; // ≤ 70 chars
  heroSubheadline: string; // ≤ 170 chars
  primaryCta: string; // e.g. "Book an appointment"
  secondaryCta: string; // e.g. "Call us"
  services: { name: string; blurb: string; icon: IconName }[]; // 3–6
  about: { heading: string; body: string };
  highlights: { label: string; detail: string }[]; // 3 trust points, from real data only
  testimonials: { quote: string; author: string; rating?: number }[]; // only quotes from real reviews; may be empty
  faq: { q: string; a: string }[]; // 3–4
  ctaBand: { heading: string; body: string; button: string };
  seo: { title: string; description: string };
  palette: PaletteId;
  fontPair: FontPairId;
  mood: "warm" | "clinical" | "bold" | "earthy" | "luxury" | "playful";
  imagePrompt: string; // hero photo brief: no text, no logos, no people's faces up close
}

/** Facts about the business a renderer may show. Never invented. */
export interface BusinessFacts {
  name: string;
  niche: string;
  nicheLabel: string;
  city: string;
  region?: string;
  phone?: string;
  email?: string;
  address?: string;
  hours?: string[]; // "Monday: 8:00 AM – 5:00 PM"
  mapsUrl?: string;
  rating?: number;
  reviewCount?: number;
}

export interface Variant {
  id: VariantId;
  label: string;
  path: string; // relative to DATA_DIR, e.g. "sites/ld_abc/bold/index.html"
  screenshot?: string; // relative to DATA_DIR, e.g. "sites/ld_abc/bold/shot.jpg"
}

export interface VideoAsset {
  path: string; // relative to DATA_DIR
  poster: string; // relative to DATA_DIR
  durationSec: number;
  script: string;
  voice: "elevenlabs" | "system" | "silent";
}

export interface PitchPack {
  email: { subject: string; body: string };
  followups: { day: number; subject: string; body: string }[];
  sms: string;
  dm: string;
  callScript: string;
}

export interface Lead {
  id: string;
  source: "google" | "demo" | "manual";
  sourceId: string;
  name: string;
  niche: string;
  city: string;
  region?: string;
  country: Country;
  address?: string;
  phone?: string;
  email?: string;
  emailSource?: string; // the page the email was published on (CASL/CAN-SPAM record)
  website?: string;
  mapsUrl?: string;
  lat?: number;
  lon?: number;
  rating?: number;
  reviewCount?: number;
  hours?: string[];
  reviews?: Review[];
  primaryType?: string;
  status: LeadStatus;
  websiteState?: WebsiteState;
  audit?: SiteAudit;
  score?: number; // 0–100 opportunity score
  scoreReasons?: string[];
  diagnosis?: Diagnosis;
  spec?: SiteSpec;
  heroImage?: string; // relative to DATA_DIR
  variants?: Variant[];
  video?: VideoAsset;
  pitch?: PitchPack;
  proposalToken?: string;
  priceCents: number;
  dealValueCents?: number;
  chosenVariant?: VariantId;
  consent?: { basis: "published_email" | "inquiry" | "replied" | "none"; note?: string; at?: string };
  lastContactAt?: string;
  nextActionAt?: string;
  firstPitchAt?: string;
  followupsSent: number;
  skipReason?: string;
  liveSlug?: string; // set when the site is launched at /live/<slug>/
  error?: string;
  errorStage?: string;
  attempts?: number;
  retryAt?: string;
  notes?: string;
  /** Demo mode only: the fictional website's truth, so audits need no network. */
  demo?: { state: WebsiteState; copyrightYear?: number; email?: string; reviews?: Review[] };
  createdAt: string;
  updatedAt: string;
}

/** The slim shape lists and the voice agent get. */
export interface LeadSummary {
  id: string;
  name: string;
  niche: string;
  city: string;
  region?: string;
  status: LeadStatus;
  websiteState?: WebsiteState;
  score?: number;
  rating?: number;
  reviewCount?: number;
  priceCents: number;
  dealValueCents?: number;
  thumb?: string; // URL of a mockup screenshot
  proposalUrl?: string;
  hasEmail: boolean;
  hasPhone: boolean;
  lastContactAt?: string;
  updatedAt: string;
  error?: string;
}

// ── Messages, approvals, events ─────────────────────────────────────────

export type Channel = "email" | "sms" | "dm" | "call" | "note";

export interface Message {
  id: string;
  leadId: string;
  channel: Channel;
  direction: "out" | "in";
  kind: "pitch" | "followup" | "reply" | "inbound" | "note";
  subject?: string;
  body: string;
  /** "failed": a send that didn't work. "discarded": a draft that was never meant to go (replaced, rejected or cancelled). */
  status: "draft" | "pending_approval" | "queued" | "sent" | "failed" | "discarded" | "received" | "manual";
  externalId?: string;
  error?: string;
  createdAt: string;
  sentAt?: string;
  analysis?: ReplyAnalysis;
}

export interface ReplyAnalysis {
  intent: "interested" | "ready_to_buy" | "question" | "wants_call" | "price_objection" | "not_interested" | "unsubscribe" | "wrong_person" | "auto_reply";
  summary: string;
  suggestedReply: string;
  needsHuman: boolean;
  dealHintCents?: number; // what they seem to want to spend, if they said
}

export type ApprovalKind = "deal" | "pitch" | "reply" | "spend" | "strategy";

export interface Approval {
  id: string;
  kind: ApprovalKind;
  leadId?: string;
  leadName?: string;
  title: string;
  detail: string;
  amountCents?: number;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string; // "dashboard" | "voice" | "mcp"
}

export type AgentId = "orchestrator" | "scout" | "diagnoser" | "builder" | "filmer" | "pitcher" | "checker" | "closer";

export interface CrewEvent {
  id: number;
  ts: string;
  agent: AgentId | "system" | "owner";
  level: "info" | "success" | "warn" | "error";
  leadId?: string;
  leadName?: string;
  message: string;
}

export interface AgentStatus {
  id: AgentId;
  name: string;
  role: string;
  state: "idle" | "working" | "paused" | "error";
  current?: string;
  doneToday: number;
  errorsToday: number;
  lastRunAt?: string;
}

// ── Overview ─────────────────────────────────────────────────────────────

export interface Kpis {
  revenueMonthCents: number;
  revenueAllCents: number;
  dealsWonMonth: number;
  pipelineValueCents: number;
  scannedToday: number;
  qualifiedToday: number;
  builtToday: number;
  filmedToday: number;
  pitchedToday: number;
  repliesToday: number;
  responseRate7d: number; // 0..1
  responseSample7d: number; // pitches in the window
  spendTodayUsd: number;
  spendMonthUsd: number;
  budgetDailyUsd: number;
  costPerLeadUsd: number;
}

export interface Alert {
  id: string;
  level: "warn" | "error";
  message: string;
  since: string;
}

export interface Overview {
  kpis: Kpis;
  funnel: { status: LeadStatus; count: number }[];
  crew: AgentStatus[];
  approvals: Approval[];
  alerts: Alert[];
  recent: CrewEvent[];
  paused: boolean;
  demo: boolean;
  responseTrend: { day: string; pitched: number; replies: number }[]; // last 14 days
}

// ── Settings ─────────────────────────────────────────────────────────────

export interface TargetCity {
  city: string;
  region: string; // state or province code, e.g. "OR", "ON"
  country: Country;
}

export interface Settings {
  owner: {
    name: string;
    agencyName: string;
    email: string; // where alerts go; also the reply-to on pitches unless replyTo is set
    replyTo?: string; // inbound address that forwards replies to the app (see README)
    phone?: string; // E.164, for escalation calls and the one-tap channels
    postalAddress: string; // required on every commercial email (CAN-SPAM, CASL)
    bookingUrl?: string;
    timezone: string;
  };
  offer: {
    priceCents: number;
    currency: "USD" | "CAD";
    hostingMonthlyCents: number; // 0 = no hosting subscription
    deliveryDays: number;
    guarantee: string;
  };
  targets: { cities: TargetCity[]; niches: string[] };
  quotas: { scanPerDay: number; leadsPerDay: number; pitchesPerDay: number };
  pitching: {
    mode: "review" | "auto"; // review: every first email waits for your yes
    channels: { email: boolean; call: boolean; sms: boolean; dm: boolean };
    sendWindow: { startHour: number; endHour: number; weekdaysOnly: boolean };
    followupDays: number[]; // days after the first touch, e.g. [3, 7]
    warmup: boolean; // ramp daily email volume over the first two weeks
    autoReply: boolean; // let the Closer answer routine replies itself (questions, "yes", price) instead of waiting for you
  };
  escalation: {
    dealOverCents: number; // deals above this wait for you (default $3,000)
    minResponseRate: number; // alert below this 7-day rate (default 0.12)
    minSample: number; // only judge the rate after this many pitches
    pauseOnLowResponse: boolean;
    callOwner: boolean; // Atlas phones you for escalations (needs a phone number in ElevenLabs)
    ntfyTopic?: string; // push notifications through ntfy.sh
  };
  budget: { dailyUsd: number; monthlyUsd: number; perLeadMaxUsd: number };
  media: { heroImages: boolean; video: boolean; voiceId?: string };
  qualify: { minScore: number; minReviews: number; skipChains: boolean };
  crew: { paused: boolean; pausedAgents: AgentId[] };
}

export interface Integrations {
  claude: boolean;
  googlePlaces: boolean;
  elevenlabs: boolean;
  elevenImages: boolean;
  resend: boolean;
  stripe: boolean;
  voiceAgent: { configured: boolean; agentId?: string; toolMode: "client" | "webhook" };
  publicUrl?: string;
  ffmpeg: boolean;
  browser: boolean;
}

// ── Commands (shared by the dashboard, Atlas and the MCP endpoint) ──────

export interface CommandResult {
  ok: boolean;
  /** One or two plain sentences Atlas can say out loud. */
  say: string;
  data?: unknown;
  /** Set when the command needs an explicit yes first. Atlas reads `summary` back and calls again with confirmed: true. */
  needsConfirmation?: { summary: string };
}
