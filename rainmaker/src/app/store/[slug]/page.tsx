import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, ChevronRight, Info } from "lucide-react";
import { OfferIcon } from "@/components/store/icons";
import { AskButton, PriceBox } from "@/components/store/parts";
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

  return (
    <div className="store-wrap">
      <div className="pd-hero">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link href="/store">Store</Link>
          <ChevronRight size={14} />
          <Link href={o.kind === "plan" ? "/store#plans" : "/store#services"}>{o.kind === "plan" ? "Plans" : category?.label ?? "Services"}</Link>
          <ChevronRight size={14} />
          <span>{o.name}</span>
        </nav>
      </div>
      <div className="pd-grid">
        <div>
          <div className="pd-title">
            <span className="offer-icon">
              <OfferIcon name={o.icon} size={28} />
            </span>
            <div>
              <h1>{o.kind === "plan" ? `${o.name} plan` : o.name}</h1>
              <div className="muted" style={{ fontSize: 17, marginTop: 6 }}>
                {o.tagline}
              </div>
            </div>
          </div>
          <p className="pd-summary">{o.summary}</p>

          <div className="pd-block">
            <h2>Included every month</h2>
            <ul className="checklist">
              {o.included.map((x) => (
                <li key={x}>
                  <Check size={16} /> {x}
                </li>
              ))}
            </ul>
          </div>

          {bundled.length > 0 && (
            <div className="pd-block">
              <h2>Services in this plan</h2>
              <div className="chips">
                {bundled.map((b) => (
                  <Link key={b.id} href={`/store/${b.slug}`} className="chip">
                    {b.name}
                  </Link>
                ))}
              </div>
              {o.worth && o.worth > o.price && (
                <p className="faint small" style={{ marginTop: 10 }}>
                  Bought separately these cost {dollars(o.worth, { currency: c })} a month. In {o.name}: {dollars(o.price, { currency: c })}.
                </p>
              )}
            </div>
          )}

          <div className="pd-block">
            <h2>What it does for you</h2>
            <ul className="checklist">
              {o.features.map((x) => (
                <li key={x}>
                  <Check size={16} /> {x}
                </li>
              ))}
            </ul>
          </div>

          <div className="pd-block">
            <h2>How it works</h2>
            <ol className="pd-steps">
              {o.howItWorks.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ol>
          </div>

          <div className="pd-block">
            <h2>Example</h2>
            <div className="example">{o.example}</div>
          </div>

          <div className="pd-block">
            <h2>Made for</h2>
            <div className="chips">
              {o.idealFor.map((x) => (
                <span key={x} className="chip">
                  {x}
                </span>
              ))}
            </div>
          </div>

          <div className="pd-block">
            <h2>What we deliver</h2>
            <ul className="checklist">
              {o.deliverables.map((x) => (
                <li key={x}>
                  <Check size={16} /> {x}
                </li>
              ))}
            </ul>
            <p className="faint small" style={{ marginTop: 10 }}>
              {o.timeToLive}.{o.setupFee ? ` One-time setup of ${dollars(o.setupFee, { currency: c })}${v.settings.annual && v.settings.waiveSetupOnAnnual ? ", waived on yearly billing" : ""}.` : " No setup fee."}
              {(o.id === "ai-receptionist" || o.kind === "plan" || o.id === "follow-up-calls") &&
                ` Extra call minutes beyond what's included: ${dollars(v.settings.overagePerMinute, { cents: true, currency: c })} per minute.`}
            </p>
          </div>

          {o.fineprint && (
            <div className="pd-block">
              <div className="fineprint">
                <Info size={18} style={{ flex: "none", marginTop: 1 }} />
                <span>{o.fineprint}</span>
              </div>
            </div>
          )}

          <div className="pd-block">
            <h2>Questions</h2>
            <div className="faq" style={{ marginTop: 0 }}>
              {o.faqs.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
            <div style={{ marginTop: 14 }}>
              <AskButton text={`I have a question about ${o.name}.`} label="Ask another question" />
            </div>
          </div>

          {v.settings.showEngine && <p className="engine-line pd-block">Built on: {o.engine.join(" · ")}. Delivered and supported by {v.brand.name}.</p>}

          {related.length > 0 && (
            <div className="pd-block">
              <h2>Often paired with</h2>
              <div className="chips">
                {related.map((r) => (
                  <Link key={r.id} href={`/store/${r.slug}`} className="chip">
                    {r.name} · {dollars(r.price, { currency: c })}/mo
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
        <PriceBox offerId={o.id} />
      </div>
    </div>
  );
}
