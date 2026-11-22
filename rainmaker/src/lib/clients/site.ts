import "server-only";
import { writeSite } from "@/lib/claude/clients";
import { describeError } from "@/lib/claude/client";
import { claudeEnabled } from "@/lib/config";
import { getNiche } from "@/lib/niches";
import { safeFetchText } from "@/lib/net";
import { displayPhone } from "@/lib/phone";
import { pageText } from "@/lib/prospecting/crawl-parse";
import type { Client, SiteContent } from "@/lib/types";
import { getClient, patchClient, slugFor } from "./repo";
import type { SiteRender } from "./site-html";
import { templateSite } from "./templates";

// Step 1: the client's website. Written by Claude from what they tell us and
// what their current site says (or from the template without Claude), hosted
// at /s/<slug>, every form going straight into instant follow-up.

async function currentSiteText(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const r = await safeFetchText(url, { timeoutMs: 9000, maxBytes: 800_000 });
    if (r.status >= 400) return undefined;
    const text = pageText(r.body);
    return text.length > 80 ? text.slice(0, 7000) : undefined;
  } catch {
    return undefined;
  }
}

export interface SiteBriefInput {
  services?: string;
  offer?: string;
  notes?: string;
}

/** Write (or rewrite) the client's site. Real testimonials and hours they gave are kept. */
export async function buildSite(clientId: string, input: SiteBriefInput = {}): Promise<{ client: Client; by: "ai" | "template"; note?: string }> {
  const client = await getClient(clientId);
  if (!client) throw new Error("Client not found");
  const niche = getNiche(client.niche);
  const brandColor = client.site?.content.colors.primary ?? client.audit?.brandColors?.[0];
  const base = templateSite(
    { business: client.name, niche, city: client.place, phone: client.phone, address: client.address, description: client.audit?.description, brandColor, bookingUrl: client.bookingUrl },
    client.lang
  );
  let content: SiteContent = base;
  let by: "ai" | "template" = "template";
  let note: string | undefined;
  if (claudeEnabled()) {
    try {
      const written = await writeSite({ client, pageText: await currentSiteText(client.website), ...input });
      content = { ...base, ...written, lang: client.lang };
      by = "ai";
    } catch (err) {
      note = `Used the template: ${describeError(err)}`;
    }
  } else {
    note = "Written from the template. Add ANTHROPIC_API_KEY to have Claude write it from their business and current website.";
    if (input.offer) content.offer = input.offer.slice(0, 60);
  }
  const prev = client.site?.content;
  if (prev) {
    content.testimonials = prev.testimonials;
    content.hours = prev.hours;
    content.colors = prev.colors;
  }
  const saved = await patchClient(clientId, (c, db) => {
    const slug = c.site?.slug ?? slugFor(c.name, new Set(db.clients.map((x) => x.site?.slug).filter((s): s is string => Boolean(s))));
    c.site = { slug, published: c.site?.published ?? false, content, createdBy: by, updatedAt: new Date().toISOString(), publishedAt: c.site?.publishedAt };
    if (c.services.website.status === "off") c.services.website = { ...c.services.website, status: "setup", since: new Date().toISOString() };
  });
  return { client: saved, by, note };
}

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const HEX = /^#[0-9a-f]{6}$/i;

function items(v: unknown, max = 12): { title: string; text: string }[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .map((x) => ({ title: clip((x as { title?: unknown })?.title, 80), text: clip((x as { text?: unknown })?.text, 400) }))
    .filter((x) => x.title)
    .slice(0, max);
}

/** Owner edits to the site's words, colours, hours and real testimonials. */
export function cleanSiteContent(patch: Partial<SiteContent>, prev: SiteContent): SiteContent {
  const next: SiteContent = { ...prev };
  for (const k of ["headline", "subheadline", "cta", "offer", "about", "serviceArea", "formTitle", "formButton", "seoTitle", "seoDescription"] as const) {
    if (patch[k] === undefined) continue;
    const max = k === "about" ? 900 : k === "seoDescription" ? 170 : k === "subheadline" ? 240 : 120;
    next[k] = clip(patch[k], max);
  }
  if (!next.headline) next.headline = prev.headline;
  if (!next.cta) next.cta = prev.cta;
  for (const k of ["services", "benefits", "steps"] as const) {
    const v = items(patch[k]);
    if (v) next[k] = v;
  }
  if (Array.isArray(patch.faqs)) {
    next.faqs = patch.faqs.map((f) => ({ q: clip(f?.q, 160), a: clip(f?.a, 600) })).filter((f) => f.q && f.a).slice(0, 10);
  }
  if (Array.isArray(patch.testimonials)) {
    next.testimonials = patch.testimonials.map((q) => ({ quote: clip(q?.quote, 500), author: clip(q?.author, 80) })).filter((q) => q.quote).slice(0, 8);
  }
  if (Array.isArray(patch.hours)) next.hours = patch.hours.map((h) => clip(h, 80)).filter(Boolean).slice(0, 10);
  if (patch.colors) {
    next.colors = {
      primary: HEX.test(patch.colors.primary ?? "") ? patch.colors.primary.toLowerCase() : prev.colors.primary,
      ink: HEX.test(patch.colors.ink ?? "") ? patch.colors.ink.toLowerCase() : prev.colors.ink,
      soft: HEX.test(patch.colors.soft ?? "") ? patch.colors.soft.toLowerCase() : prev.colors.soft,
    };
  }
  return next;
}

export async function saveSiteContent(clientId: string, patch: Partial<SiteContent>): Promise<Client> {
  return patchClient(clientId, (c) => {
    if (!c.site) throw new Error("Build the website first");
    c.site.content = cleanSiteContent(patch, c.site.content);
    c.site.createdBy = c.site.createdBy === "template" ? "template" : "user";
    c.site.updatedAt = new Date().toISOString();
  });
}

export async function publishSite(clientId: string, published: boolean): Promise<Client> {
  return patchClient(clientId, (c) => {
    if (!c.site) throw new Error("Build the website first");
    c.site.published = published;
    if (published) {
      c.site.publishedAt = new Date().toISOString();
      if (c.services.website.status !== "paused") c.services.website = { ...c.services.website, status: "live", included: true, since: new Date().toISOString() };
    } else if (c.services.website.status === "live") {
      c.services.website = { ...c.services.website, status: "setup", since: new Date().toISOString() };
    }
  });
}

/** Everything the page renderer needs for this client. */
export function siteRender(client: Client, base: string, opts: { sent?: boolean; error?: string; refCode?: string; utm?: Record<string, string>; credit?: string; preview?: boolean; absolute?: boolean } = {}): SiteRender {
  const slug = client.site!.slug;
  return {
    content: client.site!.content,
    business: client.name,
    phone: client.phone?.startsWith("+") ? client.phone : undefined,
    phoneLabel: client.phone ? displayPhone(client.phone) : undefined,
    email: client.email,
    address: client.address,
    formAction: opts.absolute ? `${base}/api/sites/${slug}/lead` : `/api/sites/${slug}/lead`,
    bookingUrl: client.bookingUrl,
    url: `${base}/s/${slug}`,
    socials: client.audit?.socials?.filter((s) => /^https?:\/\//.test(s)),
    refCode: opts.refCode,
    utm: opts.utm,
    sent: opts.sent,
    error: opts.error,
    credit: opts.credit,
    preview: opts.preview,
  };
}
