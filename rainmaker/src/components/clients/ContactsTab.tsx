"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, MessagesSquare, Search, Trash } from "lucide-react";
import { api } from "@/components/client";
import type { WorkspaceView } from "@/lib/clients/view";
import { timeAgo } from "@/lib/format";
import { displayPhone } from "@/lib/phone";
import type { Contact } from "@/lib/types";
import type { Go } from "./Workspace";
import { useAct } from "./shared";
import { ImportCard } from "./WinbackTab";

const STATUS: Record<Contact["status"], string> = { new: "New", contacted: "Contacted", engaged: "Talking", booked: "Booked", lost: "Not interested", opted_out: "Opted out" };

export function ContactsTab({ view, go }: { view: WorkspaceView; go: Go }) {
  const c = view.client;
  const { act, busy } = useAct();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [list, setList] = useState<{ contacts: Contact[]; total: number }>({ contacts: view.contacts.slice(0, 50), total: view.contactTotal });
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      api<{ contacts: Contact[]; total: number }>(`/api/clients/${c.id}/contacts?q=${encodeURIComponent(q)}&status=${status}&offset=${offset}&limit=50`).then(setList, () => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [q, status, offset, c.id, view.contactTotal]);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <section className="card">
        <div className="card-head">
          <h3 style={{ margin: 0 }}>Customers and leads ({list.total})</h3>
          <div className="row" style={{ gap: 6 }}>
            <span className="copy-field">
              <Search size={14} className="faint" />
              <input className="input" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} placeholder="Search" aria-label="Search customers" style={{ width: 180 }} />
            </span>
            <select className="select sm-select" value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }} aria-label="Status">
              <option value="">Everyone</option>
              {Object.entries(STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>From</th>
                <th>Status</th>
                <th>May get</th>
                <th>Last visit</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.contacts.map((x) => (
                <tr key={x.id}>
                  <td>
                    <b>{x.name}</b>
                    {x.referredBy && <span className="badge" style={{ marginLeft: 6 }}>referred</span>}
                  </td>
                  <td className="small">
                    {x.phone ? displayPhone(x.phone) : ""}
                    {x.phone && x.email ? <br /> : null}
                    {x.email ?? ""}
                  </td>
                  <td className="small">{x.source}</td>
                  <td>
                    <span className={`badge ${x.status === "booked" ? "good" : x.status === "opted_out" ? "hot" : x.status === "engaged" ? "teal" : ""}`}>{STATUS[x.status]}</span>
                  </td>
                  <td className="small">{x.optedOutAt ? "nothing" : [x.consent.sms && "texts", x.consent.email && "email"].filter(Boolean).join(", ") || "replies only"}</td>
                  <td className="small">{x.lastVisit ?? (x.jobDoneAt ? timeAgo(x.jobDoneAt) : "")}</td>
                  <td>
                    <span className="row" style={{ gap: 2, justifyContent: "flex-end" }}>
                      <button className="btn ghost icon sm" title="Conversation" aria-label={`Conversation with ${x.name}`} onClick={() => go("messages", { contact: x.id })}>
                        <MessagesSquare size={14} />
                      </button>
                      <button className="btn ghost icon sm" title="Job done: ask for a review" aria-label={`Mark ${x.name}'s job done`} disabled={Boolean(busy) || Boolean(x.jobDoneAt)} onClick={() => void act(`job:${x.id}`, `/api/clients/${c.id}/contacts`, { method: "POST", json: { action: "jobs_done", ids: [x.id] } }, "Review request queued")}>
                        <BadgeCheck size={14} />
                      </button>
                      <button className="btn ghost icon sm" title="Delete" aria-label={`Delete ${x.name}`} disabled={Boolean(busy)} onClick={() => window.confirm(`Delete ${x.name} and their messages?`) && void act(`del:${x.id}`, `/api/clients/${c.id}/contacts`, { method: "POST", json: { action: "delete", ids: [x.id] } }, "Deleted")}>
                        <Trash size={14} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.contacts.length && <div className="card-body faint small">Nobody yet. Import their customer list below, or leads arrive from the website and calls.</div>}
        {list.total > 50 && (
          <div className="card-body row between small">
            <button className="btn ghost sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>
              Previous
            </button>
            <span className="faint">
              {offset + 1}–{Math.min(offset + 50, list.total)} of {list.total}
            </span>
            <button className="btn ghost sm" disabled={offset + 50 >= list.total} onClick={() => setOffset(offset + 50)}>
              Next
            </button>
          </div>
        )}
      </section>
      <ImportCard view={view} title="Import customers" intro="A CSV from their booking system, POS or a spreadsheet. Name plus a mobile or email; last visit date helps the win-back." />
    </div>
  );
}
