import { DEMO } from "../config.ts";
import { addScan, getLeadBySource, getSettings, isSuppressed, lastScan, saveLead, scannedSince, updateLead } from "../db.ts";
import { leadChanged, log, working } from "../events.ts";
import { getNiche, looksLikeChain } from "../niches.ts";
import { demoSearch } from "../providers/places/demo.ts";
import { googleSearch } from "../providers/places/google.ts";
import { auditWebsite, demoAudit } from "../site/audit.ts";
import { scoreLead } from "../site/score.ts";
import type { Lead, LeadStatus, TargetCity } from "../types.ts";
import { localDate, localDayStart, newId, nowIso } from "../util.ts";
import { ESTIMATE, preflight } from "./checker.ts";

// Scout: scans Google Maps for one niche in one city, then checks each
// business's website and scores the opportunity.

export class HeldError extends Error {}

export async function scan(target: TargetCity, nicheId: string, opts: { max?: number } = {}): Promise<{ found: number; added: number }> {
  const niche = getNiche(nicheId);
  const s = getSettings();
  return working("scout", `Scanning ${niche.plural} in ${target.city}`, async () => {
    if (!DEMO) {
      const v = preflight(ESTIMATE.scan(), { agent: "scout", what: "a map scan" });
      if (!v.ok) throw new HeldError(v.reason);
    }
    const max = opts.max ?? 60;
    const results = DEMO
      ? demoSearch({ niche: niche.id, city: target.city, region: target.region, country: target.country, max, seed: localDate(s.owner.timezone) })
      : await googleSearch({ query: niche.query, city: target.city, region: target.region, country: target.country, max });
    let added = 0;
    for (const b of results) {
      if (b.businessStatus === "CLOSED_PERMANENTLY" || b.businessStatus === "CLOSED_TEMPORARILY") continue;
      const source = DEMO ? "demo" : "google";
      if (getLeadBySource(source, b.sourceId)) continue;
      if (isSuppressed([b.sourceId, b.phone])) continue;
      const now = nowIso();
      const lead: Lead = {
        id: newId("ld"),
        source,
        sourceId: b.sourceId,
        name: b.name,
        niche: niche.id,
        city: b.city ?? target.city,
        region: b.region ?? target.region,
        country: b.country ?? target.country,
        address: b.address,
        phone: b.phone,
        website: b.website,
        mapsUrl: b.mapsUrl,
        lat: b.lat,
        lon: b.lon,
        rating: b.rating,
        reviewCount: b.reviewCount,
        hours: b.hours,
        primaryType: b.primaryType,
        status: "new",
        priceCents: s.offer.priceCents,
        followupsSent: 0,
        demo: b.demo ? { state: b.demo.state, copyrightYear: b.demo.copyrightYear, email: b.demo.email, reviews: b.demo.reviews } : undefined,
        createdAt: now,
        updatedAt: now,
      };
      saveLead(lead);
      added++;
    }
    addScan({ city: target.city, region: target.region, niche: niche.id, found: results.length, added });
    log("scout", `Scanned ${results.length} ${niche.plural} in ${target.city}, ${target.region}: ${added} new to check.`, { level: added ? "success" : "info" });
    return { found: results.length, added };
  });
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(/^https?:/i.test(url) ? url : `http://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}

const BAD_MAILBOX = /^(no-?reply|donotreply|privacy|abuse|webmaster|postmaster|hostmaster|security|support@wix|wordpress)/i;

/** Prefer an address on the business's own domain, then a general inbox. */
export function pickEmail(emails: string[], domain: string | undefined): string | undefined {
  const ok = emails.filter((e) => !BAD_MAILBOX.test(e));
  return (
    ok.find((e) => domain && e.endsWith(`@${domain}`) && /^(info|office|hello|contact|frontdesk|reception|admin|appointments|book)/.test(e)) ??
    ok.find((e) => domain && e.endsWith(`@${domain}`)) ??
    ok.find((e) => /^(info|office|hello|contact)/.test(e)) ??
    ok[0]
  );
}

export async function auditLead(lead: Lead): Promise<Lead | undefined> {
  return working("scout", `Checking ${lead.name}'s website`, async () => {
    const s = getSettings();
    const outcome = lead.demo ? demoAudit(lead.demo, lead.website, lead.niche) : await auditWebsite(lead.website, { niche: lead.niche });
    const domain = hostOf(lead.website);
    let email = pickEmail(outcome.audit?.emails ?? [], outcome.state === "social_only" ? undefined : domain);
    let consent: Lead["consent"] = { basis: "none" };
    if (email && outcome.audit?.noSolicitation) {
      email = undefined;
      consent = { basis: "none", note: "Their site asks not to be sent unsolicited offers, so we won't email them." };
    } else if (email) {
      consent = { basis: "published_email", note: `Published on ${outcome.audit?.emailPage ?? outcome.audit?.finalUrl ?? lead.website}`, at: nowIso() };
    }
    const chain = looksLikeChain(lead.name, lead.website);
    const { score, reasons } = scoreLead({
      state: outcome.state,
      niche: lead.niche,
      rating: lead.rating,
      reviewCount: lead.reviewCount,
      hasEmail: Boolean(email),
      hasPhone: Boolean(lead.phone),
      chain,
      closed: false,
    });
    let status: LeadStatus = "qualified";
    let skipReason: string | undefined;
    if (isSuppressed([email, lead.phone, domain, lead.sourceId])) (status = "dnc"), (skipReason = "On the do-not-contact list");
    else if (chain) (status = "skipped"), (skipReason = "Chain or franchise");
    else if (outcome.state === "modern") (status = "skipped"), (skipReason = "Already has a decent website");
    else if ((lead.reviewCount ?? 0) < s.qualify.minReviews) (status = "skipped"), (skipReason = `Fewer than ${s.qualify.minReviews} Google reviews`);
    else if (!email && !lead.phone) (status = "skipped"), (skipReason = "No way to reach them");
    else if (score < s.qualify.minScore) (status = "skipped"), (skipReason = `Score ${score} is under ${s.qualify.minScore}`);
    const updated = updateLead(lead.id, (l) => {
      l.websiteState = outcome.state;
      l.audit = outcome.audit;
      l.email = email;
      l.emailSource = email ? (outcome.audit?.emailPage ?? outcome.audit?.finalUrl ?? l.website) : undefined;
      l.consent = consent;
      l.score = score;
      l.scoreReasons = reasons;
      l.status = status;
      l.skipReason = skipReason;
      if (outcome.audit?.socials.facebook || outcome.audit?.socials.instagram) l.audit = outcome.audit;
    });
    if (updated) {
      leadChanged(updated);
      if (status === "qualified") log("scout", `Qualified (score ${score}): ${reasons.slice(0, 3).join(", ")}.`, { lead: updated, level: "success" });
    }
    return updated;
  });
}

/** The next city and niche to scan: whichever pair was scanned longest ago. */
export function nextTarget(): { city: TargetCity; niche: string } | undefined {
  const s = getSettings();
  const minAgeMs = (DEMO ? 1 : 30) * 86_400_000;
  let best: { city: TargetCity; niche: string; at: number } | undefined;
  for (const niche of s.targets.niches) {
    for (const city of s.targets.cities) {
      const last = lastScan(city.city, niche);
      const at = last ? Date.parse(last) : 0;
      if (last && Date.now() - at < minAgeMs) continue;
      if (!best || at < best.at) best = { city, niche, at };
    }
  }
  return best && { city: best.city, niche: best.niche };
}

export function scannedToday(): number {
  return scannedSince(localDayStart(getSettings().owner.timezone));
}
