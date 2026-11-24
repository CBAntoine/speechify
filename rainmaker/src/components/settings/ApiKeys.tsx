"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, CircleDashed, ExternalLink, LoaderCircle, Lock, ShieldCheck, Trash2 } from "lucide-react";
import { api, useToast } from "@/components/client";
import type { CheckResult, KeyView, KeysPolicy } from "@/lib/keys";
import type { ServiceDef, ServiceId } from "@/lib/keys-core";

// Settings > API keys. Paste a key once: it's saved (encrypted) on the server
// until the owner removes it. Only masked previews ever reach this page.

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Fields that must all be set for the service to work (a Mode dropdown has a default). */
const required = (fields: KeyView[]) => fields.filter((f) => !f.optional && !f.options);

function SourceBadge({ k }: { k: KeyView }) {
  if (k.locked) return <span className="badge warm">Can&apos;t unlock</span>;
  if (k.source === "saved")
    return (
      <span className="badge good">
        <Lock size={11} /> Saved
      </span>
    );
  if (k.source === "hosting") return <span className="badge">From hosting</span>;
  if (k.options) return <span className="badge outline">Default</span>;
  return <span className="badge outline">{k.optional ? "Optional" : "Not set"}</span>;
}

function KeyField({ k, canSave, onSave, onRemove }: { k: KeyView; canSave: boolean; onSave: (value: string) => Promise<boolean>; onRemove: () => Promise<void> }) {
  const effective = k.options ? (k.preview ?? k.options[0].value) : "";
  const [editing, setEditing] = useState(k.source === "none");
  const [value, setValue] = useState(effective);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const inputId = `key-${k.name}`;

  // A save or removal changed where the value comes from: start fresh.
  useEffect(() => {
    setEditing(k.source === "none");
    setConfirming(false);
    setValue(k.options ? (k.preview ?? k.options[0].value) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- options never change
  }, [k.source, k.savedAt, k.preview]);

  async function save() {
    if (!value.trim() || busy) return;
    setBusy(true);
    const ok = await onSave(value);
    setBusy(false);
    if (ok && !k.options) setValue("");
  }

  async function remove() {
    setBusy(true);
    await onRemove();
    setBusy(false);
  }

  return (
    <div className="key-field">
      <div className="row between" style={{ gap: 8 }}>
        <label className="key-label" htmlFor={inputId}>
          {k.label}
        </label>
        <SourceBadge k={k} />
      </div>

      {k.preview && !k.options && (
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="mono key-preview">{k.preview}</span>
          {k.source === "saved" && k.savedAt && <span className="faint small">saved {when(k.savedAt)}</span>}
          {k.source === "hosting" && <span className="faint small">in your hosting settings</span>}
        </div>
      )}
      {k.hostingPreview && (
        <div className="faint small">
          Used instead of the hosting key <span className="mono">{k.hostingPreview}</span>, which comes back if you remove this one.
        </div>
      )}
      {k.locked && (
        <div className="faint small key-warn">
          This key was saved with a different SECRETS_KEY, so it can&apos;t be unlocked. Paste it again, or remove it.
        </div>
      )}

      {k.options ? (
        <div className="key-input-row">
          <select id={inputId} className="select" value={value} onChange={(e) => setValue(e.target.value)} disabled={!canSave || busy}>
            {k.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button type="button" className="btn sm" onClick={() => void save()} disabled={!canSave || busy || value === effective}>
            {busy ? <LoaderCircle size={13} className="spin" /> : null} Save
          </button>
        </div>
      ) : editing ? (
        <div className="key-input-row">
          <input
            id={inputId}
            className="input mono"
            type={k.secret ? "password" : "text"}
            autoComplete={k.secret ? "new-password" : "off"}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            data-secret={k.secret ? "" : undefined}
            placeholder={k.placeholder}
            value={value}
            disabled={!canSave || busy}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void save();
              }
            }}
          />
          <button type="button" className="btn primary sm" onClick={() => void save()} disabled={!canSave || busy || !value.trim()}>
            {busy ? <LoaderCircle size={13} className="spin" /> : null} Save
          </button>
          {k.source !== "none" && (
            <button type="button" className="btn ghost sm" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
          )}
        </div>
      ) : null}

      {!k.options && !editing && (
        <div className="row wrap" style={{ gap: 6 }}>
          <button type="button" className="btn sm" onClick={() => setEditing(true)} disabled={!canSave || busy}>
            {k.source === "saved" ? "Replace" : "Use a different key"}
          </button>
          {(k.source === "saved" || k.locked) &&
            (confirming ? (
              <>
                <span className="small muted">Remove this key?</span>
                <button type="button" className="btn sm danger" onClick={() => void remove()} disabled={!canSave || busy}>
                  {busy ? <LoaderCircle size={13} className="spin" /> : <Trash2 size={13} />} Yes, remove
                </button>
                <button type="button" className="btn sm ghost" onClick={() => setConfirming(false)} disabled={busy}>
                  Keep it
                </button>
              </>
            ) : (
              <button type="button" className="btn sm ghost danger" onClick={() => setConfirming(true)} disabled={!canSave || busy}>
                <Trash2 size={13} /> Remove
              </button>
            ))}
        </div>
      )}
      {k.options && k.source === "saved" && (
        <div>
          <button type="button" className="btn sm ghost" onClick={() => void remove()} disabled={!canSave || busy}>
            Reset to {k.source === "saved" && k.hostingPreview ? "hosting setting" : "default"}
          </button>
        </div>
      )}
      {k.hint && (editing || k.options) && <small className="hint">{k.hint}</small>}
    </div>
  );
}

