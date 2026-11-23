"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bot, CircleAlert, CircleCheck, FileText, LoaderCircle, MessageSquareText, Pencil, Play, Printer, Rocket, Share2, Trash } from "lucide-react";
import { api, CopyButton, useToast } from "@/components/client";
import { shareOrCopy, useCanShare } from "@/components/pwa";
import { timeAgo } from "@/lib/format";
import { questionsPrompt } from "@/lib/offers/guide-content";
import { INTENT_LABEL, estimateGuideRoi, intentFor, leadValueFor, type GuideRoi } from "@/lib/offers/guide-math";
import type { GuideReport } from "@/lib/offers/guide";
import type { GuideDemo, Lead } from "@/lib/types";

// The AI Website Guide offer for one lead, step by step: is it worth it
// (their traffic), build the guide from their site, the five demo questions,
// the pitch, the free trial on their site, and the monthly upkeep.

type View = {
  guide: GuideDemo | null;
  roi: GuideRoi;
  roiInputs: { monthlyVisitors?: number; leadValue?: number };
  url: string | null;
  snippet: string | null;
  elevenlabs: boolean;
  report?: GuideReport;
  drafts?: number;
};

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const INTENT_TONE = { urgent: "good", considered: "brand", elective: "warm" } as const;

export function GuidePanel({ lead, onChange }: { lead: Lead; onChange: (l: Lead) => void }) {
  const toast = useToast();
  const shareable = useCanShare();
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [visitors, setVisitors] = useState(lead.guideRoi?.monthlyVisitors ? String(lead.guideRoi.monthlyVisitors) : "");
  const [leadValue, setLeadValue] = useState(String(lead.guideRoi?.leadValue ?? leadValueFor(lead.niche)));
  const [paste, setPaste] = useState<string | null>(null);
  const [editQs, setEditQs] = useState<string | null>(null);
  const [domain, setDomain] = useState(lead.website ?? "");
  const [weeks, setWeeks] = useState(4);
  const [teach, setTeach] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");

  // Reload when the guide changes elsewhere (the copilot built or tested it).
  const sig = [lead.guide?.token, lead.guide?.testedAt, lead.guide?.knowledge.length, lead.guide?.trial?.startedAt].join("|");
  useEffect(() => {
    api<View>(`/api/leads/${lead.id}/guide`)
      .then((v) => setView((prev) => ({ ...v, report: v.guide ? prev?.report : undefined })))
      .catch(() => undefined);
  }, [lead.id, sig]);

  const g = view?.guide ?? null;
  const intent = intentFor(lead.niche);
  const roi = estimateGuideRoi({ monthlyVisitors: Number(visitors) || 0, leadValue: Number(leadValue) || 0, pages: g?.pages.length });

  async function run(action: string, json: Record<string, unknown> = {}, done?: (v: View) => string | void) {
    setBusy(action);
    try {
      const v = await api<View>(`/api/leads/${lead.id}/guide`, { method: "POST", json: { action, ...json } });
      setView((prev) => ({ ...v, report: v.report ?? prev?.report }));
      onChange({ ...lead, guide: v.guide ?? undefined, guideRoi: v.roiInputs });
      const msg = done?.(v);
      if (msg) toast(msg);
      return v;
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function saveRoi() {
    const mv = Number(visitors) || 0;
    const lv = Number(leadValue) || 0;
    if (mv === (view?.roiInputs.monthlyVisitors ?? 0) && lv === (view?.roiInputs.leadValue ?? leadValueFor(lead.niche))) return;
    await run("roi", { monthlyVisitors: mv, leadValue: lv });
  }

  async function build(text?: string) {
    const v = await run("build", text ? { text } : {}, () => "AI guide built. Try it, then test the five questions.");
    if (v?.guide) setPaste(null);
    else if (!text) setPaste((p) => p ?? "");
  }

  async function loadReport() {
    setBusy("report");
    try {
      const v = await api<View>(`/api/leads/${lead.id}/guide?report=1`);
      setView(v);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm("Delete this AI guide? The demo link stops working, and if it's on their site it stops answering.")) return;
    setBusy("remove");
    try {
      await api(`/api/leads/${lead.id}/guide`, { method: "DELETE" });
      setView((v) => (v ? { ...v, guide: null, url: null, snippet: null, report: undefined } : v));
      onChange({ ...lead, guide: undefined });
      toast("AI guide deleted");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(null);
    }
  }

  const spin = (key: string) => (busy === key ? <LoaderCircle size={14} className="spin" /> : null);
  const report = view?.report;

  return (
    <section className="card guide-panel" style={{ padding: 14, background: "var(--panel-2)" }}>
      <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
        <span className="icon-tile" style={{ background: "var(--teal-soft)", color: "var(--teal)" }}>
          <MessageSquareText size={16} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            <b>AI website guide</b>
            <span className={`badge ${INTENT_TONE[intent]}`}>{INTENT_LABEL[intent].label}</span>
            {g?.trial && <span className="badge good">Live on {g.trial.domain}</span>}
          </div>
          <div className="muted small">
            A chat and voice guide on their website that answers visitors and passes them the leads. Pitch it as 10–20% more website leads, with a free trial and no card.
          </div>
        </div>
      </div>

      {/* Step 1: is it worth it? */}
      <div className="guide-step">
        <div className="guide-step-title">1 · Is it worth it?</div>
        <div className="faint small">{INTENT_LABEL[intent].advice}</div>
        <div className="grid-2" style={{ gap: 10 }}>
          <label className="field">
            <span>Website visitors a month</span>
            <input
              className="input"
              inputMode="numeric"
              value={visitors}
              onChange={(e) => setVisitors(e.target.value.replace(/[^\d]/g, ""))}
              onBlur={() => void saveRoi()}
              placeholder="e.g. 3000"
            />
            <small>From Semrush, Similarweb or their Google Analytics</small>
          </label>
          <label className="field">
            <span>One lead is worth ($)</span>
            <input className="input" inputMode="numeric" value={leadValue} onChange={(e) => setLeadValue(e.target.value.replace(/[^\d]/g, ""))} onBlur={() => void saveRoi()} />
            <small>A starting guess for this kind of business</small>
          </label>
        </div>
        {roi.visitors > 0 ? (
          <div className="guide-roi">
            <div>
              <b>{roi.chats.toLocaleString("en-US")}</b>
              <span>chats a month (5%)</span>
            </div>
            <div>
              <b>{roi.leads.toLocaleString("en-US")}</b>
              <span>new leads a month (2.5%)</span>
            </div>
            <div>
              <b>{usd(roi.value)}</b>
              <span>worth to them monthly</span>
            </div>
            <div>
              <b>
                {usd(roi.price.monthly)}
                {roi.price.plus ? "+" : ""}/mo
              </b>
              <span>what to charge{roi.price.setup ? ` + ${usd(roi.price.setup)} setup` : ""}</span>
            </div>
          </div>
        ) : (
          <div className="faint small">Add their monthly visitors to see the leads and the price. Start at $300 a month for a small site.</div>
        )}
        {roi.visitors > 0 && <div className="faint small">{roi.price.setupNote}</div>}
      </div>

      {/* Steps 2–4: build it, and the demo page */}
      <div className="guide-step">
        <div className="guide-step-title">2 · Build it from their website</div>
        {!g ? (
          <>
            <div className="muted small">
              Reads {lead.website ? "their website" : "their website (add it first)"}: services, pricing, FAQs, booking and contact pages. Then it builds the guide in ElevenLabs
              (chat and voice, says it&apos;s an AI, takes visitors&apos; name and number) and a private demo page: a one-page copy of their site with the guide on it.
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              <button className="btn sm primary" onClick={() => void build()} disabled={Boolean(busy) || !view?.elevenlabs || !lead.website}>
                {spin("build") ?? <Bot size={14} />} {busy === "build" ? "Reading their site and building (up to a minute)…" : "Build AI guide"}
              </button>
              {paste === null && (
                <button className="btn sm ghost" onClick={() => setPaste("")} disabled={Boolean(busy)}>
                  <Pencil size={13} /> Paste details instead
                </button>
              )}
            </div>
            {view && !view.elevenlabs && <div className="faint small">Needs ELEVENLABS_API_KEY in your deployment settings.</div>}
            {paste !== null && (
              <div className="stack" style={{ gap: 6 }}>
                <div className="faint small">
                  Their site can&apos;t be read automatically, or there isn&apos;t one? Ask the owner for the details, or copy them from their site yourself, and paste them here:
                  services, prices, hours, areas served, and common questions with answers (a question on one line, its answer on the next).
                </div>
                <textarea className="textarea" rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"Furnace repair, same day in Calgary. Service call $129.\nOpen Mon–Sat 7am–8pm.\nDo you offer financing?\nYes, 0% for 12 months on new systems."} />
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm primary" onClick={() => void build(paste)} disabled={Boolean(busy) || paste.trim().length < 40 || !view?.elevenlabs}>
                    {spin("build") ?? <Bot size={14} />} Build from these details
                  </button>
                  <button className="btn sm ghost" onClick={() => setPaste(null)} disabled={Boolean(busy)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="muted small">
              <b>{g.name}</b> learned{" "}
              {g.pages.length ? `${g.pages.length} page${g.pages.length === 1 ? "" : "s"} of their site${g.faqs ? ` and ${g.faqs} FAQs` : ""}` : "the details you pasted"}, {timeAgo(g.createdAt)}.
              {g.knowledge.length > 1 ? ` Plus ${g.knowledge.length - 1} answer${g.knowledge.length === 2 ? "" : "s"} you added.` : ""}
            </div>
            {view?.url && (
              <>
                <div className="copy-field">
                  <input className="input" readOnly value={view.url} aria-label="Demo page link" />
                  <CopyButton text={view.url} className="btn sm" />
                </div>
                <div className="row wrap" style={{ gap: 6 }}>
                  <a className="btn sm" href={view.url} target="_blank" rel="noopener">
                    <Play size={13} /> Open demo
                  </a>
                  <a className="btn sm" href={`${view.url}?print=1`} target="_blank" rel="noopener">
                    <Printer size={13} /> Print with link
                  </a>
                  {shareable && (
                    <button className="btn sm" onClick={() => void shareOrCopy({ title: `AI guide for ${lead.name}`, text: `I built an AI guide for ${lead.name}'s website. Ask it anything: ${view.url}` })}>
                      <Share2 size={13} /> Share
                    </button>
                  )}
                </div>
                {g.usage && <div className="faint small">Demo opened {g.usage.sessions} time(s) on {g.usage.day}</div>}
              </>
            )}
          </>
        )}
      </div>

      {g && (
        <>
          {/* Step 6: the five demo questions */}
          <div className="guide-step">
            <div className="row between wrap" style={{ gap: 6 }}>
              <div className="guide-step-title">3 · Five questions to ask it in front of the owner</div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn sm" onClick={() => setEditQs(g.questions.map((q) => q.q).join("\n"))} disabled={Boolean(busy) || editQs !== null}>
                  <Pencil size={13} /> Edit
                </button>
                <button className="btn sm primary" onClick={() => void run("test", {}, (v) => { const bad = v.guide?.questions.filter((q) => q.unsure).length ?? 0; return bad ? `${bad} answer(s) need work: add the missing facts below.` : "All five answered well."; })} disabled={Boolean(busy)}>
                  {spin("test") ?? <Play size={13} />} {busy === "test" ? "Testing (about a minute)…" : g.testedAt ? "Test again" : "Test all"}
                </button>
              </div>
            </div>
            {editQs !== null ? (
              <div className="stack" style={{ gap: 6 }}>
                <textarea className="textarea" rows={6} value={editQs} onChange={(e) => setEditQs(e.target.value)} aria-label="Questions, one per line" />
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm primary" onClick={() => void run("questions", { questions: editQs.split("\n") }).then((v) => v && setEditQs(null))} disabled={Boolean(busy)}>
                    {spin("questions")} Save questions
                  </button>
                  <button className="btn sm ghost" onClick={() => setEditQs(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <ol className="guide-qs">
                {g.questions.map((q) => (
                  <li key={q.q}>
                    <div>{q.q}</div>
                    {q.answer && (
                      <div className={`guide-answer ${q.unsure ? "unsure" : ""}`}>
                        {q.unsure ? <CircleAlert size={13} /> : <CircleCheck size={13} />} {q.answer}
                      </div>
                    )}
                    {q.unsure && q.note && q.note !== q.answer && <div className="faint small">Why it needs work: {q.note}</div>}
                  </li>
                ))}
              </ol>
            )}
            <div className="row wrap" style={{ gap: 6 }}>
              <CopyButton text={questionsPrompt(lead.website || lead.name)} label="Copy prompt for ChatGPT" className="btn sm ghost" />
              <span className="faint small">{g.testedAt ? `Tested ${timeAgo(g.testedAt)}. ` : ""}Test before every demo.</span>
            </div>
          </div>

          {/* Step 7: the pitch */}
          <div className="guide-step">
            <div className="guide-step-title">4 · Pitch: more website leads, free trial</div>
            <div className="muted small">
              An email, a text and a cold call script with their demo link and the offer: free on their site for a few weeks, no credit card, then {usd(view?.roi.price.monthly ?? 300)}
              /mo. They go to your Inbox; nothing is sent.
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              <button className="btn sm primary" onClick={() => void run("pitch", {}, (v) => `${v.drafts ?? 3} drafts in your Inbox: email, text and call script.`)} disabled={Boolean(busy)}>
                {spin("pitch") ?? <FileText size={13} />} Write the pitch
              </button>
              <Link className="btn sm ghost" href="/inbox">
                Open Inbox
              </Link>
            </div>
          </div>

          {/* Step 7–8: the trial on their site */}
          <div className="guide-step">
            <div className="guide-step-title">5 · Free trial on their website</div>
            {g.trial ? (
              <div className="muted small">
                Live on <b>{g.trial.domain}</b> since {new Date(g.trial.startedAt).toLocaleDateString()}; the trial ends {new Date(g.trial.endsAt).toLocaleDateString()}. Your tasks
                remind you to send the first leads report and to convert them.
              </div>
            ) : (
              <>
                <div className="muted small">
                  Once they say yes: it goes public, but only on their domain, with the call to action &ldquo;👋 Click here for a quick answer&rdquo; at the top of the page.
                </div>
                <div className="row wrap" style={{ gap: 6 }}>
                  <input className="input" style={{ flex: "1 1 180px" }} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="theirwebsite.com" aria-label="Their website" />
                  <select className="select" style={{ width: "auto" }} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} aria-label="Trial length">
                    <option value={2}>2 weeks</option>
                    <option value={3}>3 weeks</option>
                    <option value={4}>4 weeks</option>
                  </select>
                  <button
                    className="btn sm primary"
                    onClick={() => void run("trial", { website: domain, weeks }, () => "The guide is ready for their site. Send them the two lines below.")}
                    disabled={Boolean(busy) || !domain.trim()}
                  >
                    {spin("trial") ?? <Rocket size={13} />} Start trial
                  </button>
                </div>
              </>
            )}
            {g.trial && view?.snippet && (
              <>
                <textarea className="textarea mono" rows={3} readOnly value={view.snippet} aria-label="Embed code" style={{ fontSize: 12 }} />
                <div className="row wrap" style={{ gap: 6 }}>
                  <CopyButton text={view.snippet} label="Copy embed code" className="btn sm" />
                  <span className="faint small">
                    Paste it just before &lt;/body&gt; on every page, or in their site builder&apos;s custom code box (WordPress header and footer plugin, Wix Custom code, Squarespace
                    Code injection, Shopify theme.liquid).
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Step 8: upkeep */}
          <div className="guide-step">
            <div className="row between wrap" style={{ gap: 6 }}>
              <div className="guide-step-title">6 · Monthly upkeep</div>
              <button className="btn sm" onClick={() => void loadReport()} disabled={Boolean(busy)}>
                {spin("report")} {report ? "Refresh report" : "Load report"}
              </button>
            </div>
            {report ? (
              <>
                <div className="guide-roi">
                  <div>
                    <b>{report.last30.conversations}</b>
                    <span>conversations, last 30 days</span>
                  </div>
                  <div>
                    <b>{report.last30.leads}</b>
                    <span>left their details</span>
                  </div>
                </div>
                {report.leads.length > 0 && (
                  <ul className="guide-leads">
                    {report.leads.slice(0, 10).map((c) => (
                      <li key={c.id}>
                        <b>{c.contact.name ?? "Visitor"}</b> · {c.contact.phone ?? c.contact.email}
                        {c.contact.need ? ` · ${c.contact.need}` : ""} <span className="faint">{timeAgo(c.at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {report.unanswered.length > 0 ? (
                  <div className="stack" style={{ gap: 8 }}>
                    <div className="faint small">Visitors asked these and {g.name} wasn&apos;t sure. Add the answer and it knows from now on:</div>
                    {report.unanswered.slice(0, 8).map((q) => (
                      <div key={q} className="stack" style={{ gap: 4 }}>
                        <div className="small">
                          <CircleAlert size={12} style={{ display: "inline", verticalAlign: -1, color: "var(--warm)" }} /> {q}
                        </div>
                        <div className="row" style={{ gap: 6 }}>
                          <input className="input" value={teach[q] ?? ""} onChange={(e) => setTeach((t) => ({ ...t, [q]: e.target.value }))} placeholder="The answer" aria-label={`Answer to: ${q}`} />
                          <button
                            className="btn sm"
                            disabled={Boolean(busy) || (teach[q] ?? "").trim().length < 3}
                            onClick={() =>
                              void run("knowledge", { text: `Q: ${q}\nA: ${teach[q]}` }, () => `${g.name} knows that now.`).then((v) => v && setTeach((t) => ({ ...t, [q]: "" })))
                            }
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="faint small">No unanswered questions in recent conversations.</div>
                )}
              </>
            ) : (
              <div className="faint small">
                Conversations, the visitors who left their details, and the questions it couldn&apos;t answer, from ElevenLabs. Small sites take an hour or two a month.
              </div>
            )}
            <div className="row" style={{ gap: 6 }}>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Teach it something new (a price, a promotion, new hours)" aria-label="Teach the guide" />
              <button className="btn sm" disabled={Boolean(busy) || note.trim().length < 10} onClick={() => void run("knowledge", { text: note }, () => `${g.name} knows that now.`).then((v) => v && setNote(""))}>
                {spin("knowledge")} Teach
              </button>
            </div>
          </div>

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn sm ghost" onClick={() => void remove()} disabled={Boolean(busy)}>
              {spin("remove") ?? <Trash size={13} />} Delete guide
            </button>
          </div>
        </>
      )}
    </section>
  );
}
