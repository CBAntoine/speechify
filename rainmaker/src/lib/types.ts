// Shared data model. Kept free of runtime imports so tests can load it with
// Node's type stripping.

export type Stage = "new" | "contacted" | "replied" | "meeting" | "proposal" | "won" | "lost";

export const STAGES: { id: Stage; label: string; hint: string }[] = [
  { id: "new", label: "New", hint: "Found, not contacted yet" },
  { id: "contacted", label: "Contacted", hint: "First touch sent" },
  { id: "replied", label: "Replied", hint: "They answered" },
  { id: "meeting", label: "Meeting", hint: "Call or demo booked" },
  { id: "proposal", label: "Proposal", hint: "Offer sent" },
  { id: "won", label: "Won", hint: "Paying client" },
  { id: "lost", label: "Lost", hint: "Not now" },
];

export type LeadSource = "google_places" | "openstreetmap" | "open_data" | "web" | "manual" | "agent" | "sample" | "store";

export type Severity = "high" | "medium" | "low" | "info";

/** One finding about a prospect, written as something you can sell. */
export interface Signal {
  id: string;
  label: string;
  detail?: string;
  severity: Severity;
  /** The service this finding sells, e.g. "Online booking + reminders". */
  pitch?: string;
  /** True when the finding is evidence they can pay (e.g. already runs ads). */
  positive?: boolean;
}

export interface AuditResult {
  url?: string;
  finalUrl?: string;
  fetchedAt: string;
  reachable: boolean;
  https: boolean;
  status?: number;
  responseMs?: number;
  bytes?: number;
  title?: string;
  description?: string;
  h1?: string;
  mobileViewport: boolean;
  analytics: string[];
  pixels: string[];
  booking: string[];
  chat: string[];
  reviewsWidgets: string[];
  cms?: string;
  hasContactForm: boolean;
  hasClickToCall: boolean;
  hasSchema: boolean;
  hasOgImage: boolean;
  copyrightYear?: number;
  socials: string[];
  emails: string[];
  phones: string[];
  /** The site's robots.txt asks automated visitors not to read it, so it wasn't audited. */
  robotsBlocked?: boolean;
  /** Brand colours found on the site (theme-color first, then the most used), as #rrggbb. */
  brandColors?: string[];
  /** The page's social share image, useful as a style reference for ad art. */
  ogImage?: string;
  error?: string;
}

export interface Lead {
  id: string;
  name: string;
  niche: string;
  category?: string;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
  website?: string;
  mapsUrl?: string;
  lat?: number;
  lon?: number;
  rating?: number;
  reviewCount?: number;
  source: LeadSource;
  sourceId?: string;
  stage: Stage;
  /** Estimated monthly retainer if they sign, in dollars. */
  value?: number;
  score?: number;
  signals?: Signal[];
  audit?: AuditResult;
  notes?: string;
  tags?: string[];
  contactName?: string;
  nextStep?: string;
  sample?: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  lastContactAt?: string;
  /** A demo AI receptionist built for this prospect from their website. */
  demo?: DemoAgent;
  /** The client's own ElevenLabs agent, once they pay. */
  clientAgentId?: string;
  /** An AI Website Guide (chat + voice agent for their site) built from their website. */
  guide?: GuideDemo;
  /** Inputs for the guide's ROI: their monthly website visitors and what one lead is worth. */
  guideRoi?: { monthlyVisitors?: number; leadValue?: number };
  /** Follow-up emails written with the first touch; autopilot drafts each when it's due. */
  sequence?: SequenceStep[];
}

export interface SequenceStep {
  /** Days after the first email was sent. */
  dayOffset: number;
  subject: string;
  body: string;
  draftedAt?: string;
}

export interface DemoAgent {
  agentId: string;
  /** Random token in the private demo link (/demo/<token>). */
  token: string;
  createdAt: string;
  knowledgeBaseId?: string;
  /** Voice sessions used today, to cap what a shared link can spend. */
  usage?: { day: string; sessions: number };
}

/** Something true about a business, and where it came from: all a video ad's script may say about them. */
export interface VideoFact {
  id: string;
  kind: "business" | "gap" | "strength" | "industry" | "research";
  text: string;
  source: string;
  url?: string;
}

