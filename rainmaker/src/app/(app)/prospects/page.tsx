import type { Metadata } from "next";
import Link from "next/link";
import { ProspectFinder } from "@/components/prospects/ProspectFinder";
import { RedditBuyers } from "@/components/prospects/RedditBuyers";
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
  const reddit = one(sp.mode) === "reddit";
  const modes = (
    <nav className="seg" aria-label="Where to look" style={{ marginBottom: 16 }}>
      <Link href="/prospects" aria-current={reddit ? undefined : "page"}>
        Businesses
      </Link>
      <Link href="/prospects?mode=reddit" aria-current={reddit ? "page" : undefined}>
        Reddit buyers
      </Link>
    </nav>
  );
  if (reddit) {
    return (
      <div className="page">
        <PageHead title="Find clients" sub="People who just asked on Reddit for what you sell: recommendations, alternatives, someone who got burned. Reach them while the post is fresh." />
        {modes}
        <RedditBuyers />
      </div>
    );
  }
  return (
    <div className="page">
      <PageHead
        title="Find clients"
        sub={
          <>
            Search a niche in any city. Every result is checked for the gaps agencies sell against and scored by need and ability to pay.{" "}
            <span className="faint">
              Data:{" "}
              {i.googlePlaces
                ? "Google Places"
                : `OpenStreetMap, city licence lists${i.claude ? ", Claude web research" : ""} and Rainmaker's own crawler`}
              .
            </span>
          </>
        }
      />
      {modes}
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
