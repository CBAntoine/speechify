import { DEMO, PRICES, features, hasPublicUrl } from "../config.ts";
import { addApproval, getSettings, kvGet, kvSet, spendForLead, spendSince } from "../db.ts";
import { log } from "../events.ts";
import { getNiche } from "../niches.ts";
import { estimateClaudeUsd } from "../providers/claude.ts";
import { elevenCredits } from "../providers/eleven.ts";
import { notifyOwner } from "../providers/notify.ts";
import type { AgentId, Lead, SiteSpec } from "../types.ts";
import { clip, digits, localDate, localDayStart, localMonthStart } from "../util.ts";
import { postalAddress } from "./shared.ts";

// The Checker: estimates the cost before every paid call and refuses when a
// budget or credit balance would be blown; checks that nothing invented makes
// it into a site and that every email is compliant before it goes out.

export const ESTIMATE = {
  scan: () => PRICES.googleTextSearch * 3,
  reviews: () => PRICES.googleDetails,
  diagnose: () => estimateClaudeUsd(2500, 1800),
  spec: () => estimateClaudeUsd(3500, 4000),
  heroImage: () => PRICES.elevenImage,
  script: () => estimateClaudeUsd(1500, 800),
  voice: (chars: number) => chars * PRICES.elevenPerChar,
  pitch: () => estimateClaudeUsd(3000, 3000),
  reply: () => estimateClaudeUsd(2500, 1500),
  strategy: () => estimateClaudeUsd(6000, 4000),
};

export function budget() {
  const s = getSettings();
  const tz = s.owner.timezone;
  const today = spendSince(localDayStart(tz));
  const month = spendSince(localMonthStart(tz));
  const bump = kvGet<number>(`budget_bump:${localDate(tz)}`) ?? 0;
  const daily = s.budget.dailyUsd + bump;
  return {
    todayUsd: today,
    monthUsd: month,
    dailyUsd: daily,
    monthlyUsd: s.budget.monthlyUsd,
    dailyLeft: Math.max(0, daily - today),
    monthlyLeft: Math.max(0, s.budget.monthlyUsd - month),
  };
}

export type Verdict = { ok: true } | { ok: false; reason: string };

/** Ask before spending. Free work (demo mode, local rendering) always passes. */
export function preflight(usd: number, opts: { agent: AgentId; what: string; lead?: Pick<Lead, "id" | "name"> }): Verdict {
  if (usd <= 0) return { ok: true };
  const s = getSettings();
  const b = budget();
  let reason: string | undefined;
  if (b.todayUsd + usd > b.dailyUsd) reason = `today's budget of $${b.dailyUsd.toFixed(2)} is used up ($${b.todayUsd.toFixed(2)} spent)`;
  else if (b.monthUsd + usd > b.monthlyUsd) reason = `this month's budget of $${b.monthlyUsd.toFixed(0)} is used up`;
  else if (opts.lead && spendForLead(opts.lead.id) + usd > s.budget.perLeadMaxUsd) reason = `this lead would pass the $${s.budget.perLeadMaxUsd.toFixed(2)} per-lead cap`;
  if (!reason) return { ok: true };
  overBudget(reason, opts);
  return { ok: false, reason };
}

function overBudget(reason: string, opts: { agent: AgentId; what: string; lead?: Pick<Lead, "id" | "name"> }) {
  const s = getSettings();
  const day = localDate(s.owner.timezone);
  const key = `budget_warned:${day}:${reason.slice(0, 20)}`;
  if (kvGet(key)) return;
  kvSet(key, true);
  log("checker", `Held ${opts.what}: ${reason}.`, { level: "warn", lead: opts.lead });
  if (reason.startsWith("today")) {
    addApproval({ kind: "spend", title: "Raise today's budget by $10?", detail: `The crew paused paid work because ${reason}. Approve to allow $10 more today; it resets tomorrow.`, amountCents: 1000 });
    void notifyOwner({ title: "Daily budget reached", body: `The crew paused paid work: ${reason}. Approve more in the app or let it resume tomorrow.`, priority: "default", path: "#/approvals", dedupeKey: key });
  }
}

/** Is there enough ElevenLabs balance for this many characters? */
export async function elevenPreflight(chars: number, lead?: Pick<Lead, "id" | "name">): Promise<Verdict> {
  const c = await elevenCredits();
  if (!c || c.limit === 0) return { ok: true }; // unknown balance: let the API decide
  if (c.remaining < chars + 1500) {
    const reason = `ElevenLabs credits are low (${c.remaining.toLocaleString()} left${c.resetsAt ? `, resets ${new Date(c.resetsAt).toDateString()}` : ""})`;
    const key = `eleven_low:${localDate(getSettings().owner.timezone)}`;
    if (!kvGet(key)) {
      kvSet(key, true);
      log("checker", `${reason}. Videos will use a silent track with captions until it refills.`, { level: "warn", lead });
      void notifyOwner({ title: "ElevenLabs credits low", body: reason, priority: "default", dedupeKey: key });
    }
    return { ok: false, reason };
  }
  return { ok: true };
}

// ── Fact checks ──────────────────────────────────────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/[“”"'’‘]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Numbers the facts actually contain (rating, review count, hours, phone, address). */
function knownNumbers(lead: Lead): Set<string> {
  const blob = [lead.rating?.toFixed(1), String(lead.reviewCount ?? ""), lead.phone, lead.address, ...(lead.hours ?? []), lead.name, lead.city].join(" ");
  return new Set(blob.match(/\d+(?:\.\d+)?/g) ?? []);
}

function hasUnknownNumber(text: string, known: Set<string>): boolean {
  for (const n of text.match(/\d+(?:\.\d+)?/g) ?? []) if (!known.has(n) && !(n.length === 1 && Number(n) <= 7)) return true;
  return false;
}

