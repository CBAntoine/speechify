"use client";

import Link from "next/link";
import { useState } from "react";
import { Circle, CircleCheck, ExternalLink, Lightbulb, LoaderCircle, Megaphone, Save, Trash } from "lucide-react";
import { monthName } from "@/lib/clients/i18n";
import { missingFoundations, serviceById } from "@/lib/clients/services";
import type { WorkspaceView } from "@/lib/clients/view";
import { monthKey } from "@/lib/clients/view";
import { timeAgo } from "@/lib/format";
import type { Go } from "./Workspace";
import { Field, ServiceHeader, useAct, useMoney } from "./shared";

type Advice = { summary: string; actions: { title: string; why: string }[] };

export function AdsTab({ view, go }: { view: WorkspaceView; go: Go }) {
  const c = view.client;
  const money = useMoney(c);
  const { act, busy } = useAct();
  const [brief, setBrief] = useState({ goal: c.settings.nurtureGoal, offer: c.site?.content.offer ?? "", notes: "" });
  const [row, setRow] = useState({ month: monthKey(new Date()), spend: "", leads: "", booked: "", revenue: "" });
  const [advice, setAdvice] = useState<(Advice & { by: string }) | null>(null);
  const missing = missingFoundations("ads", c.services);
  const ready = missing.length === 0;
  const foundations = ["website", "speed_to_lead", "missed_calls"] as const;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <ServiceHeader client={c} id="ads">
        <div className={`tip ${ready ? "neutral" : "warn"}`} style={{ display: "block" }}>
          <b>{ready ? "Ready to scale." : "Not yet: fix the bucket first."}</b>{" "}
          {ready ? "Every lead is answered in seconds and every call is picked up, so ad money turns into bookings." : "Ads pour more water into the bucket. Get these live first, or most of what you spend leaks out."}
          <ul className="checklist" style={{ marginTop: 8 }}>
            {foundations.map((id) => {
              const s = serviceById(id)!;
              const ok = c.services[id].status === "live";
              return (
                <li key={id} className={ok ? "done" : ""}>
                  <button type="button" className="link-btn" onClick={() => go(id)}>
                    {ok ? <CircleCheck size={14} /> : <Circle size={14} />} {s.step}. {s.name}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </ServiceHeader>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h3 style={{ margin: 0 }}>Campaigns</h3>
          </div>
          <div className="card-body stack" style={{ gap: 12 }}>
            <div className="grid-2" style={{ gap: 12 }}>
              <Field label="Goal">
                <input className="input" value={brief.goal} onChange={(e) => setBrief({ ...brief, goal: e.target.value })} />
              </Field>
              <Field label="Offer (a real one)">
                <input className="input" value={brief.offer} onChange={(e) => setBrief({ ...brief, offer: e.target.value })} placeholder="e.g. Free estimate" />
              </Field>
            </div>
            <Field label="Notes for the ad writer">
              <input className="input" value={brief.notes} onChange={(e) => setBrief({ ...brief, notes: e.target.value })} placeholder="Audience, season, what's worked before" />
            </Field>
            <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={Boolean(busy)} onClick={() => void act("camp", `/api/clients/${c.id}/ads`, { method: "POST", json: { action: "campaign", ...brief } }, "Campaign written: open it in Ad Studio")}>
              {busy === "camp" ? <LoaderCircle size={14} className="spin" /> : <Megaphone size={14} />} Write a campaign
            </button>
            <p className="faint small" style={{ margin: 0 }}>
              Meta ads, a Google search ad and video scripts, landing on {c.site?.published ? "their new website" : "their website"}. Ad leads flow into step 4 through the intake address (Google lead forms, Meta via Zapier) or the site form.
            </p>
            {view.campaigns.length > 0 && (
              <div className="list" style={{ marginTop: 4 }}>
                {view.campaigns.map((x) => (
                  <div key={x.id} className="list-item" style={{ padding: "10px 0" }}>
                    <span style={{ flex: 1 }}>
                      <b>{x.businessName}</b> <span className="faint small">· {timeAgo(x.createdAt)}</span>
                    </span>
                    <Link className="btn ghost sm" href={`/ads?campaign=${x.id}`}>
                      <ExternalLink size={13} /> Ad Studio
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h3 style={{ margin: 0 }}>Advice for next month</h3>
            <button
              className="btn sm"
              disabled={Boolean(busy)}
              onClick={async () => {
                const r = await act<Advice & { advice: Advice; by: string; note?: string }>("adv", `/api/clients/${c.id}/ads`, { method: "POST", json: { action: "advice" } }, (r) => r.note);
                if (r) setAdvice({ ...r.advice, by: r.by });
              }}
            >
              {busy === "adv" ? <LoaderCircle size={14} className="spin" /> : <Lightbulb size={14} />} Get advice
            </button>
          </div>
          <div className="card-body stack" style={{ gap: 8 }}>
            {advice ? (
              <>
                <p className="muted small" style={{ margin: 0 }}>{advice.summary}</p>
                <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
                  {advice.actions.map((a, i) => (
                    <li key={i} style={{ marginBottom: 6 }}>
                      <b>{a.title}.</b> {a.why}
                    </li>
                  ))}
                </ol>
                <span className="faint small">{advice.by === "ai" ? "From Claude, judged on cost per booking" : "From the numbers (add a Claude key for deeper advice)"}</span>
              </>
            ) : (
              <p className="faint small" style={{ margin: 0 }}>Record a month of results, then ask. Judged on bookings and revenue, not clicks.</p>
            )}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h3 style={{ margin: 0 }}>Monthly results</h3>
        </div>
        <div className="card-body stack" style={{ gap: 12 }}>
          <div className="ad-row-form">
            <input className="input" type="month" value={row.month} onChange={(e) => setRow({ ...row, month: e.target.value })} aria-label="Month" />
            <input className="input" type="number" min={0} placeholder={`Spend (${c.currency.toUpperCase()})`} value={row.spend} onChange={(e) => setRow({ ...row, spend: e.target.value })} aria-label="Spend" />
            <input className="input" type="number" min={0} placeholder="Leads" value={row.leads} onChange={(e) => setRow({ ...row, leads: e.target.value })} aria-label="Leads" />
            <input className="input" type="number" min={0} placeholder="Booked" value={row.booked} onChange={(e) => setRow({ ...row, booked: e.target.value })} aria-label="Booked" />
            <input className="input" type="number" min={0} placeholder="Revenue (optional)" value={row.revenue} onChange={(e) => setRow({ ...row, revenue: e.target.value })} aria-label="Revenue" />
            <button className="btn primary" disabled={Boolean(busy) || !row.month} onClick={() => void act("month", `/api/clients/${c.id}/ads`, { method: "POST", json: { action: "month", ...row } }, "Month saved")}>
              <Save size={14} /> Save
            </button>
          </div>
          {c.adMonths.length > 0 && (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Spend</th>
                    <th>Leads</th>
                    <th>Per lead</th>
                    <th>Booked</th>
                    <th>Per booking</th>
                    <th>Return</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {c.adMonths.map((m) => {
                    const revenue = m.revenue ?? m.booked * c.jobValue;
                    return (
                      <tr key={m.month}>
                        <td>{monthName(m.month, "en")}</td>
                        <td>{money(m.spend)}</td>
                        <td>{m.leads}</td>
                        <td>{m.leads ? money(m.spend / m.leads) : "–"}</td>
                        <td>{m.booked}</td>
                        <td>{m.booked ? money(m.spend / m.booked) : "–"}</td>
                        <td title={m.revenue === undefined ? "Bookings × what a customer is worth" : "Revenue you entered"}>{m.spend ? `${(revenue / m.spend).toFixed(1)}×` : "–"}</td>
                        <td>
                          <button className="btn ghost icon sm" aria-label={`Delete ${m.month}`} onClick={() => void act(`del:${m.month}`, `/api/clients/${c.id}/ads`, { method: "POST", json: { action: "delete_month", month: m.month } }, "Deleted")}>
                            <Trash size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="faint small" style={{ margin: 0 }}>Ad spend is paid to Meta or Google from the client&apos;s own ad accounts; your fee covers running them.</p>
        </div>
      </section>
    </div>
  );
}
