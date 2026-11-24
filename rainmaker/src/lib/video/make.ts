import "server-only";
import { randomBytes } from "node:crypto";
import { deleteAssets, putAsset } from "@/lib/assets";
import { getOffer, isVisible, OFFERS, priceOf, recommend, type Offer } from "@/lib/catalog";
import { describeError } from "@/lib/claude/client";
import { researchWeb } from "@/lib/claude/research";
import { writeVideoStory } from "@/lib/claude/video";
import { claudeEnabled, elevenEnabled } from "@/lib/config";
import { synthesizeTimed } from "@/lib/elevenlabs/tts";
import { getNiche } from "@/lib/niches";
import { domainOf, safeFetchBytes, safeFetchText } from "@/lib/net";
import { brandColor, inkOn } from "@/lib/offers/brand-color";
import { extractBrand, pageLinks, serviceNames, type Brand } from "@/lib/offers/site-kb-parse";
import { auditWebsite } from "@/lib/prospecting/audit";
import { robotsAllowed } from "@/lib/prospecting/crawler";
import { deriveSignals, scoreProspect } from "@/lib/prospecting/score";
import { addActivity, createDraft, getLead, getProfile, updateLead } from "@/lib/repo";
import { siteUrlStatic } from "@/lib/site";
import { readDb, update } from "@/lib/store";
import type { Draft, Lead, VideoAd } from "@/lib/types";
import { videoAssetIds } from "@/lib/fresh";
import { businessFacts, type ProductBrief, type ResearchFacts, type SiteFacts } from "./facts";
import { alignedTiming, estimateTiming, groundStory, LINK, narration, templateStory, type StoryInput } from "./storyboard";

// Making a video ad for a lead: gather what's true about them, write the
// script (Claude, or a template without it), record the voiceover with its
// timing, and keep it with its private link.

export function videoPath(token: string): string {
  return `/video/${token}`;
}

export function videoUrl(token: string, origin?: string): string {
  return `${(origin ?? siteUrlStatic() ?? "").replace(/\/$/, "")}${videoPath(token)}`;
}

/** A video's own media (logo, photo, voiceover), served on its public page. */
export function mediaUrl(token: string, assetId: string): string {
  return `/api/public/video/${token}/${assetId}`;
}

export interface ProductChoice {
  id: string;
  name: string;
  tagline: string;
  features: string[];
  icon: string;
  monthly: number;
  recommended: boolean;
  why?: string;
}

/** The checklist: every product in the store, the ones that fit this lead first and ticked. */
export async function productChoices(lead: Lead): Promise<ProductChoice[]> {
  const db = await readDb();
  const recs = recommend({ niche: lead.niche, signals: lead.signals }, 6).filter((r) => r.offer.kind === "product");
  const products = OFFERS.filter((o) => o.kind === "product" && isVisible(o, db.store));
  const why = new Map(recs.map((r) => [r.offer.id, r.reason]));
  const choice = (o: Offer): ProductChoice => ({
    id: o.id,
    name: o.name,
    tagline: o.tagline,
    features: o.features.slice(0, 3),
    icon: o.icon,
    monthly: priceOf(o, db.store).monthly,
    recommended: why.has(o.id),
    why: why.get(o.id),
  });
  return [...products.filter((o) => why.has(o.id)).sort((x, y) => recs.findIndex((r) => r.offer.id === x.id) - recs.findIndex((r) => r.offer.id === y.id)), ...products.filter((o) => !why.has(o.id))].map(choice);
}

/** Re-check their website when we have no check or it's over two weeks old. */
async function freshAudit(lead: Lead): Promise<Lead> {
  if (!lead.website) return lead;
  const age = lead.audit?.fetchedAt ? Date.now() - Date.parse(lead.audit.fetchedAt) : Infinity;
  if (age < 14 * 86_400_000) return lead;
  const niche = getNiche(lead.niche);
  const audit = await auditWebsite(lead.website);
  const base = { website: lead.website, phone: lead.phone, rating: lead.rating, reviewCount: lead.reviewCount, booking: niche?.booking, retainerMid: niche?.retainerMid, audit, source: lead.source };
  const signals = deriveSignals(base);
  return updateLead(lead.id, { audit, signals, score: scoreProspect(base, signals), email: lead.email ?? audit.emails[0] });
}

