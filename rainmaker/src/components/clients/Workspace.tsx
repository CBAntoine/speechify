"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Circle, CircleCheck, ExternalLink, FileText, Inbox, LayoutDashboard, LoaderCircle, MessagesSquare, Play, Settings, Users } from "lucide-react";
import { formatDuration, type Results } from "@/lib/clients/metrics";
import { wagesFor } from "@/lib/clients/pricing";
import { nextService, SERVICES, serviceById } from "@/lib/clients/services";
import { countryByCode, LANG_NAMES } from "@/lib/markets";
import type { TabId, WorkspaceView } from "@/lib/clients/view";
import { AdsTab } from "./AdsTab";
import { CallsTab } from "./CallsTab";
import { CoachTab } from "./CoachTab";
import { ContactsTab } from "./ContactsTab";
import { LeadsTab } from "./LeadsTab";
import { MessagesTab } from "./MessagesTab";
import { ReviewsTab } from "./ReviewsTab";
import { ServiceIcon, SvcPill, useAct, useMoney } from "./shared";
import { SettingsTab } from "./SettingsTab";
import { SiteTab } from "./SiteTab";
import { WinbackTab } from "./WinbackTab";

export type Go = (tab: TabId, extra?: Record<string, string>) => void;

export function Workspace({ view, tab: initial, contactId, niches, agencyName }: { view: WorkspaceView; tab: TabId; contactId?: string; niches: { id: string; label: string }[]; agencyName: string }) {
  const [tab, setTab] = useState<TabId>(initial);
  const [contact, setContact] = useState(contactId);
  const c = view.client;
  const { act, busy } = useAct();
  const money = useMoney(c);
  const go: Go = (t, extra) => {
    setTab(t);
    setContact(extra?.contact);
    const u = new URL(window.location.href);
    u.searchParams.set("tab", t);
    if (extra?.contact) u.searchParams.set("contact", extra.contact);
    else u.searchParams.delete("contact");
    window.history.replaceState(null, "", u);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const niche = niches.find((n) => n.id === c.niche)?.label ?? c.niche;
  const reportUrl = `${view.base}/report/${c.reportToken}`;
  const waiting = view.counts.drafts + view.counts.needsHuman;

  return (
    <>
      <div className="row" style={{ marginBottom: 6 }}>
        <Link href="/clients" className="btn ghost sm">
          <ArrowLeft size={14} /> Clients
        </Link>
      </div>
      <div className="page-head keep-title" style={{ marginBottom: 14 }}>
        <div>
          <h1>{c.name}</h1>
          <p>
            {niche} · {c.place || countryByCode(c.country)?.name} · {LANG_NAMES[c.lang]} · {money(c.monthly)}/mo{" "}
            <span className={`badge ${c.status === "active" ? "good" : c.status === "onboarding" ? "warm" : ""}`} style={{ marginLeft: 4 }}>
              {c.sample ? "Sample" : c.status}
            </span>
          </p>
        </div>
        <div className="head-actions">
          {c.site && (
            <a className="btn" href={`/s/${c.site.slug}`} target="_blank" rel="noreferrer">
              <ExternalLink size={14} /> {c.site.published ? "Website" : "Preview site"}
            </a>
          )}
          <a className="btn" href={reportUrl} target="_blank" rel="noreferrer">
            <FileText size={14} /> Results report
          </a>
          <button className="btn primary" onClick={() => void act("run", `/api/clients/${c.id}/run`, { method: "POST" }, (r: { sent: number; drafted: number; held?: string }) => (r.sent || r.drafted ? `${r.sent} sent, ${r.drafted} drafted` : r.held === "quiet_hours" ? "Nothing sent: outside their sending hours" : r.held === "daily_cap" ? "Daily limit reached" : "Nothing due right now"))} disabled={busy === "run"}>
            {busy === "run" ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />} Run now
          </button>
        </div>
      </div>

      <nav className="roadmap" aria-label="The seven services, in order">
        {SERVICES.map((s) => {
          const st = c.services[s.id];
          const todo = view.setup.filter((x) => x.service === s.id && !x.ok).length;
          return (
            <button key={s.id} type="button" className={`road-step ${st.included ? st.status : "out"}`} aria-current={tab === s.id ? "page" : undefined} onClick={() => go(s.id)}>
              <span className="row between" style={{ width: "100%" }}>
                <span className="step-num sm">{s.step}</span>
                <ServiceIcon s={s} size={15} />
              </span>
              <b>{s.short}</b>
              <SvcPill status={st.status} included={st.included} />
              <span className="faint small nowrap" style={{ minHeight: 18 }}>{st.included && todo > 0 && st.status !== "live" ? `${todo} to do` : "\u00a0"}</span>
            </button>
          );
        })}
      </nav>

      <div className="tabs" role="tablist" style={{ margin: "14px 0 16px" }}>
        {(
          [
            ["overview", "Overview", <LayoutDashboard key="o" size={14} />],
            ["messages", `Messages${waiting ? ` (${waiting})` : ""}`, <MessagesSquare key="m" size={14} />],
            ["contacts", `Customers (${view.contactTotal})`, <Users key="c" size={14} />],
            ["settings", "Settings", <Settings key="s" size={14} />],
          ] as const
        ).map(([id, label, icon]) => (
          <button key={id} className="tab" role="tab" aria-selected={tab === id} onClick={() => go(id)}>
            {icon} {label}
          </button>
        ))}
      </div>

      {tab === "overview" && <Overview view={view} go={go} />}
      {tab === "website" && <SiteTab view={view} />}
      {tab === "reactivation" && <WinbackTab view={view} go={go} />}
      {tab === "reviews" && <ReviewsTab view={view} go={go} />}
      {tab === "speed_to_lead" && <LeadsTab view={view} go={go} />}
      {tab === "missed_calls" && <CallsTab view={view} go={go} />}
      {tab === "sales_coach" && <CoachTab view={view} />}
      {tab === "ads" && <AdsTab view={view} go={go} />}
      {tab === "messages" && <MessagesTab view={view} contactId={contact} />}
      {tab === "contacts" && <ContactsTab view={view} go={go} />}
      {tab === "settings" && <SettingsTab view={view} niches={niches} agencyName={agencyName} />}
    </>
  );
}

function Delta({ now, before }: { now: number; before: number }) {
  if (!before && !now) return null;
  const d = now - before;
  if (!d) return <span className="faint small">same as last month</span>;
  return <span className={`small ${d > 0 ? "good-text" : "faint"}`}>{d > 0 ? "+" : ""}{d} vs last month</span>;
}

function Tile({ label, value, sub, now, before }: { label: string; value: React.ReactNode; sub?: React.ReactNode; now: number; before: number }) {
  return (
    <div className="card stat">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
      <div className="s">{sub}</div>
      <Delta now={now} before={before} />
    </div>
  );
}

function Overview({ view, go }: { view: WorkspaceView; go: Go }) {
  const c = view.client;
  const money = useMoney(c);
  const m: Results = view.month;
  const l: Results = view.last;
  const next = nextService(Object.fromEntries(SERVICES.filter((s) => c.services[s.id].included).map((s) => [s.id, c.services[s.id]])));
  const nextTodo = next ? view.setup.filter((x) => x.service === next.id && !x.ok) : [];
  const w = wagesFor(c.country);
  const hourValue = w.hourly.lead_responder * w.burden * (w.currency === c.currency ? 1 : 0);
  const caught = m.calls.ai + m.calls.textedBack;
  const needs = view.contacts.filter((x) => x.needsHuman && !x.optedOutAt).slice(0, 5);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="grid-3">
        <Tile label="Leads answered" value={`${m.answered}/${m.leads}`} sub={!m.leads ? "No new leads yet this month" : m.medianResponseSec !== undefined ? `Median reply ${formatDuration(m.medianResponseSec)}` : "None answered yet: check Messages"} now={m.answered} before={l.answered} />
        <Tile label="Calls caught" value={caught} sub={`${m.calls.total} calls · ${m.calls.missed} missed by staff`} now={caught} before={l.calls.ai + l.calls.textedBack} />
        <Tile label="Past customers back" value={m.winback.replied} sub={`${m.winback.reached} reached · ${m.winback.booked} booked`} now={m.winback.replied} before={l.winback.replied} />
        <Tile label="Review requests" value={m.reviews.asked} sub={`${m.reviews.clicked} opened the review page · ${m.referrals.leads} referred ${m.referrals.leads === 1 ? "lead" : "leads"}`} now={m.reviews.asked} before={l.reviews.asked} />
        <Tile label="Booked" value={m.booked} sub={`≈ ${money(m.revenue)} in jobs`} now={m.booked} before={l.booked} />
        <Tile label="Work done for them" value={`${m.hours} h`} sub={hourValue ? `≈ ${money(m.hours * hourValue)} of staff time` : "of staff time"} now={Math.round(m.hours)} before={Math.round(l.hours)} />
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>Next step</h2>
          </div>
          <div className="card-body stack" style={{ gap: 10 }}>
            {next ? (
              <>
                <div className="row" style={{ gap: 10 }}>
                  <span className="step-num">{next.step}</span>
                  <div>
                    <b>{next.name}</b>
                    <div className="faint small">{next.why}</div>
                  </div>
                </div>
                {nextTodo.length > 0 && (
                  <ul className="checklist">
                    {nextTodo.map((x) => (
                      <li key={x.text}>
                        <Circle size={14} /> {x.text}
                      </li>
                    ))}
                  </ul>
                )}
                <button className="btn primary" style={{ alignSelf: "flex-start" }} onClick={() => go(next.id)}>
                  Open step {next.step} <ArrowRight size={14} />
                </button>
              </>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                Every service in their plan is live. Keep an eye on Messages, and send them their results report each month.
              </p>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>What it&apos;s worth to them</h2>
          </div>
          <div className="card-body stack" style={{ gap: 8 }}>
            <div className="row between">
              <span className="muted">People doing this work</span>
              <b className="metric">{money(view.quote.humanMonthly)}/mo</b>
            </div>
            <div className="row between">
              <span className="muted">What they pay you</span>
              <b className="metric">{money(c.monthly)}/mo</b>
            </div>
            <div className="progress" aria-hidden>
              <div style={{ width: `${Math.min(100, (c.monthly / Math.max(1, view.quote.humanMonthly)) * 100)}%`, background: "var(--good)" }} />
            </div>
            <p className="faint small" style={{ margin: 0 }}>
              About {view.quote.fte} full-time people&apos;s worth of front-desk, follow-up, review, coaching and ad work at {countryByCode(c.country)?.name} wages
              {view.quote.basis === "estimate" ? " (estimated from the minimum wage)" : ""}, plus a {money(view.quote.humanSetup)} website build. Sell this comparison, not the technology.
            </p>
          </div>
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>Needs you</h2>
            <button className="btn ghost sm" onClick={() => go("messages")}>
              <Inbox size={14} /> Messages
            </button>
          </div>
          <div className="list">
            {view.counts.drafts > 0 && (
              <button className="list-item link-row" onClick={() => go("messages")}>
                <b>{view.counts.drafts}</b>&nbsp;message{view.counts.drafts === 1 ? "" : "s"} waiting for your approval
              </button>
            )}
            {view.counts.failed > 0 && (
              <button className="list-item link-row" onClick={() => go("messages")}>
                <b>{view.counts.failed}</b>&nbsp;message{view.counts.failed === 1 ? "" : "s"} failed to send
              </button>
            )}
            {needs.map((x) => (
              <button key={x.id} className="list-item link-row" onClick={() => go("messages", { contact: x.id })}>
                <span className="truncate">
                  <b>{x.name}</b> wants a person{x.message ? `: "${x.message.slice(0, 60)}"` : ""}
                </span>
              </button>
            ))}
            {!view.counts.drafts && !view.counts.failed && !needs.length && <div className="list-item faint">Nothing right now.</div>}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Setup</h2>
            <span className="faint small">
              {view.setup.filter((x) => x.ok).length}/{view.setup.length} done
            </span>
          </div>
          <div className="card-body">
            <ul className="checklist">
              {view.setup.map((x) => (
                <li key={`${x.service}:${x.text}`} className={x.ok ? "done" : ""}>
                  <button type="button" className="link-btn" onClick={() => go(x.service)}>
                    {x.ok ? <CircleCheck size={14} /> : <Circle size={14} />} {serviceById(x.service)?.step}. {x.text}
                  </button>
                </li>
              ))}
            </ul>
            {(!view.integrations.twilio || !view.integrations.resend) && (
              <p className="faint small" style={{ marginBottom: 0 }}>
                Without {[!view.integrations.twilio && "Twilio (texts and calls)", !view.integrations.resend && "Resend (email)"].filter(Boolean).join(" or ")}, messages are saved as drafts you can copy and send yourself.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
