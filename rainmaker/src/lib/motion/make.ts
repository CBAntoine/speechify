import "server-only";
import { randomBytes } from "node:crypto";
import { deleteAssets, putAsset } from "@/lib/assets";
import { describeError } from "@/lib/claude/client";
import { reviseMotionStoryboard, writeMotionStoryboard, type MotionBrief } from "@/lib/claude/motion";
import { claudeEnabled, elevenEnabled } from "@/lib/config";
import { synthesizeTimed } from "@/lib/elevenlabs/tts";
import { getNiche } from "@/lib/niches";
import { domainOf, normalizeUrl, safeFetchBytes, safeFetchText } from "@/lib/net";
import { brandColor, inkOn } from "@/lib/offers/brand-color";
import { extractBrand, pageLinks, pagePhotos, serviceNames, type Brand } from "@/lib/offers/site-kb-parse";
import { robotsAllowed } from "@/lib/prospecting/crawler";
import { motionAssetIds } from "@/lib/fresh";
import { addActivity, getLead } from "@/lib/repo";
import { readDb, update } from "@/lib/store";
import type { Lead, MotionAd, MotionImage, MotionShot } from "@/lib/types";
import { imageSize, logoSharpness, sharpness, SHARP_4K } from "./image-size";
import { cleanShots, fitShotsToVoice, narrationOf, palette, templateShots, voiceSegments, type MotionInput } from "./story";

// Motion ads, step by step: gather their assets (logo, photos and colour
// from their website, plus anything you upload), write the numbered
// storyboard (Claude as art director, or a template), let you edit and
// approve it, record the narration, and keep it all for the browser to
// animate with Three.js and render.

const MAX_PHOTOS = 8;
const FORMATS = ["vertical", "square", "landscape"] as const;
const RASTER = /^image\/(png|jpeg|webp)$/;
export const MUSIC_TYPES = /^audio\/(mpeg|mp3|mp4|x-m4a|aac|wav|x-wav|wave|ogg|webm)$/;

const clip = (s: unknown, n: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : "");

/** A picture we keep a copy of, with its size (raster only). */
async function keepPicture(url: string | undefined, minShort = 0): Promise<MotionImage | undefined> {
  if (!url) return undefined;
  try {
    const img = await safeFetchBytes(url, { maxBytes: 8_000_000, accept: "image/png,image/jpeg,image/webp" });
    if (!RASTER.test(img.mime) || img.bytes.length < 400) return undefined;
    const size = imageSize(img.bytes);
    if (minShort && size && Math.min(size.w, size.h) < minShort) return undefined;
    return { id: await putAsset(img.bytes, img.mime), w: size?.w, h: size?.h, from: "website" };
  } catch {
    return undefined;
  }
}

/** Their homepage: brand, headline, services and the pictures on it (robots.txt respected). */
async function readSite(website: string | undefined): Promise<{ brand: Brand; services: string[]; photos: string[] }> {
  const none = { brand: {}, services: [], photos: [] };
  if (!website || !(await robotsAllowed(website))) return none;
  const page = await safeFetchText(website, { timeoutMs: 12_000, maxBytes: 2_000_000 });
  if (page.status >= 400) return none;
  return {
    brand: extractBrand(page.body, page.finalUrl),
    services: serviceNames(pageLinks(page.body, page.finalUrl)).slice(0, 6),
    photos: pagePhotos(page.body, page.finalUrl, 8),
  };
}

function factsAbout(name: string, lead: Lead | undefined, kind: string | undefined, site: { brand: Brand; services: string[] }): string[] {
  const facts: string[] = [];
  if (lead?.rating && lead.reviewCount) facts.push(`${name} is rated ${lead.rating} stars from ${lead.reviewCount} Google reviews.`);
  if (kind) facts.push(`${name} is ${/^[aeiou]/i.test(kind) ? "an" : "a"} ${kind}${lead?.city ? ` in ${lead.city.split(",")[0].trim()}` : ""}.`);
  else if (lead?.city) facts.push(`${name} is in ${lead.city.split(",")[0].trim()}.`);
  if (site.brand.headline) facts.push(`Their website's headline: "${site.brand.headline}"`);
  if (site.brand.tagline) facts.push(`Their website says: "${site.brand.tagline}"`);
  if (site.services.length) facts.push(`Services on their website: ${site.services.join(", ")}.`);
  return facts;
}

