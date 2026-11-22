"use client";

import { useState } from "react";
import { Bot, ExternalLink, LoaderCircle, PhoneIncoming, PhoneMissed, Plug, Save } from "lucide-react";
import { Switch } from "@/components/ui";
import type { WorkspaceView } from "@/lib/clients/view";
import { timeAgo } from "@/lib/format";
import { displayPhone } from "@/lib/phone";
import type { Go } from "./Workspace";
import { Field, ServiceHeader, useAct } from "./shared";

export function CallsTab({ view, go }: { view: WorkspaceView; go: Go }) {
  const c = view.client;
  const { act, busy } = useAct();
  const [f, setF] = useState({
    smsNumber: c.smsNumber ?? "",
    whatsappNumber: c.whatsappNumber ?? "",
    staffPhone: c.staffPhone ?? "",
    agentId: c.agentId ?? "",
    callFlow: c.settings.callFlow,
    ringSeconds: c.settings.ringSeconds,
    textBack: c.settings.textBack,
    textBackMessage: c.settings.textBackMessage,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = () =>
    act("save", `/api/clients/${c.id}`, {
      method: "PATCH",
      json: { smsNumber: f.smsNumber, whatsappNumber: f.whatsappNumber, staffPhone: f.staffPhone, agentId: f.agentId, settings: { callFlow: f.callFlow, ringSeconds: f.ringSeconds, textBack: f.textBack, textBackMessage: f.textBackMessage } },
    }, "Saved");
  const calls = view.calls;
  const m = view.month.calls;
  const target = f.smsNumber || "+1XXXXXXXXXX";

  return (
    <div className="stack" style={{ gap: 18 }}>
      <ServiceHeader client={c} id="missed_calls">
        <div className="grid-3" style={{ gap: 12 }}>
          <div className="stack" style={{ gap: 0 }}>
            <span className="faint small">Calls this month</span>
            <b className="metric">{m.total}</b>
          </div>
          <div className="stack" style={{ gap: 0 }}>
            <span className="faint small">Answered by the agent</span>
            <b className="metric">{m.ai}</b>
          </div>
          <div className="stack" style={{ gap: 0 }}>
            <span className="faint small">Missed, texted back</span>
            <b className="metric">
              {m.textedBack}/{m.missed}
            </b>
          </div>
        </div>
        {!view.integrations.twilio && (
          <p className="faint small" style={{ margin: 0 }}>
            Calls and texts need a Twilio account: add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to your hosting&apos;s environment variables. Until then you can try it with Simulate a missed call.
          </p>
        )}
      </ServiceHeader>

      <section className="card">
        <div className="card-head">
          <h3 style={{ margin: 0 }}>1. The number and how calls reach it</h3>
          <button className="btn primary sm" onClick={() => void save()} disabled={Boolean(busy)}>
            <Save size={14} /> Save
          </button>
        </div>
        <div className="card-body stack" style={{ gap: 12 }}>
          <div className="grid-2" style={{ gap: 12 }}>
            <Field label="Their Twilio number" hint="Buy a local number in Twilio for each client. In the US, register it for A2P 10DLC before texting.">
              <input className="input" value={f.smsNumber} onChange={(e) => set("smsNumber", e.target.value)} placeholder="+14165550123" />
            </Field>
            <Field label="WhatsApp sender (optional)" hint="A WhatsApp sender on your Twilio account. Used instead of texts when on (Settings).">
              <input className="input" value={f.whatsappNumber} onChange={(e) => set("whatsappNumber", e.target.value)} placeholder="+5215512345678" />
            </Field>
          </div>
          <button
            className="btn"
            style={{ alignSelf: "flex-start" }}
            disabled={Boolean(busy) || !c.smsNumber}
            onClick={() => void act("connect", `/api/clients/${c.id}/calls`, { method: "POST", json: { action: "connect_number" } }, (r: { message: string }) => r.message)}
          >
            {busy === "connect" ? <LoaderCircle size={14} className="spin" /> : <Plug size={14} />} Connect the number to Rainmaker
          </button>
          <div className="field">
            <span>How calls reach it</span>
            <label className="check-row">
              <input type="radio" name="flow" checked={f.callFlow === "forwarded"} onChange={() => set("callFlow", "forwarded")} />
              <span>
                <b>They forward unanswered calls to it</b> (keeps their number; simplest). Their phone rings as usual; calls nobody picks up come here.
              </span>
            </label>
            <label className="check-row">
              <input type="radio" name="flow" checked={f.callFlow === "ring_first"} onChange={() => set("callFlow", "ring_first")} />
              <span>
                <b>This is their main number</b>: it rings their staff first, then the agent picks up.
              </span>
            </label>
          </div>
          {f.callFlow === "ring_first" && (
            <div className="grid-2" style={{ gap: 12 }}>
              <Field label="Staff phone to ring first">
                <input className="input" type="tel" value={f.staffPhone} onChange={(e) => set("staffPhone", e.target.value)} />
              </Field>
              <Field label="Ring for (seconds)">
                <input className="input" type="number" min={5} max={60} value={f.ringSeconds} onChange={(e) => set("ringSeconds", Number(e.target.value))} />
              </Field>
            </div>
          )}
          {f.callFlow === "forwarded" && (
            <details>
              <summary className="small" style={{ cursor: "pointer" }}>
                How to forward unanswered calls (send this to the client)
              </summary>
              <div className="stack small" style={{ gap: 6, marginTop: 8 }}>
                <div>
                  <b>Most mobile carriers</b> (AT&amp;T, T-Mobile, Rogers, Bell, Telus, Telcel, AT&amp;T México, Movistar, Claro, Digicel, Flow): dial <span className="mono">**61*{target}#</span> for no answer, <span className="mono">**67*{target}#</span> when busy, <span className="mono">**62*{target}#</span> when off. All three at once: <span className="mono">**004*{target}#</span>. Undo: <span className="mono">##004#</span>.
                </div>
                <div>
                  <b>Verizon:</b> dial <span className="mono">*71{target.replace(/^\+1/, "")}</span> (no answer or busy). Undo: <span className="mono">*73</span>.
                </div>
                <div>
                  <b>Office phone systems</b> (RingCentral, Nextiva, Ooma, Grasshopper, 3CX…): set &quot;forward unanswered calls after 4 rings&quot; to {target} in the admin portal.
                </div>
                <div className="faint">Codes vary by carrier and plan, and some carriers charge for forwarding: call the carrier if a code doesn&apos;t work.</div>
              </div>
            </details>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3 style={{ margin: 0 }}>2. The agent that answers</h3>
          {c.agentId && (
            <a className="btn ghost sm" href={`https://elevenlabs.io/app/agents/agents/${c.agentId}`} target="_blank" rel="noreferrer">
              <ExternalLink size={14} /> Open in ElevenLabs
            </a>
          )}
        </div>
        <div className="card-body stack" style={{ gap: 12 }}>
          <p className="muted small" style={{ margin: 0 }}>
            A natural-sounding receptionist trained on their website (step 1 when it&apos;s live), in {c.lang === "es" ? "Spanish" : c.lang === "fr" ? "French" : "English"} by default and the caller&apos;s language if different. It answers questions, takes bookings and messages, says it&apos;s a virtual assistant if asked, and never makes up prices or availability.
          </p>
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn primary" disabled={Boolean(busy) || !view.integrations.eleven} onClick={() => void act("agent", `/api/clients/${c.id}/calls`, { method: "POST", json: { action: "build_agent" } }, c.agentId ? "Agent updated for phone calls" : "Agent built and ready for phone calls")}>
              {busy === "agent" ? <LoaderCircle size={14} className="spin" /> : <Bot size={14} />} {c.agentId ? "Set up for phone calls again" : "Build their agent"}
            </button>
            {!view.integrations.eleven && <span className="faint small">Needs ELEVENLABS_API_KEY.</span>}
          </div>
          <Field label="Or use an agent you built yourself" hint="Its ElevenLabs agent id. Press Save above, then Set up for phone calls.">
            <input className="input mono" value={f.agentId} onChange={(e) => set("agentId", e.target.value)} placeholder="agent_…" />
          </Field>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3 style={{ margin: 0 }}>3. Text back anyone who hangs up</h3>
          <button className="btn primary sm" onClick={() => void save()} disabled={Boolean(busy)}>
            <Save size={14} /> Save
          </button>
        </div>
        <div className="card-body stack" style={{ gap: 10 }}>
          <Switch checked={f.textBack} onChange={(v) => set("textBack", v)} label="Text missed callers within seconds" hint="If the agent can't take the call (or isn't set up), the caller hears a short apology and gets this text. Their reply is answered like any lead." />
          <Field label="The text">
            <textarea className="textarea" rows={3} value={f.textBackMessage} onChange={(e) => set("textBackMessage", e.target.value)} />
          </Field>
          <button
            className="btn"
            style={{ alignSelf: "flex-start" }}
            disabled={Boolean(busy) || c.services.missed_calls.status === "off"}
            onClick={async () => {
              const r = await act<{ messages: { contactId: string; status: string }[] }>("sim", `/api/clients/${c.id}/calls`, { method: "POST", json: { action: "simulate" } }, (r) => (r.messages.length ? `Missed call logged; text-back ${r.messages[0].status === "sent" ? "sent" : "drafted"}` : "Missed call logged"));
              if (r?.messages[0]) go("messages", { contact: r.messages[0].contactId });
            }}
          >
            <PhoneMissed size={14} /> Simulate a missed call
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3 style={{ margin: 0 }}>Call log</h3>
        </div>
        {calls.length ? (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>From</th>
                  <th>What happened</th>
                  <th>Length</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((x) => (
                  <tr key={x.id} onClick={() => x.contactId && go("messages", { contact: x.contactId })} style={{ cursor: x.contactId ? "pointer" : undefined }}>
                    <td>{timeAgo(x.at)}</td>
                    <td className="mono">{x.from ? displayPhone(x.from) : "–"}</td>
                    <td>
                      {x.outcome === "answered" ? (
                        <span className="badge good">
                          <PhoneIncoming size={12} /> Staff answered
                        </span>
                      ) : x.outcome === "ai" ? (
                        <span className="badge teal">
                          <Bot size={12} /> Agent answered
                        </span>
                      ) : (
                        <span className="badge warm">
                          <PhoneMissed size={12} /> Missed{x.textedBack ? ", texted back" : ""}
                        </span>
                      )}
                    </td>
                    <td>{x.durationSec ? `${Math.round(x.durationSec / 60)} min` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card-body faint small">No calls yet.</div>
        )}
      </section>
    </div>
  );
}
