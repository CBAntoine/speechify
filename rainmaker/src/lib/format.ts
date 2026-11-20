// Formatting helpers shared by server and client components.

export function money(n: number | undefined, opts: { compact?: boolean } = {}): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  if (opts.compact && Math.abs(n) >= 10_000) return `$${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function timeAgo(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.round((now - t) / 1000);
  if (s < -86400) return `in ${Math.round(-s / 86400)}d`;
  if (s < -3600) return `in ${Math.round(-s / 3600)}h`;
  if (s < 0) return "soon";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function dueLabel(iso: string | undefined, now = new Date()): { text: string; overdue: boolean } {
  if (!iso) return { text: "No due date", overdue: false };
  const d = new Date(iso);
  const day = (x: Date) => Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86400_000);
  const diff = day(d) - day(now);
  if (diff < 0) return { text: diff === -1 ? "Yesterday" : `${-diff} days overdue`, overdue: true };
  if (diff === 0) return { text: "Today", overdue: false };
  if (diff === 1) return { text: "Tomorrow", overdue: false };
  return { text: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }), overdue: false };
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/i.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** Stable pleasant color from a string, for logos and avatars. */
export function hue(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 45%)`;
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
