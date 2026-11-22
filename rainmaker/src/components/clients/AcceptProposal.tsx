"use client";

import { useState } from "react";

// The accept form on a proposal: details, then card (Stripe) or PayPal. With
// neither available it records the yes, and the agency sends an invoice.

type Labels = Record<"name" | "email" | "phone" | "card" | "paypal" | "talk" | "noPay" | "sub" | "acceptBtn" | "thanks", string>;

export function AcceptProposal({ token, labels, stripe, paypal, calendarUrl, email, accepted = false }: { token: string; labels: Labels; stripe: boolean; paypal: boolean; calendarUrl?: string; email?: string; accepted?: boolean }) {
  const [f, setF] = useState({ name: "", email: email ?? "", phone: "", company_url: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(accepted);
  const online = stripe || paypal;

  async function accept() {
    setBusy("accept");
    setError(null);
    try {
      const res = await fetch(`/api/proposal/${token}/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Couldn't send (${res.status})`);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (done && !online) {
    return (
      <p className="doc-thanks" role="status">
        {labels.thanks}
      </p>
    );
  }

  async function pay(provider: "stripe" | "paypal") {
    setBusy(provider);
    setError(null);
    try {
      const res = await fetch(`/api/proposal/${token}/checkout`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, provider }) });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? `Checkout failed (${res.status})`);
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (stripe) void pay("stripe"); else if (!online) void accept(); }}>
      <label className="field">
        <span>{labels.name}</span>
        <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" />
      </label>
      <label className="field">
        <span>{labels.email}</span>
        <input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" required />
      </label>
      <label className="field">
        <span>{labels.phone}</span>
        <input className="input" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" />
      </label>
      <input type="text" name="company_url" value={f.company_url} onChange={(e) => setF({ ...f, company_url: e.target.value })} tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: -9999, width: 1, height: 1 }} />
      <div className="actions">
        {stripe && (
          <button className="btn primary lg" type="submit" disabled={Boolean(busy)}>
            {busy === "stripe" ? "…" : labels.card}
          </button>
        )}
        {paypal && (
          <button className="btn lg" type="button" onClick={() => void pay("paypal")} disabled={Boolean(busy)}>
            {busy === "paypal" ? "…" : labels.paypal}
          </button>
        )}
        {calendarUrl && (
          <a className="btn ghost lg" href={calendarUrl} target="_blank" rel="noreferrer">
            {labels.talk}
          </a>
        )}
        {!online && (
          <button className="btn primary lg" type="submit" disabled={Boolean(busy)}>
            {busy === "accept" ? "…" : labels.acceptBtn}
          </button>
        )}
      </div>
      <p className="doc-note" style={{ gridColumn: "1 / -1", margin: 0 }}>{online ? labels.sub : labels.noPay}</p>
      {error && (
        <p role="alert" style={{ gridColumn: "1 / -1", color: "#b4232a", margin: 0 }}>
          {error}
        </p>
      )}
    </form>
  );
}
