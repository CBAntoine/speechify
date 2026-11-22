"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowRight, Briefcase, Inbox, LoaderCircle, Plus, UserPlus, X } from "lucide-react";
import { api, Modal, useToast } from "@/components/client";
import { PlacePicker } from "@/components/PlacePicker";
import { Empty } from "@/components/ui";
import { formatDuration, type Results } from "@/lib/clients/metrics";
import { formatMoney, quote } from "@/lib/clients/pricing";
import { SERVICES } from "@/lib/clients/services";
import { countryByCode } from "@/lib/markets";
import { marketOf } from "@/lib/regions";
import type { Client, ServiceId } from "@/lib/types";
import { ServiceIcon } from "./shared";

type Row = {
  client: Pick<Client, "id" | "name" | "niche" | "place" | "country" | "lang" | "currency" | "status" | "monthly" | "services" | "sample">;
  results: Results;
  drafts: number;
  needsHuman: number;
};

const money = (n: number, c: Pick<Client, "currency">) => formatMoney(n, c.currency);

export function ClientsList({ rows, leads, niches, defaultPlace }: { rows: Row[]; leads: { id: string; name: string; niche: string; city?: string; stage: string }[]; niches: { id: string; label: string }[]; defaultPlace: string }) {
  const [open, setOpen] = useState(false);
  const byCurrency = new Map<string, number>();
  for (const r of rows) if (r.client.status !== "ended") byCurrency.set(r.client.currency, (byCurrency.get(r.client.currency) ?? 0) + r.client.monthly);
  const niche = (id: string) => niches.find((n) => n.id === id)?.label ?? id;

  return (
    <>
      <div className="row between wrap" style={{ gap: 10, marginBottom: 16 }}>
        <div className="row wrap" style={{ gap: 18 }}>
          <span className="stack" style={{ gap: 0 }}>
            <span className="faint small">Clients</span>
            <b className="metric">{rows.filter((r) => r.client.status !== "ended").length}</b>
          </span>
          {[...byCurrency].map(([cur, total]) => (
            <span key={cur} className="stack" style={{ gap: 0 }}>
              <span className="faint small">Monthly ({cur.toUpperCase()})</span>
              <b className="metric">{formatMoney(total, cur)}</b>
            </span>
          ))}
        </div>
        <button className="btn primary" onClick={() => setOpen(true)}>
          <Plus size={15} /> Add client
        </button>
      </div>

      {rows.length ? (
        <div className="client-grid">
          {rows.map(({ client: c, results: r, drafts, needsHuman }) => (
            <Link key={c.id} href={`/clients/${c.id}`} className="card client-card">
              <div className="row between" style={{ gap: 10, alignItems: "flex-start" }}>
                <span style={{ minWidth: 0 }}>
                  <b className="truncate" style={{ display: "block", fontSize: 15 }}>
                    {c.name}
                  </b>
                  <span className="faint small truncate" style={{ display: "block" }}>
                    {niche(c.niche)} · {c.place || countryByCode(c.country)?.name}
                  </span>
                </span>
                <span className={`badge ${c.status === "active" ? "good" : c.status === "onboarding" ? "warm" : ""}`}>{c.sample ? "Sample" : c.status}</span>
              </div>
              <div className="step-dots" aria-label="The seven services">
                {SERVICES.map((s) => (
                  <span key={s.id} className={`step-dot ${c.services[s.id].included ? c.services[s.id].status : "out"}`} title={`${s.step}. ${s.short}: ${c.services[s.id].included ? c.services[s.id].status : "not in plan"}`}>
                    <ServiceIcon s={s} size={12} />
                  </span>
                ))}
              </div>
              <div className="client-stats">
                <span>
                  <b>{r.leads}</b> leads{r.medianResponseSec !== undefined ? `, answered in ${formatDuration(r.medianResponseSec)}` : ""}
                </span>
                <span>
                  <b>{r.calls.ai + r.calls.textedBack}</b> calls caught
                </span>
                <span>
                  <b>{r.booked}</b> booked
                </span>
              </div>
              <div className="row between small">
                <span className="muted">{money(c.monthly, c)}/mo</span>
                {drafts + needsHuman > 0 ? (
                  <span className="badge hot">
                    <Inbox size={12} /> {drafts + needsHuman} waiting
                  </span>
                ) : (
                  <ArrowRight size={15} className="faint" />
                )}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty icon={<Briefcase size={18} />} title="No clients yet" action={<button className="btn primary" onClick={() => setOpen(true)}><Plus size={15} /> Add your first client</button>}>
            When a business signs (or a store order comes in), add them here. You&apos;ll deploy the seven services in order, and each month&apos;s results build their report.
          </Empty>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} label="Add a client">
        <NewClient leads={leads} niches={niches} defaultPlace={defaultPlace} onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function NewClient({ leads, niches, defaultPlace, onClose }: { leads: { id: string; name: string; niche: string; city?: string; stage: string }[]; niches: { id: string; label: string }[]; defaultPlace: string; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<"lead" | "new">(leads.length ? "lead" : "new");
  const [leadId, setLeadId] = useState(leads[0]?.id ?? "");
  const [f, setF] = useState({ name: "", niche: niches[0]?.id ?? "dentist", place: defaultPlace, website: "", phone: "", email: "", contactName: "" });
  const [services, setServices] = useState<ServiceId[]>(SERVICES.map((s) => s.id));
  const [saving, setSaving] = useState(false);
  const place = mode === "lead" ? (leads.find((l) => l.id === leadId)?.city ?? defaultPlace) : f.place;
  const market = useMemo(() => marketOf(place || defaultPlace || "", "US"), [place, defaultPlace]);
  const q = useMemo(() => quote(market.country.code, services), [market.country.code, services]);
  const fmt = (n: number) => formatMoney(n, q.currency);

  async function create() {
    setSaving(true);
    try {
      const body = mode === "lead" ? { leadId, services } : { ...f, services };
      const r = await api<{ client: Client }>("/api/clients", { method: "POST", json: body });
      toast(`${r.client.name} added. Start with step 1, the website.`);
      onClose();
      router.push(`/clients/${r.client.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 14, padding: 20, maxWidth: 640 }}>
      <div className="row between">
        <h2 style={{ margin: 0, fontSize: 18 }}>Add a client</h2>
        <button className="btn ghost icon sm" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={mode === "lead"} onClick={() => setMode("lead")} disabled={!leads.length}>
          <UserPlus size={14} /> From your pipeline
        </button>
        <button className="tab" role="tab" aria-selected={mode === "new"} onClick={() => setMode("new")}>
          <Plus size={14} /> New business
        </button>
      </div>
      {mode === "lead" ? (
        <label className="field">
          <span>Lead</span>
          <select className="select" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            {leads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.city ? ` · ${l.city}` : ""}
                {l.stage === "won" ? " · Won" : ""}
              </option>
            ))}
          </select>
          <small>Their website audit, phone, email and any demo receptionist come along. The lead moves to Won.</small>
        </label>
      ) : (
        <div className="grid-2" style={{ gap: 12 }}>
          <label className="field">
            <span>Business name</span>
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          </label>
          <label className="field">
            <span>Niche</span>
            <select className="select" value={f.niche} onChange={(e) => setF({ ...f, niche: e.target.value })}>
              {niches.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </label>
          <PlacePicker value={f.place} onChange={(place) => setF((x) => ({ ...x, place }))} />
          <label className="field">
            <span>Their website (if any)</span>
            <input className="input" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="example.com" />
          </label>
          <label className="field">
            <span>Owner&apos;s name</span>
            <input className="input" value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} />
          </label>
          <label className="field">
            <span>Owner&apos;s email</span>
            <input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </label>
          <label className="field">
            <span>Business phone</span>
            <input className="input" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </label>
        </div>
      )}
      <div className="field">
        <span>What they&apos;re paying for</span>
        <div className="chips">
          {SERVICES.map((s) => {
            const on = services.includes(s.id);
            return (
              <button key={s.id} type="button" className={`chip ${on ? "positive" : ""}`} aria-pressed={on} onClick={() => setServices((x) => (on ? x.filter((y) => y !== s.id) : [...x, s.id]))}>
                {s.step}. {s.short}
              </button>
            );
          })}
        </div>
      </div>
      <div className="tip neutral">
        <span>
          In {market.country.name}: people doing this work would cost about <b>{fmt(q.humanMonthly)}/mo</b> ({q.fte} full-time). Suggested price: <b>{fmt(q.monthly)}/mo</b>
          {q.setup ? ` + ${fmt(q.setup)} setup` : ""} ({Math.round(q.share * 100)}% of that). You can change it later.
          {q.basis === "estimate" ? " Wages here are estimated from the minimum wage." : ""}
        </span>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => void create()} disabled={saving || !services.length || (mode === "new" ? !f.name.trim() : !leadId)}>
          {saving ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />} Add client
        </button>
      </div>
    </div>
  );
}