export interface VideoScene {
  kind: "hook" | "fact" | "problem" | "solution" | "cta";
  /** On screen, a few words. */
  headline: string;
  /** On screen under the headline. */
  sub: string;
  /** What the narrator says. */
  voiceover: string;
  visual: "logo" | "photo" | "website" | "stat" | "product" | "plain";
  stat?: { value: string; label: string };
  /** The product a solution scene sells. */
  productId?: string;
  /** The facts it rests on. */
  factIds: string[];
}

/**
 * A personalised video ad for one business, made from their real data to
 * sell the products picked for them. Drawn in the browser (and recorded to a
 * file there); its private page is /video/<token>.
 */
export interface VideoAd {
  id: string;
  token: string;
  leadId: string;
  business: string;
  createdAt: string;
  createdBy: string;
  format: "vertical" | "square";
  /** Store product ids it sells. */
  products: string[];
  facts: VideoFact[];
  scenes: VideoScene[];
  /** When each scene starts, in seconds, and the length. */
  timing: { starts: number[]; total: number };
  /** Their brand colour, readable text colour, and logo and photo (asset ids). */
  brand: { color: string; ink: string; logo?: string; photo?: string; domain?: string };
  voiceover?: { assetId: string; model: string };
  email: { subject: string; body: string };
  writtenBy: "claude" | "template";
  views?: number;
  lastViewedAt?: string;
}

/** An AI Website Guide built for a prospect: their website's knowledge, a demo page, and later their live widget. */
export interface GuideDemo {
  agentId: string;
  /** Random token in the private demo page (/guide/<token>). */
  token: string;
  createdAt: string;
  /** The guide's first name, e.g. "Ava". */
  name: string;
  knowledge: { id: string; name: string }[];
  /** Pages of their website the knowledge base was built from. */
  pages: { url: string; title?: string }[];
  faqs: number;
  brand?: { name?: string; color?: string; logo?: string; image?: string; headline?: string; tagline?: string; services?: string[] };
  /** The five questions to ask it in front of the owner, with its answers when tested. */
  questions: { q: string; answer?: string; unsure?: boolean; note?: string }[];
  testedAt?: string;
  /** Demo sessions used today, to cap what a shared link can spend. */
  usage?: { day: string; sessions: number };
  /** Installed on their real website for a free trial. */
  trial?: { domain: string; startedAt: string; endsAt: string };
}

/** A business found by search, before it is saved as a lead. */
export interface Prospect {
  key: string;
  name: string;
  niche: string;
  category?: string;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
  website?: string;
  mapsUrl?: string;
  lat?: number;
  lon?: number;
  rating?: number;
  reviewCount?: number;
  openNow?: boolean;
  source: LeadSource;
  sourceId?: string;
  /** Every source that listed it, e.g. ["OpenStreetMap", "City of Edmonton business licences"]. */
  foundIn?: string[];
  /** The website wasn't listed; Rainmaker's crawler found it. */
  websiteFound?: boolean;
  score?: number;
  signals?: Signal[];
  audit?: AuditResult;
  savedLeadId?: string;
}

export type Channel = "email" | "sms" | "dm" | "call";

export interface Draft {
  id: string;
  leadId?: string;
  leadName?: string;
  channel: Channel;
  to?: string;
  subject?: string;
  body: string;
  /** Why this message, in one line (shown to you, not sent). */
  rationale?: string;
  status: "pending" | "sent" | "discarded";
  createdBy: string;
  runId?: string;
  createdAt: string;
  sentAt?: string;
  sentVia?: "resend" | "manual";
  error?: string;
  sample?: boolean;
}

export interface AdAngle {
  name: string;
  hook: string;
  why: string;
}

export interface MetaAd {
  angle: string;
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
  creativeIdea: string;
}

export interface VideoScript {
  title: string;
  hook: string;
  script: string;
  shots: string[];
}

export interface Creative {
  headline: string;
  subline: string;
  badge: string;
  cta: string;
  palette: { bg: string; fg: string; accent: string };
  /** Prompt for custom background art (no text in the image; the card adds it). */
  artPrompt?: string;
}

export type ArtSize = "square" | "story" | "landscape";

/** Custom ad art made with the ElevenLabs Image & Video API and stored as an asset. */
export interface ArtAsset {
  assetId: string;
  prompt: string;
  model: string;
  createdAt: string;
}

