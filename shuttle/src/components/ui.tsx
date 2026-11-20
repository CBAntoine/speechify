import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

const PATHS: Record<string, ReactNode> = {
  record: <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6.5" y="5.5" width="3.5" height="13" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="5.5" width="3.5" height="13" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  play: <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  camera: (
    <>
      <rect x="3" y="6.5" width="13" height="11" rx="2.5" />
      <path d="m16 10.5 5-3v9l-5-3" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12.5" rx="2" />
      <path d="M8.5 20.5h7M12 16.5v4" />
    </>
  ),
  flag: <path d="M5.5 21V4.5M5.5 4.5h11l-2 4 2 4h-11" />,
  scissors: (
    <>
      <circle cx="6.5" cy="7" r="2.5" />
      <circle cx="6.5" cy="17" r="2.5" />
      <path d="M8.6 8.4 20 17M8.6 15.6 20 7" />
    </>
  ),
  zoom: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5.5 5.5M10.5 8v5M8 10.5h5" />
    </>
  ),
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />,
  download: <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" />,
  share: <path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5M6 12v7.5h12V12" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="6.3" />
      <circle cx="12" cy="12" r="2.4" />
      <path
        strokeWidth={3.2}
        strokeLinecap="butt"
        d="M12 2.6v3.2M12 18.2v3.2M2.6 12h3.2M18.2 12h3.2M5.35 5.35l2.26 2.26M16.39 16.39l2.26 2.26M5.35 18.65l2.26-2.26M16.39 7.61l2.26-2.26"
      />
    </>
  ),
  x: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  back: <path d="M15 5.5 8.5 12l6.5 6.5" />,
  sparkles: <path d="M12 3.5 13.6 9l5.4 1.6-5.4 1.6L12 17.5l-1.6-5.3L5 10.6 10.4 9zM18.5 15.5l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7z" />,
  captions: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="M10.5 10.2a2.3 2.3 0 1 0 0 3.6M17 10.2a2.3 2.3 0 1 0 0 3.6" />
    </>
  ),
  undo: <path d="M9 7.5 4.5 12 9 16.5M4.5 12H15a4.5 4.5 0 0 1 0 9h-2" />,
  redo: <path d="M15 7.5 19.5 12 15 16.5M19.5 12H9a4.5 4.5 0 0 0 0 9h2" />,
  wave: <path d="M3 12h2M7 8v8M10 5v14M13 9v6M16 7v10M19 11v2M21 12h0" />,
  pip: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="12" y="11.5" width="7" height="5.5" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  film: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M7.5 4v16M16.5 4v16M3.5 8h4M3.5 12h4M3.5 16h4M16.5 8h4M16.5 12h4M16.5 16h4" />
    </>
  ),
  restart: <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4" />,
  fullscreen: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  notes: <path d="M6 3.5h9l3.5 3.5v13.5H6zM9 11h6.5M9 14.5h6.5M9 18h4" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4M18.7 18.7l-1.4-1.4M6.7 6.7 5.3 5.3" />
    </>
  ),
  moon: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />,
  eye: (
    <>
      <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  eyeOff: <path d="M3 3l18 18M10.6 5.6A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 4M6.2 6.6C3.9 8.3 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.6 0 3-.4 4.3-1" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  speed: <path d="M4.5 16.5a8 8 0 1 1 15 0M12 13l4-4.5" />,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

type Variant = 'primary' | 'record' | 'ghost' | 'quiet' | 'danger';

export function Button({
  variant = 'quiet',
  icon,
  children,
  className = '',
  size,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: IconName; size?: 'sm' | 'lg' }) {
  return (
    <button type="button" className={`btn btn-${variant} ${size ? `btn-${size}` : ''} ${!children ? 'btn-icon' : ''} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={size === 'lg' ? 20 : size === 'sm' ? 15 : 17} />}
      {children && <span>{children}</span>}
    </button>
  );
}

/** Two-step destructive action without a modal: click, then confirm within 4 s. */
export function ConfirmButton({
  onConfirm,
  label,
  confirmLabel,
  icon = 'trash',
  variant = 'quiet',
  size,
  title,
}: {
  onConfirm: () => void;
  label?: string;
  confirmLabel: string;
  icon?: IconName;
  variant?: Variant;
  size?: 'sm' | 'lg';
  title?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button
      variant={armed ? 'danger' : variant}
      icon={armed ? 'check' : icon}
      size={size}
      title={title}
      aria-label={!label && !armed ? title : undefined}
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}
    >
      {armed ? confirmLabel : label}
    </Button>
  );
}

export function Toggle({
  id,
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={`toggle ${disabled ? 'is-disabled' : ''}`} htmlFor={id}>
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {hint && <span className="toggle-hint">{hint}</span>}
      </span>
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
    </label>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  id,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  onChange: (v: T) => void;
  label: string;
  id: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label} id={id}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          className={o.value === value ? 'is-on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

/** Live input level, 0..1 RMS mapped onto a dB scale. */
export function LevelMeter({ read, active = true }: { read: () => number; active?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let shown = 0;
    const tick = () => {
      const rms = read();
      const db = 20 * Math.log10(Math.max(rms, 1e-5));
      const v = Math.min(1, Math.max(0, (db + 60) / 54));
      shown = v > shown ? v : shown * 0.9 + v * 0.1;
      ref.current?.style.setProperty('--level', String(shown));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [read, active]);
  return (
    <div className="meter" ref={ref} role="presentation">
      <div className="meter-fill" />
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner" role="status">
      <span className="spinner-ring" aria-hidden="true" />
      {label && <span>{label}</span>}
    </span>
  );
}

export function Progress({ value, label }: { value: number; label?: string }) {
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} aria-label={label}>
      <div className="progress-fill" style={{ transform: `scaleX(${Math.max(0, Math.min(1, value))})` }} />
    </div>
  );
}

export function Notice({ tone = 'info', children, onClose }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode; onClose?: () => void }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div className="notice-body">{children}</div>
      {onClose && <Button icon="x" variant="ghost" size="sm" aria-label="Dismiss" onClick={onClose} />}
    </div>
  );
}
