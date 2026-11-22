"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { RefreshCw, Save, Trash } from "lucide-react";
import { api, useToast } from "@/components/client";
import { PlacePicker } from "@/components/PlacePicker";
import { Switch } from "@/components/ui";
import { RULES } from "@/lib/compliance-data";
import { quote } from "@/lib/clients/pricing";
import type { WorkspaceView } from "@/lib/clients/view";
import { COUNTRIES, LANG_NAMES, type Lang } from "@/lib/markets";
import { marketOf } from "@/lib/regions";
import type { ClientSettings, ServiceId } from "@/lib/types";
import { CopyRow, Field, useAct, useMoney } from "./shared";

export function SettingsTab({ view, niches }: { view: WorkspaceView; niches: { id: string; label: string }[]; agencyName: string }) {
  const c = view.client;
  const router = useRouter();
  const toast = useToast();
  const money = useMoney(c);
  const { act, busy } = useAct();
  const [f, setF] = useState({
    name: c.name,
    niche: c.niche,
    contactName: c.contactName ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    staffPhone: c.staffPhone ?? "",
    website: c.website ?? "",
    address: c.address ?? "",
    bookingUrl: c.bookingUrl ?? "",
    place: c.place,
    lang: c.lang,
    timezone: c.timezone,
    currency: c.currency,
    jobValue: c.jobValue,
    monthly: c.monthly,
    setup: c.setup,
    status: c.status,
    notes: c.notes ?? "",
  });
  const [s, setS] = useState<ClientSettings>(c.settings);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const setting = <K extends keyof ClientSettings>(k: K, v: ClientSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const market = useMemo(() => marketOf(f.place, c.country), [f.place, c.country]);
  const q = useMemo(() => quote(market.country.code, (Object.keys(c.services) as ServiceId[]).filter((x) => c.services[x].included)), [market.country.code, c.services]);
  const rules = RULES.find((r) => r.country === c.country);
  const currencies = [...new Set(COUNTRIES.map((x) => x.currency))].sort();

  return (
    <div className="stack" style={{ gap: 18 }}>
      <section className="card">
        <div className="card-head">
          <h3 style={{ margin: 0 }}>The business</h3>
          <button className="btn primary sm" disabled={Boolean(busy)} onClick={() => void act("save", `/api/clients/${c.id}`, { method: "PATCH", json: { ...f, settings: s } }, "Saved")}>
            <Save size={14} /> Save
          </button>
        </div>
        <div className="card-body stack" style={{ gap: 12 }}>
          <div className="grid-2" style={{ gap: 12 }}>
            <Field label="Business name">
              <input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Niche">
              <select className="select" value={f.niche} onChange={(e) => set("niche", e.target.value)}>
                {niches.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
                {!niches.some((n) => n.id === f.niche) && <option value={f.niche}>{f.niche}</option>}
              </select>
            </Field>
            <PlacePicker value={f.place} onChange={(place) => set("place", place)} />
            <Field label="Status">
              <select className="select" value={f.status} onChange={(e) => set("status", e.target.value as typeof f.status)}>
                <option value="onboarding">Onboarding</option>
                <option value="active">Active</option>
                <option value="paused">Paused (nothing automated)</option>
                <option value="ended">Ended</option>
              </select>
            </Field>
            <Field label="Owner's name">
              <input className="input" value={f.contactName} onChange={(e) => set("contactName", e.target.value)} />
            </Field>
            <Field label="Owner's email" hint="Alerts go here when there's no staff phone. Customer replies to emails go here too.">
              <input className="input" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
            </Field>
            <Field label="Business phone">
              <input className="input" type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
            </Field>
            <Field label="Staff phone for alerts" hint="Hot leads and people asking for a person are texted here.">
              <input className="input" type="tel" value={f.staffPhone} onChange={(e) => set("staffPhone", e.target.value)} />
            </Field>
            <Field label="Their current website">
              <input className="input" value={f.website} onChange={(e) => set("website", e.target.value)} />
            </Field>
            <Field label="Booking link" hint="Shared with customers who are ready to book. Without one, they're sent to the website form.">
              <input className="input" value={f.bookingUrl} onChange={(e) => set("bookingUrl", e.target.value)} placeholder="https://…" />
            </Field>
            <Field label="Address" hint="Shown on the website and in email footers.">
              <input className="input" value={f.address} onChange={(e) => set("address", e.target.value)} />
            </Field>
            <Field label="Customers' language">
              <select className="select" value={f.lang} onChange={(e) => set("lang", e.target.value as Lang)}>
                {(Object.keys(LANG_NAMES) as Lang[]).map((l) => (
                  <option key={l} value={l}>
                    {LANG_NAMES[l]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Time zone" hint="Sending hours follow it.">
              <input className="input mono" value={f.timezone} onChange={(e) => set("timezone", e.target.value)} />
            </Field>
            <Field label="Currency">
              <select className="select" value={f.currency} onChange={(e) => set("currency", e.target.value)}>
                {currencies.map((x) => (
                  <option key={x} value={x}>
                    {x.toUpperCase()}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {market.country.code !== c.country && <p className="faint small" style={{ margin: 0 }}>Saving moves them to {market.country.name}: language, time zone, currency and sending hours follow.</p>}
          <Field label="Notes">
            <textarea className="textarea" rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3 style={{ margin: 0 }}>Price and value</h3>
        </div>
        <div className="card-body stack" style={{ gap: 12 }}>
          <div className="grid-3" style={{ gap: 12 }}>
            <Field label={`Monthly (${c.currency.toUpperCase()})`}>
              <input className="input" type="number" min={0} value={f.monthly} onChange={(e) => set("monthly", Number(e.target.value))} />
            </Field>
            <Field label={`Setup (${c.currency.toUpperCase()})`}>
              <input className="input" type="number" min={0} value={f.setup} onChange={(e) => set("setup", Number(e.target.value))} />
            </Field>
            <Field label="One booked customer is worth" hint="For revenue in reports.">
              <input className="input" type="number" min={0} value={f.jobValue} onChange={(e) => set("jobValue", Number(e.target.value))} />
            </Field>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            Suggested for {market.country.name}: {q.currency === c.currency ? money(q.monthly) : `${q.monthly.toLocaleString()} ${q.currency.toUpperCase()}`}/mo + {q.currency === c.currency ? money(q.setup) : `${q.setup.toLocaleString()} ${q.currency.toUpperCase()}`} setup for the {q.lines.length} services in their plan; people doing the same work would cost about {q.currency === c.currency ? money(q.humanMonthly) : q.humanMonthly.toLocaleString()} a month.
            {q.lines.some((l) => l.personCheaper) && " In this market a person costs less than delivering some of these services: sell them on speed and 24/7 cover rather than price."}
          </p>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm" onClick={() => setF((x) => ({ ...x, monthly: q.monthly, setup: q.setup }))} disabled={q.currency !== f.currency}>
              Use the suggested price
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3 style={{ margin: 0 }}>Automation rules</h3>
          <button className="btn primary sm" disabled={Boolean(busy)} onClick={() => void act("rules", `/api/clients/${c.id}`, { method: "PATCH", json: { settings: s } }, "Saved")}>
            <Save size={14} /> Save
          </button>
        </div>
        <div className="card-body stack" style={{ gap: 6 }}>
          <Switch checked={s.autoSend} onChange={(v) => setting("autoSend", v)} label="Send without waiting for my approval" hint="Live steps send on their own. Off: everything waits in Messages for you to approve (good for the first week)." />
          <Switch checked={s.whatsapp} onChange={(v) => setting("whatsapp", v)} label="Use WhatsApp instead of texts" hint={c.whatsappNumber ? "Business-started WhatsApp messages need approved templates outside the 24-hour window." : "Add a WhatsApp sender in the Calls tab first."} disabled={!c.whatsappNumber && !s.whatsapp} />
          <div className="grid-3" style={{ gap: 12, marginTop: 8 }}>
            <Field label="Earliest hour">
              <input className="input" type="number" min={0} max={23} value={s.quietStart} onChange={(e) => setting("quietStart", Number(e.target.value))} />
            </Field>
            <Field label="Latest hour">
              <input className="input" type="number" min={1} max={24} value={s.quietEnd} onChange={(e) => setting("quietEnd", Number(e.target.value))} />
            </Field>
            <Field label="Days">
              <select className="select" value={s.sendDays} onChange={(e) => setting("sendDays", e.target.value as ClientSettings["sendDays"])}>
                <option value="every">Every day</option>
                <option value="mon_sat">Monday to Saturday</option>
                <option value="weekdays">Weekdays only</option>
              </select>
            </Field>
            <Field label="Most automated messages a day">
              <input className="input" type="number" min={1} max={2000} value={s.dailyCap} onChange={(e) => setting("dailyCap", Number(e.target.value))} />
            </Field>
          </div>
          {rules && (
            <p className="faint small" style={{ margin: "4px 0 0" }}>
              {rules.quietHours.why}
            </p>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3 style={{ margin: 0 }}>Links</h3>
        </div>
        <div className="card-body stack" style={{ gap: 10 }}>
          <Field label="Results report (send it to the client every month)">
            <CopyRow value={`${view.base}/report/${c.reportToken}`} />
          </Field>
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn sm" onClick={() => window.confirm("Make a new report link? The old one stops working.") && void act("rot-r", `/api/clients/${c.id}`, { method: "PATCH", json: { rotate: "report" } }, "New report link made")}>
              <RefreshCw size={13} /> New report link
            </button>
            <button className="btn sm" onClick={() => window.confirm("Make a new lead intake key? Forms and Zapier using the old one stop working until you update them.") && void act("rot-i", `/api/clients/${c.id}`, { method: "PATCH", json: { rotate: "intake" } }, "New intake key made")}>
              <RefreshCw size={13} /> New intake key
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3 style={{ margin: 0 }}>Remove</h3>
        </div>
        <div className="card-body">
          <button
            className="btn danger"
            onClick={async () => {
              if (!window.confirm(`Delete ${c.name}, their website, customers and messages? This can't be undone.`)) return;
              try {
                await api(`/api/clients/${c.id}`, { method: "DELETE" });
                toast(`${c.name} deleted`);
                router.push("/clients");
              } catch (err) {
                toast(err instanceof Error ? err.message : String(err), "error");
              }
            }}
          >
            <Trash size={14} /> Delete client
          </button>
        </div>
      </section>
    </div>
  );
}
