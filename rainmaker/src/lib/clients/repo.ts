import "server-only";
import { randomBytes } from "node:crypto";
import { addActivity } from "@/lib/repo";
import { countryByCode, type Lang } from "@/lib/markets";
import { getNiche } from "@/lib/niches";
import { normalizeUrl } from "@/lib/net";
import { toE164 } from "@/lib/phone";
import { formatPlace, marketOf, parsePlace } from "@/lib/regions";
import { newId, readDb, update } from "@/lib/store";
import type { AuditResult, Client, ClientSettings, Db, Lead, ServiceId, ServiceState, ServiceStatus } from "@/lib/types";
import { deleteClientData } from "./data-store";
import { localJobValue, quote } from "./pricing";
import { quietHoursFor, sendDaysFor } from "./rules";
import { SERVICE_IDS } from "./services";
import { textBackTemplate } from "./templates";

// Client workspaces: one per business the agency delivers the seven services
// to. The workspace (settings, website, service status) lives in the main
// document; customers and messages live in the client's own document.

const now = () => new Date().toISOString();
const token = (bytes: number) => randomBytes(bytes).toString("base64url");

function shortRef(taken: Set<string>): string {
  for (;;) {
    const r = randomBytes(5).readUIntBE(0, 5).toString(36).slice(0, 6).padStart(6, "0");
    if (!taken.has(r)) return r;
  }
}

export function defaultSettings(lang: Lang, country: string, booking: boolean): ClientSettings {
  const qh = quietHoursFor(country);
  return {
    callFlow: "forwarded",
    ringSeconds: 20,
    textBack: true,
    textBackMessage: textBackTemplate(lang),
    aiReplies: true,
    autoSend: false,
    dailyCap: 150,
    quietStart: qh.start,
    quietEnd: qh.end,
    sendDays: sendDaysFor(country),
    reviewDelayHours: 2,
    referralOffer: "",
    reactivationOffer: "",
    nurtureGoal: booking ? "Book an appointment" : "Book a visit or a free estimate",
    whatsapp: Boolean(countryByCode(country)?.whatsappFirst),
  };
}

