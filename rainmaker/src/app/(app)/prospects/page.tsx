import type { Metadata } from "next";
import { ProspectFinder } from "@/components/prospects/ProspectFinder";
import { PageHead } from "@/components/ui";
import { integrations } from "@/lib/config";
import { NICHES } from "@/lib/niches";
import { getProfile } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Find clients" };

export default async function ProspectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const profile = await getProfile();
  const i = integrations();
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const niche = one(sp.niche) ?? profile.targetNiches[0] ?? "dentist";
  return (
    <div className="page">
      <PageHead
        title="Find clients"
        sub={
          <>
            Search a niche in any city. Every result is checked for the gaps agencies sell against and scored by need and ability to pay.{" "}
            <span className="faint">Data: {i.googlePlaces ? "Google Places" : "OpenStreetMap (free)"}.</span>
          </>
        }
      />
      <ProspectFinder
        niches={NICHES.map((n) => ({
          id: n.id,
          label: n.label,
          plural: n.plural,
          icon: n.icon,
          customerValue: n.customerValue,
          retainer: n.retainer,
          offers: n.offers,
          channels: n.channels,
          painPoints: n.painPoints,
          tip: n.tip,
          evidence: n.evidence,
        }))}
        initial={{ niche, location: one(sp.location) ?? profile.city, fromUrl: Boolean(one(sp.location)), go: one(sp.go) === "1" }}
        places={i.googlePlaces}
      />
    </div>
  );
}
