"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Bot, Check, CircleX, CreditCard, ExternalLink, LoaderCircle, RefreshCw, Save, Store, Wallet } from "lucide-react";
import { api, CopyButton, useToast } from "@/components/client";
import { Switch } from "@/components/ui";
import { ANNUAL_MONTHS, CURRENCIES, dollars, margin } from "@/lib/catalog";
import type { Integrations } from "@/lib/config";
import type { PriceOverride, StoreSettings } from "@/lib/types";

interface OfferRow {
  id: string;
  name: string;
  kind: "plan" | "product";
  category: string;
  slug: string;
  monthly: number;
  setup: number;
  cost: number;
  bundles: string[];
}

function Status({ ok, on, off }: { ok: boolean; on: string; off: string }) {
  return (
    <span className={`badge ${ok ? "good" : "warm"}`}>
      {ok ? <Check size={12} /> : <CircleX size={12} />} {ok ? on : off}
    </span>
  );
}

function marginClass(m: number) {
  return m >= 70 ? "margin-good" : m >= 50 ? "margin-warn" : "margin-bad";
}

export function StoreManager({
  base,
  store,
  offers,
  integrations: i,
  webhooks,
  agentId,
  passwordSet,
}: {
  base: string;
  store: StoreSettings;
  offers: OfferRow[];
  integrations: Integrations;
  webhooks: { stripe: boolean; stripeUrl?: string; paypal: boolean; paypalUrl?: string };
  agentId?: string;
  passwordSet: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [s, setS] = useState(store);
  const [prices, setPrices] = useState<Record<string, PriceOverride>>(store.prices);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [agent, setAgent] = useState<{ connected: boolean; name?: string; reason?: string; syncedAt?: string } | null>(null);
  const storeUrl = `${base}/store`;
  const c = s.currency;

  useEffect(() => {
    if (!i.elevenlabs) return;
    api<{ connected: boolean; name?: string; reason?: string; syncedAt?: string }>("/api/elevenlabs/agent")
      .then(setAgent)
      .catch((err) => setAgent({ connected: false, reason: err instanceof Error ? err.message : String(err) }));
  }, [i.elevenlabs]);

  const rows = useMemo(
    () =>
      offers.map((o) => {
        const p = prices[o.id] ?? {};
        const monthly = p.monthly ?? o.monthly;
        const setup = p.setup ?? o.setup;
        return { ...o, price: monthly, setupFee: setup, hidden: Boolean(p.hidden), m: margin(monthly, o.cost) };
      }),
    [offers, prices]
  );
  const avg = Math.round((rows.reduce((a, r) => a + r.m, 0) / rows.length) * 10) / 10;

  function setPrice(id: string, key: keyof PriceOverride, value: number | boolean | undefined) {
    setPrices((p) => {
      const next = { ...(p[id] ?? {}), [key]: value };
      if (value === undefined || value === false) delete (next as Record<string, unknown>)[key];
      return { ...p, [id]: next };
    });
  }

  async function save() {
    setSaving(true);
    try {
      await api("/api/sell/settings", { method: "PUT", json: { ...s, prices } });
      toast("Saved. The store and the sales assistant use the new settings now.");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function connect(provider: "stripe" | "paypal") {
    setBusy(provider);
    try {
      const r = await api<{ url: string; reused: boolean }>("/api/payments/setup", { method: "POST", json: { provider } });
      toast(`${provider === "stripe" ? "Stripe" : "PayPal"} webhook ${r.reused ? "already connected" : "connected"}: ${r.url}`);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(null);
    }
  }

  async function syncAgent() {
    setBusy("agent");
    try {
      const r = await api<{ agentId: string; created: boolean; tools: number }>("/api/elevenlabs/agent", { method: "POST" });
      toast(r.created ? `Created your sales assistant in ElevenLabs (${r.tools} tools)` : `Sales assistant updated (${r.tools} tools)`);
      setAgent({ connected: true, syncedAt: new Date().toISOString() });
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      {!passwordSet && (
        <div className="storage-warning" style={{ position: "static" }}>
          Set APP_PASSWORD before you share your store: without it, anyone who finds this dashboard can change your prices.
        </div>
      )}

      <div className="grid-2 wide-left">
        <section className="card">
          <div className="card-head">
            <h2>
              <Store size={17} style={{ display: "inline", verticalAlign: -3, marginRight: 6 }} />
              Your store
            </h2>
            <Status ok={s.enabled} on="Open" off="Closed" />
          </div>
          <div className="card-body stack">
            <div className="field">
              <span>Public link: share it, put it on your site, use it in ads</span>
              <div className="copy-field">
                <input className="input" readOnly value={storeUrl} aria-label="Store link" />
                <CopyButton text={storeUrl} />
                <a className="btn sm" href="/store" target="_blank" rel="noopener">
                  <ExternalLink size={14} /> Open
                </a>
              </div>
              <small>Visitors who aren't signed in also land here from your main address.</small>
            </div>
            <Switch checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} label="Store is open" hint="When closed, the store shows a short 'back soon' message and takes no orders." />
            <label className="field">
              <span>Headline</span>
              <input className="input" value={s.headline} onChange={(e) => setS({ ...s, headline: e.target.value })} maxLength={160} />
              <small>Wrap words in *asterisks* to highlight them.</small>
            </label>
            <label className="field">
              <span>Subheadline</span>
              <textarea className="textarea" rows={3} value={s.subheadline} onChange={(e) => setS({ ...s, subheadline: e.target.value })} maxLength={400} />
            </label>
            <div className="grid-2">
              <label className="field">
                <span>AI assistant's name</span>
                <input className="input" value={s.assistantName} onChange={(e) => setS({ ...s, assistantName: e.target.value })} maxLength={30} />
              </label>
              <label className="field">
                <span>Currency</span>
                <select className="select" value={s.currency} onChange={(e) => setS({ ...s, currency: e.target.value as StoreSettings["currency"] })}>
                  {CURRENCIES.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.id.toUpperCase()} · {x.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <Switch checked={s.annual} onChange={(v) => setS({ ...s, annual: v })} label="Offer yearly billing" hint={`Yearly costs ${ANNUAL_MONTHS} months' price for 12: an easy yes for buyers, and cash up front for you.`} />
              <Switch checked={s.waiveSetupOnAnnual} onChange={(v) => setS({ ...s, waiveSetupOnAnnual: v })} label="Waive setup fees on yearly" disabled={!s.annual} />
              <Switch
                checked={s.showEngine}
                onChange={(v) => setS({ ...s, showEngine: v })}
                label="Say products are built on ElevenLabs"
                hint="Plain-text mention only, with a 'not affiliated' line in the footer. ElevenLabs' name and logos are its trademarks, so the store never uses them as your brand."
              />
            </div>
            <label className="field" style={{ maxWidth: 260 }}>
              <span>Extra call minutes ({c.toUpperCase()} per minute)</span>
              <input className="input" type="number" step="0.01" min="0" value={s.overagePerMinute} onChange={(e) => setS({ ...s, overagePerMinute: Number(e.target.value) })} />
              <small>Costs you about $0.10/minute all-in.</small>
            </label>
          </div>
        </section>

        <div className="stack" style={{ gap: 18 }}>
          <section className="card">
            <div className="card-head">
              <h2>
                <CreditCard size={17} style={{ display: "inline", verticalAlign: -3, marginRight: 6 }} />
                Payments
              </h2>
            </div>
            <div className="card-body stack" style={{ gap: 14 }}>
              <div className="stack" style={{ gap: 6 }}>
                <div className="row between">
                  <b>Stripe (cards, Apple Pay, Google Pay)</b>
                  <Status ok={i.stripe} on={i.stripeMode === "test" ? "Test mode" : "Live"} off="Not connected" />
                </div>
                {i.stripe ? (
                  <div className="row between" style={{ gap: 8 }}>
                    <span className="faint small">{webhooks.stripe ? `Webhook connected${webhooks.stripeUrl ? `: ${webhooks.stripeUrl}` : ""}` : "Connect the webhook so payments and cancellations update orders automatically."}</span>
                    <button className="btn sm" onClick={() => void connect("stripe")} disabled={busy === "stripe"}>
                      {busy === "stripe" ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} {webhooks.stripe ? "Reconnect" : "Connect webhook"}
                    </button>
                  </div>
                ) : (
                  <span className="faint small">
                    Paste your Stripe secret key in{" "}
                    <a href="/settings?keys=stripe" className="key-get">
                      Settings → API keys
                    </a>
                    , then connect the webhook here.
                  </span>
                )}
              </div>
              <div className="stack" style={{ gap: 6 }}>
                <div className="row between">
                  <b>
                    <Wallet size={15} style={{ display: "inline", verticalAlign: -2 }} /> PayPal
                  </b>
                  <Status ok={i.paypal} on={i.paypalMode === "sandbox" ? "Sandbox" : "Live"} off="Not connected" />
                </div>
                {i.paypal ? (
                  <div className="row between" style={{ gap: 8 }}>
                    <span className="faint small">{webhooks.paypal ? `Webhook connected${webhooks.paypalUrl ? `: ${webhooks.paypalUrl}` : ""}` : "Connect the webhook so subscriptions activate and cancel automatically."}</span>
                    <button className="btn sm" onClick={() => void connect("paypal")} disabled={busy === "paypal"}>
                      {busy === "paypal" ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} {webhooks.paypal ? "Reconnect" : "Connect webhook"}
                    </button>
                  </div>
                ) : (
                  <span className="faint small">
                    Paste your PayPal client ID and secret in{" "}
                    <a href="/settings?keys=paypal" className="key-get">
                      Settings → API keys
                    </a>{" "}
                    (switch Mode to Live when you&apos;re ready), then connect the webhook here.
                  </span>
                )}
              </div>
              {!i.stripe && !i.paypal && <div className="tip">Until a payment provider is connected, the checkout collects the buyer's details and creates a callback task, so no sale is lost.</div>}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>
                <Bot size={17} style={{ display: "inline", verticalAlign: -3, marginRight: 6 }} />
                AI sales assistant
              </h2>
              {i.elevenlabs ? <Status ok={Boolean(agent?.connected)} on="Live" off={agent ? "Needs setup" : "Checking…"} /> : <Status ok={false} on="" off="Not connected" />}
            </div>
            <div className="card-body stack" style={{ gap: 10 }}>
              <p className="muted small" style={{ margin: 0 }}>
                An ElevenLabs voice and chat agent on your store. It explains every product in detail from your live prices, shows products on screen, opens checkout and saves callback requests to your pipeline.
              </p>
              {i.elevenlabs ? (
                <>
                  <div className="faint small">
                    {agent?.connected ? `Agent ${agentId ?? ""}${agent.name ? ` · ${agent.name}` : ""}` : agent?.reason ?? ""}
                    {agent?.syncedAt ? ` · synced ${new Date(agent.syncedAt).toLocaleDateString()}` : ""}
                  </div>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <button className="btn sm" onClick={() => void syncAgent()} disabled={busy === "agent"}>
                      {busy === "agent" ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} {agentId ? "Sync prompt and tools" : "Create assistant"}
                    </button>
                    {agentId && (
                      <a className="btn sm" href={`https://elevenlabs.io/app/agents/agents/${agentId}`} target="_blank" rel="noopener">
                        <ExternalLink size={14} /> Open in ElevenLabs
                      </a>
                    )}
                  </div>
                </>
              ) : (
                <span className="faint small">
                  Paste your ElevenLabs API key (with Agents write access) in{" "}
                  <a href="/settings?keys=elevenlabs" className="key-get">
                    Settings → API keys
                  </a>{" "}
                  to switch it on.
                </span>
              )}
            </div>
          </section>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Prices and margins</h2>
          <span className="faint small">
            Average gross margin at full included usage: <b className={marginClass(avg)}>{avg}%</b>
          </span>
        </div>
        <div className="card-body">
          <p className="muted small" style={{ marginTop: 0 }}>
            Defaults are set for 70–99% gross margin from ElevenLabs' November 2026 rates (calls $0.08/min, voiceovers $0.08 per 1,000 characters, dubbing $0.50/min, transcription $0.20/hour) plus phone and Claude costs. Image and video need ElevenLabs Pro ($99/mo) or higher. Cost is what one customer costs you per month if they use everything included; most use less.
          </p>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Monthly ({c.toUpperCase()})</th>
                  <th className="num">Setup</th>
                  <th className="num">Your cost/mo</th>
                  <th className="num">Margin</th>
                  <th>On store</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>
                        {r.name} {r.kind === "plan" && <span className="badge brand">Plan</span>}
                      </div>
                      <div className="faint small">
                        <a href={`/store/${r.slug}`} target="_blank" rel="noopener" className="link-btn">
                          /store/{r.slug}
                        </a>
                      </div>
                    </td>
                    <td className="num">
                      <input
                        className="input price-input"
                        type="number"
                        min="1"
                        step="1"
                        value={r.price}
                        onChange={(e) => setPrice(r.id, "monthly", e.target.value === "" ? undefined : Number(e.target.value))}
                        aria-label={`${r.name} monthly price`}
                      />
                    </td>
                    <td className="num">
                      <input
                        className="input price-input"
                        type="number"
                        min="0"
                        step="1"
                        value={r.setupFee}
                        onChange={(e) => setPrice(r.id, "setup", e.target.value === "" ? undefined : Number(e.target.value))}
                        aria-label={`${r.name} setup fee`}
                      />
                    </td>
                    <td className="num">{dollars(r.cost, { cents: true })}</td>
                    <td className={`num ${marginClass(r.m)}`}>{r.m}%</td>
                    <td>
                      <span className="switch">
                        <input type="checkbox" role="switch" checked={!r.hidden} onChange={(e) => setPrice(r.id, "hidden", !e.target.checked || undefined)} aria-label={`Show ${r.name} on the store`} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <div className="row" style={{ gap: 10, position: "sticky", bottom: 12, justifyContent: "flex-end" }}>
        <button className="btn primary" onClick={() => void save()} disabled={saving} style={{ boxShadow: "var(--shadow-2)" }}>
          {saving ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />} Save store and prices
        </button>
      </div>
    </div>
  );
}
