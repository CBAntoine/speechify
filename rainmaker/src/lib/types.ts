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

export type LeadSource = "google_places" | "openstreetmap" | "open_data" | "web" | "manual" | "agent" | "sample";

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
  seeded: boolean;
}
