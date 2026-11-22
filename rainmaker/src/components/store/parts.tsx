"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, CornerRightDown, MessageSquare, Mic } from "lucide-react";
import { ANNUAL_MONTHS, dollars } from "@/lib/catalog";
import type { OfferView } from "@/lib/store-view";
import { findOffer, openAssistant, openCheckout, useStore } from "./bus";
import { OfferOrb } from "./icons";
import { categoryTone, toneOf } from "./tone";

type Interval = "month" | "year";

/** Opens the AI assistant. Renders nothing when the assistant isn't set up. */
export function TalkButton({ mode = "voice", label, className = "btn btn-talk xl" }: { mode?: "voice" | "text"; label?: string; className?: string }) {
  const store = useStore();
  if (!store.assistant) return null;
  return (
    <button type="button" className={className} onClick={() => openAssistant({ mode })}>
      {mode === "voice" ? <span className="orb tone-sky" aria-hidden /> : <MessageSquare size={17} aria-hidden />}
      {label ?? (mode === "voice" ? `Talk to ${store.settings.assistantName}` : "Chat instead")}
    </button>
  );
}

export function AskButton({ text, label, className = "btn" }: { text: string; label?: string; className?: string }) {
  const store = useStore();
  if (!store.assistant) return null;
  return (
    <button type="button" className={className} onClick={() => openAssistant({ ask: text })}>
      <span className="orb idle tone-sky" aria-hidden /> {label ?? `Ask ${store.settings.assistantName}`}
    </button>
  );
}

export function CheckoutButton({ offerId, interval, label = "Get started", className = "btn primary lg" }: { offerId: string; interval?: Interval; label?: string; className?: string }) {
  return (
    <button type="button" className={className} onClick={() => openCheckout({ offerId, interval })}>
      {label}
    </button>
  );
}

function BillingToggle({ value, onChange }: { value: Interval; onChange: (v: Interval) => void }) {
  return (
    <div className="billing-toggle" role="group" aria-label="Billing period">
      <button type="button" aria-pressed={value === "month"} onClick={() => onChange("month")}>
        Monthly
      </button>
      <button type="button" aria-pressed={value === "year"} onClick={() => onChange("year")}>
        Yearly <span className="save-pill">2 months free</span>
      </button>
    </div>
  );
}

function PriceLine({ offer, interval }: { offer: OfferView; interval: Interval }) {
  const store = useStore();
  const c = store.settings.currency;
  const yearly = interval === "year";
  const setup = yearly ? offer.setupYearly : offer.setupFee;
  return (
    <div>
      <div className="price">
        <b>{dollars(yearly ? Math.round((offer.yearly / 12) * 100) / 100 : offer.price, { currency: c })}</b>
        <span>/mo</span>
      </div>
      <div className="price-note" style={{ marginTop: 8 }}>
        {yearly ? `${dollars(offer.yearly, { currency: c })} billed yearly (${ANNUAL_MONTHS} months' price)` : "Billed monthly, cancel anytime"}
        {setup > 0 ? ` · ${dollars(setup, { currency: c })} one-time setup` : offer.setupFee > 0 && yearly ? " · setup waived" : ""}
      </div>
    </div>
  );
}

export function PlanCards() {
  const store = useStore();
  const [interval, setInterval] = useState<Interval>("month");
  const c = store.settings.currency;
  return (
    <>
      <div className="section-head">
        <div>
          <div className="store-kicker">
            <span className="orb idle tone-ember" aria-hidden /> Plans
          </div>
          <h2 className="store-h2">
            Pick a plan. <em>We build it and run it.</em>
          </h2>
          <p className="store-sub">Every plan is done for you: setup, voices, training on your business and monthly tuning. No contracts.</p>
        </div>
        {store.settings.annual && <BillingToggle value={interval} onChange={setInterval} />}
      </div>
      <div className="plans">
        {store.plans.map((p) => {
          const inherits = p.included[0]?.startsWith("Everything in") ? p.included[0] : null;
          const items = inherits ? p.included.slice(1) : p.included;
          return (
            <article key={p.id} id={`offer-${p.id}`} className={`plan ${p.highlight ? "highlight" : ""}`}>
              <div className={`plan-tile ${p.highlight ? "grain-card" : ""}`}>
                <div>
                  <h3>{p.name}</h3>
                  {p.highlight && <span className="plan-badge">Most popular</span>}
                </div>
                <PriceLine offer={p} interval={interval} />
              </div>
              <p className="tagline">{p.tagline}</p>
              <div className="plan-actions">
                <CheckoutButton offerId={p.id} interval={interval} label={`Start ${p.name}`} className="btn primary lg block" />
                <div className="plan-links">
                  <Link className="btn sm" href={`/store/${p.slug}`}>
                    Details
                  </Link>
                  <AskButton text={`Tell me about the ${p.name} plan. What exactly is included and is it right for my business?`} className="btn sm" />
                </div>
              </div>
              <div className="plan-body">
                {inherits && (
                  <p className="plan-inherit">
                    {inherits}, plus <CornerRightDown size={14} aria-hidden />
                  </p>
                )}
                <ul className="checklist">
                  {items.map((x) => (
                    <li key={x}>
                      <Check size={16} aria-hidden /> {x}
                    </li>
                  ))}
                </ul>
              </div>
              {p.worth && p.worth > p.price && (
                <div className="worth">
                  Worth <b>{dollars(p.worth, { currency: c })}/mo</b> bought separately
                </div>
              )}
            </article>
          );
        })}
      </div>
      <p className="plans-note">Prices exclude applicable taxes. Monthly plans can be cancelled anytime.</p>
    </>
  );
}

