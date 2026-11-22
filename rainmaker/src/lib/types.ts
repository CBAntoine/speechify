// Shared data model. Kept free of runtime imports so tests can load it with
// Node's type stripping.

import type { CountryCode, Lang } from "./markets.ts";

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
  /** Follow-up emails written with the first touch; autopilot drafts each when it's due. */
  sequence?: SequenceStep[];
  /** An outcome proposal sent to this prospect (/proposal/<token>). */
  proposal?: Proposal;
  /** The client workspace this lead became, once they signed. */
  clientId?: string;
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

export type StoreCurrency = "usd" | "cad" | "mxn" | "gbp" | "eur" | "aud";

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
  /** The CRM copilot's ElevenLabs agent, once synced from this app. */
  copilot?: { agentId: string; toolIds: Record<string, string>; syncedAt: string };
  /** Businesses the agency delivers the seven services to. */
  clients: Client[];
  /** The sales-practice partner agent (a customer to role-play with), once created. */
  practiceAgent?: { agentId: string; syncedAt: string };
  seeded: boolean;
}

// ── Clients: seven services, deployed in order ────────────────
// The agency sells outcomes (calls answered, past customers back, reviews,
// leads followed up in seconds) and delivers them with software. Each client
// has a workspace in the main document; their customers, messages and calls
// live in a separate per-client document (ClientData) so busy clients don't
// slow everything else down.

export type ServiceId = "website" | "reactivation" | "reviews" | "speed_to_lead" | "missed_calls" | "sales_coach" | "ads";

export type ServiceStatus = "off" | "setup" | "live" | "paused";

export interface ServiceState {
  /** off: nothing automated; setup: everything is drafted for checking; live: it runs; paused: stopped for now. */
  status: ServiceStatus;
  /** Part of what the client pays for. */
  included: boolean;
  /** When the status last changed. */
  since?: string;
}

export interface SiteItem {
  title: string;
  text: string;
}

/** Everything on a client's website, in their customers' language. */
export interface SiteContent {
  lang: Lang;
  headline: string;
  subheadline: string;
  /** Main button label, e.g. "Book a free estimate". */
  cta: string;
  /** A short offer badge, e.g. "Free estimates". Empty for none. */
  offer: string;
  about: string;
  services: SiteItem[];
  benefits: SiteItem[];
  steps: SiteItem[];
  faqs: { q: string; a: string }[];
  /** Only real reviews the business gave us. Never generated. */
  testimonials: { quote: string; author: string }[];
  hours: string[];
  serviceArea: string;
  formTitle: string;
  formButton: string;
  seoTitle: string;
  seoDescription: string;
  colors: { primary: string; ink: string; soft: string };
}

export interface ClientSite {
  /** Public address: /s/<slug>. */
  slug: string;
  published: boolean;
  content: SiteContent;
  createdBy: "ai" | "template" | "user";
  updatedAt: string;
  publishedAt?: string;
}

export interface ClientSettings {
  /** forwarded: the business forwards unanswered calls to our number. ring_first: our number rings their staff, then the AI. */
  callFlow: "forwarded" | "ring_first";
  /** Seconds staff phones ring before the AI picks up (ring_first). */
  ringSeconds: number;
  /** Text the caller when a call goes unanswered and the AI didn't take it. */
  textBack: boolean;
  textBackMessage: string;
  /** The AI answers incoming texts. Off: you answer them yourself. */
  aiReplies: boolean;
  /** Send automated messages without waiting for approval. Off: they wait in the client's Messages tab. */
  autoSend: boolean;
  /** Most automated messages sent per day (protects the number's reputation). */
  dailyCap: number;
  /** Local hours (24h) when automated messages may go out. */
  quietStart: number;
  quietEnd: number;
  /** Days automated messages may go out: US default skips Sundays; French territories weekdays only. */
  sendDays: "every" | "mon_sat" | "weekdays";
  /** Hours after a job is marked done before the review request goes out. */
  reviewDelayHours: number;
  referralOffer: string;
  reactivationOffer: string;
  /** What lead follow-up aims for, e.g. "Book a free estimate". */
  nurtureGoal: string;
  /** Text on WhatsApp instead of SMS when a WhatsApp sender is set. */
  whatsapp: boolean;
}

