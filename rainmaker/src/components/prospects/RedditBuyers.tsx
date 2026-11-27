"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Check, Copy, ExternalLink, LoaderCircle, Mail, MessageSquare, RefreshCw, Save, UserPlus, X } from "lucide-react";
import { api, useToast } from "@/components/client";
import { timeAgo } from "@/lib/format";
import { ago, type RedditConfig } from "@/lib/reddit/intent";
import type { Draft, Lead, RedditSignal } from "@/lib/types";

// Find clients → Reddit buyers: people who just asked in public for what you
// sell. Scan your subreddits, then reply on Reddit, save them as a lead, or
// email a business that named itself.

type State = { config: RedditConfig; signals: RedditSignal[]; lastScanAt?: string; lastErrors: string[]; oauth: boolean; claude: boolean };
type Tab = "new" | "saved" | "done" | "dismissed";

const PHRASES = ["recommendations for …", "alternative to …", "looking for a good …", "got burned by …", "has anyone used …"];
const splitList = (s: string) => s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);

export function RedditBuyers() {
  const toast = useToast();
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("new");
  const [form, setForm] = useState<{ subreddits: string; services: string; competitors: string; maxAgeHours: number; minScore: number; morning: boolean } | null>(null);
  const [emailTo, setEmailTo] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = (s: State) => {
    setState(s);
    setForm({ subreddits: s.config.subreddits.join("\n"), services: s.config.services.join(", "), competitors: s.config.competitors.join(", "), maxAgeHours: s.config.maxAgeHours, minScore: s.config.minScore, morning: s.config.morning });
  };
  useEffect(() => {
    api<State>("/api/reddit")
      .then(load)
      .catch((err) => toast(err instanceof Error ? err.message : String(err), "error"));
  }, [toast]);

  const replace = (s: RedditSignal) => setState((st) => (st ? { ...st, signals: st.signals.map((x) => (x.id === s.id ? s : x)) } : st));

  async function scan() {
    setBusy("scan");
    try {
      const r = await api<State & { result: { found: number; added: number; errors: string[] } }>("/api/reddit", { method: "POST", json: { action: "scan" } });
      load(r);
      setTab("new");
      toast(r.result.found ? `${r.result.found} fresh post${r.result.found === 1 ? "" : "s"} asking for what you sell${r.result.added ? `, ${r.result.added} new` : ""}.` : "No fresh posts asking for what you sell right now.");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(null);
    }
  }

  async function saveConfig() {
    if (!form) return;
    setBusy("config");
    try {
      load(
        await api<State>("/api/reddit", {
          method: "POST",
          json: { action: "config", config: { subreddits: splitList(form.subreddits), services: splitList(form.services), competitors: splitList(form.competitors), maxAgeHours: form.maxAgeHours, minScore: form.minScore, morning: form.morning } },
        })
      );
      toast("Saved. Scan to use the new settings.");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(null);
    }
  }

  async function act(s: RedditSignal, action: string, extra: Record<string, unknown> = {}) {
    setBusy(`${action}:${s.id}`);
    try {
      const r = await api<{ signal: RedditSignal; lead?: Lead; draft?: Draft }>(`/api/reddit/${encodeURIComponent(s.id)}`, { method: "POST", json: { action, ...extra } });
      replace(r.signal);
      if (action === "lead" && r.lead) toast(`Saved ${r.lead.name} to your pipeline${r.lead.email ? `, with ${r.lead.email}` : ""}.`);
      if (action === "email") toast("Email drafted. Review it and send it from your Inbox.");
      if (action === "reply") setOpen((o) => ({ ...o, [s.id]: true }));
      return r;
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(null);
    }
  }

  async function copyReply(s: RedditSignal, andOpen: boolean) {
    if (!s.reply) return;
    try {
      await navigator.clipboard.writeText(s.reply);
      toast("Reply copied. Paste it under their post.");
    } catch {
      toast("Couldn't copy: select the reply and copy it yourself.", "error");
    }
    if (andOpen) {
      window.open(s.url, "_blank", "noopener");
      await act(s, "replied");
    }
  }

  const shown = useMemo(() => {
    const all = state?.signals ?? [];
    const by: Record<Tab, (s: RedditSignal) => boolean> = {
      new: (s) => s.status === "new",
      saved: (s) => s.status === "saved",
      done: (s) => s.status === "replied" || s.status === "drafted",
      dismissed: (s) => s.status === "dismissed",
    };
    return all.filter(by[tab]).sort((a, b) => b.score - a.score || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }, [state, tab]);
  const count = (t: Tab) => (state?.signals ?? []).filter((s) => (t === "new" ? s.status === "new" : t === "saved" ? s.status === "saved" : t === "done" ? s.status === "replied" || s.status === "drafted" : s.status === "dismissed")).length;

  if (!state || !form) {
    return (
      <div className="card card-pad faint small">
        <LoaderCircle size={14} className="spin" style={{ display: "inline", verticalAlign: -2 }} /> Loading…
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <section className="card card-pad stack" style={{ gap: 10 }}>
        <div className="row between wrap" style={{ gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <b>People asking for what you sell, right now</b>
            <div className="muted small">
              Fresh posts in {state.config.subreddits.length} subreddit{state.config.subreddits.length === 1 ? "" : "s"} that say {PHRASES.map((p, i) => (i ? `, "${p}"` : `"${p}"`))} about your services
              or competitors, under {state.config.maxAgeHours} hours old.
            </div>
          </div>
          <button className="btn primary" onClick={() => void scan()} disabled={busy === "scan"}>
            {busy === "scan" ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />} {busy === "scan" ? "Reading Reddit…" : "Scan now"}
          </button>
        </div>
        <div className="faint small">
          {state.lastScanAt ? `Last scan ${timeAgo(state.lastScanAt)}. ` : "Not scanned yet. "}
          {state.oauth ? "Through Reddit's official API." : "Through Reddit's public feed; if Reddit blocks it, add REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET (a free app at reddit.com/prefs/apps)."}{" "}
          {state.claude ? "Claude reads the best posts and drops the ones that aren't real requests." : "Add ANTHROPIC_API_KEY and Claude double-checks each post."}
        </div>
        {state.lastErrors.length > 0 && (
          <div className="tip warn">
            <span className="small">{state.lastErrors.slice(0, 3).join(" · ")}</span>
          </div>
        )}
        <details>
          <summary className="small">Subreddits, services and competitors</summary>
          <div className="stack" style={{ gap: 10, marginTop: 10 }}>
            <label className="field">
              <span>Subreddits to watch (one per line: your buyers&apos; subs and your cities&apos;)</span>
              <textarea className="textarea" rows={5} value={form.subreddits} onChange={(e) => setForm({ ...form, subreddits: e.target.value })} placeholder={"smallbusiness\nCalgary\nDentistry"} />
            </label>
            <label className="field">
              <span>What you sell, as people say it</span>
              <input className="input" value={form.services} onChange={(e) => setForm({ ...form, services: e.target.value })} placeholder="web designer, Facebook ads, SEO" />
            </label>
            <label className="field">
              <span>Competitors people leave or compare</span>
              <input className="input" value={form.competitors} onChange={(e) => setForm({ ...form, competitors: e.target.value })} placeholder="GoHighLevel, Podium" />
            </label>
            <div className="grid-2" style={{ gap: 10 }}>
              <label className="field">
                <span>Posts up to</span>
                <select className="select" value={form.maxAgeHours} onChange={(e) => setForm({ ...form, maxAgeHours: Number(e.target.value) })}>
                  {[2, 4, 8, 12, 24, 48].map((h) => (
                    <option key={h} value={h}>
                      {h} hours old
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Show posts scoring</span>
                <select className="select" value={form.minScore} onChange={(e) => setForm({ ...form, minScore: Number(e.target.value) })}>
                  {[30, 50, 70].map((v) => (
                    <option key={v} value={v}>
                      {v}+ ({v >= 70 ? "only the clearest" : v >= 50 ? "clear requests" : "more, looser"})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="vopt">
              <input type="checkbox" className="check" checked={form.morning} onChange={(e) => setForm({ ...form, morning: e.target.checked })} />
              <span>Scan every morning with Autopilot (new posts show on Today)</span>
            </label>
            <div>
              <button className="btn sm" onClick={() => void saveConfig()} disabled={busy === "config"}>
                {busy === "config" ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />} Save
              </button>
            </div>
          </div>
        </details>
      </section>

      <div className="seg" role="tablist" aria-label="Which posts">
        {(
          [
            ["new", "New"],
            ["saved", "Saved"],
            ["done", "Done"],
            ["dismissed", "Dismissed"],
          ] as const
        ).map(([t, label]) => (
          <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>
            {label} {count(t) ? `(${count(t)})` : ""}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="card card-pad muted small">
          {tab === "new" ? "No fresh posts asking for what you sell. Scan again later, add subreddits (your cities' too), or widen the time window." : "Nothing here yet."}
        </div>
      ) : (
        shown.map((s) => {
          const hours = (Date.now() - Date.parse(s.createdAt)) / 3_600_000;
          const email = s.contact.emails[0];
          const business = s.ai?.business;
          return (
            <article key={s.id} className="card card-pad stack rsignal" style={{ gap: 8 }}>
              <div className="row wrap" style={{ gap: 6 }}>
                <span className={`badge ${s.score >= 75 ? "hot" : "warm"}`}>{s.score}</span>
                {s.ai && s.ai.intent !== "none" && <span className={`badge ${s.ai.intent === "high" ? "good" : "outline"}`}>{s.ai.intent} intent</span>}
                <span className="faint small">
                  r/{s.subreddit} · {ago(hours)} · {s.comments} comment{s.comments === 1 ? "" : "s"}
                </span>
              </div>
              <a className="rsignal-title" href={s.url} target="_blank" rel="noopener noreferrer">
                {s.title}
              </a>
              {s.body && (
                <p className={`muted small rsignal-body ${open[`b:${s.id}`] ? "open" : ""}`} onClick={() => setOpen((o) => ({ ...o, [`b:${s.id}`]: !o[`b:${s.id}`] }))}>
                  {s.body}
                </p>
              )}
              {s.ai?.summary && <div className="small">{s.ai.summary}</div>}
              <div className="chips">
                {s.reasons.map((r) => (
                  <span key={r} className={`chip ${r === "Urgent" || r.startsWith("Budget") ? "high" : ""}`}>
                    {r}
                  </span>
                ))}
                {business && <span className="chip positive">Business: {business}</span>}
                {(s.ai?.website || s.contact.websites[0]) && <span className="chip positive">{s.ai?.website || s.contact.websites[0]}</span>}
                {s.ai?.location && <span className="chip">{s.ai.location}</span>}
              </div>

              {s.reply && open[s.id] && (
                <div className="stack" style={{ gap: 6 }}>
                  <textarea className="textarea" rows={5} value={s.reply} onChange={(e) => replace({ ...s, reply: e.target.value })} aria-label="Your reply" />
                  <div className="row wrap" style={{ gap: 6 }}>
                    <button className="btn sm primary" onClick={() => void copyReply(s, true)}>
                      <Copy size={13} /> Copy and open the post
                    </button>
                    <button className="btn sm" onClick={() => void copyReply(s, false)}>
                      <Copy size={13} /> Copy
                    </button>
                    <span className="faint small">Check the subreddit&apos;s rules on self-promotion first.</span>
                  </div>
                </div>
              )}

              <div className="row wrap" style={{ gap: 6 }}>
                <a className="btn sm" href={s.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={13} /> Open post
                </a>
                <button className="btn sm" onClick={() => (s.reply ? setOpen((o) => ({ ...o, [s.id]: !o[s.id] })) : void act(s, "reply"))} disabled={busy === `reply:${s.id}`}>
                  {busy === `reply:${s.id}` ? <LoaderCircle size={13} className="spin" /> : <MessageSquare size={13} />} {s.reply ? (open[s.id] ? "Hide reply" : "Show reply") : "Draft a reply"}
                </button>
                {s.leadId ? (
                  <Link className="btn sm" href={`/pipeline?lead=${s.leadId}`}>
                    <Check size={13} /> In pipeline
                  </Link>
                ) : (
                  <button className="btn sm" onClick={() => void act(s, "lead")} disabled={busy === `lead:${s.id}`}>
                    {busy === `lead:${s.id}` ? <LoaderCircle size={13} className="spin" /> : <UserPlus size={13} />} Save as lead
                  </button>
                )}
                {s.status !== "dismissed" ? (
                  <button className="btn sm ghost" onClick={() => void act(s, "dismiss")} aria-label="Dismiss">
                    <X size={13} />
                  </button>
                ) : (
                  <button className="btn sm ghost" onClick={() => void act(s, "restore")}>
                    Restore
                  </button>
                )}
              </div>
              <div className="row wrap" style={{ gap: 6 }}>
                <input
                  className="input"
                  type="email"
                  style={{ flex: "1 1 200px" }}
                  value={emailTo[s.id] ?? email ?? ""}
                  onChange={(e) => setEmailTo((m) => ({ ...m, [s.id]: e.target.value }))}
                  placeholder={s.leadId ? "Their business email (if the website check found none)" : "Email they or their business published"}
                  aria-label="Email address"
                />
                <button className="btn sm" onClick={() => void act(s, "email", { to: emailTo[s.id] ?? email })} disabled={busy === `email:${s.id}` || (!s.leadId && !(emailTo[s.id] ?? email))}>
                  {busy === `email:${s.id}` ? <LoaderCircle size={13} className="spin" /> : <Mail size={13} />} Draft the email
                </button>
              </div>
            </article>
          );
        })
      )}

      <div className="faint small">
        Rainmaker reads only public posts and never tries to identify anonymous Reddit users. Reply on Reddit, or email a business that named itself or an address the
        poster shared. Follow each subreddit&apos;s rules on self-promotion.
      </div>
    </div>
  );
}
