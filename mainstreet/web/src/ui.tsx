// Shared building blocks: buttons, chips, cards, KPI tiles, dialogs, toasts.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import {
  Check,
  Clapperboard,
  Compass,
  Copy,
  Hammer,
  Handshake,
  LoaderCircle,
  Radar,
  Send,
  ShieldCheck,
  Star,
  Stethoscope,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AgentId, LeadStatus, WebsiteState } from "./api";
import { STATE_LABEL, STATE_TONE, STATUS_LABEL, STATUS_TONE, scoreTone } from "./format";
import { closeDialog, dismissToast, useStore } from "./store";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ── Buttons ──────────────────────────────────────────────────────────────

type Tone = "default" | "primary" | "ghost" | "danger" | "money" | "quiet";

export function Button({
  tone = "default",
  size,
  icon: Icon,
  busy,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; size?: "sm" | "lg"; icon?: LucideIcon; busy?: boolean }) {
  return (
    <button type="button" className={cx("btn", `btn-${tone}`, size && `btn-${size}`, !children && "btn-icon", className)} aria-busy={busy || undefined} disabled={busy || rest.disabled} {...rest}>
      {busy ? <LoaderCircle size={16} className="spin" aria-hidden /> : Icon ? <Icon size={16} aria-hidden /> : null}
      {children}
    </button>
  );
}

export function LinkButton({ href, tone = "default", size, icon: Icon, children, external, className }: { href: string; tone?: Tone; size?: "sm" | "lg"; icon?: LucideIcon; children?: ReactNode; external?: boolean; className?: string }) {
  return (
    <a className={cx("btn", `btn-${tone}`, size && `btn-${size}`, !children && "btn-icon", className)} href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {Icon ? <Icon size={16} aria-hidden /> : null}
      {children}
    </a>
  );
}

/** Run an async action with a busy flag (one at a time). */
export function useBusy(): [boolean, (fn: () => Promise<unknown>) => Promise<void>] {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const act = useCallback(async (fn: () => Promise<unknown>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);
  return [busy, act];
}

export function CopyButton({ text, label = "Copy", size = "sm" }: { text: string; label?: string; size?: "sm" | "lg" }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size={size}
      tone="ghost"
      icon={done ? Check : Copy}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const t = document.createElement("textarea");
          t.value = text;
          document.body.appendChild(t);
          t.select();
          document.execCommand("copy");
          t.remove();
        }
        setDone(true);
        window.setTimeout(() => setDone(false), 1600);
      }}
      aria-label={label}
    >
      {done ? "Copied" : label}
    </Button>
  );
}

// ── Chips ────────────────────────────────────────────────────────────────

export function Chip({ tone = "grey", children, icon: Icon, title }: { tone?: string; children: ReactNode; icon?: LucideIcon; title?: string }) {
  return (
    <span className={cx("chip", `tone-${tone}`)} title={title}>
      {Icon ? <Icon size={12} aria-hidden /> : null}
      {children}
    </span>
  );
}

export function StatusChip({ status }: { status: LeadStatus }) {
  return <Chip tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Chip>;
}

export function StateChip({ state }: { state?: WebsiteState }) {
  if (!state) return null;
  return <Chip tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Chip>;
}

export function Score({ value }: { value?: number }) {
  if (value === undefined) return null;
  return (
    <span className={cx("score", `tone-${scoreTone(value)}`)} title="Opportunity score (0–100)">
      {Math.round(value)}
    </span>
  );
}

export function Rating({ value, count }: { value?: number; count?: number }) {
  if (!value) return <span className="muted small">No reviews</span>;
  return (
    <span className="rating" title={`${value} stars from ${count ?? 0} reviews`}>
      <Star size={13} aria-hidden className="star" />
      <b className="num">{value.toFixed(1)}</b>
      {count ? <span className="muted">({count.toLocaleString()})</span> : null}
    </span>
  );
}

export function Dot({ tone, pulse, label }: { tone: string; pulse?: boolean; label?: string }) {
  return <span className={cx("dot", `tone-${tone}`, pulse && "pulse")} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

// ── Layout ───────────────────────────────────────────────────────────────

export function PageHeader({ title, sub, actions, back }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="page-head">
      {back}
      <div className="page-head-row">
        <div className="page-head-text">
          <h1>{title}</h1>
          {sub ? <p className="muted">{sub}</p> : null}
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </div>
    </header>
  );
}