export function OfferCard({ offerId }: { offerId: string }) {
  const store = useStore();
  const p = findOffer(store, offerId);
  if (!p) return null;
  const c = store.settings.currency;
  return (
    <article id={`offer-${p.id}`} className="offer-card">
      <div className="offer-top">
        <OfferOrb offer={p} />
        <h3>{p.name}</h3>
      </div>
      <p>{p.tagline}</p>
      <ul className="checklist small">
        {p.included.slice(0, 3).map((x) => (
          <li key={x}>
            <Check size={15} aria-hidden /> {x}
          </li>
        ))}
      </ul>
      <div className="offer-price">
        <b>{dollars(p.price, { currency: c })}</b>
        <span>/mo{p.setupFee ? ` + ${dollars(p.setupFee, { currency: c })} setup` : ", no setup fee"}</span>
      </div>
      <div className="offer-actions">
        <Link className="btn sm" href={`/store/${p.slug}`}>
          Details
        </Link>
        <CheckoutButton offerId={p.id} label="Start" className="btn primary sm" />
      </div>
    </article>
  );
}

export function ProductCatalog() {
  const store = useStore();
  const [cat, setCat] = useState<string>("all");
  const list = store.products.filter((p) => cat === "all" || p.category === cat);
  const active = store.categories.find((x) => x.id === cat);
  return (
    <>
      <div className="cat-tabs" role="group" aria-label="Filter by category">
        <button type="button" className="cat-tab" aria-pressed={cat === "all"} onClick={() => setCat("all")}>
          All services
        </button>
        {store.categories.map((x) => (
          <button key={x.id} type="button" className="cat-tab" aria-pressed={cat === x.id} onClick={() => setCat(x.id)}>
            <span className={`orb idle ${categoryTone(x.id)}`} aria-hidden /> {x.label}
          </button>
        ))}
      </div>
      {active && <p className="cat-blurb">{active.blurb}</p>}
      <div className="offer-grid">
        {list.map((p) => (
          <OfferCard key={p.id} offerId={p.id} />
        ))}
      </div>
    </>
  );
}

