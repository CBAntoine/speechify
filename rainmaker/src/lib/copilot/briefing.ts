import type { Db } from "../types.ts";

// What the copilot says when it opens: what changed since the owner last
// talked to it, in one short spoken sentence. Pure, unit tested.

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function list(parts: string[]): string {
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function buildBriefing(db: Db, since: string | undefined, now = new Date()): string {
  const t0 = since ? Date.parse(since) : now.getTime() - 86_400_000;
  const after = (iso?: string) => Boolean(iso) && Date.parse(iso!) > t0;
  const parts: string[] = [];

  const sales = db.orders.filter((o) => after(o.createdAt) && o.status === "active").length;
  if (sales) parts.push(plural(sales, "new paying client"));
  const replied = db.activity.filter((a) => a.kind === "stage" && after(a.at) && /moved to (Replied|Meeting)/.test(a.text)).length;
  if (replied) parts.push(plural(replied, "lead") + " replied or booked a meeting");
  const buyers = (db.reddit?.signals ?? []).filter((s) => s.status === "new" && after(s.foundAt)).length;
  if (buyers) parts.push(`${plural(buyers, "Reddit post")} asking for what you sell`);
  const leads = db.leads.filter((l) => !l.sample && after(l.createdAt)).length;
  if (leads) parts.push(plural(leads, "new lead"));
  const drafts = db.drafts.filter((d) => d.status === "pending").length;
  if (drafts) parts.push(`${plural(drafts, "draft")} waiting for your approval`);
  const today = now.toISOString().slice(0, 10);
  const due = db.tasks.filter((t) => !t.done && t.due && t.due.slice(0, 10) <= today).length;
  if (due) parts.push(`${plural(due, "task")} due`);
  const ending = db.leads.find((l) => {
    const end = l.guide?.trial ? Date.parse(l.guide.trial.endsAt) : NaN;
    return end > now.getTime() && end - now.getTime() < 3 * 86_400_000;
  });
  if (ending) parts.push(`${ending.name}'s AI guide trial ends soon`);

  if (!parts.length) return since ? "All quiet since your last visit." : "Nothing new in the last day.";
  return `${since ? "Since your last visit" : "In the last day"}: ${list(parts.slice(0, 3))}.`;
}

/**
 * When a briefing counts from. Sessions within half an hour of each other
 * (switching from typing to voice) share one, so the second greeting isn't
 * "all quiet".
 */
export function briefingWindow(c: { lastSessionAt?: string; briefSince?: string } | undefined, now = new Date()): { since?: string; next: { lastSessionAt: string; briefSince?: string } } {
  const last = c?.lastSessionAt;
  const recent = Boolean(last) && now.getTime() - Date.parse(last!) < 30 * 60_000;
  // Within half an hour: the same window as the session before (none means "the last day").
  const since = recent ? c?.briefSince : last;
  return { since, next: { lastSessionAt: now.toISOString(), briefSince: since } };
}