export function Card({ title, icon: Icon, action, children, className, id, pad = true }: { title?: ReactNode; icon?: LucideIcon; action?: ReactNode; children: ReactNode; className?: string; id?: string; pad?: boolean }) {
  return (
    <section className={cx("card", !pad && "card-flush", className)} id={id}>
      {title || action ? (
        <div className="card-head">
          {title ? (
            <h2>
              {Icon ? <Icon size={16} aria-hidden /> : null}
              {title}
            </h2>
          ) : (
            <span />
          )}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Kpi({ label, value, sub, tone, children, icon: Icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string; children?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className={cx("kpi", tone && `kpi-${tone}`)}>
      <div className="kpi-label">
        {Icon ? <Icon size={14} aria-hidden /> : null}
        {label}
      </div>
      <div className="kpi-value num">{value}</div>
      {children}
      {sub ? <div className="kpi-sub">{sub}</div> : null}
    </div>
  );
}

export function Progress({ value, max, tone = "green", marker, label }: { value: number; max: number; tone?: string; marker?: number; label?: string }) {
  const p = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const m = marker !== undefined && max > 0 ? Math.min(100, Math.max(0, (marker / max) * 100)) : undefined;
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
      <span className={cx("progress-fill", `tone-${tone}`)} style={{ width: `${p}%` }} />
      {m !== undefined ? <span className="progress-marker" style={{ left: `${m}%` }} /> : null}
    </div>
  );
}

export function Empty({ icon: Icon, title, body, action }: { icon?: LucideIcon; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {Icon ? (
        <span className="empty-icon">
          <Icon size={20} aria-hidden />
        </span>
      ) : null}
      <b>{title}</b>
      {body ? <p className="muted">{body}</p> : null}
      {action}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle size={18} className="spin" aria-hidden /> {label}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="callout tone-red" role="alert">
      <span>{message}</span>
      {onRetry ? (
        <Button size="sm" tone="ghost" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function Skeleton({ h = 16, w = "100%" }: { h?: number; w?: number | string }) {
  return <span className="skeleton" style={{ height: h, width: w }} aria-hidden />;
}

// ── Agents ───────────────────────────────────────────────────────────────

export const AGENT_ICON: Record<AgentId, LucideIcon> = {
  orchestrator: Compass,
  scout: Radar,
  diagnoser: Stethoscope,
  builder: Hammer,
  filmer: Clapperboard,
  pitcher: Send,
  checker: ShieldCheck,
  closer: Handshake,
};

export function AgentBadge({ id, size = 32 }: { id: AgentId | "system" | "owner"; size?: number }) {
  const Icon = id in AGENT_ICON ? AGENT_ICON[id as AgentId] : null;
  return (
    <span className={cx("agent-badge", `agent-${id}`)} style={{ width: size, height: size }} aria-hidden>
      {Icon ? <Icon size={Math.round(size * 0.5)} /> : <span className="agent-badge-text">{id === "owner" ? "You" : "•"}</span>}
    </span>
  );
}

export const STATE_DOT: Record<string, string> = { idle: "grey", working: "green", paused: "amber", error: "red" };

// ── Toasts and dialogs (rendered once by the shell) ─────────────────────

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className={cx("toast", `tone-${t.tone}`)} role={t.tone === "error" ? "alert" : "status"}>
          {t.href ? (
            <a href={t.href} onClick={() => dismissToast(t.id)}>
              {t.text}
            </a>
          ) : (
            <span>{t.text}</span>
          )}
          <button type="button" className="toast-x" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function DialogHost() {
  const dialog = useStore((s) => s.dialog);
  const [values, setValues] = useState<Record<string, string>>({});
  const firstRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!dialog) return;
    const v: Record<string, string> = {};
    for (const f of dialog.fields ?? []) v[f.name] = f.value ?? (f.type === "select" ? (f.options?.[0]?.value ?? "") : "");
    setValues(v);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDialog(null);
    };
    window.addEventListener("keydown", onKey);
    window.setTimeout(() => firstRef.current?.focus(), 30);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog]);

  if (!dialog) return null;
  const fields = dialog.fields ?? [];
  const missing = fields.some((f) => f.required && !values[f.name]?.trim());

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeDialog(null)}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onSubmit={(e) => {
          e.preventDefault();
          if (!missing) closeDialog(values);
        }}
      >
        <h2 id="dialog-title">{dialog.title}</h2>
        {dialog.body ? <p className="dialog-body">{dialog.body}</p> : null}
        {fields.map((f, i) => (
          <label key={f.name} className="field">
            <span className="field-label">{f.label}</span>
            {f.type === "textarea" ? (
              <textarea
                ref={i === 0 ? (el) => {
                        firstRef.current = el;
                      } : undefined}
                className="input"
                rows={5}
                value={values[f.name] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              />
            ) : f.type === "select" ? (
              <select
                ref={i === 0 ? (el) => {
                        firstRef.current = el;
                      } : undefined}
                className="input"
                value={values[f.name] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              >
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                ref={i === 0 ? (el) => {
                        firstRef.current = el;
                      } : undefined}
                className="input"
                type={f.type === "number" ? "number" : "text"}
                inputMode={f.type === "number" ? "decimal" : undefined}
                value={values[f.name] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              />
            )}
            {f.hint ? <span className="field-hint">{f.hint}</span> : null}
          </label>
        ))}
        <div className="dialog-actions">
          <Button tone="ghost" onClick={() => closeDialog(null)}>
            Cancel
          </Button>
          <button
            type="submit"
            className={cx("btn", dialog.tone === "danger" ? "btn-danger" : dialog.tone === "money" ? "btn-money" : "btn-primary")}
            disabled={missing}
            ref={fields.length ? undefined : (el) => {
                        firstRef.current = el;
                      }}
          >
            {dialog.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Form controls (Settings) ─────────────────────────────────────────────

export function Field({ label, hint, error, children, wide }: { label: string; hint?: ReactNode; error?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <label className={cx("field", wide && "field-wide", error ? "field-error" : null)}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-err">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx("toggle", disabled && "is-disabled")}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden>
        <span className="toggle-thumb" />
      </span>
      <span className="toggle-text">
        <span>{label}</span>
        {hint ? <small className="muted">{hint}</small> : null}
      </span>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={cx(value === o.value && "is-on")} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
