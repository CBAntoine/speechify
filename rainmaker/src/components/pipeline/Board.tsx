"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Columns3, LoaderCircle, Plus, Rows3, Search, X } from "lucide-react";
import { api, Modal, useToast } from "@/components/client";
import { DynIcon, Empty, ScoreRing, SignalChips } from "@/components/ui";
import { money, timeAgo } from "@/lib/format";
import { STAGES, type AdCampaign, type Draft, type Lead, type Stage } from "@/lib/types";
import { LeadDrawer } from "./LeadDrawer";

const COLORS: Record<Stage, string> = {
  new: "var(--cool)",
  contacted: "var(--brand)",
  replied: "var(--violet)",
  meeting: "var(--teal)",
  proposal: "var(--warm)",
  won: "var(--good)",
  lost: "var(--line-strong)",
};

export function Board({
  initialLeads,
  drafts,
  campaigns,
  niches,
  openLeadId,
  claude,
}: {
  initialLeads: Lead[];
  drafts: Draft[];
  campaigns: AdCampaign[];
  niches: { id: string; label: string; icon: string }[];
  openLeadId?: string;
  claude: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [leads, setLeads] = useState(initialLeads);
  const [view, setView] = useState<"board" | "table">("board");
  const [q, setQ] = useState("");
  const [nicheFilter, setNicheFilter] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const [openId, setOpenId] = useState<string | undefined>(openLeadId);
  const [adding, setAdding] = useState(false);

  useEffect(() => setLeads(initialLeads), [initialLeads]);

  const niche = (id: string) => niches.find((n) => n.id === id);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return leads.filter((l) => (!nicheFilter || l.niche === nicheFilter) && (!t || `${l.name} ${l.city ?? ""} ${l.contactName ?? ""}`.toLowerCase().includes(t)));
  }, [leads, q, nicheFilter]);

  async function move(id: string, stage: Stage) {
    const prev = leads.find((l) => l.id === id);
    if (!prev || prev.stage === stage) return;
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, stage } : l)));
    try {
      const res = await api<{ lead: Lead }>(`/api/leads/${id}`, { method: "PATCH", json: { stage } });
      setLeads((ls) => ls.map((l) => (l.id === id ? res.lead : l)));
      if (stage === "won") toast(`${prev.name} won. Nice work.`);
      router.refresh();
    } catch (e) {
      setLeads((ls) => ls.map((l) => (l.id === id ? prev : l)));
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  const open = leads.find((l) => l.id === openId) ?? null;
  const pendingFor = (id: string) => drafts.filter((d) => d.leadId === id && d.status === "pending").length;

  return (
    <>
      <div className="row wrap" style={{ marginBottom: 14, gap: 8 }}>
        <div className="tabs">
          <button className="tab" aria-selected={view === "board"} onClick={() => setView("board")}>
            <Columns3 size={14} /> Board
          </button>
          <button className="tab" aria-selected={view === "table"} onClick={() => setView("table")}>
            <Rows3 size={14} /> List
          </button>
        </div>
        <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 320 }}>
          <Search size={14} className="faint" style={{ position: "absolute", left: 11, top: 12 }} />
          <input className="input" style={{ paddingLeft: 32 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search leads" />
        </div>
        <select className="select" style={{ width: 190 }} value={nicheFilter} onChange={(e) => setNicheFilter(e.target.value)} aria-label="Filter by niche">
          <option value="">All niches</option>
          {niches
            .filter((n) => leads.some((l) => l.niche === n.id))
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
        </select>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setAdding(true)}>
          <Plus size={15} /> Add lead
        </button>
      </div>

      {leads.length === 0 ? (
        <div className="card">
          <Empty icon={<Columns3 size={18} />} title="Your pipeline is empty" action={<a className="btn primary" href="/prospects">Find clients <ArrowRight size={14} /></a>}>
            Search a niche and a city, then add the best businesses here in one click.
          </Empty>
        </div>
      ) : view === "board" ? (
        <div className="board">
          {STAGES.map((s) => {
            const items = filtered.filter((l) => l.stage === s.id).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
            const value = items.reduce((a, l) => a + (l.value ?? 0), 0);
            return (
              <section
                key={s.id}
                className={`column ${over === s.id ? "over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(s.id);
                }}
                onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  const id = e.dataTransfer.getData("text/plain") || dragId;
                  if (id) void move(id, s.id);
                }}
                aria-label={`${s.label} column`}
              >
                <div className="column-head">
                  <span className="stage-dot" style={{ background: COLORS[s.id] }} />
                  <b>{s.label}</b>
                  <span className="faint">{items.length}</span>
                  <span className="spacer" />
                  {value > 0 && <span className="faint">{money(value, { compact: true })}/mo</span>}
                </div>
                <div className="column-body">
                  {items.map((l) => {
                    const n = niche(l.niche);
                    const pending = pendingFor(l.id);
                    return (
                      <button
                        key={l.id}
                        className={`deal ${dragId === l.id ? "dragging" : ""}`}
                        draggable
                        onDragStart={(e) => {
                          setDragId(l.id);
                          e.dataTransfer.setData("text/plain", l.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => setDragId(null)}
                        onClick={() => setOpenId(l.id)}
                      >
                        <div className="row" style={{ alignItems: "flex-start", gap: 10, width: "100%" }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <h4 className="truncate">{l.name}</h4>
                            <div className="faint small row" style={{ gap: 5, marginTop: 2 }}>
                              {n && <DynIcon name={n.icon} size={12} />}
                              <span className="truncate">{l.city ?? n?.label}</span>
                            </div>
                          </div>
                          <ScoreRing score={l.score} size="sm" />
                        </div>
                        <SignalChips signals={l.signals} max={2} showPositive={false} />
                        {l.nextStep && (
                          <div className="next">
                            <ArrowRight size={12} style={{ marginTop: 2, flex: "none" }} />
                            <span>{l.nextStep}</span>
                          </div>
                        )}
                        <div className="row small faint" style={{ gap: 8 }}>
                          {l.value ? <span className="nowrap">{money(l.value)}/mo</span> : null}
                          {pending > 0 && <span className="badge brand">{pending} draft{pending > 1 ? "s" : ""}</span>}
                          {l.sample && <span className="badge warm">Sample</span>}
                          <span className="spacer" />
                          <span className="nowrap">{timeAgo(l.lastContactAt ?? l.updatedAt)}</span>
                        </div>
                      </button>
                    );
                  })}
                  {items.length === 0 && <div className="faint small" style={{ padding: "18px 8px", textAlign: "center" }}>Drop a lead here</div>}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Business</th>
                <th>Stage</th>
                <th>Score</th>
                <th>Biggest gap</th>
                <th>Next step</th>
                <th>Value</th>
                <th>Last touch</th>
              </tr>
            </thead>
            <tbody>
              {[...filtered]
                .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
                .map((l) => (
                  <tr key={l.id} onClick={() => setOpenId(l.id)}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{l.name}</div>
                      <div className="faint small">
                        {niche(l.niche)?.label} · {l.city}
                      </div>
                    </td>
                    <td>
                      <span className="row small" style={{ gap: 6 }}>
                        <span className="stage-dot" style={{ background: COLORS[l.stage] }} />
                        {STAGES.find((s) => s.id === l.stage)?.label}
                      </span>
                    </td>
                    <td>
                      <ScoreRing score={l.score} size="sm" />
                    </td>
                    <td className="small">{l.signals?.find((s) => !s.positive)?.label ?? "—"}</td>
                    <td className="small muted">{l.nextStep ?? "—"}</td>
                    <td className="small nowrap">{l.value ? `${money(l.value)}/mo` : "—"}</td>
                    <td className="small faint nowrap">{timeAgo(l.lastContactAt ?? l.updatedAt)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      <LeadDrawer
        lead={open}
        onClose={() => {
          setOpenId(undefined);
          if (openLeadId) router.replace("/pipeline", { scroll: false });
        }}
        onChange={(l, removedId) => {
          if (removedId) setLeads((ls) => ls.filter((x) => x.id !== removedId));
          else if (l) setLeads((ls) => ls.map((x) => (x.id === l.id ? l : x)));
        }}
        drafts={drafts}
        campaigns={campaigns}
        nicheLabel={open ? niche(open.niche)?.label : undefined}
        nicheIcon={open ? niche(open.niche)?.icon : undefined}
        claude={claude}
      />

      <AddLeadModal
        open={adding}
        onClose={() => setAdding(false)}
        niches={niches}
        onAdded={(l) => {
          setLeads((ls) => [l, ...ls]);
          setAdding(false);
          setOpenId(l.id);
          router.refresh();
        }}
      />
    </>
  );
}

function AddLeadModal({ open, onClose, niches, onAdded }: { open: boolean; onClose: () => void; niches: { id: string; label: string }[]; onAdded: (l: Lead) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: "", niche: niches[0]?.id ?? "dentist", city: "", website: "", phone: "", email: "", contactName: "" });
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api<{ lead: Lead }>("/api/leads", { method: "POST", json: { lead: f } });
      let lead = res.lead;
      if (f.website.trim()) {
        const audited = await api<{ lead: Lead }>(`/api/leads/${lead.id}/audit`, { method: "POST", json: {} }).catch(() => null);
        if (audited) lead = audited.lead;
      }
      onAdded(lead);
      setF({ ...f, name: "", website: "", phone: "", email: "", contactName: "" });
      toast("Lead added");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} label="Add a lead">
      <form onSubmit={submit}>
        <div className="card-head">
          <h2>Add a lead</h2>
          <button type="button" className="btn ghost icon sm" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="card-body stack">
          <label className="field">
            <span>Business name</span>
            <input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
          </label>
          <div className="grid-2">
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
            <label className="field">
              <span>City</span>
              <input className="input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
            </label>
            <label className="field">
              <span>Website</span>
              <input className="input" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="We'll audit it" />
            </label>
            <label className="field">
              <span>Phone</span>
              <input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
            </label>
            <label className="field">
              <span>Contact name</span>
              <input className="input" value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} />
            </label>
            <label className="field">
              <span>Email</span>
              <input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            </label>
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy}>
              {busy ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />} Add lead
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
