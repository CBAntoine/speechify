import "server-only";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { claude, FALLBACK, MODEL, RefusalError } from "./client";
import { getNiche } from "@/lib/niches";
import { domainOf } from "@/lib/net";
import { topSignals } from "@/lib/prospecting/score";
import type { AgencyProfile, Channel, Lead } from "@/lib/types";

export const OutreachSchema = z.object({
  subject: z.string(),
  body: z.string(),
  rationale: z.string(),
  followUps: z.array(z.object({ dayOffset: z.number().int(), subject: z.string(), body: z.string() })),
  sms: z.string(),
  dm: z.string(),
  callScript: z.string(),
  videoScript: z.string(),
});

export type OutreachContent = z.infer<typeof OutreachSchema>;

const SYSTEM = `You write first-touch outreach for a small marketing agency that sells to local businesses. Your messages get replies because they are about the prospect, not the agency.

Rules for every message:
- Open with one specific thing you observed about THIS business (from the findings you are given). Never invent an observation, a visit, a mutual friend or a compliment you can't back up.
- Connect that observation to money or customers they are losing, in one sentence.
- Offer one small, concrete next step (a 2-minute video, a free mockup, a quick audit), not a meeting. The call to action is a yes/no question.
- Email: 60 to 120 words, plain text, no links in the first email except the agency's calendar link if provided, no images, no attachments. Subject line under 50 characters, lowercase is fine, no clickbait, no "Re:" or "Fwd:" tricks.
- End every email with the sender's name and agency, the agency's postal address if given, and a one-line opt-out ("Not interested? Reply 'no' and I won't follow up.").
- Write follow-ups as replies in the same thread: day 3 (new angle or free asset), day 7 (short social proof or a question), day 14 (polite breakup). Each under 70 words.
- SMS: under 300 characters, identify the sender, include "Reply STOP to opt out". DM: under 400 characters, casual.
- Call script: a 2-sentence opener, 3 discovery questions, and short answers to "how much?", "we already have someone" and "send me an email".
- Video audit script (for a 45-second screen recording of their website or listing): greet them by business name, show the 2 biggest gaps on screen in plain words, say what fixing them would mean for bookings, and ask if they want the fix list. Write it as what to say, with [show: ...] cues.
- Never use: "I hope this finds you well", "quick question", "touch base", "synergy", "game-changer", ALL CAPS or more than one exclamation mark.
- Match the agency's voice. Sign with the agency owner's name if given.`;

function prompt(lead: Lead, profile: AgencyProfile, focus: Channel): string {
  const niche = getNiche(lead.niche);
  const gaps = topSignals(lead.signals, 4);
  const lines = [
    `PROSPECT: ${lead.name}${lead.contactName ? ` (contact: ${lead.contactName})` : ""}`,
    `NICHE: ${niche?.label ?? lead.niche}`,
    lead.city || lead.address ? `LOCATION: ${lead.city ?? lead.address}` : "",
    lead.website ? `WEBSITE: ${domainOf(lead.website)}` : "WEBSITE: none found",
    lead.rating !== undefined ? `GOOGLE: ${lead.rating}★ from ${lead.reviewCount ?? 0} reviews` : "",
    "",
    "FINDINGS (verified by our audit; use only these as observations):",
    ...(gaps.length ? gaps.map((g) => `- ${g.label}: ${g.detail ?? ""} (sells: ${g.pitch ?? "n/a"})`) : ["- No audit findings yet. Keep the opener to what is known: their niche and city."]),
    ...(lead.signals ?? []).filter((s) => s.positive).map((s) => `- Positive: ${s.label}: ${s.detail ?? ""}`),
    lead.notes ? `\nNOTES: ${lead.notes}` : "",
    "",
    "THE AGENCY:",
    `- Name: ${profile.agencyName}`,
    profile.ownerName ? `- Sender: ${profile.ownerName}` : "- Sender: (no name set; sign with the agency name)",
    `- Offer: ${profile.coreOffer}`,
    `- Services: ${profile.services.join(", ")}`,
    profile.pricing ? `- Pricing: ${profile.pricing} (don't put prices in a first email)` : "",
    profile.proof ? `- Proof / results: ${profile.proof}` : "- Proof: none given (don't invent any)",
    profile.calendarUrl ? `- Calendar link: ${profile.calendarUrl}` : "",
    profile.mailingAddress ? `- Postal address: ${profile.mailingAddress}` : "- Postal address: none given (write [agency postal address] in the email footer)",
    `- Voice: ${profile.voice}`,
    niche ? `\nNICHE CONTEXT: their usual pain points are: ${niche.painPoints.join("; ")}.` : "",
    "",
    `Write the full sequence. The ${focus === "email" ? "email" : focus === "sms" ? "SMS" : focus === "dm" ? "DM" : "call script"} is the one they will use first, so make it the strongest.`,
  ];
  return lines.filter((l) => l !== "").join("\n");
}

