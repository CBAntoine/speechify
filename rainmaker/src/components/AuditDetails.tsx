import { Check, ExternalLink, Minus, X } from "lucide-react";
import type { AuditResult, Signal } from "@/lib/types";

function Yes({ ok, label }: { ok: boolean | undefined; label?: string }) {
  if (ok === undefined) return <Minus size={14} className="faint" />;
  return (
    <span className="row" style={{ gap: 6, color: ok ? "var(--good)" : "var(--hot)" }}>
      {ok ? <Check size={14} /> : <X size={14} />}
      <span style={{ color: "var(--text)" }}>{label ?? (ok ? "Yes" : "No")}</span>
    </span>
  );
}

export function AuditDetails({ audit }: { audit: AuditResult }) {
  if (!audit.reachable) {
    return (
      <div className="tip warn">
        <span>
          The website didn&apos;t load{audit.error ? `: ${audit.error}` : ""}. A broken site is itself a strong pitch: they&apos;re losing every visitor.
        </span>
      </div>
    );
  }
  const list = (xs: string[]) => (xs.length ? xs.join(", ") : <span className="faint">None found</span>);
  return (
    <dl className="kv">
      <dt>Secure (HTTPS)</dt>
      <dd>
        <Yes ok={audit.https} />
      </dd>
      <dt>Mobile-friendly</dt>
      <dd>
        <Yes ok={audit.mobileViewport} />
      </dd>
      <dt>Load time</dt>
      <dd>{audit.responseMs !== undefined ? <Yes ok={audit.responseMs <= 2500} label={`${(audit.responseMs / 1000).toFixed(1)}s to respond`} /> : "—"}</dd>
      <dt>Online booking</dt>
      <dd>{list(audit.booking)}</dd>
      <dt>Chat / text</dt>
      <dd>{list(audit.chat)}</dd>
      <dt>Ad tracking</dt>
      <dd>{list(audit.pixels)}</dd>
      <dt>Analytics</dt>
      <dd>{list(audit.analytics)}</dd>
      <dt>Contact form</dt>
      <dd>
        <Yes ok={audit.hasContactForm} />
      </dd>
      <dt>Tap to call</dt>
      <dd>
        <Yes ok={audit.hasClickToCall} />
      </dd>
      <dt>Site builder</dt>
      <dd>{audit.cms ?? <span className="faint">Unknown / custom</span>}</dd>
      <dt>Last updated</dt>
      <dd>{audit.copyrightYear ? `© ${audit.copyrightYear}` : <span className="faint">No date found</span>}</dd>
      <dt>Social</dt>
      <dd>{list(audit.socials)}</dd>
      {audit.emails.length > 0 && (
        <>
          <dt>Emails found</dt>
          <dd>{audit.emails.join(", ")}</dd>
        </>
      )}
      {audit.title && (
        <>
          <dt>Page title</dt>
          <dd>{audit.title}</dd>
        </>
      )}
      {audit.finalUrl && (
        <>
          <dt>Checked</dt>
          <dd>
            <a href={audit.finalUrl} target="_blank" rel="noreferrer" className="row" style={{ gap: 5, color: "var(--brand-ink)" }}>
              {audit.finalUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")} <ExternalLink size={12} />
            </a>
          </dd>
        </>
      )}
    </dl>
  );
}

export function SignalList({ signals }: { signals?: Signal[] }) {
  if (!signals?.length) return <div className="faint small">No findings yet. Run an audit.</div>;
  const order = { high: 0, medium: 1, low: 2, info: 3 };
  const sorted = [...signals].sort((a, b) => (a.positive === b.positive ? order[a.severity] - order[b.severity] : a.positive ? 1 : -1));
  return (
    <div className="stack" style={{ gap: 8 }}>
      {sorted.map((s) => (
        <div key={s.id} className="row" style={{ alignItems: "flex-start", gap: 10 }}>
          <span
            className="stage-dot"
            style={{
              marginTop: 6,
              background: s.positive ? "var(--good)" : s.severity === "high" ? "var(--hot)" : s.severity === "medium" ? "var(--warm)" : "var(--cool)",
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{s.label}</div>
            {s.detail && <div className="muted small">{s.detail}</div>}
            {s.pitch && (
              <div className="small" style={{ color: "var(--brand-ink)", marginTop: 2 }}>
                Sell: {s.pitch}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
