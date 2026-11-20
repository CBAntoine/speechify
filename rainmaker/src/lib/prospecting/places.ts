import "server-only";
import type { Niche } from "@/lib/niches";
import { expandPlace } from "@/lib/regions";
import type { Prospect } from "@/lib/types";

// Google Places API (New), Text Search. Needs GOOGLE_PLACES_API_KEY with the
// "Places API (New)" enabled. Returns ratings and review counts, which
// OpenStreetMap doesn't have.

const FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.location",
  "places.googleMapsUri",
  "places.businessStatus",
  "places.primaryTypeDisplayName",
  "nextPageToken",
].join(",");

type PlacesResponse = {
  places?: {
    id: string;
    displayName?: { text: string };
    formattedAddress?: string;
    nationalPhoneNumber?: string;
    websiteUri?: string;
    rating?: number;
    userRatingCount?: number;
    location?: { latitude: number; longitude: number };
    googleMapsUri?: string;
    businessStatus?: string;
    primaryTypeDisplayName?: { text: string };
  }[];
  nextPageToken?: string;
  error?: { message?: string };
};

export function placesEnabled(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY);
}

export async function searchPlaces(params: {
  niche: Niche;
  location: string;
  limit: number;
  /** Search around a point (the phone's location) instead of a named place. */
  near?: { lat: number; lon: number; radiusKm: number };
}): Promise<Prospect[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error("GOOGLE_PLACES_API_KEY is not set");
  // "London, ON" → "London, Ontario, Canada", with Canada as the region, so
  // Google doesn't pick another country's London.
  const place = expandPlace(params.location);
  const out: Prospect[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 3 && out.length < params.limit; page++) {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": FIELDS,
      },
      body: JSON.stringify({
        textQuery: params.near ? params.niche.query : `${params.niche.query} in ${place.query}`,
        pageSize: 20,
        ...(place.countryCode && !params.near ? { regionCode: place.countryCode.toUpperCase() } : {}),
        ...(params.near
          ? { locationBias: { circle: { center: { latitude: params.near.lat, longitude: params.near.lon }, radius: Math.min(50_000, params.near.radiusKm * 1000) } } }
          : {}),
        ...(pageToken ? { pageToken } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json()) as PlacesResponse;
    if (!res.ok) throw new Error(`Google Places search failed: ${data.error?.message ?? `HTTP ${res.status}`}`);
    for (const p of data.places ?? []) {
      if (p.businessStatus === "CLOSED_PERMANENTLY") continue;
      out.push({
        key: `gp:${p.id}`,
        name: p.displayName?.text ?? "Unnamed business",
        niche: params.niche.id,
        category: p.primaryTypeDisplayName?.text,
        address: p.formattedAddress,
        phone: p.nationalPhoneNumber,
        website: p.websiteUri,
        mapsUrl: p.googleMapsUri,
        lat: p.location?.latitude,
        lon: p.location?.longitude,
        rating: p.rating,
        reviewCount: p.userRatingCount ?? 0,
        source: "google_places",
        sourceId: p.id,
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out.slice(0, params.limit);
}
