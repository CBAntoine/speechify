import "server-only";
import { friendlyNetError } from "@/lib/net";
import type { Niche } from "@/lib/niches";
import type { Prospect } from "@/lib/types";
import {
  categoryFits,
  fromCalgary,
  fromEdmonton,
  fromToronto,
  fromVancouver,
  nameKey,
  namePattern,
  socrataWhere,
  tidyName,
  torontoQuery,
  vancouverWhere,
  type LicenceRecord,
} from "./opendata-parse";
import { distanceKm } from "./osm-parse";

// Live business-licence lists from city open-data portals. Each is an
// official API published for programmatic use under the city's open
// government licence.

const UA = "Rainmaker/0.1 (self-hosted agency CRM)";

interface CitySource {
  id: string;
  label: string;
  /** Address cities that are this city itself ("NORTH YORK" is Toronto). */
  ownCity: RegExp;
  /** The dataset page, for attribution. */
  url: string;
  center: { lat: number; lon: number };
  /** Searches whose centre is this close (km) are "in" the city. */
  cityKm: number;
  /** Searches this close may use the list, matched by address city (Toronto licenses GTA contractors). */
  reachKm: number;
  fetch(like: string[]): Promise<LicenceRecord[]>;
}

async function getJson<T>(url: string): Promise<T> {
  let res: Response | undefined;
  let lastError: unknown;
  // One retry: some portals drop a connection now and then.
  for (let attempt = 0; attempt < 2 && !res; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1_500));
    try {
      res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      lastError = err;
    }
  }
  if (!res) throw new Error(friendlyNetError(lastError, 15_000));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

const today = () => new Date().toISOString().slice(0, 10);
const pick = (rows: Record<string, unknown>[], conv: (r: Record<string, unknown>) => LicenceRecord | undefined) =>
  rows.map(conv).filter((r): r is LicenceRecord => !!r);

export const CITY_SOURCES: CitySource[] = [
  {
    id: "toronto",
    label: "City of Toronto business licences",
    ownCity: /^(TORONTO|NORTH YORK|SCARBOROUGH|ETOBICOKE|EAST YORK|YORK)$/,
    url: "https://open.toronto.ca/dataset/municipal-licensing-and-standards-business-licences-and-permits/",
    center: { lat: 43.7, lon: -79.42 },
    cityKm: 22,
    reachKm: 60,
    async fetch(like) {
      const q = torontoQuery(like);
      if (!q) return [];
      const url = `https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search?${new URLSearchParams({
        resource_id: "169e90ba-3ae0-43dd-8b2f-919e87002f50",
        q: JSON.stringify({ "Operating Name": q }),
        plain: "false",
        sort: "Issued desc",
        limit: "700",
      })}`;
      const d = await getJson<{ result?: { records?: Record<string, unknown>[] } }>(url);
      return pick(d.result?.records ?? [], fromToronto);
    },
  },
  {
    id: "vancouver",
    label: "City of Vancouver business licences",
    ownCity: /^VANCOUVER$/,
    url: "https://opendata.vancouver.ca/explore/dataset/business-licences/",
    center: { lat: 49.261, lon: -123.114 },
    cityKm: 12,
    reachKm: 12,
    async fetch(like) {
      const base = {
        where: vancouverWhere(like, new Date().getFullYear()),
        select: "businessname,businesstradename,businesstype,unit,house,street,postalcode,geo_point_2d,licencenumber",
        order_by: "folderyear desc",
        limit: "100",
      };
      const out: LicenceRecord[] = [];
      for (const offset of [0, 100, 200]) {
        const url = `https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/business-licences/records?${new URLSearchParams({ ...base, offset: String(offset) })}`;
        const d = await getJson<{ results?: Record<string, unknown>[] }>(url);
        out.push(...pick(d.results ?? [], fromVancouver));
        if ((d.results?.length ?? 0) < 100) break;
      }
      return out;
    },
  },
  {
    id: "calgary",
    label: "City of Calgary business licences",
    ownCity: /^CALGARY$/,
    url: "https://data.calgary.ca/d/vdjc-pybd",
    center: { lat: 51.045, lon: -114.072 },
    cityKm: 25,
    reachKm: 25,
    async fetch(like) {
      const url = `https://data.calgary.ca/resource/vdjc-pybd.json?${new URLSearchParams({
        $select: "tradename,address,licencetypes,point,getbusid",
        $where: socrataWhere("tradename", like, "jobstatusdesc='Licensed'"),
        $limit: "1000",
      })}`;
      return pick(await getJson<Record<string, unknown>[]>(url), fromCalgary);
    },
  },
  {
    id: "edmonton",
    label: "City of Edmonton business licences",
    ownCity: /^EDMONTON$/,
    url: "https://data.edmonton.ca/d/qhi4-bdpu",
    center: { lat: 53.546, lon: -113.494 },
    cityKm: 25,
    reachKm: 25,
    async fetch(like) {
      const url = `https://data.edmonton.ca/resource/qhi4-bdpu.json?${new URLSearchParams({
        $select: "business_name,business_address,business_licence_category,latitude,longitude,externalid",
        $where: socrataWhere("business_name", like, `expiry_date >= '${today()}'`),
        $limit: "1000",
      })}`;
      return pick(await getJson<Record<string, unknown>[]>(url), fromEdmonton);
    },
  },
];

