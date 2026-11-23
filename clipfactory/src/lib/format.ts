export function pad2(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, "0");
}

/** 59.16 → "00:59.16", 3723.5 → "1:02:03.50". */
export function timecode(sec: number): string {
  const s = Math.max(0, sec || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const whole = Math.floor(s % 60);
  const cs = Math.floor((s - Math.floor(s)) * 100);
  const tail = `${pad2(whole)}.${pad2(cs)}`;
  return h > 0 ? `${h}:${pad2(m)}:${tail}` : `${pad2(m)}:${tail}`;
}

/** 77 → "01:17", 3723 → "1:02:03". */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${pad2(m)}:${pad2(s % 60)}`;
}

/** 209_900 → "209.9K". */
export function compact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(Math.round(n));
}

export function seconds(sec: number): string {
  return `${(Math.round(sec * 10) / 10).toFixed(1)} s`;
}

/** "Mr. Somebody's GTA RP Stream!!" → "MR_SOMEBODYS_GTA_RP_STREAM" */
export function projectSlug(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
    .slice(0, 28)
    .replace(/_+$/g, "");
  return slug || "UNTITLED";
}
