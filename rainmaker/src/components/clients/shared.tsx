"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, type ReactNode } from "react";
import { TriangleExclamationPoint as AlertTriangle, CircleCheck, Globe, GraduationCap, LoaderCircle, Megaphone, PhoneCall, RotateCcw, Save, Sparkles, Star, Zap, type LucideIcon } from "lucide-react";
import { api, useToast } from "@/components/client";
import { missingFoundations, pitchFor, serviceById, type ServiceDef } from "@/lib/clients/services";
import { formatMoney } from "@/lib/clients/pricing";
import { smsSegments } from "@/lib/clients/rules";
import type { Client, Sequence, SequenceStepContent, ServiceId, ServiceStatus } from "@/lib/types";

export const SERVICE_ICONS: Record<string, LucideIcon> = { Globe, RotateCcw, Star, Zap, PhoneCall, GraduationCap, Megaphone };

export function ServiceIcon({ s, size = 16 }: { s: ServiceDef; size?: number }) {
  const I = SERVICE_ICONS[s.icon] ?? Zap;
  return <I size={size} aria-hidden />;
}

export const STATUS_LABEL: Record<ServiceStatus, string> = { off: "Not started", setup: "Setting up", live: "Live", paused: "Paused" };

export function SvcPill({ status, included = true }: { status: ServiceStatus; included?: boolean }) {
  if (!included) return <span className="svc-pill out">Not in plan</span>;
  return <span className={`svc-pill ${status}`}>{STATUS_LABEL[status]}</span>;
}

/** Money in the client's currency and locale. */
/** Money as the agency reads it: "$1,597" for US dollars, "CA$1,597", "MX$6,090", "GTQ 1,597" for the rest. */
export function useMoney(client: Pick<Client, "currency">) {
  return (n: number) => formatMoney(n, client.currency);
}

