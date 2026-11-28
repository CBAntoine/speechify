import { DEMO } from "./config.ts";
import { addCost, addMessage, addPayment, addScan, countByStatus, getSettings, insertEvent, saveLead } from "./db.ts";
import { getNiche } from "./niches.ts";
import { demoSearch } from "./providers/places/demo.ts";
import type { Lead, LeadStatus, ReplyAnalysis } from "./types.ts";
import { newId, token } from "./util.ts";

// Demo mode only: two weeks of believable history (scans, pitches, replies,
// a few sales) so the dashboard and Atlas have something to talk about from
// the first minute. Every record is fictional and tagged "Demo history".

const REPLIES: { text: string; a: ReplyAnalysis; then: LeadStatus }[] = [
  { text: "This looks great. Do you handle the domain too?", a: { intent: "question", summary: "Likes it; asked about the domain.", suggestedReply: "", needsHuman: false }, then: "negotiating" },
  { text: "Yes, let's do it. How do I pay?", a: { intent: "ready_to_buy", summary: "Wants to go ahead.", suggestedReply: "", needsHuman: false }, then: "won" },
  { text: "Thanks, but we already have someone working on it.", a: { intent: "not_interested", summary: "Already has someone.", suggestedReply: "", needsHuman: false }, then: "lost" },
  { text: "Can you call me Thursday afternoon?", a: { intent: "wants_call", summary: "Asked for a call Thursday afternoon.", suggestedReply: "", needsHuman: true }, then: "negotiating" },
  { text: "How much is it after the first year?", a: { intent: "question", summary: "Asked about ongoing costs.", suggestedReply: "", needsHuman: false }, then: "negotiating" },
];

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a * 1664525 + 1013904223) % 4294967296;
    return a / 4294967296;
  };
}

export function seedDemoHistory(days = 12): number {
  if (!DEMO) throw new Error("History is only seeded in demo mode.");
  if (Object.values(countByStatus()).some((n) => (n ?? 0) > 0)) return 0;
  const s = getSettings();
  const r = rng(20261128);
  let made = 0;
  let replyIdx = 0;
  for (let d = days; d >= 1; d--) {
    const day = new Date(Date.now() - d * 86_400_000);
    day.setUTCHours(15, 0, 0, 0);
    const at = (minutes: number) => new Date(day.getTime() + minutes * 60_000).toISOString();
    const city = s.targets.cities[d % s.targets.cities.length];
    const niche = s.targets.niches[d % s.targets.niches.length];
    const found = demoSearch({ niche, city: city.city, region: city.region, country: city.country, max: 40, seed: `history-${d}` });
    const scanned = 180 + Math.floor(r() * 50);
    addScan({ city: city.city, region: city.region, niche: `history-${niche}`, found: scanned, added: found.length, ts: at(5) });
    insertEvent({ ts: at(5), agent: "scout", level: "info", message: `Scanned ${scanned} businesses in ${city.city}, ${city.region} (${getNiche(niche).plural} and more).` });
    const pitches = Math.min(found.length, 9 + Math.floor(r() * 6));
    for (let i = 0; i < pitches; i++) {
      const b = found[i];
      const lead: Lead = {
        id: newId("ld"),
        source: "demo",
        sourceId: `${b.sourceId}:history`,
        name: b.name,
        niche,
        city: city.city,
        region: city.region,
        country: city.country,
        address: b.address,
        phone: b.phone,
        email: b.demo?.email ?? `hello@${b.sourceId.split(":").pop()}.example`,
        website: b.website,
        rating: b.rating,
        reviewCount: b.reviewCount,
        status: "pitched",
        websiteState: b.demo?.state === "modern" ? "outdated" : b.demo?.state,
        score: 60 + Math.floor(r() * 30),
        priceCents: s.offer.priceCents,
        proposalToken: token(9),
        followupsSent: 2,
        firstPitchAt: at(60 + i * 9),
        lastContactAt: at(60 + i * 9),
        notes: "Demo history",
        createdAt: at(10),
        updatedAt: at(60 + i * 9),
      };
      addMessage({ leadId: lead.id, channel: "email", direction: "out", kind: "pitch", subject: `made ${lead.name} a new website`, body: "(demo history)", status: "sent", sentAt: at(60 + i * 9), createdAt: at(50) });
      if (r() < 0.15) {
        const rep = REPLIES[replyIdx++ % REPLIES.length];
        addMessage({ leadId: lead.id, channel: "email", direction: "in", kind: "inbound", subject: `Re: made ${lead.name} a new website`, body: rep.text, status: "received", analysis: rep.a, createdAt: at(60 + i * 9 + 90 + Math.floor(r() * 240)) });
        lead.status = rep.then;
        if (rep.then === "won") {
          lead.dealValueCents = s.offer.priceCents;
          addPayment({ leadId: lead.id, provider: "demo", externalId: `history_${lead.id}`, amountCents: s.offer.priceCents, currency: s.offer.currency, status: "paid", createdAt: at(60 + i * 9 + 400) });
          insertEvent({ ts: at(60 + i * 9 + 400), agent: "closer", level: "success", leadId: lead.id, leadName: lead.name, message: `Paid $${s.offer.priceCents / 100}. Launched their site.` });
        }
      } else if (d > 3) {
        lead.status = "lost";
        lead.skipReason = "No reply after the full sequence";
      } else lead.followupsSent = 0;
      saveLead(lead);
      made++;
    }
    insertEvent({ ts: at(420), agent: "pitcher", level: "info", message: `Sent ${pitches} pitches today.` });
    for (const [provider, agent, usd] of [
      ["google", "scout", 0.35],
      ["anthropic", "builder", 2.4 + r() * 1.5],
      ["elevenlabs", "filmer", 1.2 + r()],
      ["anthropic", "pitcher", 0.9 + r() * 0.5],
    ] as const) {
      addCost({ provider, agent, usd: Math.round(usd * 100) / 100, note: "demo history", ts: at(400) });
    }
  }
  return made;
}