/** The home page's centrepiece: category tabs over a carousel of product orbs. */
export function Showcase() {
  const store = useStore();
  const cats = store.categories.filter((x) => store.products.some((p) => p.category === x.id));
  const [cat, setCat] = useState(cats[0]?.id ?? "");
  const [at, setAt] = useState(0);
  const items = store.products.filter((p) => p.category === cat);
  if (!items.length) return null;
  const n = items.length;
  const idx = ((at % n) + n) % n;
  const active = items[idx];
  const c = store.settings.currency;
  const go = (d: number) => setAt((v) => v + d);

  return (
    <div className="showcase">
      <div className="showcase-tabs" role="tablist" aria-label="Service categories">
        {cats.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            className="showcase-tab"
            aria-selected={cat === x.id}
            onClick={() => {
              setCat(x.id);
              setAt(0);
            }}
          >
            <span className={`orb idle ${categoryTone(x.id)}`} aria-hidden /> {x.label}
          </button>
        ))}
      </div>
      <div className="showcase-stage" role="tabpanel">
        <div className="orb-row">
          {items.map((p, i) => {
            let pos = i - idx;
            if (n > 2) {
              if (pos > n / 2) pos -= n;
              if (pos < -n / 2) pos += n;
            }
            const dist = Math.abs(pos);
            const hidden = dist > 2;
            const style = {
              "--k": Math.sign(pos) * (dist === 2 ? 1.82 : dist),
              "--s": dist === 0 ? 1 : dist === 1 ? 0.76 : 0.54,
              "--o": hidden ? 0 : dist === 2 ? 0.55 : 1,
              pointerEvents: hidden ? "none" : undefined,
            } as React.CSSProperties;
            return (
              <div key={p.id} className="orb-item" data-pos={pos} style={style} aria-hidden={hidden || undefined}>
                {dist === 0 ? (
                  <span className={`orb ${toneOf(p, i)}`} />
                ) : (
                  <button type="button" className="orb-item-btn" onClick={() => go(pos)} tabIndex={hidden ? -1 : 0} aria-label={`Show ${p.name}`}>
                    <span className={`orb idle ${toneOf(p, i)}`} />
                  </button>
                )}
                {dist === 0 && (
                  <button
                    type="button"
                    className="orb-play"
                    aria-label={store.assistant ? `Hear ${store.settings.assistantName} explain ${p.name}` : `See ${p.name}`}
                    onClick={() =>
                      store.assistant
                        ? openAssistant({ mode: "voice", ask: `Tell me about the ${p.name}: what it does for a business like mine and what it costs.` })
                        : (window.location.href = `/store/${p.slug}`)
                    }
                  >
                    {store.assistant ? <Mic size={24} aria-hidden /> : <ArrowUpRight size={24} aria-hidden />}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="orb-caption">
          <button type="button" className="orb-arrow" onClick={() => go(-1)} aria-label="Previous service" disabled={n < 2}>
            <ChevronLeft size={20} />
          </button>
          <div aria-live="polite">
            <Link href={`/store/${active.slug}`}>
              {active.name} <ArrowUpRight size={16} aria-hidden />
            </Link>
            <p>{active.tagline}</p>
            <div className="price-hint">From {dollars(active.price, { currency: c })}/mo</div>
          </div>
          <button type="button" className="orb-arrow" onClick={() => go(1)} aria-label="Next service" disabled={n < 2}>
            <ChevronRight size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function PriceBox({ offerId }: { offerId: string }) {
  const store = useStore();
  const offer = findOffer(store, offerId);
  const [interval, setInterval] = useState<Interval>("month");
  if (!offer) return null;
  const plan = offer.kind === "product" ? store.plans.find((p) => p.bundles?.includes(offer.id)) : undefined;
  return (
    <aside className="price-box" id={`offer-${offer.id}`}>
      {store.settings.annual && <BillingToggle value={interval} onChange={setInterval} />}
      <PriceLine offer={offer} interval={interval} />
      <div className="stack" style={{ gap: 8 }}>
        <CheckoutButton offerId={offer.id} interval={interval} label={`Start ${offer.kind === "plan" ? offer.name : "now"}`} className="btn primary xl block" />
        {store.assistant && (
          <button type="button" className="btn lg block" onClick={() => openAssistant({ ask: `Explain the ${offer.name} in detail for my business.` })}>
            <span className={`orb ${toneOf(offer)}`} aria-hidden /> Ask {store.settings.assistantName} about it
          </button>
        )}
      </div>
      <div className="meta">{offer.timeToLive} · Cancel anytime</div>
      {plan && (
        <div className="upsell">
          Included in the <b>{plan.name}</b> plan with {plan.bundles!.length - 1} other {plan.bundles!.length - 1 === 1 ? "service" : "services"} for {dollars(plan.price, { currency: store.settings.currency })}/mo.{" "}
          <Link className="text-link" href={`/store/${plan.slug}`}>
            Compare
          </Link>
        </div>
      )}
    </aside>
  );
}

/** Closing call to action: talk to the assistant, or see the plans. */
export function CtaBand({ title, text }: { title: string; text?: string }) {
  const store = useStore();
  return (
    <div className="cta-band">
      <div>
        <h2>{title}</h2>
        {text && <p>{text}</p>}
      </div>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        {store.assistant ? (
          <TalkButton mode="voice" label={`Talk to ${store.settings.assistantName}`} className="btn lg" />
        ) : (
          store.brand.calendarUrl && (
            <a className="btn lg" href={store.brand.calendarUrl} target="_blank" rel="noopener">
              Book a call
            </a>
          )
        )}
        <a className="btn primary lg" href="/store#plans">
          See plans
        </a>
      </div>
    </div>
  );
}
