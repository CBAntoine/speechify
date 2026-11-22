"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Briefcase, ExternalLink, FileText, LoaderCircle, RefreshCw, Share2, Trash } from "lucide-react";
import { api, CopyButton, useToast } from "@/components/client";
import { shareOrCopy, useCanShare } from "@/components/pwa";
import { formatMoney } from "@/lib/clients/pricing";
import { SERVICES } from "@/lib/clients/services";
import { timeAgo } from "@/lib/format";
import type { Client, Lead, Proposal, ServiceId } from "@/lib/types";

// "Sell the outcome": an outcome proposal for this lead (the seven services in
// order, priced under what the people would cost where they are), and turning
// them into a client once they sign.

export function DeliverPanel({ lead, onChange }: { lead: Lead; onChange: (l: Lead) => void }) {
  const router = useRouter();
  const toast = useToast();
  const shareable = useCanShare();
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [services, setServices] = useState<ServiceId[]>(lead.proposal?.services ?? SERVICES.map((s) => s.id));
  useEffect(() => setOrigin(window.location.origin), []);

  const p = lead.proposal;
  const url = p ? `${origin}/proposal/${p.token}` : "";
  const money = (n: number, pr: Proposal) => formatMoney(n, pr.currency);

  async function propose() {
    setBusy("propose");
    try {
      const r = await api<{ proposal: Proposal; url: string }>(`/api/leads/${lead.id}/proposal`, { method: "POST", json: { services } });
      onChange({ ...lead, proposal: r.proposal, stage: ["new", "contacted", "replied", "meeting"].includes(lead.stage) ? "proposal" : lead.stage });
      toast("Proposal ready. Send them the link.");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(null);
    }
  }

  async function makeClient() {
    setBusy("client");
    try {
      const r = await api<{ client: Client }>("/api/clients", { method: "POST", json: { leadId: lead.id, services } });
      toast(`${r.client.name} is now a client. Start with step 1, the website.`);
      router.push(`/clients/${r.client.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
      setBusy(null);
    }
  }

  return (
    <section className="stack" style={{ gap: 10 }}>
      <div className="section-title" style={{ margin: 0 }}>
        Sell the outcome
      </div>
      {lead.clientId ? (
        <Link href={`/clients/${lead.clientId}`} className="btn primary" style={{ alignSelf: "flex-start" }}>
          <Briefcase size={15} /> Open their client workspace
        </Link>
      ) : (
        <>
          <p className="muted small" style={{ margin: 0 }}>
            Pitch the jobs they already pay people for (answering calls, following up, reviews), priced under what those people cost. Don&apos;t lead with the technology.
          </p>
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
          {p && (
            <div className="card" style={{ padding: 12 }}>
              <div className="row between" style={{ gap: 8 }}>
                <b className="small">
                  {money(p.monthly, p)}/mo{p.setup ? ` + ${money(p.setup, p)} setup` : ""}
                </b>
                <span className="faint small">people would cost {money(p.humanMonthly, p)}/mo</span>
              </div>
              <div className="faint small" style={{ marginTop: 4 }}>
                {p.acceptedAt && (
                  <>
                    <b className="good-text">Accepted {timeAgo(p.acceptedAt)}</b>: invoice them, then make them a client ·{" "}
                  </>
                )}
                {p.viewedAt ? `Opened ${p.views ?? 1}× · last ${timeAgo(p.viewedAt)}` : "Not opened yet"} · in {p.lang === "es" ? "Spanish" : p.lang === "fr" ? "French" : "English"}
              </div>
              <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                <a className="btn sm" href={url} target="_blank" rel="noreferrer">
                  <ExternalLink size={13} /> Open
                </a>
                <CopyButton text={url} label="Copy link" />
                {shareable && (
                  <button className="btn sm" onClick={() => void shareOrCopy({ title: `Proposal for ${lead.name}`, text: url })}>
                    <Share2 size={13} /> Share
                  </button>
                )}
                <button
                  className="btn ghost sm"
                  disabled={Boolean(busy)}
                  onClick={async () => {
                    if (!confirm("Remove this proposal? The link stops working.")) return;
                    await api(`/api/leads/${lead.id}/proposal`, { method: "DELETE" }).then(() => onChange({ ...lead, proposal: undefined }), (err) => toast(String(err), "error"));
                  }}
                  aria-label="Remove proposal"
                >
                  <Trash size={13} />
                </button>
              </div>
            </div>
          )}
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn" onClick={() => void propose()} disabled={Boolean(busy) || !services.length}>
              {busy === "propose" ? <LoaderCircle size={14} className="spin" /> : p ? <RefreshCw size={14} /> : <FileText size={14} />} {p ? "Update proposal" : "Make a proposal"}
            </button>
            <button className="btn primary" onClick={() => void makeClient()} disabled={Boolean(busy) || !services.length}>
              {busy === "client" ? <LoaderCircle size={14} className="spin" /> : <Briefcase size={14} />} They signed: make them a client
            </button>
          </div>
        </>
      )}
    </section>
  );
}