function CheckLine({ r }: { r: CheckResult | "busy" }) {
  if (r === "busy")
    return (
      <span className="key-check">
        <LoaderCircle size={14} className="spin" /> Checking…
      </span>
    );
  const Icon = r.state === "ok" ? CircleCheck : r.state === "fail" ? CircleAlert : CircleDashed;
  return (
    <span className={`key-check ${r.state}`} role="status">
      <Icon size={14} /> {r.text}
    </span>
  );
}

export function ApiKeys({
  keys: initial,
  services,
  policy,
  persistent,
  focus,
}: {
  keys: KeyView[];
  services: ServiceDef[];
  policy: KeysPolicy;
  persistent: boolean;
  /** A service to scroll to and highlight, e.g. from the copilot (?keys=stripe). */
  focus?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [keys, setKeys] = useState(initial);
  const [checks, setChecks] = useState<Partial<Record<ServiceId, CheckResult | "busy">>>({});

  useEffect(() => setKeys(initial), [initial]);

  useEffect(() => {
    if (!focus) return;
    const el = document.getElementById(`keys-${focus}`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("copilot-spot");
    const t = window.setTimeout(() => el.classList.remove("copilot-spot"), 3200);
    el.querySelector<HTMLInputElement>("input:not([disabled])")?.focus({ preventScroll: true });
    return () => window.clearTimeout(t);
  }, [focus]);

  async function check(id: ServiceId) {
    setChecks((c) => ({ ...c, [id]: "busy" }));
    try {
      const r = await api<CheckResult>("/api/keys/check", { method: "POST", json: { service: id } });
      setChecks((c) => ({ ...c, [id]: r }));
    } catch (err) {
      setChecks((c) => ({ ...c, [id]: { state: "fail", text: errText(err) } }));
    }
  }

  async function save(k: KeyView, value: string): Promise<boolean> {
    const svc = services.find((s) => s.id === k.service);
    try {
      const r = await api<{ keys: KeyView[] }>("/api/keys", { method: "PUT", json: { name: k.name, value } });
      setKeys(r.keys);
      toast(`${svc?.name ?? "Key"} ${k.label.toLowerCase()} saved. It stays until you remove it.`);
      router.refresh();
      const fields = r.keys.filter((x) => x.service === k.service);
      if (svc?.checkable && required(fields).every((f) => f.source !== "none")) void check(k.service);
      else setChecks((c) => ({ ...c, [k.service]: undefined }));
      return true;
    } catch (err) {
      toast(errText(err), "error");
      return false;
    }
  }

  async function remove(k: KeyView) {
    const svc = services.find((s) => s.id === k.service);
    try {
      const r = await api<{ keys: KeyView[] }>(`/api/keys?name=${encodeURIComponent(k.name)}`, { method: "DELETE" });
      setKeys(r.keys);
      const now = r.keys.find((x) => x.name === k.name);
      toast(now?.source === "hosting" ? `Removed. ${svc?.name ?? "It"} uses the key in your hosting settings again.` : `${svc?.name ?? "Key"} ${k.label.toLowerCase()} removed.`);
      setChecks((c) => ({ ...c, [k.service]: undefined }));
      router.refresh();
    } catch (err) {
      toast(errText(err), "error");
    }
  }

  return (
    <section className="card" id="api-keys">
      <div className="card-head">
        <h2>API keys</h2>
        <span className="badge good">
          <ShieldCheck size={12} /> Encrypted
        </span>
      </div>
      <div className="card-body stack" style={{ gap: 12 }}>
        <div className="muted small">
          Paste a key and press Save. Rainmaker keeps it, encrypted, through restarts and redeploys until you press Remove, and never shows it in full again. A key saved here is used instead of one in your hosting settings.
        </div>
        {!policy.canSave && (
          <div className="tip warn">
            <Lock size={15} />
            <span>{policy.reason}</span>
          </div>
        )}
        {!persistent && (
          <div className="tip warn">
            <CircleAlert size={15} />
            <span>This host doesn&apos;t keep files, so saved keys would disappear when it restarts. Connect a Postgres database (DATABASE_URL) to keep them.</span>
          </div>
        )}
        <div className="key-services">
          {services.map((s) => {
            const fields = keys.filter((k) => k.service === s.id);
            const main = fields.filter((f) => !f.optional);
            const extra = fields.filter((f) => f.optional);
            const need = required(fields);
            const have = need.filter((f) => f.source !== "none").length;
            const result = checks[s.id];
            return (
              <div key={s.id} className="key-service" id={`keys-${s.id}`}>
                <div className="row between" style={{ gap: 8 }}>
                  <b>{s.name}</b>
                  {have === need.length ? (
                    <span className="badge good">
                      <CircleCheck size={11} /> Ready
                    </span>
                  ) : have > 0 ? (
                    <span className="badge warm">{need.length - have} more to add</span>
                  ) : (
                    <span className="badge outline">Not set</span>
                  )}
                </div>
                <div className="muted small">
                  {s.turnsOn}{" "}
                  <a href={s.url} target="_blank" rel="noreferrer" className="key-get">
                    Get a key <ExternalLink size={11} />
                  </a>
                  <span className="faint"> · {s.where}</span>
                </div>
                {main.map((k) => (
                  <KeyField key={k.name} k={k} canSave={policy.canSave} onSave={(v) => save(k, v)} onRemove={() => remove(k)} />
                ))}
                {extra.length > 0 && (
                  <details className="key-more" open={extra.some((k) => k.source !== "none")}>
                    <summary>{extra.map((k) => k.label).join(", ")} (optional)</summary>
                    {extra.map((k) => (
                      <KeyField key={k.name} k={k} canSave={policy.canSave} onSave={(v) => save(k, v)} onRemove={() => remove(k)} />
                    ))}
                  </details>
                )}
                {s.checkable && have > 0 && (
                  <div className="row wrap" style={{ gap: 8 }}>
                    <button type="button" className="btn sm ghost" onClick={() => void check(s.id)} disabled={result === "busy"}>
                      Check {s.name.replace(/ \(.*\)$/, "")}
                    </button>
                    {result && <CheckLine r={result} />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="faint small">
          {policy.ownEncryptionKey
            ? "Encrypted with your SECRETS_KEY. Keep that setting: without it, saved keys can't be unlocked."
            : "Keys are encrypted at rest. For extra protection, add SECRETS_KEY (any long random text) to your hosting settings, so the encryption key isn't stored next to them."}
        </div>
      </div>
    </section>
  );
}
