"use client";

import { useState } from "react";
import { FlaskConical, LoaderCircle, Plus, Save } from "lucide-react";
import { formatDuration } from "@/lib/clients/metrics";
import type { WorkspaceView } from "@/lib/clients/view";
import { Switch } from "@/components/ui";
import type { Go } from "./Workspace";
import { CopyRow, Field, SequenceEditor, ServiceHeader, useAct } from "./shared";

export function LeadsTab({ view, go }: { view: WorkspaceView; go: Go }) {
  const c = view.client;
  const { act, busy } = useAct();
  const [goal, setGoal] = useState(c.settings.nurtureGoal);
  const [lead, setLead] = useState({ name: "", phone: "", email: "", notes: "", sms: false });
  const nurture = view.sequences.find((s) => s.kind === "nurture");
  const m = view.month;
  const intake = `${view.base}/api/intake/${c.id}`;
  const example = JSON.stringify({ name: "Jane Doe", phone: "+1 416 555 0199", email: "jane@example.com", message: "Can I book a visit next week?", sms_consent: true }, null, 2);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <ServiceHeader client={c} id="speed_to_lead">
        <div className="grid-3" style={{ gap: 12 }}>
          <div className="stack" style={{ gap: 0 }}>
            <span className="faint small">New leads this month</span>
            <b className="metric">{m.leads}</b>
          </div>
          <div className="stack" style={{ gap: 0 }}>
            <span className="faint small">Median first reply</span>
            <b className="metric">{formatDuration(m.medianResponseSec)}</b>
          </div>
          <div className="stack" style={{ gap: 0 }}>
            <span className="faint small">Answered within 5 minutes</span>
            <b className="metric">
              {m.fast}/{m.leads}
            </b>
          </div>
        </div>
      </ServiceHeader>

      <section className="card">
        <div className="card-head">
          <h3 style={{ margin: 0 }}>1. How it answers</h3>
          <button className="btn primary sm" disabled={Boolean(busy)} onClick={() => void act("goal", `/api/clients/${c.id}`, { method: "PATCH", json: { settings: { nurtureGoal: goal } } }, "Saved")}>
            <Save size={14} /> Save
          </button>
        </div>
        <div className="card-body stack" style={{ gap: 10 }}>
          <Switch
            checked={c.settings.aiReplies}
            onChange={(v) => void act("ai", `/api/clients/${c.id}`, { method: "PATCH", json: { settings: { aiReplies: v } } }, v ? "AI replies on" : "AI replies off: you answer texts yourself")}
            label="Answer every message right away"
            hint={view.integrations.claude ? "Claude writes each reply from their website and services, in the customer's language, and hands over to a person when needed." : "Without a Claude key, leads get the template reply and you get an alert to answer them."}
          />
          <Field label="What follow-up aims for" hint="The AI steers every conversation toward this.">
            <input className="input" value={goal} onChange={(e) => setGoal(e.target.value)} />
          </Field>
          <div className="row wrap" style={{ gap: 8 }}>
            <button
              className="btn"
              disabled={Boolean(busy) || c.services.speed_to_lead.status === "off"}
              onClick={async () => {
                const r = await act<{ contact: { id: string }; replies: { status: string }[] }>("test", `/api/clients/${c.id}/contacts`, { method: "POST", json: { action: "test_lead" } }, (r) => (r.replies.some((x) => x.status === "sent") ? "Test lead answered" : r.replies.length ? "Test lead answered as a draft" : "Test lead saved"));
                if (r) go("messages", { contact: r.contact.id });
              }}
            >
              {busy === "test" ? <LoaderCircle size={14} className="spin" /> : <FlaskConical size={14} />} Send a test lead
            </button>
            {c.services.speed_to_lead.status === "off" && <span className="faint small">Switch this step to Setting up or Live first.</span>}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3 style={{ margin: 0 }}>2. Where leads come from</h3>
        </div>
        <div className="card-body stack" style={{ gap: 12 }}>
          <div>
            <b className="small">Their website (step 1)</b>
            <p className="muted small" style={{ margin: "2px 0 0" }}>
              {c.site?.published ? "Every form on their new site already comes here." : "Once the website is published, its form comes here automatically."}
            </p>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <b className="small">Any other form, Zapier or Make (Meta lead ads, Typeform, Jotform…)</b>
            <span className="muted small">POST JSON or form fields to this address. The key is in the address; treat it like a password.</span>
            <CopyRow value={`${intake}?key=${c.intakeKey}`} />
            <details>
              <summary className="small" style={{ cursor: "pointer" }}>Example body</summary>
              <pre className="code-block">{example}</pre>
              <p className="faint small">Field names in English, Spanish or French work (name, phone, email, message, service). Set sms_consent to true only if the form asked for permission to text.</p>
            </details>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <b className="small">Google Ads lead forms</b>
            <span className="muted small">In the lead form, under Lead delivery → Webhook, use this URL and key. Test leads from Google are accepted and ignored.</span>
            <CopyRow value={intake} label="Copy URL" />
            <CopyRow value={c.intakeKey} label="Copy key" />
          </div>
        </div>
      </section>

      <SequenceEditor
        client={c}
        seq={nurture}
        kind="nurture"
        title="3. Follow-ups until they reply"
        hint="Message 1 is the instant answer (Claude writes it from what they asked, when connected). The rest go out if they don't reply; any reply stops them. Texts only go to people who ticked the texting box; otherwise by email."
      />

      <section className="card">
        <div className="card-head">
          <h3 style={{ margin: 0 }}>Add a lead by hand</h3>
        </div>
        <div className="card-body stack" style={{ gap: 12 }}>
          <div className="grid-2" style={{ gap: 12 }}>
            <Field label="Name">
              <input className="input" value={lead.name} onChange={(e) => setLead({ ...lead, name: e.target.value })} />
            </Field>
            <Field label="Mobile">
              <input className="input" type="tel" value={lead.phone} onChange={(e) => setLead({ ...lead, phone: e.target.value })} />
            </Field>
            <Field label="Email">
              <input className="input" type="email" value={lead.email} onChange={(e) => setLead({ ...lead, email: e.target.value })} />
            </Field>
            <Field label="What they want">
              <input className="input" value={lead.notes} onChange={(e) => setLead({ ...lead, notes: e.target.value })} />
            </Field>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={lead.sms} onChange={(e) => setLead({ ...lead, sms: e.target.checked })} /> They agreed to get texts
          </label>
          <button
            className="btn"
            style={{ alignSelf: "flex-start" }}
            disabled={Boolean(busy) || (!lead.phone && !lead.email)}
            onClick={async () => {
              const r = await act("add", `/api/clients/${c.id}/contacts`, { method: "POST", json: { action: "add", lead: true, ...lead } }, "Lead added");
              if (r) setLead({ name: "", phone: "", email: "", notes: "", sms: false });
            }}
          >
            <Plus size={14} /> Add lead
          </button>
        </div>
      </section>
    </div>
  );
}