export interface OpenDataResult {
  prospects: Prospect[];
  used: { id: string; label: string; url: string; count: number }[];
  errors: string[];
}

/** Licensed businesses of a niche around a point, from the cities that publish licence lists. */
export async function searchOpenData(params: {
  niche: Niche;
  center: { lat: number; lon: number };
  radiusKm: number;
  /** The searched town ("Oakville"), to match records that only give an address city. */
  town?: string;
}): Promise<OpenDataResult> {
  const { niche, center, radiusKm } = params;
  const pattern = namePattern(niche);
  const out: OpenDataResult = { prospects: [], used: [], errors: [] };
  if (!pattern) return out;
  const town = params.town?.trim().toUpperCase();
  const sources = CITY_SOURCES.filter((s) => distanceKm(s.center.lat, s.center.lon, center.lat, center.lon) <= s.reachKm + radiusKm);

  await Promise.all(
    sources.map(async (s) => {
      let records: LicenceRecord[];
      try {
        records = await s.fetch(pattern.like);
      } catch (err) {
        out.errors.push(`${s.label}: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      const inCity = distanceKm(s.center.lat, s.center.lon, center.lat, center.lon) <= s.cityKm;
      const seen = new Set<string>();
      const found: (Prospect & { _d: number })[] = [];
      for (const r of records) {
        if (!pattern.re.test(r.name) || !categoryFits(niche.id, r.category)) continue;
        let d = Number.POSITIVE_INFINITY;
        if (r.lat !== undefined && r.lon !== undefined) {
          d = distanceKm(center.lat, center.lon, r.lat, r.lon);
          if (d > radiusKm * 1.25) continue;
        } else if (r.addressCity) {
          // Only the address city is known: keep it when it's this city and
          // the search is here, or when it's the town searched for.
          const ok = (inCity && s.ownCity.test(r.addressCity)) || (!!town && r.addressCity === town);
          if (!ok) continue;
        } else if (!inCity) {
          // Home-based or no address: we only know it's licensed in this city.
          continue;
        }
        const key = nameKey(r.name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        found.push({
          key: `od:${r.city}:${r.id}`,
          name: tidyName(r.name),
          niche: niche.id,
          category: niche.label.toLowerCase(),
          address: r.address,
          city: r.addressCity ? tidyName(r.addressCity) : undefined,
          phone: r.phone,
          lat: r.lat,
          lon: r.lon,
          source: "open_data",
          sourceId: `${r.city}/${r.id}`,
          foundIn: [s.label],
          _d: d,
        });
      }
      found.sort((a, b) => a._d - b._d);
      out.prospects.push(...found.map(({ _d, ...p }) => p));
      out.used.push({ id: s.id, label: s.label, url: s.url, count: found.length });
    })
  );
  return out;
}