function inputOf(ad: Pick<MotionAd, "business" | "brief" | "facts" | "assets" | "format">): MotionInput {
  return {
    business: ad.business,
    goal: ad.brief.goal,
    offer: ad.brief.offer,
    audience: ad.brief.audience,
    notes: ad.brief.notes,
    cta: ad.brief.cta,
    facts: ad.facts,
    hasLogo: Boolean(ad.assets.logo),
    photos: ad.assets.photos.length,
    format: ad.format,
  };
}

function briefOf(ad: MotionAd, lead?: Lead): MotionBrief {
  const niche = lead ? getNiche(lead.niche) : undefined;
  return {
    business: ad.business,
    kind: niche && niche.id !== "custom" ? niche.label : lead?.category,
    city: lead?.city?.split(",")[0].trim(),
    website: domainOf(ad.website),
    format: ad.format,
    goal: ad.brief.goal,
    offer: ad.brief.offer,
    audience: ad.brief.audience,
    notes: ad.brief.notes,
    cta: ad.brief.cta,
    facts: ad.facts,
    hasLogo: Boolean(ad.assets.logo),
    photos: ad.assets.photos.map((p) => ({ from: p.from, w: p.w, h: p.h })),
  };
}

/** Low-resolution and missing pictures, said plainly. */
export function assetWarnings(ad: Pick<MotionAd, "assets">): string[] {
  const out: string[] = [];
  if (!ad.assets.logo) out.push("No logo yet: upload one (PNG with a transparent background is best) or the ad uses their brand colour instead.");
  else if (logoSharpness(ad.assets.logo) === "low") out.push(`The logo is small (${ad.assets.logo.w}×${ad.assets.logo.h}). A bigger PNG or an SVG keeps it crisp.`);
  if (!ad.assets.photos.length) out.push("No photos yet: upload a few of their work, team or products. Shots fall back to colour without them.");
  ad.assets.photos.forEach((p, i) => {
    const s = sharpness(p);
    if (s === "low") out.push(`Photo ${i + 1} is ${p.w}×${p.h}: it will look soft. Use one at least ${SHARP_4K} pixels on its short side for 4K.`);
    else if (s === "hd") out.push(`Photo ${i + 1} (${p.w}×${p.h}) is sharp in 1080p but a little soft in 4K.`);
  });
  return out;
}

export interface MotionCreate {
  leadId?: string;
  business?: string;
  website?: string;
  format?: string;
  goal?: string;
  offer?: string;
  audience?: string;
  notes?: string;
  cta?: string;
  createdBy?: string;
}

export async function createMotionAd(input: MotionCreate): Promise<{ ad: MotionAd; notes: string[] }> {
  const notes: string[] = [];
  const lead = input.leadId ? await getLead(input.leadId) : undefined;
  if (input.leadId && !lead) throw new Error("Lead not found");
  const business = lead?.name ?? clip(input.business, 100);
  if (!business) throw new Error("Pick a business from your pipeline or type its name.");
  const website = normalizeUrl(lead?.website ?? input.website);
  const format = (FORMATS as readonly string[]).includes(input.format ?? "") ? (input.format as MotionAd["format"]) : "vertical";

  const site = await readSite(website).catch((err) => {
    notes.push(`Couldn't read their website: ${err instanceof Error ? err.message : String(err)}`);
    return { brand: {} as Brand, services: [] as string[], photos: [] as string[] };
  });
  const [logo, ...found] = await Promise.all([keepPicture(site.brand.logo), ...site.photos.slice(0, 6).map((u) => keepPicture(u, 300))]);
  const photos = found.filter((p): p is MotionImage => Boolean(p)).slice(0, 4);
  const extra = found.filter((p): p is MotionImage => Boolean(p)).slice(4);
  if (extra.length) await deleteAssets(extra.map((p) => p.id)).catch(() => undefined);

  const niche = lead ? getNiche(lead.niche) : undefined;
  const kind = niche && niche.id !== "custom" ? niche.label : lead?.category;
  const now = new Date().toISOString();
  const ad: MotionAd = {
    id: `motion_${Date.now().toString(36)}${randomBytes(3).toString("hex")}`,
    leadId: lead?.id,
    business,
    website,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy ?? "user",
    format,
    brief: {
      goal: clip(input.goal, 120) || "Get more customers",
      offer: clip(input.offer, 120) || undefined,
      audience: clip(input.audience, 120) || undefined,
      notes: clip(input.notes, 800) || undefined,
      cta: clip(input.cta, 80) || lead?.phone || domainOf(website) || undefined,
    },
    facts: factsAbout(business, lead, kind, site),
    concept: "",
    brand: palette(brandColor(site.brand.color)),
    assets: { logo, photos },
    shots: [],
    status: "storyboard",
    revisions: [],
    sound: { sfx: true, bed: "pulse", music: 0.6, voice: true },
    writtenBy: "template",
  };
  ad.brand.ink = inkOn(ad.brand.primary);
  await storyboard(ad, lead, notes);
  await update((db) => {
    db.motion = [ad, ...(db.motion ?? [])].slice(0, 100);
  });
  await addActivity({ kind: "ad", text: `You storyboarded a motion ad for ${business} (${ad.shots.length} shots)`, leadId: lead?.id });
  return { ad, notes: [...notes, ...assetWarnings(ad)] };
}

