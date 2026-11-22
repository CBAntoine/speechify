"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, Lock, X } from "lucide-react";
import { useOverlay, useToast } from "@/components/client";
import { ANNUAL_MONTHS, dollars } from "@/lib/catalog";
import { findOffer, storedLeadId, useStore, type CheckoutRequest } from "./bus";
import { OfferOrb } from "./icons";

type Interval = "month" | "year";

export function Checkout() {
  const store = useStore();
  const toast = useToast();
  const [req, setReq] = useState<{ offerId: string; interval: Interval } | null>(null);
  const [form, setForm] = useState({ business: "", email: "", name: "", phone: "", website: "", company_url: "" });
  const [busy, setBusy] = useState<"stripe" | "paypal" | "lead" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const close = useCallback(() => {
    setReq(null);
    setError(null);
    setSent(false);
  }, []);
  useOverlay(Boolean(req), close);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<CheckoutRequest>).detail;
      if (!d?.offerId) return;
      setError(null);
      setSent(false);
      setReq({ offerId: d.offerId, interval: d.interval === "year" && store.settings.annual ? "year" : "month" });
    };
    window.addEventListener("rm:checkout", on);
    return () => window.removeEventListener("rm:checkout", on);
  }, [store.settings.annual]);

  const offer = req ? findOffer(store, req.offerId) : undefined;
  if (!req || !offer) return null;
  const c = store.settings.currency;
  const yearly = req.interval === "year";
  const recurring = yearly ? offer.yearly : offer.price;
  const setup = yearly ? offer.setupYearly : offer.setupFee;
  const canPay = store.payments.stripe || store.payments.paypal;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function pay(provider: "stripe" | "paypal") {
    setError(null);
    if (!form.business.trim()) return setError("Enter your business name.");
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(form.email.trim())) return setError("Enter a valid email address.");
    setBusy(provider);
    try {
      const res = await fetch("/api/store/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, offerId: offer!.id, interval: req!.interval, provider, leadId: storedLeadId() }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Checkout couldn't start. Try again.");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  async function leaveDetails(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) return setError("Enter your name.");
    if (!form.email.trim() && !form.phone.trim()) return setError("Enter an email address or phone number.");
    setBusy("lead");
    try {
      const res = await fetch("/api/store/lead", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, interest: offer!.id, notes: `Wants to start ${offer!.name} (${req!.interval === "year" ? "yearly" : "monthly"}).` }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Couldn't send. Try again.");
      setSent(true);
      toast("Thanks! We'll be in touch shortly.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="store-scrim" onClick={close} />
      <div className="store-modal" role="dialog" aria-modal="true" aria-label={`Checkout: ${offer.name}`}>
        <div className="row between" style={{ marginBottom: 14 }}>
          <b className="modal-title">{canPay ? "Secure checkout" : "Get started"}</b>
          <button type="button" className="btn ghost icon sm" onClick={close} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="checkout-summary">
          <OfferOrb offer={offer} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{offer.name}</b>
            <div className="faint small truncate">{offer.tagline}</div>
          </div>
        </div>

        {store.settings.annual && (
          <div className="billing-toggle" role="group" aria-label="Billing" style={{ margin: "14px 0 4px" }}>
            <button type="button" aria-pressed={!yearly} onClick={() => setReq({ ...req, interval: "month" })}>
              Monthly
            </button>
            <button type="button" aria-pressed={yearly} onClick={() => setReq({ ...req, interval: "year" })}>
              Yearly <span className="save-pill">2 months free</span>
            </button>
          </div>
        )}

        <div className="checkout-total" style={{ margin: "12px 0 16px" }}>
          <div>
            <span>{yearly ? `${offer.name}, billed yearly` : `${offer.name}, billed monthly`}</span>
            <b>
              {dollars(recurring, { currency: c })}/{yearly ? "yr" : "mo"}
            </b>
          </div>
          {setup > 0 ? (
            <div>
              <span>One-time setup</span>
              <b>{dollars(setup, { currency: c })}</b>
            </div>
          ) : offer.setupFee > 0 && yearly ? (
            <div>
              <span>One-time setup</span>
              <b style={{ color: "var(--good)" }}>Waived</b>
            </div>
          ) : null}
          <div className="due">
            <span>Due today</span>
            <b>
              {dollars(recurring + setup, { currency: c })} {c.toUpperCase()}
            </b>
          </div>
          {yearly && <span className="faint small">That's {ANNUAL_MONTHS} months' price for 12. Saves {dollars(offer.annualSaving, { currency: c })} a year.</span>}
        </div>

        <form className="stack" style={{ gap: 10 }} onSubmit={canPay ? (e) => e.preventDefault() : leaveDetails}>
          <label className="field">
            <span>Business name</span>
            <input className="input" value={form.business} onChange={set("business")} autoComplete="organization" required maxLength={120} />
          </label>
          <div className="grid-2" style={{ gap: 10 }}>
            <label className="field">
              <span>Your name</span>
              <input className="input" value={form.name} onChange={set("name")} autoComplete="name" maxLength={120} />
            </label>
            <label className="field">
              <span>Phone</span>
              <input className="input" value={form.phone} onChange={set("phone")} autoComplete="tel" inputMode="tel" maxLength={40} />
            </label>
          </div>
          <label className="field">
            <span>Email</span>
            <input className="input" type="email" value={form.email} onChange={set("email")} autoComplete="email" required={canPay} maxLength={200} />
          </label>
          <label className="field">
            <span>Website (so we can train your AI on it)</span>
            <input className="input" value={form.website} onChange={set("website")} placeholder="yourbusiness.com" inputMode="url" maxLength={300} />
          </label>
          <label className="hp" aria-hidden>
            Company URL
            <input tabIndex={-1} autoComplete="off" value={form.company_url} onChange={set("company_url")} />
          </label>

          {error && (
            <div className="ap-notice" style={{ margin: 0 }} role="alert">
              {error}
            </div>
          )}

          {canPay ? (
            <div className="pay-buttons" style={{ marginTop: 6 }}>
              {store.payments.stripe && (
                <button type="button" className="pay-btn card" onClick={() => void pay("stripe")} disabled={Boolean(busy)}>
                  <CreditCard size={18} /> {busy === "stripe" ? "Opening secure checkout…" : "Pay by card"}
                </button>
              )}
              {store.payments.paypal && (
                <button type="button" className="pay-btn paypal" onClick={() => void pay("paypal")} disabled={Boolean(busy)}>
                  {busy === "paypal" ? "Opening PayPal…" : (
                    <>
                      Pay with <b style={{ fontStyle: "italic", color: "#003087" }}>Pay</b>
                      <b style={{ fontStyle: "italic", color: "#009cde", marginLeft: -10 }}>Pal</b>
                    </>
                  )}
                </button>
              )}
              <div className="secure-note">
                <Lock size={13} /> Payments are processed by {store.payments.stripe && store.payments.paypal ? "Stripe or PayPal" : store.payments.stripe ? "Stripe" : "PayPal"}. Cancel anytime.
              </div>
            </div>
          ) : sent ? (
            <div className="call-summary">Thanks! We'll contact you shortly to get you started.</div>
          ) : (
            <>
              <p className="faint small" style={{ margin: 0 }}>
                Online payment opens soon. Leave your details and we'll get you set up personally.
              </p>
              <button type="submit" className="btn primary lg" disabled={busy === "lead"}>
                {busy === "lead" ? "Sending…" : "Request a callback"}
              </button>
            </>
          )}
          <p className="faint small" style={{ margin: "4px 0 0", textAlign: "center" }}>
            By continuing you agree to our{" "}
            <a className="text-link" href="/store/terms" target="_blank">
              terms and refund policy
            </a>
            .
          </p>
        </form>
      </div>
    </>
  );
}