const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const text = (v: unknown, max: number, d: string) => (typeof v === "string" ? v.trim().slice(0, max) : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

export function sanitizeSettings(patch: Partial<ClientSettings>, base: ClientSettings): ClientSettings {
  return {
    callFlow: patch.callFlow === "ring_first" || patch.callFlow === "forwarded" ? patch.callFlow : base.callFlow,
    ringSeconds: clamp(patch.ringSeconds, 5, 60, base.ringSeconds),
    textBack: bool(patch.textBack, base.textBack),
    textBackMessage: text(patch.textBackMessage, 480, base.textBackMessage) || base.textBackMessage,
    aiReplies: bool(patch.aiReplies, base.aiReplies),
    autoSend: bool(patch.autoSend, base.autoSend),
    dailyCap: clamp(patch.dailyCap, 1, 2000, base.dailyCap),
    quietStart: clamp(patch.quietStart, 0, 23, base.quietStart),
    quietEnd: clamp(patch.quietEnd, 0, 24, base.quietEnd),
    sendDays: patch.sendDays === "every" || patch.sendDays === "mon_sat" || patch.sendDays === "weekdays" ? patch.sendDays : (base.sendDays ?? "every"),
    reviewDelayHours: clamp(patch.reviewDelayHours, 0, 168, base.reviewDelayHours),
    referralOffer: text(patch.referralOffer, 120, base.referralOffer),
    reactivationOffer: text(patch.reactivationOffer, 160, base.reactivationOffer),
    nurtureGoal: text(patch.nurtureGoal, 120, base.nurtureGoal) || base.nurtureGoal,
    whatsapp: bool(patch.whatsapp, base.whatsapp),
  };
}

/**
 * A lead's place as "City, XX" when it can be worked out: their city alone
 * often lacks the province, but the address usually has it.
 */
export function placeForLead(lead: Pick<Lead, "city" | "address">, fallback = ""): string {
  const city = lead.city?.trim();
  if (city && parsePlace(city).region) return city;
  const parts = (lead.address ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const town = city || parts[parts.length - 3] || parts[0];
  if (town) {
    for (const p of parts) {
      const words = p.replace(/\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b|\b\d{5}(-\d{4})?\b/gi, "").trim();
      if (!words) continue;
      const parsed = parsePlace(`${town}, ${words}`);
      if (parsed.region) return formatPlace(parsed.city, parsed.region);
    }
  }
  return city || fallback;
}

export interface NewClient {
  name: string;
  niche?: string;
  place?: string;
  leadId?: string;
  orderId?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  audit?: AuditResult;
  /** Which of the seven they're paying for (default: all). */
  services?: ServiceId[];
  monthly?: number;
  setup?: number;
  sample?: boolean;
}

function buildClient(db: Db, input: NewClient): Client {
  const market = marketOf(input.place || db.profile.city || "", "US");
  const country = market.country.code;
  const niche = getNiche(input.niche);
  const included = new Set(input.services?.length ? input.services : SERVICE_IDS);
  const q = quote(country, [...included]);
  const services = Object.fromEntries(SERVICE_IDS.map((id) => [id, { status: "off", included: included.has(id) } satisfies ServiceState])) as Record<ServiceId, ServiceState>;
  const t = now();
  const phone = input.phone ? (toE164(input.phone, country) ?? input.phone) : undefined;
  return {
    id: newId("cli"),
    ref: shortRef(new Set(db.clients.map((c) => c.ref))),
    name: input.name.trim().slice(0, 120),
    niche: niche?.id ?? input.niche ?? "custom",
    status: "onboarding",
    leadId: input.leadId,
    orderId: input.orderId,
    contactName: input.contactName,
    email: input.email?.toLowerCase(),
    phone,
    staffPhone: phone && /^\+/.test(phone) ? phone : undefined,
    website: normalizeUrl(input.website),
    address: input.address,
    place: input.place || db.profile.city || "",
    country,
    lang: market.lang,
    timezone: market.timezone,
    currency: q.currency,
    jobValue: localJobValue(niche?.customerValue, country),
    monthly: input.monthly ?? q.monthly,
    setup: input.setup ?? q.setup,
    services,
    settings: defaultSettings(market.lang, country, niche?.booking ?? true),
    audit: input.audit,
    campaignIds: [],
    adMonths: [],
    intakeKey: token(18),
    reportToken: token(12),
    sample: input.sample,
    createdAt: t,
    updatedAt: t,
  };
}

export async function listClients(): Promise<Client[]> {
  return (await readDb()).clients;
}

export async function getClient(id: string): Promise<Client | undefined> {
  return (await readDb()).clients.find((c) => c.id === id);
}

export async function createClient(input: NewClient, actor = "user"): Promise<Client> {
  if (!input.name?.trim()) throw new Error("A business name is needed");
  const client = await update((db) => {
    if (input.leadId) {
      const existing = db.clients.find((c) => c.leadId === input.leadId);
      if (existing) return structuredClone(existing);
    }
    const c = buildClient(db, input);
    db.clients.unshift(c);
    const lead = input.leadId ? db.leads.find((l) => l.id === input.leadId) : undefined;
    if (lead) {
      lead.clientId = c.id;
      if (lead.stage !== "won") lead.stage = "won";
      lead.value = Math.round(c.monthly);
      lead.nextStep = "Onboarding: deploy the seven services in order";
      lead.updatedAt = now();
    }
    return structuredClone(c);
  });
  await addActivity({ kind: "system", text: `${actor.startsWith("agent:") || actor === "store" ? "A new client signed" : "You added a client"}: ${client.name}. Start with step 1, the website.`, leadId: client.leadId });
  return client;
}

/** The client workspace for a lead in the pipeline (made once; later calls return it). */
export async function clientFromLead(leadId: string, extra: Partial<NewClient> = {}): Promise<Client> {
  const db = await readDb();
  const lead = db.leads.find((l) => l.id === leadId);
  if (!lead) throw new Error("Lead not found");
  const existing = db.clients.find((c) => c.leadId === leadId || c.id === lead.clientId);
  if (existing) return existing;
  return createClient({
    name: lead.name,
    niche: lead.niche,
    place: placeForLead(lead, db.profile.city),
    leadId,
    contactName: lead.contactName,
    email: lead.email,
    phone: lead.phone,
    website: lead.website,
    address: lead.address,
    audit: lead.audit,
    services: lead.proposal?.services,
    monthly: lead.proposal?.monthly,
    setup: lead.proposal?.setup,
    sample: lead.sample,
    ...extra,
  });
}

/** Fields the owner can edit from the workspace. */
export type ClientPatch = Partial<Pick<Client, "name" | "niche" | "contactName" | "email" | "phone" | "staffPhone" | "website" | "address" | "place" | "lang" | "timezone" | "currency" | "jobValue" | "monthly" | "setup" | "bookingUrl" | "reviewUrl" | "smsNumber" | "whatsappNumber" | "agentId" | "status" | "notes">> & { settings?: Partial<ClientSettings> };

const STATUSES: Client["status"][] = ["onboarding", "active", "paused", "ended"];

export function applyPatch(c: Client, patch: ClientPatch): void {
  const s = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);
  if (patch.place !== undefined && s(patch.place) !== c.place) {
    // A new place moves the market: country, language, time zone and quiet hours follow it.
    const m = marketOf(s(patch.place) ?? "", c.country);
    c.place = s(patch.place) ?? "";
    if (m.country.code !== c.country) {
      c.country = m.country.code;
      c.currency = m.currency;
      const qh = quietHoursFor(c.country);
      c.settings.quietStart = qh.start;
      c.settings.quietEnd = qh.end;
      c.settings.sendDays = sendDaysFor(c.country);
    }
    c.lang = m.lang;
    c.timezone = m.timezone;
  }
  if (patch.name !== undefined) c.name = s(patch.name, 120) || c.name;
  if (patch.niche !== undefined) c.niche = s(patch.niche, 60) || c.niche;
  for (const k of ["contactName", "address", "notes"] as const) if (patch[k] !== undefined) c[k] = s(patch[k], k === "notes" ? 4000 : 200) || undefined;
  if (patch.email !== undefined) c.email = s(patch.email)?.toLowerCase() || undefined;
  for (const k of ["phone", "staffPhone", "smsNumber", "whatsappNumber"] as const) {
    if (patch[k] === undefined) continue;
    const raw = s(patch[k], 40);
    const e164 = raw ? toE164(raw, c.country) : undefined;
    if (raw && !e164 && k !== "phone") throw new Error(`${k === "staffPhone" ? "The staff phone" : k === "smsNumber" ? "The texting number" : "The WhatsApp number"} doesn't look like a full phone number. Include the area code.`);
    c[k] = e164 ?? raw;
  }
  for (const k of ["website", "bookingUrl", "reviewUrl"] as const) {
    if (patch[k] === undefined) continue;
    const raw = s(patch[k], 500);
    const url = normalizeUrl(raw);
    if (raw && !url) throw new Error(`That ${k === "reviewUrl" ? "review link" : k === "bookingUrl" ? "booking link" : "website"} isn't a valid web address.`);
    c[k] = url;
  }
  if (patch.lang && ["en", "es", "fr", "nl", "da"].includes(patch.lang)) c.lang = patch.lang;
  if (patch.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: patch.timezone });
      c.timezone = patch.timezone;
    } catch {
      throw new Error("Unknown time zone");
    }
  }
  if (patch.currency && /^[a-z]{3}$/i.test(patch.currency)) c.currency = patch.currency.toLowerCase();
  for (const k of ["jobValue", "monthly", "setup"] as const) {
    if (patch[k] === undefined) continue;
    const n = Number(patch[k]);
    if (Number.isFinite(n) && n >= 0) c[k] = Math.round(n * 100) / 100;
  }
  if (patch.agentId !== undefined) c.agentId = s(patch.agentId, 80) || undefined;
  if (patch.status && STATUSES.includes(patch.status)) c.status = patch.status;
  if (patch.settings) c.settings = sanitizeSettings(patch.settings, c.settings);
}

