"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Ban, CircleCheck, CircleDashed, CircleX, CreditCard, ExternalLink, LoaderCircle, Plus, Receipt, RefreshCw, Repeat, TrendingUp, Users, X } from "lucide-react";
import { api, Modal, useToast } from "@/components/client";
import { Empty, Stat } from "@/components/ui";
import { dollars } from "@/lib/catalog";
import { timeAgo } from "@/lib/format";
import type { SalesStats } from "@/lib/payments/encode";
import type { FulfillmentStep, Order, StoreCurrency } from "@/lib/types";

const STATUS: Record<Order["status"], { label: string; cls: string }> = {
  pending: { label: "Checkout started", cls: "" },
  active: { label: "Active", cls: "good" },
  past_due: { label: "Payment failed", cls: "hot" },
  canceled: { label: "Cancelled", cls: "outline" },
};

function StepIcon({ s }: { s: FulfillmentStep["status"] }) {
  if (s === "done") return <CircleCheck size={15} style={{ color: "var(--good)", flex: "none", marginTop: 2 }} />;
  if (s === "error") return <CircleX size={15} style={{ color: "var(--hot)", flex: "none", marginTop: 2 }} />;
  if (s === "skipped") return <Ban size={15} style={{ color: "var(--text-3)", flex: "none", marginTop: 2 }} />;
  return <CircleDashed size={15} style={{ color: "var(--text-3)", flex: "none", marginTop: 2 }} />;
}

