"use client";

import { useMemo, useState } from "react";
import { BadgeCheck, LoaderCircle, Save, Send, ShieldCheck } from "lucide-react";
import { GENERAL } from "@/lib/compliance-data";
import type { WorkspaceView } from "@/lib/clients/view";
import { timeAgo } from "@/lib/format";
import { displayPhone } from "@/lib/phone";
import type { Go } from "./Workspace";
import { Field, SequenceEditor, ServiceHeader, useAct } from "./shared";

export function ReviewsTab({ view, go }: { view: WorkspaceView; go: Go }) {
  const c = view.client;
  const { act, busy } = useAct();
  const [reviewUrl, setReviewUrl] = useState(c.reviewUrl ?? "");
  const [delay, setDelay] = useState(c.settings.reviewDelayHours);
  const [refOffer, setRefOffer] = useState(c.settings.referralOffer);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [one, setOne] = useState({ name: "", phone: "", email: "", sms: false });
  const review = view.sequences.find((s) => s.kind === "review");
  const referral = view.sequences.find((s) => s.kind === "referral");
  const recent = useMemo(
    () =>
      view.contacts
        .filter((x) => !x.optedOutAt && (!q || x.name.toLowerCase().includes(q.toLowerCase()) || x.phone?.includes(q) || x.email?.includes(q.toLowerCase())))
        .slice(0, 40),
    [view.contacts, q]
  );
  const asked = view.contacts.filter((x) => x.jobDoneAt).slice(0, 8);
  const m = view.month;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <ServiceHeader client={c} id="reviews">
        <div className="grid-3" style={{ gap: 12 }}>
          <div className="stack" style={{ gap: 0 }}>
            <span className="faint small">Asked this month</span>
            <b className="metric">{m.reviews.asked}</b>
          </div>
          <div className="stack" style={{ gap: 0 }}>
            <span className="faint small">Opened the review page</span>
            <b className="metric">{m.reviews.clicked}</b>
          </div>
          <div className="stack" style={{ gap: 0 }}>
            <span className="faint small">Referred leads</span>
            <b className="metric">{m.referrals.leads}</b>
          </div>
        </div>
        <div className="tip neutral">
          <ShieldCheck size={15} />
          <span>{GENERAL.reviews.text}</span>
        </div>
      </ServiceHeader>

      <section className="card">
        <div className="card-head">
          <h3 style={{ margin: 0 }}>1. Where reviews go</h3>
          <button
            className="btn primary sm"
            disabled={Boolean(busy)}
            onClick={() => void act("save", `/api/clients/${c.id}`, { method: "PATCH", json: { reviewUrl, settings: { reviewDelayHours: delay, referralOffer: refOffer } } }, "Saved")}
          >
            <Save size={14} /> Save
          </button>
        </div>
        <div className="card-body stack" style={{ gap: 12 }}>
          <Field label="Their review link" hint="In their Google Business Profile, choose Ask for reviews (or Share review form) and copy the link. Any platform's review page works.">
            <input className="input" value={reviewUrl} onChange={(e) => setReviewUrl(e.target.value)} placeholder="https://g.page/r/…/review" />
          </Field>
          <div className="grid-2" style={{ gap: 12 }}>
            <Field label="Ask this many hours after the job" hint="0 sends right away; 2 to 24 usually works best.">
              <input className="input" type="number" min={0} max={168} value={delay} onChange={(e) => setDelay(Number(e.target.value))} />
            </Field>
            <Field label="Referral reward (optional)" hint="Rewards for referrals are fine; rewards for reviews are not.">
              <input className="input" value={refOffer} onChange={(e) => setRefOffer(e.target.value)} placeholder="e.g. $25 off for you and your friend" />
            </Field>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3 style={{ margin: 0 }}>2. Mark finished jobs</h3>
          <span className="faint small">{view.counts.awaitingReview} asked, not reviewed yet</span>
        </div>
        <div className="card-body stack" style={{ gap: 14 }}>
          <div className="grid-2" style={{ gap: 12 }}>
            <Field label="Customer name">
              <input className="input" value={one.name} onChange={(e) => setOne({ ...one, name: e.target.value })} />
            </Field>
            <Field label="Mobile">
              <input className="input" type="tel" value={one.phone} onChange={(e) => setOne({ ...one, phone: e.target.value })} />
            </Field>
            <Field label="Email">
              <input className="input" type="email" value={one.email} onChange={(e) => setOne({ ...one, email: e.target.value })} />
            </Field>
            <label className="check-row" style={{ alignSelf: "end", paddingBottom: 10 }}>
              <input type="checkbox" checked={one.sms} onChange={(e) => setOne({ ...one, sms: e.target.checked })} /> They agreed to texts
            </label>
          </div>
          <button
            className="btn primary"
            style={{ alignSelf: "flex-start" }}
            disabled={Boolean(busy) || (!one.phone && !one.email)}
            onClick={async () => {
              const r = await act("one", `/api/clients/${c.id}/contacts`, { method: "POST", json: { action: "add", ...one, jobDone: true } }, `Review request queued for ${one.name || "them"}`);
              if (r) setOne({ name: "", phone: "", email: "", sms: false });
            }}
          >
            {busy === "one" ? <LoaderCircle size={14} className="spin" /> : <Send size={14} />} Add and ask for a review
          </button>
          <div className="divider" />
          <Field label="Or pick customers already on file">
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone or email" />
          </Field>
          <div className="pick-list">
            {recent.map((x) => (
              <label key={x.id} className="check-row">
                <input type="checkbox" checked={picked.includes(x.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, x.id] : p.filter((y) => y !== x.id)))} />
                <span className="truncate">
                  {x.name} <span className="faint small">{x.phone ? displayPhone(x.phone) : x.email}</span>
                  {x.jobDoneAt && <span className="badge" style={{ marginLeft: 6 }}>asked {timeAgo(x.jobDoneAt)}</span>}
                </span>
              </label>
            ))}
            {!recent.length && <span className="faint small">No customers yet. Import them in Customers or step 2.</span>}
          </div>
          <button
            className="btn"
            style={{ alignSelf: "flex-start" }}
            disabled={!picked.length || Boolean(busy)}
            onClick={async () => {
              const r = await act<{ queued: number; skipped: number }>("done", `/api/clients/${c.id}/contacts`, { method: "POST", json: { action: "jobs_done", ids: picked } }, (r) => `${r.queued} review request${r.queued === 1 ? "" : "s"} queued${r.skipped ? `, ${r.skipped} skipped (already asked or step off)` : ""}`);
              if (r) setPicked([]);
            }}
          >
            <BadgeCheck size={14} /> Mark {picked.length || ""} done
          </button>
          {asked.length > 0 && (
            <div className="faint small">
              Recently finished: {asked.map((x) => `${x.name}${x.reviewClickedAt ? " (opened)" : ""}`).join(", ")}.{" "}
              <button type="button" className="link-btn" onClick={() => go("contacts")}>
                All customers
              </button>
            </div>
          )}
          <p className="faint small" style={{ margin: 0 }}>
            Their booking or job software can mark jobs done automatically: send a POST to the lead intake address (step 4) with <span className="mono">{'"event": "job_done"'}</span>, or ask us to connect it.
          </p>
        </div>
      </section>

      <SequenceEditor client={c} seq={review} kind="review" title="3. The review request" hint="Everyone gets the same ask and one reminder. Opening the review page stops the reminder and starts the referral ask." />
      <SequenceEditor client={c} seq={referral} kind="referral" title="4. The referral ask" hint="Sent the day after they open the review page. Their link opens the website with their referral code, so referred leads are credited to them." />
    </div>
  );
}