/** Call an API, toast the outcome, refresh the page's server data. */
export function useAct() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const act = useCallback(
    async <T,>(key: string, url: string, init: RequestInit & { json?: unknown }, ok?: string | ((r: T) => string | undefined)): Promise<T | undefined> => {
      setBusy(key);
      try {
        const r = await api<T>(url, init);
        const msg = typeof ok === "function" ? ok(r) : ok;
        if (msg) toast(msg);
        router.refresh();
        return r;
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error");
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [router, toast]
  );
  return { act, busy };
}

/** The top of each service tab: what it is, why it's at this step, its status, and what's missing first. */
export function ServiceHeader({ client, id, children }: { client: Client; id: ServiceId; children?: ReactNode }) {
  const s = serviceById(id)!;
  const state = client.services[id];
  const { act, busy } = useAct();
  const missing = missingFoundations(id, client.services);
  const setStatus = (status: ServiceStatus) =>
    act(`status:${status}`, `/api/clients/${client.id}`, { method: "PATCH", json: { service: id, status } }, status === "live" ? `${s.short} is live` : `${s.short}: ${STATUS_LABEL[status].toLowerCase()}`);
  return (
    <section className="card">
      <div className="card-head" style={{ alignItems: "flex-start" }}>
        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
          <span className="step-num">{s.step}</span>
          <div>
            <h2 style={{ margin: 0 }}>{s.name}</h2>
            <div className="faint small">Replaces {/^[aeiou]/i.test(s.roleLabel) ? "an" : "a"} {s.roleLabel.toLowerCase()} · {pitchFor(s, client.lang).title}</div>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 6, justifyContent: "flex-end" }}>
          <SvcPill status={state.status} included={state.included} />
          {state.included ? (
            <select className="select sm-select" value={state.status} aria-label={`${s.short} status`} onChange={(e) => void setStatus(e.target.value as ServiceStatus)} disabled={Boolean(busy)}>
              <option value="off">Not started</option>
              <option value="setup">Setting up (draft only)</option>
              <option value="live">Live</option>
              <option value="paused">Paused</option>
            </select>
          ) : (
            <button className="btn sm" onClick={() => void act("include", `/api/clients/${client.id}`, { method: "PATCH", json: { service: id, included: true } }, `${s.short} added to their plan`)}>
              Add to plan
            </button>
          )}
        </div>
      </div>
      <div className="card-body stack" style={{ gap: 10 }}>
        <p className="muted small" style={{ margin: 0 }}>
          <b>Why step {s.step}:</b> {s.why}
        </p>
        {missing.length > 0 && state.status !== "off" && (
          <div className="tip warn">
            <AlertTriangle size={15} />
            <span>
              Deploy in order: {missing.map((m) => `step ${m.step} (${m.short})`).join(" and ")} {missing.length === 1 ? "isn't" : "aren't"} live yet.
            </span>
          </div>
        )}
        {state.status === "setup" && (
          <div className="tip neutral">
            <CircleCheck size={15} />
            <span>Setting up: everything this step would send is saved as a draft in Messages for you to check. Switch it to Live when it looks right.</span>
          </div>
        )}
        {state.status === "live" && !client.settings.autoSend && (
          <div className="tip neutral">
            <CircleCheck size={15} />
            <span>Live with approvals on: messages wait in Messages until you approve them. Turn on automatic sending in Settings so customers hear back in seconds.</span>
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

/** Edit a sequence's steps: delay, text, email subject and body. */
export function SequenceEditor({ client, seq, kind, title, hint, extra }: { client: Client; seq?: Sequence; kind: Sequence["kind"]; title: string; hint?: ReactNode; extra?: ReactNode }) {
  const { act, busy } = useAct();
  const [steps, setSteps] = useState<SequenceStepContent[]>(seq?.steps ?? []);
  const [dirty, setDirty] = useState(false);
  const [service, setService] = useState("");
  const edit = (i: number, k: keyof SequenceStepContent, v: string) => {
    setSteps((x) => x.map((s, j) => (j === i ? { ...s, [k]: k === "delayHours" ? Math.max(0, Math.round(Number(v) || 0)) : v } : s)));
    setDirty(true);
  };
  const write = async () => {
    const r = await act<{ sequence: Sequence; by: string; note?: string }>(`write:${kind}`, `/api/clients/${client.id}/sequences`, { method: "POST", json: { action: "write", kind, seqId: seq?.id, service: service || undefined } }, (r) => r.note ?? (r.by === "ai" ? "Rewritten by Claude" : "Reset to the template"));
    if (r) {
      setSteps(r.sequence.steps);
      setDirty(false);
    }
  };
  const save = async () => {
    if (!seq) return;
    const r = await act<{ sequence: Sequence }>(`save:${kind}`, `/api/clients/${client.id}/sequences`, { method: "POST", json: { action: "save", seqId: seq.id, steps } }, "Messages saved");
    if (r) setDirty(false);
  };
  const toggle = () => seq && act(`pause:${kind}`, `/api/clients/${client.id}/sequences`, { method: "POST", json: { action: "save", seqId: seq.id, status: seq.status === "running" ? "paused" : "running" } }, seq.status === "running" ? "Paused" : "Running again");
  return (
    <section className="card">
      <div className="card-head">
        <h3 style={{ margin: 0 }}>{title}</h3>
        <div className="row wrap" style={{ gap: 6 }}>
          {seq && (
            <button className="btn ghost sm" onClick={() => void toggle()} disabled={Boolean(busy)}>
              {seq.status === "running" ? "Pause" : "Resume"}
            </button>
          )}
          <button className="btn sm" onClick={() => void write()} disabled={Boolean(busy)}>
            {busy === `write:${kind}` ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />} {seq ? "Rewrite" : "Write them"}
          </button>
          {seq && (
            <button className="btn primary sm" onClick={() => void save()} disabled={!dirty || Boolean(busy)}>
              <Save size={14} /> Save
            </button>
          )}
        </div>
      </div>
      <div className="card-body stack" style={{ gap: 12 }}>
        {hint && <p className="muted small" style={{ margin: 0 }}>{hint}</p>}
        {kind === "reactivation" && (
          <label className="field">
            <span>What they'd come back for (optional, used when rewriting)</span>
            <input className="input" value={service} onChange={(e) => setService(e.target.value)} placeholder="e.g. your next cleaning, a furnace tune-up" />
          </label>
        )}
        {extra}
        {!seq && <p className="faint small">No messages yet. Press Write them (Claude writes them in {client.lang === "es" ? "Spanish" : client.lang === "fr" ? "French" : "the client's language"}; without Claude you get the template).</p>}
        {steps.map((s, i) => {
          const seg = smsSegments(s.sms);
          return (
            <div key={i} className="seq-step">
              <div className="row between wrap" style={{ gap: 8 }}>
                <b className="small">Message {i + 1}</b>
                <label className="row small" style={{ gap: 6 }}>
                  <span className="faint">Send after</span>
                  <input className="input" style={{ width: 80 }} type="number" min={0} value={s.delayHours} onChange={(e) => edit(i, "delayHours", e.target.value)} aria-label={`Message ${i + 1} delay in hours`} />
                  <span className="faint">hours</span>
                </label>
              </div>
              <label className="field">
                <span>
                  Text <span className="counter">{seg.chars} chars · {seg.segments} SMS{seg.unicode ? " (accents use more room)" : ""}</span>
                </span>
                <textarea className="textarea" rows={3} value={s.sms} onChange={(e) => edit(i, "sms", e.target.value)} />
              </label>
              <details>
                <summary className="small" style={{ cursor: "pointer" }}>
                  Email version: {s.subject || "no subject"}
                </summary>
                <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                  <input className="input" value={s.subject} onChange={(e) => edit(i, "subject", e.target.value)} aria-label="Email subject" />
                  <textarea className="textarea" rows={5} value={s.email} onChange={(e) => edit(i, "email", e.target.value)} aria-label="Email body" />
                </div>
              </details>
            </div>
          );
        })}
        {steps.length > 0 && (
          <p className="faint small" style={{ margin: 0 }}>
            Placeholders: {"{first_name}"}, {"{business}"}, {"{booking_link}"}, {"{review_link}"}, {"{referral_link}"}. A message with a placeholder that can't be filled waits as a draft instead of going out.
          </p>
        )}
      </div>
    </section>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function CopyRow({ value, label = "Copy" }: { value: string; label?: string }) {
  const toast = useToast();
  return (
    <div className="copy-field">
      <input className="input mono" value={value} readOnly onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="btn sm"
        onClick={() =>
          navigator.clipboard.writeText(value).then(
            () => toast("Copied"),
            () => toast("Couldn't copy. Select it and copy by hand.", "error")
          )
        }
      >
        {label}
      </button>
    </div>
  );
}