/** An audio ad or voiceover made with ElevenLabs text to speech. */
export interface Voiceover {
  id: string;
  assetId: string;
  voiceId: string;
  voiceName?: string;
  text: string;
  createdAt: string;
}

export interface AdCampaign {
  id: string;
  leadId?: string;
  businessName: string;
  niche?: string;
  location?: string;
  goal: string;
  offer?: string;
  website?: string;
  createdAt: string;
  createdBy: string;
  sample?: boolean;
  strategy: {
    summary: string;
    audience: string;
    angles: AdAngle[];
    budget: string;
    kpis: string[];
  };
  meta: MetaAd[];
  google: {
    headlines: string[];
    descriptions: string[];
    keywords: string[];
    negativeKeywords: string[];
  };
  video: VideoScript[];
  landing: {
    headline: string;
    subheadline: string;
    bullets: string[];
    cta: string;
  };
  creative: Creative;
  /** A 20-30 second audio ad (radio, streaming, on-hold), spoken words only. */
  audio?: { title: string; script: string };
  art?: Partial<Record<ArtSize, ArtAsset>>;
  voiceovers?: Voiceover[];
}

export interface Task {
  id: string;
  title: string;
  leadId?: string;
  due?: string;
  done: boolean;
  createdBy: string;
  createdAt: string;
}

export interface AgencyProfile {
  agencyName: string;
  ownerName: string;
  email: string;
  phone: string;
  website: string;
  city: string;
  services: string[];
  coreOffer: string;
  pricing: string;
  calendarUrl: string;
  voice: string;
  targetNiches: string[];
  proof: string;
  /** Postal address for the email footer (US CAN-SPAM requires one). */
  mailingAddress: string;
}

export type RunStatus = "running" | "waiting" | "done" | "error" | "stopped";

export type RunEventKind = "status" | "thinking" | "message" | "tool_call" | "tool_result" | "error" | "user";

export interface RunEvent {
  id: string;
  at: string;
  kind: RunEventKind;
  text?: string;
  tool?: string;
  input?: unknown;
  ok?: boolean;
}

export interface AgentRun {
  id: string;
  agentId: string;
  goal: string;
  status: RunStatus;
  runtime: "managed" | "messages" | "demo";
  sessionId?: string;
  startedAt: string;
  endedAt?: string;
  events: RunEvent[];
  summary?: string;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number };
}

export interface Activity {
  id: string;
  at: string;
  text: string;
  kind: "lead" | "draft" | "ad" | "agent" | "stage" | "task" | "system";
  leadId?: string;
  agentId?: string;
}

// ── Store, orders and payments ────────────────────────────────

export type BillingInterval = "month" | "year";
export type PaymentProvider = "stripe" | "paypal" | "manual";
export type OrderStatus = "pending" | "active" | "past_due" | "canceled";

export interface OrderPayment {
  at: string;
  /** Dollars. */
  amount: number;
  ref?: string;
}

export interface FulfillmentStep {
  id: string;
  label: string;
  status: "todo" | "done" | "error" | "skipped";
  detail?: string;
  at?: string;
}

export interface Order {
  id: string;
  provider: PaymentProvider;
  /** A plan or product id from the catalog. */
  offerId: string;
  offerName: string;
  interval: BillingInterval;
  /** Recurring price per interval, in dollars. */
  amount: number;
  setupFee: number;
  currency: string;
  status: OrderStatus;
  email?: string;
  name?: string;
  business?: string;
  phone?: string;
  website?: string;
  notes?: string;
  /** Stripe checkout session id or PayPal subscription id. */
  providerRef?: string;
  subscriptionId?: string;
  customerId?: string;
  leadId?: string;
  payments: OrderPayment[];
  fulfillment?: { status: "queued" | "running" | "done" | "error"; steps: FulfillmentStep[]; updatedAt: string };
  createdAt: string;
  updatedAt: string;
  activatedAt?: string;
  canceledAt?: string;
  /** When autopilot drafted an "abandoned checkout" nudge. */
  nudgedAt?: string;
}

/** Owner overrides for one catalog offer. */
export interface PriceOverride {
  monthly?: number;
  setup?: number;
  hidden?: boolean;
}