export async function updateClient(id: string, patch: ClientPatch): Promise<Client> {
  return update((db) => {
    const c = db.clients.find((x) => x.id === id);
    if (!c) throw new Error("Client not found");
    applyPatch(c, patch);
    c.updatedAt = now();
    return structuredClone(c);
  });
}

/** Change a client in place. fn may run more than once (on a conflict), so keep it to edits. */
export async function patchClient(id: string, fn: (c: Client, db: Db) => void): Promise<Client> {
  return update((db) => {
    const c = db.clients.find((x) => x.id === id);
    if (!c) throw new Error("Client not found");
    fn(c, db);
    c.updatedAt = now();
    return structuredClone(c);
  });
}

const STATUS_ORDER: ServiceStatus[] = ["off", "setup", "live", "paused"];

export async function setServiceStatus(id: string, service: ServiceId, status: ServiceStatus): Promise<Client> {
  if (!SERVICE_IDS.includes(service) || !STATUS_ORDER.includes(status)) throw new Error("Unknown service or status");
  const c = await patchClient(id, (c) => {
    const s = c.services[service];
    if (s.status === status) return;
    s.status = status;
    s.included = true;
    s.since = now();
    if (status === "live" && c.status === "onboarding") c.status = "active";
  });
  if (status === "live") await addActivity({ kind: "system", text: `${c.name}: ${service.replace(/_/g, " ")} is live` });
  return c;
}

export async function deleteClient(id: string): Promise<void> {
  await update((db) => {
    db.clients = db.clients.filter((c) => c.id !== id);
    for (const l of db.leads) if (l.clientId === id) delete l.clientId;
  });
  await deleteClientData(id).catch(() => undefined);
}

// ── Lookups for public routes and webhooks ────────────────────

export async function clientBySlug(slug: string): Promise<Client | undefined> {
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) return undefined;
  return (await readDb()).clients.find((c) => c.site?.slug === slug);
}

export async function clientByRef(ref: string): Promise<Client | undefined> {
  if (!/^[a-z0-9]{6}$/.test(ref)) return undefined;
  return (await readDb()).clients.find((c) => c.ref === ref);
}

export async function clientByReportToken(t: string): Promise<Client | undefined> {
  if (!/^[A-Za-z0-9_-]{12,40}$/.test(t)) return undefined;
  return (await readDb()).clients.find((c) => c.reportToken === t);
}

/** The client a Twilio number (or WhatsApp sender) belongs to. */
export async function clientByNumber(e164: string): Promise<Client | undefined> {
  const n = e164.replace(/^whatsapp:/, "");
  return (await readDb()).clients.find((c) => c.smsNumber === n || c.whatsappNumber === n);
}

/** "Lakeside Dental Care" → "lakeside-dental-care", unique among clients. */
export function slugFor(name: string, taken: Set<string>): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "site";
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  return slug;
}
