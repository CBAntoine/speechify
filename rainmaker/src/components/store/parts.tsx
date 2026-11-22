"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check, MessageSquare, Mic, Sparkles } from "lucide-react";
import { ANNUAL_MONTHS, dollars } from "@/lib/catalog";
import type { OfferView } from "@/lib/store-view";
import { findOffer, openAssistant, openCheckout, useStore } from "./bus";
import { OfferIcon } from "./icons";

type Interval = "month" | "year";

/** Opens the AI assistant. Renders nothing when the assistant isn't set up. */
export function TalkButton({ mode = "voice", label, className = "btn btn-talk xl" }: { mode?: "voice" | "text"; label?: string; className?: string }) {
  const store = useStore();
  if (!store.assistant) return null;
  return (
    <button type="button" className={className} onClick={() => openAssistant({ mode })}>
      {mode === "voice" ? <span className="orb" /> : <MessageSquare size={18} />}
      {label ?? (mode === "voice" ? `Talk to ${store.settings.assistantName}, our AI` : "Chat instead")}
    </button>
  );
}

export function AskButton({ text, label = "Ask AI", className = "btn" }: { text: string; label?: string; className?: string }) {
  const store = useStore();
  if (!store.assistant) return null;
  return (
    <button type="button" className={className} onClick={() => openAssistant({ ask: text })}>
      <Sparkles size={15} /> {label}
    </button>
  );
}

export function CheckoutButton({ offerId, interval, label = "Get started", className = "btn primary lg" }: { offerId: string; interval?: Interval; label?: string; className?: string }) {
  return (
    <button type="button" className={className} onClick={() => openCheckout({ offerId, interval })}>
      {label} <ArrowRight size={17} />
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
        <span>/month</span>
      </div>
      <div className="price-note" style={{ marginTop: 6 }}>
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
          <div className="store-kicker">Plans</div>
          <h2 className="store-h2">Pick a plan. We build it and run it.</h2>
          <p className="store-sub">Every plan is done for you: setup, voices, training on your business and monthly tuning. No contracts.</p>
        </div>
        {store.settings.annual && <BillingToggle value={interval} onChange={setInterval} />}
      </div>
      <div className="plans">
        {store.plans.map((p) => (
          <article key={p.id} id={`offer-${p.id}`} className={`plan ${p.highlight ? "highlight" : ""}`}>
            {p.highlight && <span className="plan-badge">Most popular</span>}
            <div>
              <h3>{p.name}</h3>
              <p className="tagline">{p.tagline}</p>
            </div>
            <PriceLine offer={p} interval={interval} />
            {p.worth && p.worth > p.price && <div className="worth">Worth {dollars(p.worth, { currency: c })}/mo bought separately</div>}
            <ul className="checklist">
              {p.included.map((x) => (
                <li key={x}>
                  <Check size={16} /> {x}
                </li>
              ))}
            </ul>
            <div className="plan-actions">
              <CheckoutButton offerId={p.id} interval={interval} label={`Start ${p.name}`} className={`btn ${p.highlight ? "primary" : ""} lg`} />
              <div className="row" style={{ gap: 8 }}>
                <Link className="btn" style={{ flex: 1 }} href={`/store/${p.slug}`}>
                  Details
                </Link>
                <AskButton text={`Tell me about the ${p.name} plan. What exactly is included and is it right for my business?`} className="btn" />
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

export function ProductCatalog() {
  const store = useStore();
  const [cat, setCat] = useState<string>("all");
  const c = store.settings.currency;
  const list = store.products.filter((p) => cat === "all" || p.category === cat);
  const active = store.categories.find((x) => x.id === cat);
  return (
    <>
      <div className="cat-tabs" role="group" aria-label="Filter by category">
        <button type="button" className="cat-tab" aria-pressed={cat === "all"} onClick={() => setCat("all")}>
          All ({store.products.length})
        </button>
        {store.categories.map((x) => (
          <button key={x.id} type="button" className="cat-tab" aria-pressed={cat === x.id} onClick={() => setCat(x.id)}>
            {x.label}
          </button>
        ))}
      </div>
      {active && <p className="cat-blurb">{active.blurb}</p>}
      <div className="offer-grid">
        {list.map((p) => (
          <article key={p.id} id={`offer-${p.id}`} className="offer-card">
            <div className="offer-top">
              <span className="offer-icon">
                <OfferIcon name={p.icon} />
              </span>
              <h3>{p.name}</h3>
            </div>
            <p>{p.tagline}</p>
            <ul className="checklist small">
              {p.included.slice(0, 3).map((x) => (
                <li key={x}>
                  <Check size={15} /> {x}
                </li>
              ))}
            </ul>
            <div className="offer-price">
              <b>{dollars(p.price, { currency: c })}</b>
              <span>/mo{p.setupFee ? ` + ${dollars(p.setupFee, { currency: c })} setup` : ", no setup fee"}</span>
            </div>
            <div className="offer-actions">
              <Link className="btn" href={`/store/${p.slug}`}>
                Details
              </Link>
              <CheckoutButton offerId={p.id} label="Start" className="btn primary" />
            </div>
          </article>
        ))}
      </div>
    </>
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
      <CheckoutButton offerId={offer.id} interval={interval} label={`Start ${offer.kind === "plan" ? offer.name : "now"}`} className="btn primary xl" />
      {store.assistant && (
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn" style={{ flex: 1 }} onClick={() => openAssistant({ ask: `Explain the ${offer.name} in detail for my business.` })}>
            <Mic size={15} /> Ask {store.settings.assistantName}
          </button>
        </div>
      )}
      <div className="faint small">{offer.timeToLive} · Cancel anytime</div>
      {plan && (
        <div className="upsell">
          Included in the <b>{plan.name}</b> plan with {plan.bundles!.length - 1} other services for {dollars(plan.price, { currency: store.settings.currency })}/mo.{" "}
          <Link className="text-link" href={`/store/${plan.slug}`}>
            Compare
          </Link>
        </div>
      )}
    </aside>
  );
}
