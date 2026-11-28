import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Settings } from "./types.ts";

// Environment, paths and default settings. Everything optional degrades
// gracefully: with no keys at all Mainstreet runs in demo mode on fictional
// businesses and never sends anything.

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const f of [".env.local", ".env"]) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) {
    try {
      process.loadEnvFile(p);
    } catch (err) {
      console.warn(`[mainstreet] couldn't read ${f}: ${(err as Error).message}`);
    }
  }
}

const env = (k: string): string | undefined => {
  const v = process.env[k]?.trim();
  return v ? v : undefined;
};

export const DATA_DIR = path.resolve(ROOT, env("DATA_DIR") ?? "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

export const PORT = Number(env("PORT") ?? 8787);
export const HOST = env("HOST") ?? "127.0.0.1";
/** Your public https address. Proposal links, webhooks and Atlas's phone tools need it. */
export const PUBLIC_URL = env("PUBLIC_URL")?.replace(/\/+$/, "");
export const APP_PASSWORD = env("APP_PASSWORD");
export const FORCE_DEMO = env("DEMO") === "1" || env("DEMO") === "true";
export const LOOP_SECONDS = Math.max(5, Number(env("LOOP_SECONDS") ?? 20));

export const keys = {
  anthropic: env("ANTHROPIC_API_KEY"),
  google: env("GOOGLE_PLACES_API_KEY"),
  eleven: env("ELEVENLABS_API_KEY"),
  resend: env("RESEND_API_KEY"),
  stripe: env("STRIPE_SECRET_KEY"),
  stripeWebhook: env("STRIPE_WEBHOOK_SECRET"),
  inbound: env("INBOUND_SECRET"),
  mcp: env("MCP_TOKEN"),
  voiceTools: env("VOICE_TOOL_SECRET"),
  voicePin: env("OWNER_VOICE_PIN"),
};

export const CLAUDE_MODEL = env("CLAUDE_MODEL") ?? "claude-opus-5-5";
export const MAIL_FROM = env("MAIL_FROM"); // "Craig at Mainstreet <craig@yourdomain.com>"

export const eleven = {
  api: env("ELEVENLABS_API_BASE") ?? "https://api.elevenlabs.io",
  agentId: env("ELEVENLABS_AGENT_ID"),
  /** Atlas's LLM inside ElevenLabs: fast enough for live voice and strong at tools. */
  agentLlm: env("ELEVENLABS_AGENT_LLM") ?? "claude-sonnet-5-5",
  agentVoice: env("ELEVENLABS_AGENT_VOICE_ID") ?? "cjVigY5qzO86Huf0OWal",
  agentTtsModel: env("ELEVENLABS_AGENT_TTS_MODEL") ?? "eleven_v4_turbo",
  /** The Filmer's narrator. "Eric – smooth, trustworthy" is a premade voice every workspace has. */
  voiceoverVoice: env("ELEVENLABS_VOICE_ID") ?? "cjVigY5qzO86Huf0OWal",
  ttsModel: env("ELEVENLABS_TTS_MODEL") ?? "eleven_v4",
  imageModel: env("ELEVENLABS_IMAGE_MODEL") ?? "gpt-image-2",
  /** An imported phone number Atlas can call you from (Phone Numbers in ElevenLabs). */
  phoneNumberId: env("ELEVENLABS_PHONE_NUMBER_ID"),
};

/** Phone numbers allowed to run Atlas's tools on a phone call (E.164, comma separated). */
export const OWNER_PHONES = (env("OWNER_PHONES") ?? "")
  .split(",")
  .map((s) => s.replace(/[^\d+]/g, ""))
  .filter(Boolean);

export const features = {
  claude: Boolean(keys.anthropic) && !FORCE_DEMO,
  places: Boolean(keys.google) && !FORCE_DEMO,
  eleven: Boolean(keys.eleven),
  resend: Boolean(keys.resend && MAIL_FROM) && !FORCE_DEMO,
  stripe: Boolean(keys.stripe) && !FORCE_DEMO,
};

/** Demo mode: the businesses are fictional and nothing is sent. */
export const DEMO = FORCE_DEMO || !features.places;

export function publicBase(): string {
  return PUBLIC_URL ?? `http://localhost:${PORT}`;
}

/** Links that go to prospects only work from a public https address. */
export function hasPublicUrl(): boolean {
  return Boolean(PUBLIC_URL && /^https:\/\//i.test(PUBLIC_URL) && !/localhost|127\.0\.0\.1/.test(PUBLIC_URL));
}

export const DEFAULT_SETTINGS: Settings = {
  owner: {
    name: env("OWNER_NAME") ?? "",
    agencyName: env("AGENCY_NAME") ?? "Mainstreet Studio",
    email: env("OWNER_EMAIL") ?? "",
    replyTo: env("REPLY_TO"),
    phone: env("OWNER_PHONE"),
    postalAddress: env("POSTAL_ADDRESS") ?? "",
    bookingUrl: env("BOOKING_URL"),
    timezone: env("TZ") ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "America/Toronto",
  },
  offer: {
    priceCents: 50_000,
    currency: "USD",
    hostingMonthlyCents: 0,
    deliveryDays: 3,
    guarantee: "If you don't love it, you don't pay.",
  },
  targets: {
    cities: [
      { city: "Bend", region: "OR", country: "US" },
      { city: "Boise", region: "ID", country: "US" },
      { city: "Fort Collins", region: "CO", country: "US" },
      { city: "Chattanooga", region: "TN", country: "US" },
      { city: "Kingston", region: "ON", country: "CA" },
    ],
    niches: ["dentist", "roofer", "plumber", "hvac", "landscaper", "auto_repair", "salon", "chiropractor"],
  },
  quotas: { scanPerDay: 220, leadsPerDay: 30, pitchesPerDay: 30 },
  pitching: {
    mode: "review",
    channels: { email: true, call: true, sms: true, dm: true },
    sendWindow: { startHour: 9, endHour: 16, weekdaysOnly: true },
    followupDays: [3, 7],
    warmup: true,
    autoReply: false,
  },
  escalation: {
    dealOverCents: 300_000,
    minResponseRate: 0.12,
    minSample: 40,
    pauseOnLowResponse: false,
    callOwner: false,
    ntfyTopic: env("NTFY_TOPIC"),
  },
  budget: { dailyUsd: 15, monthlyUsd: 300, perLeadMaxUsd: 1.5 },
  media: { heroImages: true, video: true },
  qualify: { minScore: 55, minReviews: 3, skipChains: true },
  crew: { paused: false, pausedAgents: [] },
};

/** Rough unit prices the Checker uses to estimate spend before each paid call. Override with PRICE_* env vars. */
export const PRICES = {
  // Claude, USD per million tokens
  claude: {
    "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2 },
    "claude-opus-5": { in: 5, out: 25, cacheRead: 0.5 },
    "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.1 },
    "claude-haiku-5-5": { in: 0.1, out: 0.5, cacheRead: 0.01 },
  } as Record<string, { in: number; out: number; cacheRead: number }>,
  googleTextSearch: Number(env("PRICE_GOOGLE_SEARCH") ?? 0.035), // per request (Enterprise fields)
  googleDetails: Number(env("PRICE_GOOGLE_DETAILS") ?? 0.025), // per Place Details call with reviews
  elevenPerChar: Number(env("PRICE_ELEVEN_CHAR") ?? 0.0002), // TTS, USD per character
  elevenImage: Number(env("PRICE_ELEVEN_IMAGE") ?? 0.06), // per hero image
  resendEmail: Number(env("PRICE_RESEND_EMAIL") ?? 0.0004),
};
