/**
 * CISA's Known Exploited Vulnerabilities (KEV) catalog, cut down to Fortinet
 * products. The runner downloads it on your machine and uploads only the
 * Fortinet entries, so the agent's sandbox needs no internet access.
 */

export const KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";

export interface KevEntry {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  shortDescription: string;
  requiredAction: string;
  dueDate: string;
  knownRansomwareCampaignUse: string;
  notes: string;
}

export interface KevFile {
  format: "fortigate-review kev-fortinet.json v1";
  source: string;
  catalog_version: string | null;
  date_released: string | null;
  count: number;
  vulnerabilities: KevEntry[];
}

export function fortinetKev(catalog: unknown, source: string): KevFile {
  const c = (catalog ?? {}) as Record<string, unknown>;
  if (!Array.isArray(c.vulnerabilities)) throw new Error("KEV: the file has no vulnerabilities list.");
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const vulnerabilities: KevEntry[] = (c.vulnerabilities as Record<string, unknown>[])
    .filter((v) => /fortinet/i.test(str(v.vendorProject)))
    .map((v) => ({
      cveID: str(v.cveID),
      vendorProject: str(v.vendorProject),
      product: str(v.product),
      vulnerabilityName: str(v.vulnerabilityName),
      dateAdded: str(v.dateAdded),
      shortDescription: str(v.shortDescription),
      requiredAction: str(v.requiredAction),
      dueDate: str(v.dueDate),
      knownRansomwareCampaignUse: str(v.knownRansomwareCampaignUse),
      notes: str(v.notes),
    }))
    .sort((a, b) => b.dateAdded.localeCompare(a.dateAdded));
  return {
    format: "fortigate-review kev-fortinet.json v1",
    source,
    catalog_version: typeof c.catalogVersion === "string" ? c.catalogVersion : null,
    date_released: typeof c.dateReleased === "string" ? c.dateReleased : null,
    count: vulnerabilities.length,
    vulnerabilities,
  };
}

export async function downloadFortinetKev(): Promise<KevFile> {
  const res = await fetch(KEV_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`KEV: CISA returned HTTP ${res.status}`);
  return fortinetKev(await res.json(), KEV_URL);
}