/** Make the Builder's plan safe: real testimonials only, no invented numbers, sane lengths and counts. */
export function validateSpec(raw: SiteSpec, lead: Lead): { spec: SiteSpec; problems: string[] } {
  const problems: string[] = [];
  const spec: SiteSpec = structuredClone(raw);
  const known = knownNumbers(lead);
  const niche = getNiche(lead.niche);

  const reviews = (lead.reviews ?? []).map((r) => ({ ...r, n: norm(r.text) }));
  spec.testimonials = spec.testimonials.filter((t) => {
    const parts = t.quote.split(/…|\.\.\./).map(norm).filter((p) => p.length > 8);
    const match = reviews.find((r) => parts.length > 0 && parts.every((p) => r.n.includes(p)));
    if (!match) problems.push(`Dropped a testimonial that isn't in their reviews: "${clip(t.quote, 60)}"`);
    else t.author = match.author;
    return Boolean(match);
  }).slice(0, 3);

  const scrub = (text: string, field: string): string => {
    const sentences = text.split(/(?<=[.!?])\s+/);
    const kept = sentences.filter((s) => {
      const bad = hasUnknownNumber(s, known) || /\b(since|established|founded|est\.)\s+(in\s+)?\d{4}\b|\b\d+\+?\s+years\b|award|certified|licensed and insured|#1|number one|best in/i.test(s);
      if (bad) problems.push(`Removed an unverifiable claim from ${field}: "${clip(s, 60)}"`);
      return !bad;
    });
    return kept.join(" ").trim();
  };
  spec.about.body = scrub(spec.about.body, "about") || `${lead.name} is a local ${niche.label.toLowerCase()} serving ${lead.city} and the surrounding area.`;
  spec.heroSubheadline = scrub(spec.heroSubheadline, "subheadline") || `${niche.label} in ${lead.city}. Call or book online.`;
  spec.highlights = spec.highlights.filter((h) => {
    const bad = hasUnknownNumber(`${h.label} ${h.detail}`, known) || /award|certified|#1|best/i.test(`${h.label} ${h.detail}`);
    if (bad) problems.push(`Removed a highlight that isn't backed by facts: "${h.label}"`);
    return !bad;
  });
  const generic = [
    { label: "Local and independent", detail: `Proudly serving ${lead.city}` },
    { label: "Easy to reach", detail: lead.phone ? `Call ${lead.phone}` : "Send us a message any time" },
    { label: "Straight answers", detail: "Clear pricing before any work starts" },
  ];
  while (spec.highlights.length < 3) spec.highlights.push(generic[spec.highlights.length] ?? generic[0]);
  spec.highlights = spec.highlights.slice(0, 3);
  for (const f of spec.faq) f.a = scrub(f.a, "FAQ") || "Give us a call and we'll walk you through it.";

  const phoneDigits = digits(lead.phone);
  for (const s of spec.services) s.blurb = clip(s.blurb.replace(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, (m) => (digits(m) === phoneDigits ? m : "")), 220);
  if (spec.services.length < 3) for (const s of niche.services) if (spec.services.length < 3 && !spec.services.some((x) => x.name === s.name)) spec.services.push({ name: s.name, blurb: `Ask us about ${s.name.toLowerCase()}.`, icon: s.icon });
  spec.services = spec.services.slice(0, 6);
  spec.faq = spec.faq.slice(0, 4);
  spec.businessName = lead.name;
  spec.tagline = clip(spec.tagline, 60);
  spec.heroHeadline = clip(spec.heroHeadline, 70);
  spec.heroSubheadline = clip(spec.heroSubheadline, 170);
  spec.seo.title = clip(spec.seo.title, 60);
  spec.seo.description = clip(spec.seo.description, 155);
  return { spec, problems };
}

/** Rendered pages must never show a broken value or a leftover placeholder. */
export function checkHtml(html: string): string[] {
  const body = html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "");
  const text = body.replace(/<[^>]+>/g, " ");
  const problems: string[] = [];
  if (/\b(undefined|NaN)\b/.test(text) || /=["'](undefined|NaN)["']/.test(body)) problems.push("The page shows an empty value (undefined or NaN).");
  if (body.includes("[object Object]")) problems.push("The page shows [object Object].");
  if (/\{proposal_link\}|\{claim_link\}|\{\{/.test(body)) problems.push("The page still has a placeholder.");
  return problems;
}

/** What every commercial email needs before it can go out. */
export function emailProblems(text: string): string[] {
  const s = getSettings();
  const p: string[] = [];
  const address = postalAddress(s);
  if (!address) p.push("Your postal address is missing (Settings → You). Commercial email must include it.");
  else if (!text.includes(address)) p.push("The postal address isn't in the email.");
  if (!/\/u\/[A-Za-z0-9_-]+/.test(text)) p.push("The unsubscribe link is missing.");
  if (/\{[a-z_]+\}|\[[A-Z][^\]]{2,30}\]|\bundefined\b/.test(text)) p.push("The email still has a placeholder in it.");
  if (!(s.owner.name || s.owner.agencyName)) p.push("Your name or agency name is missing.");
  return p;
}

/** Can the Pitcher send real email right now? (Demo mode only simulates.) */
export function realSendBlockers(): string[] {
  if (DEMO) return [];
  const s = getSettings();
  const out: string[] = [];
  if (!features.resend) out.push("Add RESEND_API_KEY and MAIL_FROM to send email.");
  if (!hasPublicUrl()) out.push("Set PUBLIC_URL to your public https address so proposal links work.");
  if (!s.owner.postalAddress.trim()) out.push("Add your postal address in Settings.");
  if (!s.owner.email.trim()) out.push("Add your email in Settings so replies and alerts reach you.");
  return out;
}