/** Write the storyboard: Claude as art director, or the template without it. */
async function storyboard(ad: MotionAd, lead: Lead | undefined, notes: string[]): Promise<void> {
  let raw: { concept: string; shots: Partial<MotionShot>[] } | undefined;
  if (claudeEnabled()) {
    raw = await writeMotionStoryboard(briefOf(ad, lead)).catch((err) => {
      notes.push(`Claude couldn't write the storyboard (${describeError(err)}), so this one is from the template.`);
      return undefined;
    });
  }
  const input = inputOf(ad);
  const { shots, dropped } = raw ? cleanShots(raw.shots, input) : { shots: templateShots(input), dropped: [] };
  if (dropped.length) notes.push(`Removed: ${dropped.join("; ")}.`);
  if (raw && shots.length < 3) {
    notes.push("Claude's storyboard didn't pass the checks, so this one is from the template.");
    ad.shots = templateShots(input);
    ad.writtenBy = "template";
    ad.concept = "";
    return;
  }
  ad.shots = shots;
  ad.concept = raw?.concept.trim().slice(0, 240) ?? `${ad.business}: ${ad.brief.offer ?? ad.brief.goal}, one shape morphing from shot to shot.`;
  ad.writtenBy = raw ? "claude" : "template";
}

export async function listMotion(): Promise<MotionAd[]> {
  return (await readDb()).motion ?? [];
}

export async function getMotion(id: string): Promise<MotionAd | undefined> {
  return ((await readDb()).motion ?? []).find((m) => m.id === id);
}


/** Change a motion ad inside one database update; returns it, plus asset ids that are no longer used. */
async function change(id: string, fn: (ad: MotionAd) => string[] | void): Promise<{ ad: MotionAd; freed: string[] }> {
  const out = await update((db) => {
    const ad = (db.motion ?? []).find((m) => m.id === id);
    if (!ad) return undefined;
    const freed = fn(ad) ?? [];
    ad.updatedAt = new Date().toISOString();
    return { ad: structuredClone(ad), freed };
  });
  if (!out) throw new Error("Motion ad not found");
  if (out.freed.length) await deleteAssets(out.freed).catch(() => undefined);
  return out;
}

/** New shots make the recorded narration out of date. */
function setShots(ad: MotionAd, shots: MotionShot[]): string[] {
  const same = JSON.stringify(shots) === JSON.stringify(ad.shots);
  ad.shots = shots;
  if (same || !ad.voiceover) return [];
  const freed = [ad.voiceover.assetId];
  ad.voiceover = undefined;
  return freed;
}

export interface MotionPatch {
  shots?: Partial<MotionShot>[];
  concept?: string;
  status?: "storyboard" | "approved";
  brand?: { primary?: string; accent?: string };
  sound?: Partial<MotionAd["sound"]>;
  brief?: Partial<MotionAd["brief"]>;
}

const HEX = /^#[0-9a-f]{6}$/i;

