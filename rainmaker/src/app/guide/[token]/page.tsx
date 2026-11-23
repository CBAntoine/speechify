import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AutoPrint, GuideCallout, PrintButton } from "@/components/guide/GuideClient";
import { Assistant } from "@/components/store/Assistant";
import { getNiche } from "@/lib/niches";
import { brandColor, inkOn } from "@/lib/offers/brand-color";
import { guidePath, leadByGuideToken } from "@/lib/offers/guide";
import { getProfile } from "@/lib/repo";
import { siteUrlFrom } from "@/lib/site";
import "../../store/store.css";
import "../guide.css";

// A prospect's private sandbox: a one-page copy of their website with the AI
// guide the agency built from it, above the fold. Shown to the owner in the
// demo and linked from the pitch; never indexed.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

const load = cache((token: string) => leadByGuideToken(token));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lead = await load((await params).token);
  return { title: lead?.guide ? `${lead.name} · AI guide demo` : "AI guide demo", robots: { index: false, follow: false } };
}

const httpUrl = (u?: string) => (u ? (/^https?:\/\//i.test(u) ? u : `https://${u}`) : undefined);

export default async function GuidePage({ params }: Props) {
  const { token } = await params;
  const [lead, profile, h] = await Promise.all([load(token), getProfile(), headers()]);
  const g = lead?.guide;
  if (!lead || !g) notFound();

  const url = `${siteUrlFrom(h)}${guidePath(g.token)}`;
  const brand = g.brand ?? {};
  const accent = brandColor(brand.color);
  const niche = getNiche(lead.niche);
  const kind = niche && niche.id !== "custom" ? niche.label : undefined;
  const questions = g.questions.map((q) => q.q).slice(0, 5);
  const services = (brand.services ?? []).slice(0, 8);
  const tel = lead.phone ? `tel:${lead.phone.replace(/[^\d+]/g, "")}` : undefined;
  const site = httpUrl(lead.website);
  const headline = brand.headline && brand.headline.length > 5 ? brand.headline : lead.name;
  const style = { "--g": accent, "--g-ink": inkOn(accent) } as CSSProperties;

  return (
    <div className="store guide-site" style={style}>
      <AutoPrint />
      <div className="guide-print-url">
        Try it live: <mark>{url}</mark>
      </div>
      <div className="guide-bar">
        <span>
          <b>Sandbox demo</b>
          <span className="guide-bar-long"> of {lead.name}&apos;s website with an AI guide</span>, built by {profile.agencyName}. Not the live site.
        </span>
        <PrintButton />
      </div>

      <header className="guide-nav">
        <div className="guide-wrap">
          <span className="guide-brand">
            {brand.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logo} alt={`${lead.name} logo`} referrerPolicy="no-referrer" />
            ) : (
              <span className="guide-initial" aria-hidden>
                {lead.name.trim()[0]?.toUpperCase()}
              </span>
            )}
            <b>{lead.name}</b>
          </span>
          <span className="spacer" />
          {tel && (
            <a className="guide-phone" href={tel}>
              {lead.phone}
            </a>
          )}
        </div>
      </header>

      <main>
        <section className="guide-hero">
          <div className="guide-wrap guide-hero-grid">
            <div className="guide-top">
              {(kind || lead.city) && <span className="guide-eyebrow">{[kind, lead.city].filter(Boolean).join(" · ")}</span>}
              <h1>{headline}</h1>
            </div>
            <div className="guide-widget" id="ai-guide">
              <GuideCallout />
              <Assistant
                variant="inline"
                guideToken={g.token}
                title={`${g.name}, AI guide`}
                subtitle={`Chat or voice · answers from ${lead.name}'s website`}
                intro={`Hi, I'm ${g.name}, the AI guide for ${lead.name}. Ask me anything a customer would: services, prices, hours, booking.`}
                quick={questions}
              />
            </div>
            <div className="guide-more">
              <p>{brand.tagline || `Questions about ${kind ? kind.toLowerCase() : "our services"}${lead.city ? ` in ${lead.city.split(",")[0]}` : ""}? Ask ${g.name}, day or night.`}</p>
              <div className="guide-actions">
                {tel && (
                  <a className="btn guide-solid" href={tel}>
                    Call {lead.phone}
                  </a>
                )}
                {site && (
                  <a className="btn guide-ghost" href={site} target="_blank" rel="noopener noreferrer">
                    See the real site
                  </a>
                )}
              </div>
              {brand.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="guide-photo" src={brand.image} alt="" referrerPolicy="no-referrer" />
              )}
            </div>
          </div>
        </section>

        {services.length > 0 && (
          <section className="guide-section">
            <div className="guide-wrap">
              <h2>What {lead.name} does</h2>
              <ul className="guide-services">
                {services.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          </section>
        )}

        <section className="guide-section guide-try">
          <div className="guide-wrap">
            <h2>
              {questions.length === 5 ? "Five questions" : "Questions"} to ask {g.name}
            </h2>
            <ol>
              {questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ol>
            <p>
              {g.name} answers only from{" "}
              {g.pages.length
                ? `${lead.name}'s public website (${g.pages.length} page${g.pages.length === 1 ? "" : "s"}${g.faqs ? `, ${g.faqs} FAQs` : ""})`
                : `the details ${lead.name} gave us`}
              , always says it&apos;s an AI, and passes the team the name and number of every visitor who wants a quote, a booking or a callback. By voice it offers to text or
              email links; in chat it shares them.
            </p>
          </div>
        </section>
      </main>

      <footer className="guide-foot">
        <div className="guide-wrap">
          <span>
            {lead.name}
            {lead.address ? ` · ${lead.address}` : lead.city ? ` · ${lead.city}` : ""}
            {lead.phone ? ` · ${lead.phone}` : ""}
          </span>
          <span className="faint">
            Demo built by {profile.agencyName}
            {profile.phone ? ` · ${profile.phone}` : ""}
            {profile.email ? ` · ${profile.email}` : ""}. It isn&apos;t connected to your phone line or calendar.
          </span>
        </div>
      </footer>
    </div>
  );
}
