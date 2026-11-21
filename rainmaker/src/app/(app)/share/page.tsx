import type { Metadata } from "next";
import { ShareActions } from "@/components/ShareActions";
import { PageHead } from "@/components/ui";
import { NICHES } from "@/lib/niches";
import { getProfile } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shared to Rainmaker" };

const URL_RE = /https?:\/\/[^\s<>"]+/i;

/** Split what another app shared into a business name, a website and a map link. */
function parseShare(title?: string, text?: string, url?: string) {
  const all = [url, text, title].filter(Boolean).join("\n");
  const links = Array.from(all.matchAll(new RegExp(URL_RE, "gi")), (m) => m[0].replace(/[).,]+$/, ""));
  const isMap = (u: string) => /(^https?:\/\/)?(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps|maps\.google\.)/i.test(u);
  const mapsUrl = links.find(isMap);
  const website = links.find((u) => !isMap(u) && !/google\.[a-z.]+\/search|facebook\.com|instagram\.com|yelp\.com/i.test(u));
  const firstLine = (s?: string) => s?.replace(URL_RE, "").split("\n").map((x) => x.trim()).find(Boolean);
  const name = (firstLine(title) ?? firstLine(text) ?? "").replace(/\s+[-–|·].*$/, "").slice(0, 120);
  return { name, website, mapsUrl, raw: all.slice(0, 600) };
}

export default async function SharePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const shared = parseShare(one(sp.title), one(sp.text), one(sp.url));
  const profile = await getProfile();
  return (
    <div className="page">
      <PageHead title="Shared to Rainmaker" sub="Turn a business you found in another app into a lead, an audit or sample ads." />
      <ShareActions
        shared={shared}
        niches={NICHES.map((n) => ({ id: n.id, label: n.label }))}
        defaultNiche={profile.targetNiches[0] ?? NICHES[0].id}
        defaultCity={profile.city}
      />
    </div>
  );
}