export async function updateMotion(id: string, patch: MotionPatch): Promise<{ ad: MotionAd; notes: string[] }> {
  const notes: string[] = [];
  const { ad } = await change(id, (ad) => {
    const freed: string[] = [];
    if (patch.brief) {
      const b = patch.brief;
      if (b.goal !== undefined) ad.brief.goal = clip(b.goal, 120) || ad.brief.goal;
      if (b.offer !== undefined) ad.brief.offer = clip(b.offer, 120) || undefined;
      if (b.audience !== undefined) ad.brief.audience = clip(b.audience, 120) || undefined;
      if (b.notes !== undefined) ad.brief.notes = clip(b.notes, 800) || undefined;
      if (b.cta !== undefined) ad.brief.cta = clip(b.cta, 80) || undefined;
    }
    if (Array.isArray(patch.shots)) {
      const { shots, dropped } = cleanShots(patch.shots, inputOf(ad));
      if (!shots.length) throw new Error("A storyboard needs at least one shot with words on it.");
      if (dropped.length) notes.push(`Removed: ${dropped.join("; ")}.`);
      freed.push(...setShots(ad, shots));
    }
    if (typeof patch.concept === "string") ad.concept = clip(patch.concept, 240);
    if (patch.brand?.primary && HEX.test(patch.brand.primary)) {
      ad.brand.primary = patch.brand.primary.toLowerCase();
      ad.brand.ink = inkOn(ad.brand.primary);
    }
    if (patch.brand?.accent && HEX.test(patch.brand.accent)) ad.brand.accent = patch.brand.accent.toLowerCase();
    if (patch.sound) {
      const s = patch.sound;
      if (typeof s.sfx === "boolean") ad.sound.sfx = s.sfx;
      if (s.bed === "none" || s.bed === "pad" || s.bed === "pulse" || (s.bed === "track" && ad.assets.music)) ad.sound.bed = s.bed;
      if (typeof s.music === "number" && Number.isFinite(s.music)) ad.sound.music = Math.max(0, Math.min(1, s.music));
      if (typeof s.voice === "boolean") ad.sound.voice = s.voice;
    }
    if (patch.status === "approved" && ad.status !== "approved") {
      ad.status = "approved";
      ad.approvedAt = new Date().toISOString();
    } else if (patch.status === "storyboard") ad.status = "storyboard";
    return freed;
  });
  return { ad, notes: [...new Set(notes)] };
}

/** Ask Claude for a change to the storyboard ("make shot 3 about the warranty"). */
export async function reviseMotion(id: string, ask: string): Promise<{ ad: MotionAd; notes: string[] }> {
  const text = clip(ask, 600);
  if (!text) throw new Error("Say what to change.");
  if (!claudeEnabled()) throw new Error("Asking for changes needs ANTHROPIC_API_KEY. You can still edit the shots by hand.");
  const current = await getMotion(id);
  if (!current) throw new Error("Motion ad not found");
  const lead = current.leadId ? await getLead(current.leadId) : undefined;
  const raw = await reviseMotionStoryboard(briefOf(current, lead), { concept: current.concept, shots: current.shots }, text);
  const { shots, dropped } = cleanShots(raw.shots, inputOf(current));
  if (shots.length < 3) throw new Error("Claude's new storyboard didn't pass the checks. Try asking another way.");
  const notes = dropped.length ? [`Removed: ${dropped.join("; ")}.`] : [];
  const { ad } = await change(id, (ad) => {
    const freed = setShots(ad, shots);
    ad.concept = raw.concept.trim().slice(0, 240) || ad.concept;
    ad.revisions = [...ad.revisions, { at: new Date().toISOString(), ask: text }].slice(-20);
    ad.status = "storyboard";
    ad.writtenBy = "claude";
    return freed;
  });
  return { ad, notes };
}

/** Start the storyboard again from the brief and assets. */
export async function rewriteMotion(id: string): Promise<{ ad: MotionAd; notes: string[] }> {
  const current = await getMotion(id);
  if (!current) throw new Error("Motion ad not found");
  const lead = current.leadId ? await getLead(current.leadId) : undefined;
  const notes: string[] = [];
  const draft = structuredClone(current);
  await storyboard(draft, lead, notes);
  const { ad } = await change(id, (ad) => {
    const freed = setShots(ad, draft.shots);
    ad.concept = draft.concept;
    ad.writtenBy = draft.writtenBy;
    ad.status = "storyboard";
    return freed;
  });
  return { ad, notes };
}

/** Add an uploaded logo, photo or music track. */
export async function addMotionAsset(id: string, kind: string, bytes: Buffer, mime: string, name?: string): Promise<{ ad: MotionAd; notes: string[] }> {
  const ad0 = await getMotion(id);
  if (!ad0) throw new Error("Motion ad not found");
  let stored: MotionImage | { id: string; name: string };
  if (kind === "logo" || kind === "photo") {
    if (!RASTER.test(mime)) throw new Error("Upload a PNG, JPEG or WebP picture.");
    if (kind === "photo" && ad0.assets.photos.length >= MAX_PHOTOS) throw new Error(`Up to ${MAX_PHOTOS} photos. Remove one first.`);
    const size = imageSize(bytes);
    if (!size) throw new Error("That picture couldn't be read.");
    stored = { id: await putAsset(bytes, mime), w: size.w, h: size.h, from: "upload" };
  } else if (kind === "music") {
    if (!MUSIC_TYPES.test(mime)) throw new Error("Upload an MP3, M4A, WAV or OGG file.");
    stored = { id: await putAsset(bytes, mime), name: clip(name, 80) || "Music" };
  } else throw new Error("Unknown kind of file");
  const { ad } = await change(id, (ad) => {
    if (kind === "logo") {
      const old = ad.assets.logo?.id;
      ad.assets.logo = stored as MotionImage;
      return old ? [old] : [];
    }
    if (kind === "photo") {
      ad.assets.photos = [...ad.assets.photos, stored as MotionImage].slice(0, MAX_PHOTOS);
      return [];
    }
    const old = ad.assets.music?.id;
    ad.assets.music = stored as { id: string; name: string };
    ad.sound.bed = "track";
    return old ? [old] : [];
  });
  return { ad, notes: assetWarnings(ad) };
}

