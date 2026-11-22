"use client";

import { useMemo, useState } from "react";
import { FileText, LoaderCircle, Play, Upload } from "lucide-react";
import { useToast } from "@/components/client";
import { RULES } from "@/lib/compliance-data";
import type { WorkspaceView } from "@/lib/clients/view";
import type { Go } from "./Workspace";
import { Field, SequenceEditor, ServiceHeader, useAct } from "./shared";

type Preview = { count: number; total: number; duplicates: number; skipped: { line: number; reason: string }[]; columns: Record<string, string>; rows: { name: string; phone?: string; email?: string; lastVisit?: string }[] };

/** Import a customer list: paste or upload, check the columns, say what they agreed to. */
export function ImportCard({ view, source = "import", title, intro }: { view: WorkspaceView; source?: string; title: string; intro: React.ReactNode }) {
  const c = view.client;
  const toast = useToast();
  const { act, busy } = useAct();
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [email, setEmail] = useState(true);
  const [sms, setSms] = useState(false);
  const rules = RULES.find((r) => r.country === c.country);

  const load = (file: File) => {
    if (file.size > 8 * 1024 * 1024) return toast("That file is over 8 MB. Export just name, phone, email and last visit.", "error");
    const reader = new FileReader();
    reader.onload = () => {
      setCsv(String(reader.result ?? ""));
      setPreview(null);
    };
    reader.readAsText(file);
  };

  return (
    <section className="card">
      <div className="card-head">
        <h3 style={{ margin: 0 }}>{title}</h3>
        <label className="btn sm">
          <Upload size={14} /> Upload CSV
          <input type="file" accept=".csv,.txt,text/csv" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        </label>
      </div>
      <div className="card-body stack" style={{ gap: 12 }}>
        <p className="muted small" style={{ margin: 0 }}>{intro}</p>
        <textarea className="textarea mono" rows={5} value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); }} placeholder={"Name,Phone,Email,Last visit\nAna López,(416) 555-0199,ana@example.com,2025-03-14"} aria-label="Customer list" />
        <div className="toggle-row">
          <span>
            <b>They bought from {c.name} (email is allowed)</b>
            <small>{rules?.email.text}</small>
          </span>
          <span className="switch">
            <input type="checkbox" role="switch" checked={email} onChange={(e) => setEmail(e.target.checked)} />
          </span>
        </div>
        <div className="toggle-row">
          <span>
            <b>They agreed to get texts from {c.name}</b>
            <small>
              Only switch this on if you have their permission on record (a signed form, a checkbox, a text they sent). {rules?.smsConsent === "express_written" ? "In the US, marketing texts need prior express written consent." : rules?.sms.text}
            </small>
          </span>
          <span className="switch">
            <input type="checkbox" role="switch" checked={sms} onChange={(e) => setSms(e.target.checked)} />
          </span>
        </div>
        {preview && (
          <div className="tip neutral" style={{ display: "block" }}>
            <b>{preview.count}</b> of {preview.total} rows ready
            {preview.duplicates ? `, ${preview.duplicates} duplicates merged` : ""}
            {preview.skipped.length ? `, ${preview.skipped.length} skipped (${preview.skipped.slice(0, 2).map((s) => `line ${s.line}: ${s.reason}`).join("; ")})` : ""}.
            <div className="faint small" style={{ marginTop: 6 }}>
              Columns: {Object.entries(preview.columns).map(([k, v]) => `${k} ← "${v}"`).join(", ") || "none recognised"}
            </div>
            <div className="table-scroll" style={{ marginTop: 8 }}>
              <table className="table">
                <tbody>
                  {preview.rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.name}</td>
                      <td className="mono">{r.phone ?? "–"}</td>
                      <td>{r.email ?? "–"}</td>
                      <td>{r.lastVisit ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn"
            disabled={!csv.trim() || Boolean(busy)}
            onClick={async () => {
              const r = await act<Preview>("preview", `/api/clients/${c.id}/contacts`, { method: "POST", json: { action: "preview", csv } });
              if (r) setPreview(r);
            }}
          >
            <FileText size={14} /> Check the list
          </button>
          <button
            className="btn primary"
            disabled={!csv.trim() || !preview || Boolean(busy)}
            onClick={async () => {
              const r = await act<{ added: number; updated: number }>("import", `/api/clients/${c.id}/contacts`, { method: "POST", json: { action: "import", csv, consent: { email, sms }, source } }, (r) => `${r.added} added${r.updated ? `, ${r.updated} already there` : ""}`);
              if (r) {
                setCsv("");
                setPreview(null);
              }
            }}
          >
            {busy === "import" ? <LoaderCircle size={14} className="spin" /> : <Upload size={14} />} Import
          </button>
        </div>
      </div>
    </section>
  );
}

export function WinbackTab({ view, go }: { view: WorkspaceView; go: Go }) {
  const c = view.client;
  const { act, busy } = useAct();
  const [months, setMonths] = useState(3);
  const [offer, setOffer] = useState(c.settings.reactivationOffer);
  const seq = view.sequences.find((s) => s.kind === "reactivation" && s.status === "running") ?? view.sequences.find((s) => s.kind === "reactivation");
  const imported = view.contacts.filter((x) => x.source === "import");
  const cutoff = Date.now() - months * 30 * 86_400_000;
  const eligible = useMemo(() => imported.filter((x) => !x.optedOutAt && !x.enrollments.some((e) => e.kind === "reactivation" && !e.stoppedAt) && (!x.lastVisit || Date.parse(x.lastVisit) < cutoff)), [imported, cutoff]);
  const onIt = view.contacts.filter((x) => x.enrollments.some((e) => e.kind === "reactivation" && !e.stoppedAt)).length;
  const replies = view.messages.filter((m) => m.direction === "in" && view.contacts.find((x) => x.id === m.contactId)?.enrollments.some((e) => e.kind === "reactivation")).slice(-6).reverse();
  const r = view.month.winback;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <ServiceHeader client={c} id="reactivation">
        <div className="grid-3" style={{ gap: 12 }}>
          <div className="stack" style={{ gap: 0 }}>
            <span className="faint small">Reached this month</span>
            <b className="metric">{r.reached}</b>
          </div>
          <div className="stack" style={{ gap: 0 }}>
            <span className="faint small">Replied</span>
            <b className="metric">{r.replied}</b>
          </div>
          <div className="stack" style={{ gap: 0 }}>
            <span className="faint small">Booked</span>
            <b className="metric">{r.booked}</b>
          </div>
        </div>
      </ServiceHeader>

      <ImportCard
        view={view}
        title="1. Their past customers"
        intro={<>Export the list from their booking system, POS or spreadsheet: name, mobile, email and the date of their last visit if they have it. {imported.length ? `${view.counts.customers} customers on file.` : ""}</>}
      />

      <SequenceEditor
        client={c}
        seq={seq}
        kind="reactivation"
        title="2. The win-back messages"
        hint="Short, personal, one yes/no question. Replies stop the sequence and go to the AI (or you), steered to a booking."
        extra={
          <Field label="Offer (optional, only a real one)" hint="Used in the first message when it's set.">
            <div className="copy-field">
              <input className="input" value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="e.g. 20% off a tune-up this month" />
              <button className="btn sm" onClick={() => void act("offer", `/api/clients/${c.id}/sequences`, { method: "POST", json: { action: "write", kind: "reactivation", seqId: seq?.id, offer } }, "Offer saved and messages rewritten")} disabled={Boolean(busy)}>
                Save & rewrite
              </button>
            </div>
          </Field>
        }
      />

      <section className="card">
        <div className="card-head">
          <h3 style={{ margin: 0 }}>3. Start it</h3>
          <span className="faint small">{onIt} on the win-back now</span>
        </div>
        <div className="card-body stack" style={{ gap: 12 }}>
          <label className="row small" style={{ gap: 8 }}>
            Customers who haven&apos;t been in for at least
            <select className="select sm-select" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              {[0, 2, 3, 6, 12].map((m) => (
                <option key={m} value={m}>
                  {m ? `${m} months` : "any time"}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small" style={{ margin: 0 }}>
            About <b>{eligible.length}</b> of the customers shown can be reached
            {view.contactTotal > view.contacts.length ? " (the server counts the full list)" : ""}. It sends up to {c.settings.dailyCap} messages a day, {c.settings.quietStart === 0 && c.settings.quietEnd >= 24 ? "at any hour" : `${c.settings.quietStart}:00–${c.settings.quietEnd}:00 their time`}, and never to anyone who opted out or didn&apos;t agree to that channel.
          </p>
          <button
            className="btn primary"
            style={{ alignSelf: "flex-start" }}
            disabled={Boolean(busy) || !imported.length || c.services.reactivation.status === "off"}
            onClick={() => void act("start", `/api/clients/${c.id}/contacts`, { method: "POST", json: { action: "winback", all: true, olderThanDays: months * 30, seqId: seq?.id } }, (r: { enrolled: number; sent: number; drafted: number }) => `${r.enrolled} started · ${r.sent} sent, ${r.drafted} drafted so far`)}
          >
            {busy === "start" ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />} Start the win-back
          </button>
          {c.services.reactivation.status === "off" && <p className="faint small" style={{ margin: 0 }}>Switch this step to Setting up (drafts) or Live above first.</p>}
        </div>
      </section>

      {replies.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h3 style={{ margin: 0 }}>Latest replies</h3>
            <button className="btn ghost sm" onClick={() => go("messages")}>
              All messages
            </button>
          </div>
          <div className="list">
            {replies.map((m) => {
              const who = view.contacts.find((x) => x.id === m.contactId);
              return (
                <button key={m.id} className="list-item link-row" onClick={() => go("messages", { contact: m.contactId })}>
                  <span className="truncate">
                    <b>{who?.name}</b>: {m.body}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
