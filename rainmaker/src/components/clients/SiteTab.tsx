"use client";

import { useState } from "react";
import { Download, ExternalLink, Eye, EyeOff, LoaderCircle, Plus, Save, Sparkles, Trash } from "lucide-react";
import type { WorkspaceView } from "@/lib/clients/view";
import type { SiteContent, SiteItem } from "@/lib/types";
import { CopyRow, Field, ServiceHeader, useAct } from "./shared";

function ItemsEditor({ label, items, onChange, max = 8, stacked = false }: { label: string; items: SiteItem[]; onChange: (v: SiteItem[]) => void; max?: number; stacked?: boolean }) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="stack" style={{ gap: 8 }}>
        {items.map((it, i) => (
          <div key={i} className={stacked ? "item-row stacked" : "item-row"}>
            <input className="input" value={it.title} placeholder="Title" onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} aria-label={`${label} ${i + 1} title`} />
            <input className="input" value={it.text} placeholder="One sentence" onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} aria-label={`${label} ${i + 1} text`} />
            <button type="button" className="btn ghost icon sm" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Remove ${it.title || "item"}`}>
              <Trash size={14} />
            </button>
          </div>
        ))}
        {items.length < max && (
          <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => onChange([...items, { title: "", text: "" }])}>
            <Plus size={14} /> Add
          </button>
        )}
      </div>
    </div>
  );
}

export function SiteTab({ view }: { view: WorkspaceView }) {
  const c = view.client;
  const { act, busy } = useAct();
  const [brief, setBrief] = useState({ services: "", offer: "", notes: "" });
  const [content, setContent] = useState<SiteContent | undefined>(c.site?.content);
  const [dirty, setDirty] = useState(false);
  const [frame, setFrame] = useState(0);
  const set = <K extends keyof SiteContent>(k: K, v: SiteContent[K]) => {
    setContent((x) => (x ? { ...x, [k]: v } : x));
    setDirty(true);
  };
  const url = c.site ? `${view.base}/s/${c.site.slug}` : "";

  const build = async () => {
    const r = await act<{ client: typeof c; by: string; note?: string }>("build", `/api/clients/${c.id}/site`, { method: "POST", json: { action: "build", ...brief } }, (r) => r.note ?? (r.by === "ai" ? "Website written. Check it, then publish." : "Website drafted."));
    if (r?.client.site) {
      setContent(r.client.site.content);
      setDirty(false);
      setFrame((n) => n + 1);
    }
  };
  const save = async () => {
    const r = await act("save", `/api/clients/${c.id}/site`, { method: "POST", json: { action: "save", content } }, "Website saved");
    if (r) {
      setDirty(false);
      setFrame((n) => n + 1);
    }
  };

  const briefForm = (
    <div className="stack" style={{ gap: 12 }}>
      <Field label="Their services, in their words" hint="Claude also reads their current website, if they have one.">
        <textarea className="textarea" rows={3} value={brief.services} onChange={(e) => setBrief({ ...brief, services: e.target.value })} placeholder="e.g. cleanings, whitening, emergency visits, Invisalign" />
      </Field>
      <Field label="Offer (only if they really make one)">
        <input className="input" value={brief.offer} onChange={(e) => setBrief({ ...brief, offer: e.target.value })} placeholder="e.g. Free estimates" />
      </Field>
      <Field label="Anything else to say">
        <textarea className="textarea" rows={2} value={brief.notes} onChange={(e) => setBrief({ ...brief, notes: e.target.value })} placeholder="Family-owned since 2009, Saturday hours, speak Spanish…" />
      </Field>
      <button className="btn primary" style={{ alignSelf: "flex-start" }} onClick={() => void build()} disabled={Boolean(busy)}>
        {busy === "build" ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />} {c.site ? "Rewrite the website" : "Build the website"}
      </button>
    </div>
  );

  return (
    <div className="stack" style={{ gap: 18 }}>
      <ServiceHeader client={c} id="website">
        {c.site ? (
          <div className="stack" style={{ gap: 10 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <button className={`btn ${c.site.published ? "" : "primary"}`} onClick={() => void act("pub", `/api/clients/${c.id}/site`, { method: "POST", json: { action: c.site!.published ? "unpublish" : "publish" } }, c.site!.published ? "Unpublished" : "Published: it's live")} disabled={Boolean(busy)}>
                {c.site.published ? <EyeOff size={15} /> : <Eye size={15} />} {c.site.published ? "Unpublish" : "Publish"}
              </button>
              <a className="btn" href={url} target="_blank" rel="noreferrer">
                <ExternalLink size={15} /> Open
              </a>
              <a className="btn" href={`/api/clients/${c.id}/site?export=1`}>
                <Download size={15} /> Download HTML
              </a>
            </div>
            <CopyRow value={url} />
            <p className="faint small" style={{ margin: 0 }}>
              {c.site.published ? "Live. Point their domain here, or upload the HTML file to their own host: its form still sends leads to step 4." : "Not public yet: only you can see the preview."} Last written by {c.site.createdBy === "ai" ? "Claude" : c.site.createdBy === "user" ? "you" : "the template"}.
            </p>
          </div>
        ) : (
          briefForm
        )}
      </ServiceHeader>

      {c.site && content && (
        <div className="site-split">
          <section className="card">
            <div className="card-head">
              <h3 style={{ margin: 0 }}>Edit the page</h3>
              <button className="btn primary sm" onClick={() => void save()} disabled={!dirty || Boolean(busy)}>
                <Save size={14} /> Save
              </button>
            </div>
            <div className="card-body stack" style={{ gap: 12 }}>
              <Field label="Headline">
                <input className="input" value={content.headline} onChange={(e) => set("headline", e.target.value)} />
              </Field>
              <Field label="Subheadline">
                <textarea className="textarea" rows={2} value={content.subheadline} onChange={(e) => set("subheadline", e.target.value)} />
              </Field>
              <div className="grid-2" style={{ gap: 12 }}>
                <Field label="Main button">
                  <input className="input" value={content.cta} onChange={(e) => set("cta", e.target.value)} />
                </Field>
                <Field label="Offer badge (blank for none)">
                  <input className="input" value={content.offer} onChange={(e) => set("offer", e.target.value)} />
                </Field>
              </div>
              <Field label="About">
                <textarea className="textarea" rows={3} value={content.about} onChange={(e) => set("about", e.target.value)} />
              </Field>
              <ItemsEditor label="Services" items={content.services} onChange={(v) => set("services", v)} max={10} />
              <ItemsEditor label="Why choose them" items={content.benefits} onChange={(v) => set("benefits", v)} max={4} />
              <ItemsEditor label="How it works" items={content.steps} onChange={(v) => set("steps", v)} max={4} />
              <ItemsEditor label="FAQ" stacked items={content.faqs.map((f) => ({ title: f.q, text: f.a }))} onChange={(v) => set("faqs", v.map((x) => ({ q: x.title, a: x.text })))} max={10} />
              <div className="field">
                <span>Customer reviews (real ones only, with permission)</span>
                <div className="stack" style={{ gap: 8 }}>
                  {content.testimonials.map((t, i) => (
                    <div key={i} className="item-row">
                      <input className="input" value={t.quote} placeholder="What they said" onChange={(e) => set("testimonials", content.testimonials.map((x, j) => (j === i ? { ...x, quote: e.target.value } : x)))} aria-label={`Review ${i + 1}`} />
                      <input className="input" value={t.author} placeholder="Name, e.g. Maria G." onChange={(e) => set("testimonials", content.testimonials.map((x, j) => (j === i ? { ...x, author: e.target.value } : x)))} aria-label={`Review ${i + 1} author`} />
                      <button type="button" className="btn ghost icon sm" onClick={() => set("testimonials", content.testimonials.filter((_, j) => j !== i))} aria-label="Remove review">
                        <Trash size={14} />
                      </button>
                    </div>
                  ))}
                  {content.testimonials.length < 8 && (
                    <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => set("testimonials", [...content.testimonials, { quote: "", author: "" }])}>
                      <Plus size={14} /> Add a review
                    </button>
                  )}
                </div>
                <small>Copy them from their Google reviews. Never write or edit a review for them.</small>
              </div>
              <Field label="Hours, one line each">
                <textarea className="textarea" rows={3} value={content.hours.join("\n")} onChange={(e) => set("hours", e.target.value.split("\n"))} placeholder={"Mon–Fri 8am–6pm\nSat 9am–1pm"} />
              </Field>
              <div className="grid-2" style={{ gap: 12 }}>
                <Field label="Service area">
                  <input className="input" value={content.serviceArea} onChange={(e) => set("serviceArea", e.target.value)} />
                </Field>
                <Field label="Form title">
                  <input className="input" value={content.formTitle} onChange={(e) => set("formTitle", e.target.value)} />
                </Field>
              </div>
              <div className="row wrap" style={{ gap: 14 }}>
                {(["primary", "ink", "soft"] as const).map((k) => (
                  <label key={k} className="row small" style={{ gap: 6 }}>
                    <input type="color" value={content.colors[k]} onChange={(e) => set("colors", { ...content.colors, [k]: e.target.value })} aria-label={`${k} colour`} />
                    {k === "primary" ? "Buttons" : k === "ink" ? "Text" : "Background tint"}
                  </label>
                ))}
              </div>
              <Field label="Search title" hint={`${content.seoTitle.length}/60`}>
                <input className="input" value={content.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} />
              </Field>
              <Field label="Search description" hint={`${content.seoDescription.length}/155`}>
                <textarea className="textarea" rows={2} value={content.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} />
              </Field>
              <details>
                <summary className="small" style={{ cursor: "pointer" }}>
                  Rewrite it from a new brief
                </summary>
                <div style={{ marginTop: 10 }}>{briefForm}</div>
              </details>
            </div>
          </section>
          <section className="card site-preview">
            <div className="card-head">
              <h3 style={{ margin: 0 }}>Preview</h3>
              <span className="faint small">{dirty ? "Save to update" : "As customers see it"}</span>
            </div>
            <iframe key={frame} src={`/s/${c.site.slug}`} title={`${c.name} website preview`} className="site-frame" />
          </section>
        </div>
      )}
    </div>
  );
}