/** Remove a logo, photo or track; shots that used a removed photo move to the others. */
export async function removeMotionAsset(id: string, assetId: string): Promise<{ ad: MotionAd; notes: string[] }> {
  const { ad } = await change(id, (ad) => {
    if (ad.assets.logo?.id === assetId) {
      ad.assets.logo = undefined;
      ad.shots = ad.shots.map((s) => (s.fill === "logo" ? { ...s, fill: "brand" } : s));
      return [assetId];
    }
    if (ad.assets.music?.id === assetId) {
      ad.assets.music = undefined;
      if (ad.sound.bed === "track") ad.sound.bed = "pulse";
      return [assetId];
    }
    const i = ad.assets.photos.findIndex((p) => p.id === assetId);
    if (i < 0) return [];
    ad.assets.photos.splice(i, 1);
    const left = ad.assets.photos.length;
    ad.shots = ad.shots.map((s) => {
      if (s.fill !== "photo" || s.photo === undefined) return s;
      if (!left) return { ...s, fill: "accent", photo: undefined };
      if (s.photo === i) return { ...s, photo: Math.min(i, left - 1) };
      return s.photo > i ? { ...s, photo: s.photo - 1 } : s;
    });
    return [assetId];
  });
  return { ad, notes: assetWarnings(ad) };
}

/** Record the narration in one take with ElevenLabs, cut it into each shot's line, and stretch shots that need it. */
export async function voiceMotion(id: string, voiceId?: string): Promise<{ ad: MotionAd; notes: string[] }> {
  if (!elevenEnabled()) throw new Error("Voiceovers need ELEVENLABS_API_KEY.");
  const current = await getMotion(id);
  if (!current) throw new Error("Motion ad not found");
  const { text, lines } = narrationOf(current.shots);
  if (!lines.length) throw new Error("No shot has a voiceover line yet. Add one in the storyboard.");
  const voice = voiceId && /^[A-Za-z0-9]{8,40}$/.test(voiceId) ? voiceId : undefined;
  const v = await synthesizeTimed(text, voice);
  const segments = voiceSegments(lines, v.alignment);
  const before = current.shots.map((s) => s.seconds);
  const notes: string[] = [];
  const { ad } = await change(id, (ad) => {
    if (JSON.stringify(ad.shots.map((s) => s.voice ?? "")) !== JSON.stringify(current.shots.map((s) => s.voice ?? ""))) {
      throw new Error("The storyboard changed while recording. Record it again.");
    }
    const old = ad.voiceover?.assetId;
    ad.shots = fitShotsToVoice(ad.shots, segments);
    ad.voiceover = { assetId: v.assetId, model: v.model, text, segments };
    ad.sound.voice = true;
    return old ? [old] : [];
  }).catch(async (err) => {
    await deleteAssets([v.assetId]).catch(() => undefined);
    throw err;
  });
  const longer = ad.shots.map((s, i) => (s.seconds > before[i] ? i + 1 : 0)).filter(Boolean);
  if (longer.length) notes.push(`Shot${longer.length === 1 ? "" : "s"} ${longer.join(", ")} got a little longer to fit the narration.`);
  return { ad, notes };
}

export async function removeVoice(id: string): Promise<MotionAd> {
  return (
    await change(id, (ad) => {
      const old = ad.voiceover?.assetId;
      ad.voiceover = undefined;
      return old ? [old] : [];
    })
  ).ad;
}

export async function deleteMotion(id: string): Promise<void> {
  const gone = await update((db) => {
    const m = (db.motion ?? []).find((x) => x.id === id);
    db.motion = (db.motion ?? []).filter((x) => x.id !== id);
    return m;
  });
  if (gone) await deleteAssets(motionAssetIds(gone)).catch(() => undefined);
}
