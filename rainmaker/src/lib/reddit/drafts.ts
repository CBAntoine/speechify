// What you send someone who asked on Reddit: a helpful public reply (with
// your affiliation disclosed), or, when they named their business or shared
// an email, a two-line email about their exact post. Templates for when
// Claude isn't connected; Claude's versions follow the same rules. Pure.

import type { AgencyProfile, RedditSignal } from "../types.ts";

const PHRASED: Record<string, string> = {
  website: "a new website",
  review: "getting more reviews",
  reviews: "getting more reviews",
  receptionist: "an answering service",
  "answering service": "an answering service",
  chatbot: "a website chatbot",
  "booking system": "online booking",
  "lead generation": "more leads",
};

/** "a web designer", "SEO", "Facebook ads": a service term as a phrase. */
function asNeed(term: string): string {
  const k = term.trim().toLowerCase();
  if (PHRASED[k]) return PHRASED[k];
  if (/s$|^[A-Z]{2,}$|ads\b|marketing$|generation$/.test(term.trim())) return term.trim();
  return /^[aeiou]/i.test(term.trim()) ? `an ${term.trim()}` : `a ${term.trim()}`;
}

/** What they asked for, in a few words: Claude's read, else the service terms that matched, else the title. */
export function needOf(s: Pick<RedditSignal, "ai" | "services" | "competitors" | "title">): string {
  if (s.ai?.need) return s.ai.need;
  if (s.services.length) return asNeed(s.services[0]);
  if (s.competitors.length) return `an alternative to ${s.competitors[0]}`;
  return s.title.replace(/[?!.]+$/, "").slice(0, 60);
}

export function templateReply(s: RedditSignal, profile: Pick<AgencyProfile, "agencyName" | "proof" | "services">): string {
  const need = needOf(s);
  const lines = [
    s.urgent ? `If it's urgent, the fastest way to avoid getting burned is to ask anyone you talk to for two recent clients you can call.` : `A couple of things that usually decide it for ${need}: who exactly does the work, and how they report results each month.`,
    s.competitors.length ? `If you're moving off ${s.competitors[0]}, make sure you own your accounts and data before you switch.` : `Ask for a short written plan before you pay anything.`,
    `Full disclosure: I run ${profile.agencyName} and we help with exactly this.${profile.proof?.trim() ? ` ${profile.proof.trim()}` : ""} Happy to answer questions here either way.`,
  ];
  return lines.join(" ");
}

export function templateEmail(s: RedditSignal, profile: Pick<AgencyProfile, "agencyName" | "ownerName" | "proof" | "mailingAddress">, name?: string): { subject: string; body: string } {
  const need = needOf(s);
  const hi = name ? `Hey ${name.split(/\s+/)[0]},` : "Hey,";
  const proof = profile.proof?.trim() ? ` ${profile.proof.trim().replace(/\.?$/, ".")}` : "";
  const sender = profile.ownerName || profile.agencyName;
  return {
    subject: `Your post in r/${s.subreddit}`.slice(0, 60),
    body: [
      hi,
      "",
      `Saw your post in r/${s.subreddit} about ${need}${s.urgent ? " (sounded urgent)" : ""}. We do exactly that at ${profile.agencyName}.${proof} Free 15-minute call this week?`,
      "",
      sender,
      ...(profile.ownerName ? [profile.agencyName] : []),
      profile.mailingAddress?.trim() || "[agency postal address]",
      "",
      `Not interested? Reply "no" and I won't follow up.`,
    ].join("\n"),
  };
}

/** The sign-off commercial email needs: who it's from, the postal address, and an easy opt-out. */
export function withSignature(body: string, profile: Pick<AgencyProfile, "agencyName" | "ownerName" | "mailingAddress">): string {
  let out = body.trim();
  const sender = profile.ownerName || profile.agencyName;
  if (!out.includes(sender)) out += `\n\n${sender}${profile.ownerName ? `\n${profile.agencyName}` : ""}`;
  if (!out.includes(profile.mailingAddress?.trim() || "[agency postal address]")) out += `\n${profile.mailingAddress?.trim() || "[agency postal address]"}`;
  if (!/not interested\?/i.test(out)) out += `\n\nNot interested? Reply "no" and I won't follow up.`;
  return out;
}