export type StoreCurrency = "usd" | "cad" | "gbp" | "eur" | "aud";

export interface StoreSettings {
  /** Public storefront switched on. */
  enabled: boolean;
  /** Prices on the store are in this currency (Stripe and PayPal charge in it). */
  currency: StoreCurrency;
  headline: string;
  subheadline: string;
  /** Name the AI sales assistant introduces itself with. */
  assistantName: string;
  /** Mention that products are built on ElevenLabs technology (plain text, no logos). */
  showEngine: boolean;
  /** Offer annual billing (10 months' price for 12). */
  annual: boolean;
  /** Waive setup fees when paying yearly. */
  waiveSetupOnAnnual: boolean;
  /** Extra minutes beyond what a plan includes, $ per minute (shown on the store). */
  overagePerMinute: number;
  prices: Record<string, PriceOverride>;
  /** The sales assistant Rainmaker created or synced in ElevenLabs. */
  salesAgent?: { agentId: string; toolIds: Record<string, string>; syncedAt: string };
}

export interface PaymentsState {
  stripe: { webhookId?: string; webhookSecret?: string; webhookUrl?: string };
  paypal: { webhookId?: string; webhookUrl?: string; products: Record<string, string>; plans: Record<string, string> };
  /** Webhook event ids already handled (providers retry deliveries). */
  seenEvents: string[];
}

// ── Autopilot ─────────────────────────────────────────────────

export interface AutopilotConfig {
  enabled: boolean;
  /** Cities to prospect, in rotation, e.g. "Mississauga, ON". */
  cities: string[];
  /** Niche ids to prospect, in rotation. Empty = the agency's target niches. */
  niches: string[];
  /** New businesses to look at per run. */
  leadsPerRun: number;
  /** Only save businesses scoring at least this. */
  minScore: number;
  /** Personalized work (outreach, demo, ads) for at most this many new leads per run. */
  personalizePerRun: number;
  draftOutreach: boolean;
  buildDemos: boolean;
  buildAds: boolean;
  makeArt: boolean;
  followUps: boolean;
  /** Send approved-quality emails without waiting for a human (email only, never texts or calls). */
  autoSend: boolean;
  dailySendCap: number;
  fulfillOrders: boolean;
  /** Email the owner a summary after each run. */
  emailSummary: boolean;
}

export interface AutopilotLogLine {
  kind: "prospect" | "outreach" | "demo" | "ads" | "art" | "followup" | "fulfill" | "send" | "info" | "error";
  text: string;
  leadId?: string;
  orderId?: string;
}

export interface AutopilotRun {
  id: string;
  trigger: "cron" | "manual";
  startedAt: string;
  endedAt?: string;
  status: "running" | "done" | "error";
  lines: AutopilotLogLine[];
  counts: { found: number; saved: number; drafted: number; demos: number; ads: number; sent: number; fulfilled: number };
}

export interface AutopilotState {
  config: AutopilotConfig;
  /** Position in the niche × city rotation. */
  cursor: number;
  /** A run holds this until it finishes, so two runs never overlap. */
  lockUntil?: string;
  sent: { day: string; count: number };
  runs: AutopilotRun[];
}

export interface ManagedAgentRecord {
  id: string;
  version: number;
  hash: string;
}

export interface Db {
  version: 1;
  profile: AgencyProfile;
  leads: Lead[];
  drafts: Draft[];
  campaigns: AdCampaign[];
  tasks: Task[];
  runs: AgentRun[];
  activity: Activity[];
  managed: {
    environmentId?: string;
    agents: Record<string, ManagedAgentRecord>;
  };
  /** Run ids someone asked to stop (works across server instances). */
  stopRequests?: string[];
  orders: Order[];
  store: StoreSettings;
  payments: PaymentsState;
  autopilot: AutopilotState;
  /** The CRM copilot's ElevenLabs agent, once synced from this app; hash is the spec it was synced from. */
  copilot?: { agentId: string; toolIds: Record<string, string>; syncedAt: string; hash?: string };
  /** Video ads made for leads. */
  videos?: VideoAd[];
  /** When the owner last talked to the copilot, for its "since your last visit" greeting. */
  copilotSeen?: { lastSessionAt: string; briefSince?: string };
  seeded: boolean;
}