export async function generateOutreach(lead: Lead, profile: AgencyProfile, focus: Channel = "email"): Promise<OutreachContent> {
  const res = await claude().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort: "medium", format: betaZodOutputFormat(OutreachSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: prompt(lead, profile, focus) }],
  });
  if (res.stop_reason === "refusal") throw new RefusalError("Claude declined to write this message. Edit the lead notes and try again.");
  if (!res.parsed_output) throw new Error("Claude's reply didn't match the outreach format. Try again.");
  return res.parsed_output;
}

/** A no-AI message built from the audit, for demo mode. */
export function templateOutreach(lead: Lead, profile: AgencyProfile): OutreachContent {
  const niche = getNiche(lead.niche);
  const top = topSignals(lead.signals, 1)[0];
  const hi = lead.contactName ? `Hi ${lead.contactName.split(" ")[0]},` : "Hi there,";
  const site = domainOf(lead.website) ?? "your site";
  const plural = niche?.plural ?? "businesses";
  // One natural opener + consequence per finding.
  const lines: Record<string, [string, string]> = {
    no_website: [`I searched for ${lead.name} and found the listing but no website.`, "People who look you up before calling hit a dead end and pick someone else."],
    site_down: [`I tried to open ${site} and it didn't load.`, "Anyone who searches for you right now sees an error page."],
    few_reviews: [`${lead.name} has ${lead.reviewCount ?? "only a few"} Google reviews.`, `Most ${plural} that win the map listings nearby have far more, and that decides who gets the call.`],
    low_rating: [`${lead.name} shows ${lead.rating?.toFixed(1) ?? "a low"} stars on Google.`, "Below about 4.2 stars, a lot of searchers scroll past without clicking."],
    no_https: [`${site} shows a "Not secure" warning in the browser.`, "That warning scares off visitors before they read anything."],
    not_mobile: [`I opened ${site} on my phone and it isn't built for mobile.`, "Most local searches happen on phones, so most visitors see a squeezed desktop page."],
    slow: [`${site} took ${lead.audit?.responseMs ? (lead.audit.responseMs / 1000).toFixed(1) : "several"} seconds just to respond when I opened it.`, "Visitors on phones usually leave before a slow page loads."],
    no_booking: [`I went to book on ${site} and there's no way to do it online.`, "Anyone browsing after hours has to remember to call back, and many book elsewhere."],
    no_pixel: [`I couldn't find any ad tracking on ${site}.`, "If you're running ads, there's no way to see which ones bring in customers."],
    no_chat: [`There's no way to message you from ${site} without calling.`, "Visitors who don't want to call just leave."],
    stale_site: [`The footer on ${site} still says \u00a9 ${lead.audit?.copyrightYear ?? "an old year"}.`, "Small signs like that make a business look closed or neglected."],
    no_form: [`There's no contact form on ${site}.`, "After-hours visitors have no way to leave their details."],
    no_click_to_call: [`On my phone, the number on ${site} isn't tappable.`, "Every extra step loses a few callers."],
    weak_seo: [`${site} is missing the title and description Google shows in search results.`, "Google guesses instead, and it usually guesses badly."],
    no_schema: [`${site} doesn't tell Google its hours, address or services in a structured way.`, "That makes it harder to show up in local results."],
    no_social: [`I couldn't find any social profiles linked from ${site}.`, "Many customers check those before they book."],
  };
  const [observation, impact] = top && lines[top.id]
    ? lines[top.id]
    : [`I was looking at ${plural} in ${lead.city ?? "your area"} and ${lead.name} came up.`, "A few quick fixes could bring in noticeably more customers."];
  const sender = profile.ownerName || profile.agencyName;
  const footer = `${sender}\n${profile.agencyName}${profile.mailingAddress ? `\n${profile.mailingAddress}` : "\n[agency postal address]"}\n\nNot interested? Reply "no" and I won't follow up.`;
  const fix = top?.pitch ? `We set up ${top.pitch.toLowerCase()} for ${niche?.plural ?? "local businesses"}.` : `We help ${niche?.plural ?? "local businesses"} turn searches into booked customers.`;
  const body = `${hi}\n\n${observation} ${impact}\n\n${fix} Would it help if I sent a 2-minute video showing exactly what I'd change?\n\n${footer}`;
  return {
    subject: top ? `${lead.name}: ${top.label.toLowerCase()}`.slice(0, 50) : `idea for ${lead.name}`.slice(0, 50),
    body,
    rationale: top ? `Opens with the strongest finding (${top.label}) and offers a free video instead of a meeting. Template: add a Claude key for a personal version.` : "Template opener. Audit the lead first for a stronger, specific message.",
    followUps: [
      { dayOffset: 3, subject: "", body: `${hi}\n\nI put together a quick mockup of what fixing this could look like for ${lead.name}. Want me to send it over?\n\n${sender}` },
      { dayOffset: 7, subject: "", body: `${hi}\n\nOne question: how do most new customers find you today? If it's mostly referrals, there's a lot of easy search traffic going to competitors.\n\n${sender}` },
      { dayOffset: 14, subject: "", body: `${hi}\n\nI'll stop here so I'm not cluttering your inbox. If growing ${niche?.label.toLowerCase() ?? "your business"} bookings becomes a priority, just reply and I'll pick it back up.\n\n${sender}` },
    ],
    sms: `Hi, it's ${sender} from ${profile.agencyName}. ${observation} Mind if I text you a 2-min fix? Reply STOP to opt out`.slice(0, 300),
    dm: `Hey! ${observation} I help ${niche?.plural ?? "local businesses"} fix exactly this. Want me to send a quick mockup? No pitch, promise.`,
    videoScript: `[show: their homepage] "Hi ${lead.contactName?.split(" ")[0] ?? "there"}, this is ${sender} from ${profile.agencyName}. I recorded this for ${lead.name}."\n\n[show: ${top?.label ?? "the first gap"}] "${observation} ${impact}"\n\n[show: a competitor that does it well] "Here's what customers see nearby instead."\n\n[show: your face] "Fixing this is usually a quick project. Want me to send you the full fix list? Just reply yes."`,
    callScript: `Opener: "Hi, this is ${sender} with ${profile.agencyName}. ${observation} Do you have 30 seconds for why I called?"\n\nQuestions:\n1. How are most new customers finding you right now?\n2. What happens to calls that come in when you're busy?\n3. If you could add 10 more customers a month, could you handle them?\n\nIf "how much?": "It depends on what you need; most ${niche?.plural ?? "clients"} start around ${profile.pricing || "[your price]"}. Can I show you what I'd do first?"\nIf "we already have someone": "Great. Are you happy with the number of new customers they bring in each month?"\nIf "send me an email": "Will do. What's the best address, and what should I make sure to include?"`,
  };
}