/** Their homepage's headline, description, services, logo, photo and colour (robots.txt respected). */
async function readSite(lead: Lead): Promise<{ site?: SiteFacts; brand: Brand }> {
  const g = lead.guide?.brand;
  if (g) return { site: { headline: g.headline, tagline: g.tagline, services: g.services }, brand: g };
  if (!lead.website || !(await robotsAllowed(lead.website))) return { brand: {} };
  const page = await safeFetchText(lead.website, { timeoutMs: 12_000, maxBytes: 2_000_000 });
  if (page.status >= 400) return { brand: {} };
  const brand = extractBrand(page.body, page.finalUrl);
  return { site: { headline: brand.headline, tagline: brand.tagline, services: serviceNames(pageLinks(page.body, page.finalUrl)) }, brand };
}

const RASTER = /^image\/(png|jpe?g|webp|gif)$/;

/** Keep a copy of their logo or photo, so the video can draw it (raster images only). */
async function keepImage(url?: string): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const img = await safeFetchBytes(url, { maxBytes: 3_000_000, accept: "image/png,image/jpeg,image/webp,image/gif" });
    return RASTER.test(img.mime) && img.bytes.length > 200 ? await putAsset(img.bytes, img.mime) : undefined;
  } catch {
    return undefined;
  }
}

export interface MakeOptions {
  products: string[];
  format?: "vertical" | "square";
  /** Search the web for more about them (Claude). */
  research?: boolean;
  /** Record a voiceover (ElevenLabs). */
  voice?: boolean;
  createdBy?: string;
}

