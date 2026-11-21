import type { Metadata } from "next";
import { AdStudio } from "@/components/ads/AdStudio";
import { PageHead } from "@/components/ui";
import { integrations } from "@/lib/config";
import { NICHES } from "@/lib/niches";
import { readDb } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ad Studio" };

export default async function AdsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const db = await readDb();
  return (
    <div className="page wide">
      <PageHead
        title="Ad Studio"
        sub="Tailored campaigns for any local business: strategy, Meta and Google ads, short-video scripts, landing copy and creative, checked against each platform's limits."
      />
      <AdStudio
        leads={db.leads.filter((l) => l.stage !== "lost").map((l) => ({ id: l.id, name: l.name, niche: l.niche, city: l.city, website: l.website }))}
        niches={NICHES.map((n) => ({ id: n.id, label: n.label, offers: n.offers, booking: n.booking }))}
        campaigns={db.campaigns}
        initial={{
          leadId: one(sp.lead),
          business: one(sp.business),
          niche: one(sp.niche),
          location: one(sp.location),
          website: one(sp.website),
          campaignId: one(sp.campaign),
        }}
        claude={integrations().claude}
      />
    </div>
  );
}
