import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, ChevronRight, Info } from "lucide-react";
import { AskButton, CtaBand, OfferCard, PriceBox } from "@/components/store/parts";
import { toneOf } from "@/components/store/tone";
import { dollars } from "@/lib/catalog";
import { findOfferView, getStoreView } from "@/lib/store-view";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const v = await getStoreView();
  const o = findOfferView(v, (await params).slug);
  if (!o) return { title: "Not found" };
  return { title: o.name, description: `${o.tagline} ${o.summary}`.slice(0, 300), openGraph: { title: `${o.name} · ${v.brand.name}`, description: o.tagline } };
}

export default async function OfferPage({ params }: Props) {
  const v = await getStoreView();
  const o = findOfferView(v, (await params).slug);
  if (!o || !v.settings.enabled) notFound();
  const c = v.settings.currency;
  const category = v.categories.find((x) => x.id === o.category);
  const bundled = (o.bundles ?? []).map((id) => findOfferView(v, id)).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const related = o.kind === "product" ? v.products.filter((p) => p.category === o.category && p.id !== o.id).slice(0, 3) : [];
  const setupText = o.setupFee
    ? `${dollars(o.setupFee, { currency: c })} setup${v.settings.annual && v.settings.waiveSetupOnAnnual ? ", waived on yearly" : ""}`
    : "No setup fee";

  return (
    <>
      <div className="pd">
        <div className="store-wrap">
          <nav className="crumbs" aria-label="Breadcrumb">
            <Link href="/store">Store</Link>
            <ChevronRight size={14} aria-hidden />
            <Link href={o.kind === "plan" ? "/store#plans" : "/store#services"}>{o.kind === "plan" ? "Plans" : category?.label ?? "Services"}</Link>
            <ChevronRight size={14} aria-hidden />
            <span>{o.name}</span>
          </nav>

          <div className="pd-hero">
            <h1>
              {o.kind === "plan" ? `${o.name} plan` : o.name}
              <em>{o.tagline}</em>
            </h1>
            <div>
              <p className="store-lede">{o.summary}</p>
              <div className="pd-facts">
                <span>
                  <Check size={15} aria-hidden /> {o.timeToLive}
                </span>
                <span>
                  <Check size={15} aria-hidden /> {setupText}
                </span>
                <span>
                  <Check size={15} aria-hidden /> Cancel anytime
                </span>
              </div>
            </div>
          </div>

          <div className="pd-visual">
            <div className="pd-orb">
              <span className={`orb ${toneOf(o)}`} aria-hidden />
            </div>
            <PriceBox offerId={o.id} />
          </div>

          <div className="pd-sections">
            <section className="pd-card">
              <h2>Included every month</h2>
              <ul className="checklist">
                {o.included.map((x) => (
                  <li key={x}>
                    <Check size={16} aria-hidden /> {x}
                  </li>
                ))}
              </ul>
            </section>

            <section className="pd-card">
              <h2>What it does for you</h2>
              <ul className="checklist">
                {o.features.map((x) => (
                  <li key={x}>
                    <Check size={16} aria-hidden /> {x}
                  </li>
                ))}
              </ul>
            </section>

            {bundled.length > 0 && (
              <section className="pd-card span">
                <h2>Services in this plan</h2>
                <div className="chips">
                  {bundled.map((b) => (
                    <Link key={b.id} href={`/store/${b.slug}`} className="chip">
                      {b.name}
                    </Link>
                  ))}
                </div>
                {o.worth && o.worth > o.price && (
                  <p className="engine-line" style={{ marginTop: 14 }}>
                    Bought separately these cost {dollars(o.worth, { currency: c })} a month. In {o.name}: {dollars(o.price, { currency: c })}.
                  </p>
                )}
              </section>
            )}

            <section className="pd-card">
              <h2>How it works</h2>
              <ol className="pd-steps">
                {o.howItWorks.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ol>
            </section>

            <section className="pd-card">
              <h2>Example</h2>
              <p className="example">{o.example}</p>
            </section>

            <section className="pd-card">
              <h2>Made for</h2>
              <div className="chips">
                {o.idealFor.map((x) => (
                  <span key={x} className="chip">
                    {x}
                  </span>
                ))}
              </div>
            </section>

            <section className="pd-card">
              <h2>What we deliver</h2>
              <ul className="checklist">
                {o.deliverables.map((x) => (
                  <li key={x}>
                    <Check size={16} aria-hidden /> {x}
                  </li>
                ))}
              </ul>
              <p className="engine-line" style={{ marginTop: 14 }}>
                {o.timeToLive}.{o.setupFee ? ` One-time setup of ${dollars(o.setupFee, { currency: c })}${v.settings.annual && v.settings.waiveSetupOnAnnual ? ", waived on yearly billing" : ""}.` : " No setup fee."}
                {(o.id === "ai-receptionist" || o.kind === "plan" || o.id === "follow-up-calls") &&
                  ` Extra call minutes beyond what's included: ${dollars(v.settings.overagePerMinute, { cents: true, currency: c })} per minute.`}
                {v.settings.showEngine && ` Built on ${o.engine.join(", ")}; delivered and supported by ${v.brand.name}.`}
              </p>
            </section>

            {o.fineprint && (
              <section className="pd-card span">
                <div className="fineprint">
                  <Info size={18} style={{ flex: "none", marginTop: 1 }} aria-hidden />
                  <span>{o.fineprint}</span>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>

      <section className="store-section pd-more">
        <div className="store-wrap faq-grid">
          <div>
            <h2 className="store-h2">
              Questions about <em>{o.kind === "plan" ? `the ${o.name} plan` : o.name}</em>
            </h2>
            <div className="faq-more">
              <AskButton text={`I have a question about ${o.name}.`} label="Ask another question" />
            </div>
          </div>
          <div className="faq">
            {o.faqs.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {related.length > 0 && (
        <section className="store-section pd-more">
          <div className="store-wrap">
            <h2 className="store-h2">
              Often paired with <em>{o.name}</em>
            </h2>
            <div className="offer-grid">
              {related.map((r) => (
                <OfferCard key={r.id} offerId={r.id} />
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="store-section cta">
        <div className="store-wrap">
          <CtaBand title={`Ready for ${o.kind === "plan" ? `the ${o.name} plan` : `your ${o.name}`}?`} text="Monthly or yearly billing. Cancel anytime." />
        </div>
      </section>
    </>
  );
}
