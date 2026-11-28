import type { Metadata } from "next";
import Link from "next/link";
import { AdStudio } from "@/components/ads/AdStudio";
import { MotionAdBuilder } from "@/components/motion/MotionAdBuilder";
import { VideoAdBuilder } from "@/components/video/VideoAdBuilder";
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
  const mode = one(sp.mode) === "video" ? "video" : one(sp.mode) === "motion" ? "motion" : "campaign";
  const lead = one(sp.lead);
  const q = (extra: string) => {
    const p = new URLSearchParams();
    if (extra) p.set("mode", extra);
    if (lead) p.set("lead", lead);
    const s = p.toString();
    return s ? `/ads?${s}` : "/ads";
  };
  return (
    <div className="page wide">
      <PageHead
        title="Ad Studio"
        sub="Tailored campaigns for any local business: strategy, Meta and Google ads, short-video scripts, landing copy and creative, checked against each platform's limits. A video ad for the owner, made from their real data. Or a motion-graphics ad in 4K, made in code."
      />
      <nav className="seg" aria-label="What to make" style={{ marginBottom: 16 }}>
        <Link href={q("")} aria-current={mode === "campaign" ? "page" : undefined}>
          Ad campaign
        </Link>
        <Link href={q("video")} aria-current={mode === "video" ? "page" : undefined}>
          Video ad
        </Link>
        <Link href={q("motion")} aria-current={mode === "motion" ? "page" : undefined}>
          Motion ad
        </Link>
      </nav>
      {mode === "motion" ? (
        <MotionAdBuilder
          key={lead ?? "motion"}
          leads={db.leads.filter((l) => l.stage !== "lost").map((l) => ({ id: l.id, name: l.name, niche: l.niche, city: l.city, website: l.website, phone: l.phone }))}
          initialLeadId={lead}
        />
      ) : mode === "video" ? (
        <VideoAdBuilder
          key={lead ?? "video"}
          leads={db.leads.filter((l) => l.stage !== "lost").map((l) => ({ id: l.id, name: l.name, niche: l.niche, city: l.city, website: l.website, email: l.email }))}
          initialLeadId={lead}
          agency={db.profile.agencyName}
        />
      ) : (
      <AdStudio
        key={[one(sp.campaign), one(sp.lead), one(sp.business)].join("|")}
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
        elevenlabs={integrations().elevenlabs}
      />
      )}
    </div>
  );
}
