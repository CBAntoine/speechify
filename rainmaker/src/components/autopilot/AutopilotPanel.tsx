"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  CircleAlert, CircleCheck, Clapperboard, LoaderCircle, Mail, PenLine, Phone, Play, Radar, Save, Send, ShieldCheck, Sparkles, Zap,
} from "lucide-react";
import { api, useToast } from "@/components/client";
import { Empty, Switch } from "@/components/ui";
import type { Integrations } from "@/lib/config";
import { timeAgo } from "@/lib/format";
import type { AutopilotConfig, AutopilotLogLine, AutopilotRun } from "@/lib/types";

const ICON: Record<AutopilotLogLine["kind"], React.ReactNode> = {
  prospect: <Radar size={14} />,
  outreach: <PenLine size={14} />,
  demo: <Phone size={14} />,
  ads: <Clapperboard size={14} />,
  art: <Sparkles size={14} />,
  followup: <Mail size={14} />,
  fulfill: <CircleCheck size={14} />,
  send: <Send size={14} />,
  info: <Zap size={14} />,
  error: <CircleAlert size={14} />,
};

type State = { config: AutopilotConfig; runs: AutopilotRun[]; running: boolean };

export function AutopilotPanel({
  initial,
  niches,
  targetNiches,
  integrations: i,
  mailingAddress,
  siteUrlSet,
}: {
  initial: State;
  niches: { id: string; label: string }[];
  targetNiches: string[];
  integrations: Integrations;
  mailingAddress: boolean;
  siteUrlSet: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState(initial);
  const [c, setC] = useState(initial.config);
  const [cities, setCities] = useState(initial.config.cities.join("\n"));
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);

  const refresh = useCallback(async () => {
    const s = await api<State>("/api/autopilot");
    setState(s);
    return s;
  }, []);

  // Poll while a run is going.
  useEffect(() => {
    if (!state.running) return;
    const t = setInterval(() => {
      void refresh().then((s) => {
        if (!s.running) router.refresh();
      });
    }, 3000);
    return () => clearInterval(t);
  }, [state.running, refresh, router]);

  const set = <K extends keyof AutopilotConfig>(k: K, v: AutopilotConfig[K]) => setC((x) => ({ ...x, [k]: v }));

  async function save(extra: Partial<AutopilotConfig> = {}) {
    setSaving(true);
    try {
      const body = { ...c, ...extra, cities: cities.split("\n").map((s) => s.trim()).filter(Boolean) };
      const r = await api<{ config: AutopilotConfig }>("/api/autopilot", { method: "PUT", json: body });
      setC(r.config);
      setCities(r.config.cities.join("\n"));
      toast("Autopilot settings saved");
      return r.config;
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setStarting(true);
    try {
      await save();
      await api("/api/autopilot", { method: "POST" });
      toast("Autopilot is running. Watch the log below.");
      setTimeout(() => void refresh(), 1200);
      setState((s) => ({ ...s, running: true }));
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setStarting(false);
    }
  }

  const niche = (id: string) => niches.find((n) => n.id === id)?.label ?? id;
  const usingNiches = c.niches.length ? c.niches : targetNiches;
  const latest = state.runs[0];

  return (
    <div className="grid-2 wide-left">
      <div className="stack" style={{ gap: 18 }}>
        <section className="card">
          <div className="card-head">
            <h2>
              <Zap size={17} style={{ display: "inline", verticalAlign: -3, marginRight: 6 }} />
              Autopilot is {c.enabled ? "on" : "off"}
            </h2>
            <div className="row" style={{ gap: 8 }}>
              <span className="switch">
                <input type="checkbox" role="switch" checked={c.enabled} onChange={(e) => void save({ enabled: e.target.checked }).then((r) => r && setC(r))} aria-label="Autopilot on" />
              </span>
              <button className="btn primary sm" onClick={() => void runNow()} disabled={starting || state.running}>
                {state.running || starting ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />} {state.running ? "Running…" : "Run now"}
              </button>
            </div>
          </div>
          <div className="card-body stack" style={{ gap: 12 }}>
            <div className="muted small">
              {i.cron
                ? "Runs every day by itself (Vercel Cron, 13:17 UTC), plus whenever you press Run now."
                : "Press Run now any time. To run every day by itself, add CRON_SECRET to your hosting's environment variables (Vercel calls it daily; see the README)."}{" "}
              Even when it's off, paid orders get onboarded and due follow-ups get drafted.
            </div>
            <label className="field">
              <span>Cities to prospect, one per line</span>
              <textarea className="textarea" rows={4} value={cities} onChange={(e) => setCities(e.target.value)} placeholder={"Mississauga, ON\nBrampton, ON\nOakville, ON"} />
              <small>It works through every niche × city pair, one per run.</small>
            </label>
            <div className="field">
              <span>Niches {c.niches.length ? "" : `(using your agency's target niches: ${targetNiches.map(niche).join(", ") || "none set"})`}</span>
              <div className="chips">
                {niches.map((n) => {
                  const on = c.niches.includes(n.id);
                  return (
                    <button
                      key={n.id}
                      type="button"
                      className={`chip ${on ? "positive" : ""}`}
                      onClick={() => set("niches", on ? c.niches.filter((x) => x !== n.id) : [...c.niches, n.id])}
                      aria-pressed={on}
                      style={{ cursor: "pointer" }}
                    >
                      {n.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid-3">
              <label className="field">
                <span>Businesses per run</span>
                <input className="input" type="number" min={3} max={40} value={c.leadsPerRun} onChange={(e) => set("leadsPerRun", Number(e.target.value))} />
              </label>
              <label className="field">
                <span>Minimum score</span>
                <input className="input" type="number" min={0} max={100} value={c.minScore} onChange={(e) => set("minScore", Number(e.target.value))} />
              </label>
              <label className="field">
                <span>Personal work per run</span>
                <input className="input" type="number" min={0} max={10} value={c.personalizePerRun} onChange={(e) => set("personalizePerRun", Number(e.target.value))} />
              </label>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>What it does for each good lead</h2>
          </div>
          <div className="card-body">
            <Switch
              checked={c.buildDemos}
              onChange={(v) => set("buildDemos", v)}
              disabled={!i.elevenlabs}
              label="Build a demo AI receptionist from their website"
              hint={i.elevenlabs ? `The outreach links to a private page where they can talk to it.${siteUrlSet ? "" : " Set SITE_URL so email links work."}` : "Needs ELEVENLABS_API_KEY."}
            />
            <Switch checked={c.draftOutreach} onChange={(v) => set("draftOutreach", v)} label="Write the first email and a 3-step follow-up sequence" hint={i.claude ? "Written by Claude from their audit, pitching the product that fits them best." : "Templates until you add ANTHROPIC_API_KEY."} />
            <Switch checked={c.buildAds} onChange={(v) => set("buildAds", v)} label="Build a sample ad campaign for them" hint="Meta, Google and video ads they can see before they buy." />
            <Switch checked={c.makeArt} onChange={(v) => set("makeArt", v)} disabled={!i.elevenlabs} label="Add custom ad art in their brand colours" hint={i.elevenlabs ? "ElevenLabs Image & Video: needs the Pro plan or above, and uses credits." : "Needs ELEVENLABS_API_KEY."} />
            <Switch checked={c.followUps} onChange={(v) => set("followUps", v)} label="Draft follow-ups when they're due" hint="Day 3, 7 and 14 after the first email, until they reply. Plus a nudge to anyone who didn't finish checkout." />
            <Switch checked={c.fulfillOrders} onChange={(v) => set("fulfillOrders", v)} label="Onboard new paying clients" hint="Builds their agent, writes their launch campaign, adds the onboarding checklist and sends the welcome email." />
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>
              <ShieldCheck size={17} style={{ display: "inline", verticalAlign: -3, marginRight: 6 }} />
              Sending
            </h2>
          </div>
          <div className="card-body">
            <Switch
              checked={c.autoSend}
              onChange={(v) => set("autoSend", v)}
              disabled={!i.resend}
              label="Send emails without waiting for my approval"
              hint={
                i.resend
                  ? mailingAddress
                    ? "Only emails that include your postal address and an opt-out line, to a real address, with no [placeholders], up to the daily cap. Everything else waits in your Inbox."
                    : "Add your postal address in Settings first: commercial email must include it."
                  : "Needs RESEND_API_KEY and RESEND_FROM. Until then, everything waits in your Inbox for you to send."
              }
            />
            <label className="field" style={{ maxWidth: 220, marginTop: 10 }}>
              <span>Daily send cap</span>
              <input className="input" type="number" min={1} max={100} value={c.dailySendCap} onChange={(e) => set("dailySendCap", Number(e.target.value))} disabled={!c.autoSend} />
            </label>
            <Switch checked={c.emailSummary} onChange={(v) => set("emailSummary", v)} disabled={!i.resend} label="Email me a summary after each run" />
            <div className="tip" style={{ marginTop: 10 }}>
              Autopilot never texts or calls prospects. AI calls and texts need the person's prior consent, so those always wait for you.
            </div>
          </div>
        </section>

        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn primary" onClick={() => void save()} disabled={saving}>
            {saving ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />} Save settings
          </button>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Run log</h2>
          {latest && <span className="faint small">Last run {timeAgo(latest.startedAt)}</span>}
        </div>
        <div className="card-body">
          {!state.runs.length ? (
            <Empty icon={<Zap size={20} />} title="No runs yet">
              Add a city or two, then press Run now to see it work.
            </Empty>
          ) : (
            <div className="stack" style={{ gap: 18 }}>
              {state.runs.map((r) => (
                <div key={r.id}>
                  <div className="row between" style={{ marginBottom: 4 }}>
                    <b className="small">
                      {new Date(r.startedAt).toLocaleString()} · {r.trigger === "cron" ? "scheduled" : "manual"}
                    </b>
                    <span className={`badge ${r.status === "done" ? "good" : r.status === "running" ? "brand" : "hot"}`}>{r.status === "running" ? "Running" : r.status === "done" ? "Done" : "Stopped"}</span>
                  </div>
                  <div className="faint small" style={{ marginBottom: 6 }}>
                    {r.counts.saved} leads · {r.counts.demos} demos · {r.counts.drafted} drafts · {r.counts.ads} campaigns · {r.counts.sent} sent · {r.counts.fulfilled} onboarded
                  </div>
                  {r.lines.length === 0 ? (
                    <div className="faint small">{r.status === "running" ? "Starting…" : "Nothing to do this time."}</div>
                  ) : (
                    r.lines.map((l, idx) => (
                      <div key={idx} className="log-line" style={{ color: l.kind === "error" ? "var(--hot)" : undefined }}>
                        <span style={{ marginTop: 2, color: l.kind === "error" ? "var(--hot)" : "var(--text-3)" }}>{ICON[l.kind]}</span>
                        <span>
                          {l.text}
                          {l.leadId && (
                            <>
                              {" "}
                              <a className="link-btn" href={`/pipeline?lead=${l.leadId}`}>
                                open
                              </a>
                            </>
                          )}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