/** Turns URLs and app paths in a step's detail into links. */
function Detail({ text }: { text?: string }) {
  if (!text) return null;
  const parts = text.split(/(https?:\/\/\S+|\/ads\?campaign=\S+)/g);
  return (
    <span className="faint">
      {parts.map((p, i) =>
        /^(https?:\/\/|\/ads\?)/.test(p) ? (
          <a key={i} className="link-btn" href={p} target={p.startsWith("http") ? "_blank" : undefined} rel="noopener">
            {p.startsWith("http") ? "open" : "view campaign"}
          </a>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </span>
  );
}

export function Orders({
  orders,
  stats,
  currency,
  offers,
  leads,
}: {
  orders: Order[];
  stats: SalesStats;
  currency: StoreCurrency;
  offers: { id: string; name: string; kind: string }[];
  leads: { id: string; name: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Order["status"]>("all");
  const [manual, setManual] = useState(false);
  const [form, setForm] = useState({ offerId: offers[0]?.id ?? "", interval: "month", business: "", email: "", leadId: "", amount: "" });
  const money = (n: number) => dollars(n, { currency });
  const list = orders.filter((o) => filter === "all" || o.status === filter);

  async function act(o: Order, action: "fulfill" | "cancel" | "portal") {
    if (action === "cancel" && !confirm(`Cancel ${o.business ?? o.email}'s ${o.offerName}? ${o.provider === "manual" ? "" : "This also cancels the subscription with " + (o.provider === "stripe" ? "Stripe" : "PayPal") + "."}`)) return;
    setBusy(`${o.id}:${action}`);
    try {
      const r = await api<{ url?: string }>(`/api/orders/${o.id}`, { method: "POST", json: { action } });
      if (action === "portal" && r.url) window.open(r.url, "_blank", "noopener");
      else toast(action === "fulfill" ? "Onboarding ran again" : "Cancelled");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(null);
    }
  }

  async function recordSale(e: React.FormEvent) {
    e.preventDefault();
    setBusy("manual");
    try {
      await api("/api/orders", {
        method: "POST",
        json: { ...form, leadId: form.leadId || undefined, amount: form.amount ? Number(form.amount) : undefined, business: form.business || leads.find((l) => l.id === form.leadId)?.name },
      });
      toast("Sale recorded. Onboarding has started.");
      setManual(false);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="grid-4">
        <Stat icon={<Repeat size={16} />} label="Monthly recurring revenue" value={money(stats.mrr)} sub={`${stats.active} active ${stats.active === 1 ? "client" : "clients"}`} tone="good" />
        <Stat icon={<TrendingUp size={16} />} label="Collected this month" value={money(stats.revenueThisMonth)} sub={`${stats.newThisMonth} new this month`} />
        <Stat icon={<Receipt size={16} />} label="Lifetime revenue" value={money(stats.lifetimeRevenue)} sub={stats.churnedThisMonth ? `${stats.churnedThisMonth} cancelled this month` : "No cancellations this month"} tone="violet" />
        <Stat icon={<Users size={16} />} label="Unfinished checkouts" value={stats.pending} sub="Autopilot drafts a nudge after a day" tone="teal" />
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Orders</h2>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <select className="select" style={{ height: 32 }} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter orders">
              <option value="all">All orders</option>
              <option value="active">Active</option>
              <option value="pending">Checkout started</option>
              <option value="past_due">Payment failed</option>
              <option value="canceled">Cancelled</option>
            </select>
            <button className="btn sm" onClick={() => setManual(true)}>
              <Plus size={14} /> Record a sale
            </button>
            <a className="btn sm" href="/store" target="_blank" rel="noopener">
              <ExternalLink size={14} /> Store
            </a>
          </div>
        </div>
        {list.length === 0 ? (
          <div className="card-body">
            <Empty icon={<CreditCard size={20} />} title={orders.length ? "No orders match" : "No orders yet"}>
              {orders.length ? "Try another filter." : "Share your store link, or let Autopilot send prospects their demo. Orders appear here the moment someone checks out."}
            </Empty>
          </div>
        ) : (
          <div className="list">
            {list.map((o) => {
              const st = STATUS[o.status];
              const f = o.fulfillment;
              return (
                <div key={o.id} className="list-item" style={{ alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                      <b>{o.business || o.name || o.email || "Customer"}</b>
                      <span className={`badge ${st.cls}`}>{st.label}</span>
                      <span className="badge outline">{o.provider === "manual" ? "Recorded by you" : o.provider === "stripe" ? "Stripe" : "PayPal"}</span>
                    </div>
                    <div className="muted small" style={{ marginTop: 4 }}>
                      {o.offerName} · {money(o.amount)}/{o.interval === "year" ? "yr" : "mo"}
                      {o.setupFee ? ` + ${money(o.setupFee)} setup` : ""} · {timeAgo(o.createdAt)}
                    </div>
                    <div className="faint small">
                      {[o.email, o.phone, o.website].filter(Boolean).join(" · ")}
                      {o.payments.length ? ` · paid ${money(o.payments.reduce((a, p) => a + p.amount, 0))} so far` : ""}
                    </div>
                    {f && (
                      <div style={{ marginTop: 8 }}>
                        <div className="small" style={{ fontWeight: 600, marginBottom: 2 }}>
                          Onboarding: {f.status === "done" ? "done" : f.status === "running" ? "running…" : f.status === "error" ? "needs attention" : "queued"}
                        </div>
                        {f.steps.map((s) => (
                          <div key={s.id} className="step-status">
                            <StepIcon s={s.status} />
                            <span>
                              {s.label}
                              {s.detail ? ": " : ""}
                              <Detail text={s.detail} />
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    {o.leadId && (
                      <Link className="btn sm" href={`/pipeline?lead=${o.leadId}`}>
                        Lead
                      </Link>
                    )}
                    {o.status === "active" && f && f.status !== "done" && (
                      <button className="btn sm" onClick={() => void act(o, "fulfill")} disabled={busy === `${o.id}:fulfill`}>
                        {busy === `${o.id}:fulfill` ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} {f.status === "error" ? "Retry onboarding" : "Run onboarding"}
                      </button>
                    )}
                    {o.provider === "stripe" && o.customerId && (
                      <button className="btn sm" onClick={() => void act(o, "portal")} disabled={busy === `${o.id}:portal`}>
                        Billing portal
                      </button>
                    )}
                    {(o.status === "active" || o.status === "past_due") && (
                      <button className="btn sm ghost" onClick={() => void act(o, "cancel")} disabled={busy === `${o.id}:cancel`}>
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Modal open={manual} onClose={() => setManual(false)} label="Record a sale">
        <form onSubmit={recordSale} className="stack" style={{ gap: 12 }}>
          <div className="row between">
            <b style={{ fontSize: 17 }}>Record a sale</b>
            <button type="button" className="btn ghost icon sm" onClick={() => setManual(false)} aria-label="Close">
              <X size={18} />
            </button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            For deals paid outside the store (cash, e-transfer, invoice). Rainmaker tracks it in your revenue and runs the same onboarding.
          </p>
          <label className="field">
            <span>Product or plan</span>
            <select className="select" value={form.offerId} onChange={(e) => setForm({ ...form, offerId: e.target.value })}>
              {offers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.kind === "plan" ? `Plan: ${o.name}` : o.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid-2">
            <label className="field">
              <span>Billing</span>
              <select className="select" value={form.interval} onChange={(e) => setForm({ ...form, interval: e.target.value })}>
                <option value="month">Monthly</option>
                <option value="year">Yearly</option>
              </select>
            </label>
            <label className="field">
              <span>Price ({currency.toUpperCase()}, blank = store price)</span>
              <input className="input" type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </label>
          </div>
          <label className="field">
            <span>Existing lead (optional)</span>
            <select className="select" value={form.leadId} onChange={(e) => setForm({ ...form, leadId: e.target.value })}>
              <option value="">New customer</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          {!form.leadId && (
            <div className="grid-2">
              <label className="field">
                <span>Business name</span>
                <input className="input" value={form.business} onChange={(e) => setForm({ ...form, business: e.target.value })} required />
              </label>
              <label className="field">
                <span>Email</span>
                <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </label>
            </div>
          )}
          <button className="btn primary" disabled={busy === "manual"}>
            {busy === "manual" ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />} Record sale
          </button>
        </form>
      </Modal>
    </div>
  );
}