export interface AdMonth {
  /** YYYY-MM. */
  month: string;
  /** Ad spend, in the client's currency. */
  spend: number;
  leads: number;
  booked: number;
  revenue?: number;
  notes?: string;
}

export interface Client {
  id: string;
  /** Short random code used in the client's tracked links (/r/<ref>/...). */
  ref: string;
  name: string;
  niche: string;
  status: "onboarding" | "active" | "paused" | "ended";
  leadId?: string;
  orderId?: string;
  contactName?: string;
  /** The owner's email: where alerts and reports go. */
  email?: string;
  /** Their main business number. */
  phone?: string;
  /** Who gets hot-lead alerts and rings first on ring_first (E.164). */
  staffPhone?: string;
  /** Their existing website, if any. */
  website?: string;
  address?: string;
  /** "City, XX" place: decides country, language, currency and time zone. */
  place: string;
  country: CountryCode;
  lang: Lang;
  timezone: string;
  currency: string;
  /** What one booked customer or job is worth to them, in their currency. */
  jobValue: number;
  /** What they pay the agency each month and once, in their currency. */
  monthly: number;
  setup: number;
  bookingUrl?: string;
  /** Where customers leave a review (Google "Ask for reviews" link or similar). */
  reviewUrl?: string;
  /** The agency's Twilio number that texts and calls for this business (E.164). */
  smsNumber?: string;
  /** A WhatsApp sender on the agency's Twilio account (E.164). */
  whatsappNumber?: string;
  /** ElevenLabs agent that answers their calls. */
  agentId?: string;
  services: Record<ServiceId, ServiceState>;
  settings: ClientSettings;
  site?: ClientSite;
  audit?: AuditResult;
  /** Ad Studio campaigns made for them. */
  campaignIds: string[];
  adMonths: AdMonth[];
  /** Secret for the lead intake webhook. */
  intakeKey: string;
  /** Token for the public results report. */
  reportToken: string;
  notes?: string;
  sample?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ContactSource = "import" | "website" | "call" | "text" | "ad" | "referral" | "manual" | "webhook";

export type ContactStatus = "new" | "contacted" | "engaged" | "booked" | "lost" | "opted_out";

export interface Consent {
  /** Marketing email allowed. */
  email: boolean;
  /** Marketing texts allowed (they gave permission to be texted). */
  sms: boolean;
  /** form: filled in a form with the texting notice; customer: bought before; inquiry: asked a question; written: signed or typed permission. */
  basis: "form" | "customer" | "inquiry" | "written" | "none";
  at?: string;
}

export type SequenceKind = "nurture" | "reactivation" | "review" | "referral";

export interface Enrollment {
  seqId: string;
  kind: SequenceKind;
  startedAt: string;
  /** Index of the next step to send. */
  next: number;
  stoppedAt?: string;
  stop?: "replied" | "opted_out" | "booked" | "finished" | "manual" | "clicked" | "no_channel";
}

/** One of the client's customers or leads. */
export interface Contact {
  id: string;
  /** Short code for this contact's tracked links. */
  ref: string;
  name: string;
  /** E.164. */
  phone?: string;
  email?: string;
  lang?: Lang;
  source: ContactSource;
  status: ContactStatus;
  consent: Consent;
  /** What they asked about or bought. */
  interest?: string;
  /** What they wrote in the form. */
  message?: string;
  /** Last purchase or visit (for win-back). */
  lastVisit?: string;
  /** Job finished: the review request goes out after the delay. */
  jobDoneAt?: string;
  reviewClickedAt?: string;
  referralClicks?: number;
  /** Contact id of whoever referred them. */
  referredBy?: string;
  bookedAt?: string;
  /** What the booking was worth, when known. */
  value?: number;
  /** The AI handed this conversation to a person. */
  needsHuman?: boolean;
  optedOutAt?: string;
  enrollments: Enrollment[];
  utm?: { source?: string; medium?: string; campaign?: string };
  notes?: string;
  /** First message they got back (speed to lead). */
  firstReplyAt?: string;
  lastInboundAt?: string;
  lastOutboundAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type MsgChannel = "sms" | "whatsapp" | "email";

export type MsgPurpose = "nurture" | "reactivation" | "review" | "referral" | "missed_call" | "reply" | "manual" | "opt_out" | "alert";

export interface ClientMessage {
  id: string;
  contactId: string;
  channel: MsgChannel;
  direction: "out" | "in";
  purpose: MsgPurpose;
  subject?: string;
  body: string;
  by: "ai" | "template" | "staff" | "contact";
  /** draft: waiting for approval; sending: claimed by a sender. */
  status: "draft" | "sending" | "sent" | "failed" | "received";
  at: string;
  sentAt?: string;
  providerId?: string;
  error?: string;
  seqId?: string;
  step?: number;
}

export interface CallLog {
  id: string;
  /** Twilio CallSid. */
  sid?: string;
  from?: string;
  contactId?: string;
  at: string;
  /** answered: staff picked up; ai: the AI agent took it; missed: nobody did. */
  outcome: "answered" | "ai" | "missed";
  durationSec?: number;
  textedBack?: boolean;
  summary?: string;
}

export interface SequenceStepContent {
  /** Hours after the contact was enrolled. */
  delayHours: number;
  sms: string;
  subject: string;
  email: string;
}

export interface Sequence {
  id: string;
  kind: SequenceKind;
  name: string;
  status: "draft" | "running" | "paused";
  steps: SequenceStepContent[];
  createdBy: "ai" | "template" | "user";
  createdAt: string;
  updatedAt: string;
}

/** Numbers read straight off a sales conversation, no AI needed. */
export interface TranscriptMetrics {
  words: number;
  turns: number;
  /** Share of the words spoken by the rep, 0-100. */
  repShare: number;
  repQuestions: number;
  askedForBooking: boolean;
  mentionedPrice: boolean;
  nextStepSet: boolean;
  usedName: boolean;
  fillers: number;
}

export interface Scorecard {
  /** 0-100. */
  overall: number;
  /** One per skill, 1-5. */
  scores: { id: string; label: string; score: number; note: string }[];
  strengths: string[];
  fixes: { issue: string; instead: string }[];
  summary: string;
  by: "ai" | "rules";
}

export interface CallReview {
  id: string;
  rep: string;
  title: string;
  source: "transcript" | "recording" | "practice";
  transcript: string;
  metrics: TranscriptMetrics;
  scorecard: Scorecard;
  createdAt: string;
}

/** A client's customers, conversations, calls and coaching, stored apart from the main document. */
export interface ClientData {
  version: 1;
  clientId: string;
  contacts: Contact[];
  messages: ClientMessage[];
  calls: CallLog[];
  sequences: Sequence[];
  reviews: CallReview[];
  /** Per day (YYYY-MM-DD, client's time zone): automated messages sent and website visits. */
  daily: Record<string, { sent: number; views: number }>;
}

/** An outcome proposal for a prospect: their gaps, the services in order, and the price next to what staff would cost. */
export interface Proposal {
  token: string;
  createdAt: string;
  services: ServiceId[];
  place: string;
  lang: Lang;
  currency: string;
  /** Monthly total and one-time setup, in `currency`. */
  monthly: number;
  setup: number;
  /** What people doing the same work would cost per month, in `currency`. */
  humanMonthly: number;
  views?: number;
  viewedAt?: string;
  acceptedAt?: string;
}
