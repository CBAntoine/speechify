"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bot, Check, CircleX, Database, KeyRound, LoaderCircle, Lock, Mail, MapPin, Radar, Save, Sparkles } from "lucide-react";
import { api, useToast } from "@/components/client";
import { InstallButton } from "@/components/pwa";
import type { AgencyProfile } from "@/lib/types";
import type { Integrations } from "@/lib/config";

function Status({ ok, on, off }: { ok: boolean; on: string; off: string }) {
  return (
    <span className={`badge ${ok ? "good" : "warm"}`}>
      {ok ? <Check size={12} /> : <CircleX size={12} />} {ok ? on : off}
    </span>
  );
}

export function SettingsForm({
  profile: initial,
  integrations: i,
  niches,
  storage,
  passwordSet,
  sampleCount,
}: {
  profile: AgencyProfile;
  integrations: Integrations;
  niches: { id: string; label: string }[];
  storage: { kind: "file" | "postgres"; label: string; persistent: boolean };
  passwordSet: boolean;
  sampleCount: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [p, setP] = useState(initial);
  const [services, setServices] = useState(initial.services.join(", "));
  const [saving, setSaving] = useState(false);
  const [setup, setSetup] = useState<{ environmentId: string; agents: Record<string, { agentId: string; version: number }> } | null>(null);
  const [settingUp, setSettingUp] = useState(false);

  const set = (k: keyof AgencyProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setP({ ...p, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/api/settings", { method: "PUT", json: { ...p, services: services.split(",").map((s) => s.trim()).filter(Boolean) } });
      toast("Saved. Agents use this from their next run.");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function samples(action: "clear" | "load") {
    try {
      await api("/api/settings/samples", { method: "POST", json: { action } });
      toast(action === "clear" ? "Sample data removed" : "Sample data added");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function setupAgents() {
    setSettingUp(true);
    try {
      setSetup(await api("/api/agents/setup", { method: "POST" }));
      toast("Agents are ready on Claude");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSettingUp(false);
    }
  }

  return (
    <div className="grid-2 wide-left">
      <form className="card" onSubmit={save}>
        <div className="card-head">
          <h2>Your agency</h2>
          <span className="faint small">Agents read this before every run</span>
        </div>
        <div className="card-body stack">
          <div className="grid-2">
            <label className="field">
              <span>Agency name</span>
              <input className="input" value={p.agencyName} onChange={set("agencyName")} required />
            </label>
            <label className="field">
              <span>Your name (signs messages)</span>
              <input className="input" value={p.ownerName} onChange={set("ownerName")} placeholder="Sam Rivera" />
            </label>
            <label className="field">
              <span>Reply-to email</span>
              <input className="input" type="email" value={p.email} onChange={set("email")} placeholder="sam@agency.com" />
            </label>
            <label className="field">
              <span>Home city</span>
              <input className="input" value={p.city} onChange={set("city")} placeholder="e.g. Toronto, ON" />
            </label>
            <label className="field">
              <span>Website</span>
              <input className="input" value={p.website} onChange={set("website")} />
            </label>
            <label className="field">
              <span>Booking link</span>
              <input className="input" value={p.calendarUrl} onChange={set("calendarUrl")} placeholder="Your calendar page" />
            </label>
          </div>
          <label className="field">
            <span>Postal address for email footers</span>
            <input className="input" value={p.mailingAddress} onChange={set("mailingAddress")} placeholder="Required in commercial email in the US (CAN-SPAM)" />
          </label>
          <label className="field">
            <span>Core offer</span>
            <textarea className="textarea" rows={3} value={p.coreOffer} onChange={set("coreOffer")} />
            <small>One or two sentences: who you help, the result, and why it's low-risk.</small>
          </label>
          <label className="field">
            <span>Services (comma-separated)</span>
            <input className="input" value={services} onChange={(e) => setServices(e.target.value)} />
          </label>
          <div className="grid-2">
            <label className="field">
              <span>Pricing</span>
              <input className="input" value={p.pricing} onChange={set("pricing")} />
            </label>
            <label className="field">
              <span>Phone</span>
              <input className="input" value={p.phone} onChange={set("phone")} />
            </label>
          </div>
          <label className="field">
            <span>Proof and results</span>
            <textarea className="textarea" rows={2} value={p.proof} onChange={set("proof")} placeholder="Real numbers only, e.g. 'Booked 41 new patients for a dental office in 60 days'. Agents never invent proof." />
          </label>
          <label className="field">
            <span>Writing voice</span>
            <input className="input" value={p.voice} onChange={set("voice")} />
          </label>
          <div className="field">
            <span>Target niches</span>
            <div className="chips">
              {niches.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className="chip"
                  aria-pressed={p.targetNiches.includes(n.id)}
                  onClick={() => setP({ ...p, targetNiches: p.targetNiches.includes(n.id) ? p.targetNiches.filter((x) => x !== n.id) : [...p.targetNiches, n.id] })}
                >
                  {p.targetNiches.includes(n.id) && <Check size={12} />} {n.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <button className="btn primary" disabled={saving}>
              {saving ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />} Save
            </button>
          </div>
        </div>
      </form>

      <div className="stack" style={{ gap: 14 }}>
        <section className="card">
          <div className="card-head">
            <h2>Connections</h2>
            <span className="faint small">Set in .env.local</span>
          </div>
          <div className="list">
            <div className="list-item">
              <span className="icon-tile">
                <Sparkles size={15} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div className="row between" style={{ gap: 8 }}>
                  <b>Claude</b>
                  <Status ok={i.claude} on="Connected" off="Not set" />
                </div>
                <div className="muted small">
                  {i.claude
                    ? `Model ${i.model}. Writes ads and outreach, researches the web, finds clients on the web and runs the agents.`
                    : "Set ANTHROPIC_API_KEY to turn on AI ads, AI outreach, web research, web search in Find clients, and thinking agents."}
                </div>
              </span>
            </div>
            <div className="list-item">
              <span className="icon-tile" style={{ background: "var(--violet-soft)", color: "var(--violet)" }}>
                <Bot size={15} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div className="row between" style={{ gap: 8 }}>
                  <b>Agent runtime</b>
                  <span className="badge">{i.agentRuntime === "managed" ? "Managed Agents" : i.agentRuntime === "messages" ? "Messages API" : "Demo"}</span>
                </div>
                <div className="muted small">
                  {i.agentRuntime === "managed"
                    ? `Anthropic hosts the agent loop; this server answers the CRM tool calls. Beta, billed for session time on top of tokens; sessions stay in your Claude Console until you delete them. Cap: $${i.runBudgetUsd.toFixed(2)} per run (AGENT_RUN_BUDGET_USD). Set AGENT_RUNTIME=messages to run the loop on this server instead.`
                    : i.agentRuntime === "messages"
                      ? "The agent loop runs on this server over the Messages API. Set AGENT_RUNTIME=managed for Claude Managed Agents."
                      : "Agents follow a fixed script until Claude is connected."}
                </div>
                {i.agentRuntime === "managed" && (
                  <div style={{ marginTop: 8 }}>
                    <button className="btn sm" onClick={() => void setupAgents()} disabled={settingUp}>
                      {settingUp ? <LoaderCircle size={13} className="spin" /> : <Bot size={13} />} Create or update agents on Claude
                    </button>
                    {setup && (
                      <div className="mono" style={{ marginTop: 8, color: "var(--text-2)" }}>
                        env {setup.environmentId}
                        {Object.entries(setup.agents).map(([k, v]) => (
                          <div key={k}>
                            {k}: {v.agentId} v{v.version}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </span>
            </div>
            <div className="list-item">
              <span className="icon-tile" style={{ background: "var(--good-soft)", color: "var(--good)" }}>
                <Radar size={15} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div className="row between" style={{ gap: 8 }}>
                  <b>Finding clients</b>
                  <Status ok on={i.googlePlaces ? "Google Places" : i.claude ? "Free sources + Claude" : "Free sources"} off="" />
                </div>
                <ul className="muted small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  <li>OpenStreetMap, the free world map, through its Nominatim search server.</li>
                  <li>City business-licence lists: Toronto, Vancouver, Calgary and Edmonton publish theirs as open data, contractors included.</li>
                  <li>
                    Claude web research: {i.claude ? "on. It runs when the free sources find fewer than 20 businesses, at roughly 10–30 cents a search." : "turns on with ANTHROPIC_API_KEY and finds businesses in any town, at roughly 10–30 cents a search."}
                  </li>
                  <li>Rainmaker&apos;s crawler visits each business&apos;s own website for its phone, email and the gaps you sell against, finds sites that weren&apos;t listed, and follows each site&apos;s robots.txt.</li>
                </ul>
              </span>
            </div>
            <div className="list-item">
              <span className="icon-tile" style={{ background: "var(--teal-soft)", color: "var(--teal)" }}>
                <MapPin size={15} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div className="row between" style={{ gap: 8 }}>
                  <b>Google Places (optional)</b>
                  <Status ok={i.googlePlaces} on="Connected" off="Using OpenStreetMap" />
                </div>
                <div className="muted small">
                  Finds every kind of business, roofers and plumbers included, with ratings and review counts. Free OpenStreetMap data lists few tradespeople.
                </div>
                {!i.googlePlaces && (
                  <ol className="muted small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                    <li>
                      In{" "}
                      <a href="https://console.cloud.google.com/apis/library/places.googleapis.com" target="_blank" rel="noreferrer">
                        Google Cloud
                      </a>
                      , enable <b>Places API (New)</b>. Google asks for billing details, and gives a free monthly allowance of about 1,000 searches.
                    </li>
                    <li>
                      Open{" "}
                      <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
                        Credentials
                      </a>
                      , create an <b>API key</b>, and restrict it to Places API (New).
                    </li>
                    <li>
                      In your Vercel project, open <b>Settings → Environment Variables</b>, add <code>GOOGLE_PLACES_API_KEY</code> with the key, then redeploy.
                    </li>
                  </ol>
                )}
              </span>
            </div>
            <div className="list-item">
              <span className="icon-tile" style={{ background: "var(--hot-soft)", color: "var(--hot)" }}>
                <Mail size={15} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div className="row between" style={{ gap: 8 }}>
                  <b>Sending email</b>
                  <Status ok={i.resend} on="Resend" off="Your mail app" />
                </div>
                <div className="muted small">Set RESEND_API_KEY and RESEND_FROM (a sender on a domain you verified) to send approved emails from the Inbox.</div>
              </span>
            </div>
            <div className="list-item">
              <span className="icon-tile" style={{ background: passwordSet ? "var(--good-soft)" : "var(--warm-soft)", color: passwordSet ? "var(--good)" : "var(--warm)" }}>
                <Lock size={15} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div className="row between" style={{ gap: 8 }}>
                  <b>Password</b>
                  <Status ok={passwordSet} on="On" off="Off" />
                </div>
                <div className="muted small">Set APP_PASSWORD before you put this on the internet, so nobody else can use your data or your API credits.</div>
              </span>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Data</h2>
          </div>
          <div className="card-body stack" style={{ gap: 10 }}>
            <div className="row small muted" style={{ gap: 8 }}>
              <Database size={14} /> Stored in <span className="mono">{storage.label}</span>
            </div>
            {!storage.persistent ? (
              <div className="tip warn">
                <span>
                  This host doesn&apos;t keep files, so your data can disappear. Connect a Postgres database (on Vercel: Storage → Neon) and set DATABASE_URL.
                </span>
              </div>
            ) : (
              <div className="muted small">
                {storage.kind === "postgres" ? "Saved in your Postgres database, shared by every device you sign in from." : "Back this file up to keep your pipeline."} Sample records are marked &ldquo;Sample&rdquo; and use fictional businesses.
              </div>
            )}
            <div className="row wrap">
              {sampleCount > 0 ? (
                <button className="btn sm" onClick={() => void samples("clear")}>
                  Remove {sampleCount} sample records
                </button>
              ) : (
                <button className="btn sm" onClick={() => void samples("load")}>
                  Load sample data
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="card card-pad stack" style={{ gap: 10 }}>
          <b>Use it on your phone</b>
          <div className="muted small">
            Open this site in Chrome on Android and choose <b>Install app</b> (or ⋮ → <b>Add to home screen</b>). It opens full screen from its own icon, and Rainmaker shows up in your share sheet so you can send it a business from Google Maps.
          </div>
          <div className="row wrap">
            <InstallButton className="btn primary sm" label="Install on this device" />
          </div>
        </section>

        <section className="card card-pad stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 8 }}>
            <KeyRound size={15} className="faint" />
            <b>Where keys go</b>
          </div>
          <div className="muted small">
            Copy <span className="mono">.env.example</span> to <span className="mono">.env.local</span> in the <span className="mono">rainmaker</span> folder, fill in what you have, and restart. Keys stay on your server; the browser never sees them.
          </div>
        </section>
      </div>
    </div>
  );
}
