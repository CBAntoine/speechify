import { PRICES, keys } from "../../config.ts";
import { addCost } from "../../db.ts";
import type { Country, Review } from "../../types.ts";
import { fetchWithTimeout } from "../../util.ts";

// Google Places API (New): Text Search for the scan, Place Details for the
// reviews of the few businesses we actually build for. Needs
// GOOGLE_PLACES_API_KEY with "Places API (New)" enabled.

export interface FoundBusiness {
  sourceId: string;
  name: string;
  address?: string;
  city?: string;
  region?: string;
  country?: Country;
  phone?: string;
  website?: string;
  mapsUrl?: string;
  lat?: number;
  lon?: number;
  rating?: number;
  reviewCount?: number;
  hours?: string[];
  primaryType?: string;
  businessStatus?: string;
  /** Demo mode only: what the fictional website looks like. */
  demo?: DemoSite;
}

export interface DemoSite {
  state: "none" | "social_only" | "dead" | "outdated" | "weak" | "modern";
  copyrightYear?: number;
  email?: string;
  reviews?: Review[];
}

const SEARCH_FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.location",
  "places.googleMapsUri",
  "places.businessStatus",
  "places.primaryType",
  "places.regularOpeningHours.weekdayDescriptions",
  "nextPageToken",
].join(",");

interface PlacesPlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  addressComponents?: { longText: string; shortText: string; types: string[] }[];
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  location?: { latitude: number; longitude: number };
  googleMapsUri?: string;
  businessStatus?: string;
  primaryType?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
}

export async function googleSearch(opts: { query: string; city: string; region?: string; country: Country; max: number }): Promise<FoundBusiness[]> {
  if (!keys.google) throw new Error("Add GOOGLE_PLACES_API_KEY to .env to scan real businesses.");
  const out: FoundBusiness[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 3 && out.length < opts.max; page++) {
    const res = await fetchWithTimeout("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Goog-Api-Key": keys.google, "X-Goog-FieldMask": SEARCH_FIELDS },
      body: JSON.stringify({
        textQuery: `${opts.query} in ${opts.city}${opts.region ? `, ${opts.region}` : ""}`,
        pageSize: 20,
        regionCode: opts.country,
        ...(pageToken ? { pageToken } : {}),
      }),
      timeoutMs: 20_000,
    });
    const data = (await res.json().catch(() => ({}))) as { places?: PlacesPlace[]; nextPageToken?: string; error?: { message?: string } };
    addCost({ provider: "google", agent: "scout", usd: PRICES.googleTextSearch, units: 1, unit: "request", note: `search ${opts.query} ${opts.city}` });
    if (!res.ok) throw new Error(`Google Places: ${data.error?.message ?? `HTTP ${res.status}`}`);
    for (const p of data.places ?? []) {
      const comp = (t: string) => p.addressComponents?.find((c) => c.types.includes(t));
      out.push({
        sourceId: p.id,
        name: p.displayName?.text ?? "Unnamed business",
        address: p.formattedAddress,
        city: comp("locality")?.longText ?? comp("postal_town")?.longText ?? opts.city,
        region: comp("administrative_area_level_1")?.shortText ?? opts.region,
        country: (comp("country")?.shortText as Country | undefined) ?? opts.country,
        phone: p.nationalPhoneNumber,
        website: p.websiteUri,
        mapsUrl: p.googleMapsUri,
        lat: p.location?.latitude,
        lon: p.location?.longitude,
        rating: p.rating,
        reviewCount: p.userRatingCount ?? 0,
        hours: p.regularOpeningHours?.weekdayDescriptions,
        primaryType: p.primaryType,
        businessStatus: p.businessStatus,
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out.slice(0, opts.max);
}

/** Up to five recent reviews, for testimonials that are real. */
export async function googleReviews(placeId: string, leadId: string): Promise<Review[]> {
  if (!keys.google) return [];
  const res = await fetchWithTimeout(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { "X-Goog-Api-Key": keys.google, "X-Goog-FieldMask": "reviews" },
    timeoutMs: 15_000,
  });
  addCost({ provider: "google", agent: "builder", leadId, usd: PRICES.googleDetails, units: 1, unit: "request", note: "reviews" });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as {
    reviews?: { rating?: number; text?: { text?: string }; originalText?: { text?: string }; authorAttribution?: { displayName?: string }; relativePublishTimeDescription?: string }[];
  };
  return (data.reviews ?? [])
    .map((r) => ({
      author: r.authorAttribution?.displayName ?? "A Google reviewer",
      rating: r.rating ?? 5,
      text: (r.originalText?.text ?? r.text?.text ?? "").trim(),
      when: r.relativePublishTimeDescription,
    }))
    .filter((r) => r.text.length > 20);
}