export async function createVideoAd(leadId: string, opts: MakeOptions): Promise<{ video: VideoAd; notes: string[] }> {
  let lead = await getLead(leadId);
  if (!lead) throw new Error("Lead not found");
  const picked = [...new Set(opts.products)].map((id) => getOffer(id)).filter((o): o is Offer => Boolean(o && o.kind === "product")).slice(0, 4);
  if (!picked.length) throw new Error("Tick at least one product for the video to sell.");
  const notes: string[] = [];
  const profile = await getProfile();
  const niche = getNiche(lead.niche);

  lead = await freshAudit(lead).catch((err) => {
    notes.push(`Couldn't re-check their website: ${err instanceof Error ? err.message : String(err)}`);
    return lead!;
  });
  const { site, brand } = await readSite(lead).catch((err) => {
    notes.push(`Couldn't read their website: ${err instanceof Error ? err.message : String(err)}`);
    return { site: undefined, brand: {} as Brand };
  });
  let research: ResearchFacts | undefined;
  if (opts.research && claudeEnabled()) {
    const place = lead.city ? ` in ${lead.city}` : "";
    research = await researchWeb(
      `${lead.name}${place}${lead.website ? ` (${lead.website})` : ""}: what do customers say about them in reviews, which services, specials or guarantees do they promote, and is there anything notable about them recently? Only facts about this specific business, each with its source. Bullet points.`,
      { maxSearches: 3 }
    ).catch((err) => {
      notes.push(`Web research didn't work: ${describeError(err)}`);
      return undefined;
    });
  }
  const [logo, photo] = await Promise.all([keepImage(brand.logo), keepImage(brand.image)]);

  const facts = businessFacts({ lead, niche, site, research });
  const recs = new Map(recommend({ niche: lead.niche, signals: lead.signals }, 8).map((r) => [r.offer.id, r.reason]));
  const gapsBySignal = new Map((lead.signals ?? []).filter((s) => !s.positive).map((s) => [s.id, s.label.replace(/\s*\(.*\)$/, "")]));
  const products: ProductBrief[] = picked.map((o) => ({
    id: o.id,
    name: o.name,
    tagline: o.tagline,
    features: o.features.slice(0, 3),
    why: recs.get(o.id),
    fixes: (o.signals ?? []).map((id) => gapsBySignal.get(id)).find(Boolean),
  }));
  const input: StoryInput = {
    business: lead.name,
    city: lead.city?.split(",")[0].trim(),
    kind: niche && niche.id !== "custom" ? niche.label : lead.category || "local business",
    facts,
    products,
    agency: { name: profile.agencyName, owner: profile.ownerName, phone: profile.phone, email: profile.email, calendarUrl: profile.calendarUrl, mailingAddress: profile.mailingAddress },
    hasLogo: Boolean(logo),
    hasPhoto: Boolean(photo),
  };
  const format = opts.format === "square" ? "square" : "vertical";
  const written = claudeEnabled() ? await writeVideoStory(input, format) : templateStory(input);
  const { story, dropped } = groundStory(written, input);
  if (dropped.length) notes.push(`Removed from the script because the facts don't support it: ${dropped.join("; ")}.`);

  let timing = estimateTiming(story.scenes);
  let voiceover: VideoAd["voiceover"];
  if (opts.voice !== false) {
    if (!elevenEnabled()) notes.push("No voiceover: add ELEVENLABS_API_KEY to have it narrated.");
    else {
      const { text, offsets } = narration(story.scenes);
      try {
        const v = await synthesizeTimed(text);
        voiceover = { assetId: v.assetId, model: v.model };
        timing = alignedTiming(offsets, v.alignment);
      } catch (err) {
        notes.push(`No voiceover: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const color = brandColor(brand.color);
  const video: VideoAd = {
    id: `video_${Date.now().toString(36)}${randomBytes(3).toString("hex")}`,
    token: randomBytes(12).toString("base64url"),
    leadId: lead.id,
    business: lead.name,
    createdAt: new Date().toISOString(),
    createdBy: opts.createdBy ?? "user",
    format,
    products: products.map((p) => p.id),
    facts,
    scenes: story.scenes,
    timing,
    brand: { color, ink: inkOn(color), logo, photo, domain: domainOf(lead.website) },
    voiceover,
    email: story.email,
    writtenBy: claudeEnabled() ? "claude" : "template",
  };
  await update((db) => {
    db.videos = [video, ...(db.videos ?? [])].slice(0, 300);
  });
  const by = video.createdBy.startsWith("agent:") || video.createdBy === "copilot" ? "The copilot" : "You";
  await addActivity({ kind: "ad", text: `${by} made a video ad for ${lead.name} selling ${products.map((p) => p.name).join(", ")}`, leadId: lead.id });
  return { video, notes };
}

export async function listVideos(leadId?: string): Promise<VideoAd[]> {
  const all = (await readDb()).videos ?? [];
  return leadId ? all.filter((v) => v.leadId === leadId) : all;
}

export async function getVideo(id: string): Promise<VideoAd | undefined> {
  return ((await readDb()).videos ?? []).find((v) => v.id === id);
}

export async function videoByToken(token: string): Promise<VideoAd | undefined> {
  if (!/^[A-Za-z0-9_-]{10,40}$/.test(token)) return undefined;
  return ((await readDb()).videos ?? []).find((v) => v.token === token);
}

export function videoAssets(v: VideoAd): string[] {
  return videoAssetIds(v);
}

export async function deleteVideoAd(id: string): Promise<void> {
  const gone = await update((db) => {
    const v = (db.videos ?? []).find((x) => x.id === id);
    db.videos = (db.videos ?? []).filter((x) => x.id !== id);
    return v;
  });
  if (gone) await deleteAssets(videoAssets(gone)).catch(() => undefined);
}

/** The email that goes with it, as a draft in the Inbox (nothing is sent until you approve it). */
export async function emailVideoAd(id: string, opts: { to?: string; origin?: string; createdBy?: string } = {}): Promise<Draft> {
  const v = await getVideo(id);
  if (!v) throw new Error("Video not found");
  const lead = await getLead(v.leadId);
  if (!lead) throw new Error("The lead for this video was deleted");
  const to = opts.to?.trim() || lead.email;
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error("Add their email address first.");
  if (!lead.email) await updateLead(lead.id, { email: to });
  const draft = await createDraft({
    leadId: lead.id,
    channel: "email",
    to,
    subject: v.email.subject,
    body: v.email.body.split(LINK).join(videoUrl(v.token, opts.origin)),
    rationale: `Video ad made from ${v.facts.length} facts about ${lead.name}, selling ${v.products.length} product${v.products.length === 1 ? "" : "s"}.`,
    createdBy: opts.createdBy ?? "user",
  });
  return draft;
}

/** Someone opened the video's page: count it, and tell you the first time. */
export async function countView(token: string): Promise<void> {
  const first = await update((db) => {
    const v = (db.videos ?? []).find((x) => x.token === token);
    if (!v) return undefined;
    v.views = (v.views ?? 0) + 1;
    v.lastViewedAt = new Date().toISOString();
    return v.views === 1 ? v : undefined;
  });
  if (first) await addActivity({ kind: "lead", text: `${first.business} opened the video ad you made for them`, leadId: first.leadId });
}
