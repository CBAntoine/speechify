// Turning Claude's web research into prospects, and merging prospects that
// several sources found. Pure helpers, unit tested.

import type { Niche } from "../niches.ts";
import type { Prospect } from "../types.ts";
import { formatPhone } from "./crawl-parse.ts";
import { nameKey } from "./opendata-parse.ts";
import { distanceKm } from "./osm-parse.ts";

export const WEB_RESEARCH = "Claude web research";

// Listing and social sites: a page there is a source, not the business's website.
const DIRECTORY = /(^|\.)(yelp|yellowpages|homestars|facebook|instagram|linkedin|twitter|x|tiktok|youtube|google|goo|bbb|houzz|angi|angieslist|homeadvisor|thumbtack|411|canpages|n49|cylex|manta|foursquare|tripadvisor|mapquest|bing|nextdoor|trustedpros|ratemds|opencare|realtor|kijiji|craigslist)\.[a-z.]+$/i;

function website(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".") || DIRECTORY.test(u.hostname)) return undefined;
    return `${u.protocol}//${u.host}${u.pathname === "/" ? "/" : u.pathname}`;
  } catch {
    return undefined;
  }
}

const text = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

/** The record_businesses tool input → prospects. Anything malformed is dropped. */
export function researchToProspects(input: unknown, niche: Pick<Niche, "id" | "label">, limit = 40): Prospect[] {
  const list = (input as { businesses?: unknown } | null)?.businesses;
  if (!Array.isArray(list)) return [];
  const out: Prospect[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    if (out.length >= limit) break;
    if (!raw || typeof raw !== "object") continue;
    const b = raw as Record<string, unknown>;
    const name = text(b.name, 120);
    const key = name ? nameKey(name) : "";
    if (!name || !key || seen.has(key)) continue;
    seen.add(key);
    const phone = text(b.phone, 40);
    out.push({
      key: `web:${key.replace(/ /g, "-")}`,
      name,
      niche: niche.id,
      category: niche.label.toLowerCase(),
      website: website(b.website),
      phone: phone ? formatPhone(phone) : undefined,
      address: text(b.address),
      source: "web",
      sourceId: text(b.source_url, 500),
      foundIn: [WEB_RESEARCH],
    });
  }
  return out;
}

/** Same business? Same name once suffixes are dropped, and not far apart when both are on the map. */
function sameBusiness(a: Prospect, b: Prospect): boolean {
  const ka = nameKey(a.name);
  const kb = nameKey(b.name);
  if (!ka || !kb) return false;
  const nameMatch = ka === kb || (Math.min(ka.length, kb.length) >= 8 && (ka.includes(kb) || kb.includes(ka)));
  if (!nameMatch) return false;
  if (a.lat !== undefined && a.lon !== undefined && b.lat !== undefined && b.lon !== undefined) {
    return distanceKm(a.lat, a.lon, b.lat, b.lon) < 3;
  }
  return true;
}

/** One record per business across sources, keeping the best detail from each. */
export function mergeProspects(lists: Prospect[][]): Prospect[] {
  const out: Prospect[] = [];
  for (const list of lists) {
    for (const p of list) {
      const twin = out.find((q) => sameBusiness(q, p));
      if (!twin) {
        out.push({ ...p, foundIn: [...(p.foundIn ?? [])] });
        continue;
      }
      twin.website ??= p.website;
      twin.phone ??= p.phone;
      twin.email ??= p.email;
      twin.address ??= p.address;
      twin.city ??= p.city;
      if (twin.lat === undefined && p.lat !== undefined) {
        twin.lat = p.lat;
        twin.lon = p.lon;
      }
      twin.rating ??= p.rating;
      twin.reviewCount ??= p.reviewCount;
      twin.mapsUrl ??= p.mapsUrl;
      twin.foundIn = [...new Set([...(twin.foundIn ?? []), ...(p.foundIn ?? [])])];
    }
  }
  return out;
}

/**
 * Which prospects to crawl first: closest first within each source, taking
 * turns between sources so every source gets a share.
 */
export function crawlOrder(prospects: Prospect[], center: { lat: number; lon: number }): Prospect[] {
  const dist = (p: Prospect) => (p.lat !== undefined && p.lon !== undefined ? distanceKm(center.lat, center.lon, p.lat, p.lon) : Number.POSITIVE_INFINITY);
  const bySource = new Map<string, Prospect[]>();
  for (const p of prospects) {
    const k = p.foundIn?.[0] ?? p.source;
    if (!bySource.has(k)) bySource.set(k, []);
    bySource.get(k)!.push(p);
  }
  const queues = [...bySource.values()].map((q) => q.sort((a, b) => dist(a) - dist(b)));
  const out: Prospect[] = [];
  while (queues.some((q) => q.length)) for (const q of queues) if (q.length) out.push(q.shift()!);
  return out;
}
