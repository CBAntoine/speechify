import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { VideoPageClient } from "@/components/video/VideoPageClient";
import { getOffer, priceOf } from "@/lib/catalog";
import { readDb } from "@/lib/store";
import { mediaUrl, videoByToken } from "@/lib/video/make";
import "../../store/store.css";
import "../video.css";

// A business's private video ad page, linked from the email. Never indexed.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const load = cache((token: string) => videoByToken(token));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const v = await load((await params).token);
  return { title: v ? `A video for ${v.business}` : "Video", robots: { index: false, follow: false } };
}

export default async function VideoPage({ params, searchParams }: Props) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const [video, db] = await Promise.all([load(token), readDb()]);
  if (!video) notFound();
  const profile = db.profile;
  const products = video.products
    .map((id) => getOffer(id))
    .filter((o): o is NonNullable<ReturnType<typeof getOffer>> => Boolean(o))
    .map((o) => ({ id: o.id, slug: o.slug, name: o.name, tagline: o.tagline, features: o.features.slice(0, 3), monthly: priceOf(o, db.store).monthly }));
  const mail = profile.email ? `mailto:${profile.email}?subject=${encodeURIComponent(`Re: the video for ${video.business}`)}` : undefined;
  return (
    <div className="store vpage">
      <header className="vpage-top">
        <div className="store-wrap row" style={{ gap: 10 }}>
          <span className="orb idle tone-sky" aria-hidden />
          <b>{profile.agencyName}</b>
          <span className="spacer" />
          <span className="faint small">Made for {video.business}</span>
        </div>
      </header>
      <main className="store-wrap vpage-main">
        <div className="vpage-intro">
          <h1>{video.business}, this one&apos;s for you</h1>
          <p>A short look at your business: what&apos;s working, what we noticed, and how we&apos;d help you win more customers. Press play; it has sound.</p>
        </div>
        <VideoPageClient
          token={video.token}
          preview={sp.preview === "1"}
          scenes={video.scenes}
          timing={video.timing}
          brand={video.brand}
          logoUrl={video.brand.logo ? mediaUrl(video.token, video.brand.logo) : undefined}
          photoUrl={video.brand.photo ? mediaUrl(video.token, video.brand.photo) : undefined}
          voiceUrl={video.voiceover ? mediaUrl(video.token, video.voiceover.assetId) : undefined}
          business={video.business}
          agency={profile.agencyName}
          format={video.format}
          products={products}
        />
        <section className="vpage-products">
          <h2>What we&apos;d set up for you</h2>
          <div className="vpage-grid">
            {products.map((p) => (
              <article key={p.id} className="vpage-card">
                <b>{p.name}</b>
                <span className="muted">{p.tagline}</span>
                <ul>
                  {p.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <div className="row between" style={{ marginTop: "auto" }}>
                  <span className="faint small">from ${p.monthly}/mo</span>
                  <Link className="btn sm" href={`/store/${p.slug}?lead=${video.leadId}`}>
                    Details
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="vpage-cta">
          <h2>Want this for {video.business}?</h2>
          {!profile.calendarUrl && !mail && !profile.phone && <p className="muted">Reply to the email this link came in, and we&apos;ll set up a quick call.</p>}
          <div className="row wrap" style={{ gap: 8, justifyContent: "center" }}>
            {profile.calendarUrl && (
              <a className="btn primary" href={profile.calendarUrl} target="_blank" rel="noopener noreferrer">
                Book a quick call
              </a>
            )}
            {mail && (
              <a className={`btn ${profile.calendarUrl ? "" : "primary"}`} href={mail}>
                Reply by email
              </a>
            )}
            {profile.phone && (
              <a className="btn" href={`tel:${profile.phone.replace(/[^\d+]/g, "")}`}>
                Call {profile.phone}
              </a>
            )}
          </div>
        </section>
      </main>
      <footer className="store-wrap vpage-foot faint small">
        {profile.agencyName}
        {profile.mailingAddress ? ` · ${profile.mailingAddress}` : ""}. This page was made for {video.business} and isn&apos;t listed anywhere.
      </footer>
    </div>
  );
}
