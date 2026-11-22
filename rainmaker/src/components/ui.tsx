import type { ReactNode } from "react";
import {
  Activity, Bug, Calculator, Car, Compass, Dumbbell, HeartPulse, House, KeyRound, Megaphone, PawPrint, PenLine,
  Radar, Scale, Scissors, Sparkles, SprayCan, Store, Thermometer, ToothbrushSparkles, Trees, TrendingUp,
  UtensilsCrossed, Wrench, type LucideIcon,
} from "lucide-react";

// Only the icons niches and agents use, so the client bundle stays small.
const ICONS: Record<string, LucideIcon> = {
  Activity, Bug, Calculator, Car, Compass, Dumbbell, HeartPulse, House, KeyRound, Megaphone, PawPrint, PenLine,
  Radar, Scale, Scissors, Sparkles, SprayCan, Store, Thermometer, ToothbrushSparkles, Trees, UtensilsCrossed, Wrench,
};
import { tierOf, topSignals } from "@/lib/prospecting/score";
import type { Signal } from "@/lib/types";

/** Look up a lucide icon by name (used for niche and agent icons). */
export function DynIcon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const Ico = ICONS[name] ?? Store;
  return <Ico size={size} className={className} aria-hidden />;
}

export function ScoreRing({ score, size = "md" }: { score?: number; size?: "md" | "sm" }) {
  const px = size === "sm" ? 34 : 44;
  const stroke = size === "sm" ? 3.5 : 4;
  const r = (px - stroke) / 2;
  const c = 2 * Math.PI * r;
  const t = tierOf(score);
  const color = t.id === "hot" ? "var(--hot)" : t.id === "warm" ? "var(--warm)" : "var(--cool)";
  const pct = Math.max(0, Math.min(100, score ?? 0)) / 100;
  return (
    <div className={`score ${size === "sm" ? "sm" : ""}`} title={score === undefined ? "Not scored yet" : `Opportunity score ${score}/100 (${t.label})`}>
      <svg width={px} height={px} viewBox={`0 0 ${px} ${px}`} aria-hidden>
        <circle cx={px / 2} cy={px / 2} r={r} fill="none" stroke="var(--sunken)" strokeWidth={stroke} />
        <circle
          cx={px / 2}
          cy={px / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
        />
      </svg>
      <span style={{ color }}>{score ?? "–"}</span>
    </div>
  );
}

export function TierBadge({ score }: { score?: number }) {
  const t = tierOf(score);
  const cls = t.id === "hot" ? "hot" : t.id === "warm" ? "warm" : "";
  return <span className={`badge ${cls}`}>{t.label}</span>;
}

export function SignalChips({ signals, max = 3, showPositive = true }: { signals?: Signal[]; max?: number; showPositive?: boolean }) {
  const gaps = topSignals(signals, max);
  const pos = showPositive ? (signals ?? []).filter((s) => s.positive).slice(0, 1) : [];
  if (!gaps.length && !pos.length) return <div className="faint small">No gaps found yet</div>;
  return (
    <div className="chips">
      {gaps.map((s) => (
        <span key={s.id} className={`chip ${s.severity === "high" ? "high" : s.severity === "medium" ? "medium" : ""}`} title={s.detail}>
          {s.label}
        </span>
      ))}
      {pos.map((s) => (
        <span key={s.id} className="chip positive" title={s.detail}>
          <TrendingUp size={12} aria-hidden /> {s.label}
        </span>
      ))}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="icon-tile lg">{icon}</div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Stat({ icon, label, value, sub, tone = "brand" }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; tone?: "brand" | "good" | "hot" | "violet" | "teal" }) {
  const bg = { brand: "var(--brand-soft)", good: "var(--good-soft)", hot: "var(--hot-soft)", violet: "var(--violet-soft)", teal: "var(--teal-soft)" }[tone];
  const fg = { brand: "var(--brand)", good: "var(--good)", hot: "var(--hot)", violet: "var(--violet)", teal: "var(--teal)" }[tone];
  return (
    <div className="card stat">
      <div className="k">
        <span className="icon-tile" style={{ background: bg, color: fg }}>
          {icon}
        </span>
        {label}
      </div>
      <div className="v">{value}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}

export function AgentAvatar({ icon, color, size = "md" }: { icon: string; color: string; size?: "md" | "sm" }) {
  return (
    <span className={`avatar ${size === "sm" ? "sm" : ""}`} style={{ background: `linear-gradient(145deg, color-mix(in srgb, ${color} 75%, white), ${color})` }}>
      <DynIcon name={icon} size={size === "sm" ? 14 : 18} />
    </span>
  );
}

export function PageHead({ title, sub, actions, keepTitle }: { title: string; sub?: ReactNode; actions?: ReactNode; keepTitle?: boolean }) {
  return (
    <div className={`page-head ${keepTitle ? "keep-title" : ""}`}>
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="head-actions">{actions}</div>}
    </div>
  );
}

export function RainMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M7.5 15.5c-2.5 0-4.5-1.9-4.5-4.3 0-2.2 1.7-4 3.9-4.3C7.7 4.6 9.7 3 12 3c2.9 0 5.3 2.2 5.6 5 2 .3 3.4 2 3.4 4 0 2-1.6 3.5-3.6 3.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M9 18.5 8 21M13 17.5l-1 3.5M17 18.5 16 21" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

/** An on/off switch with a label and an optional hint underneath. */
export function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className="toggle-row">
      <span>
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </span>
      <span className="switch">
        <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      </span>
    </label>
  );
}
