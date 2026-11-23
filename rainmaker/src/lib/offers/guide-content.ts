// The words of the AI Website Guide offer: the guide's own instructions, the
// five questions to ask it in front of the owner, and the risk-free trial
// pitch. Pure, unit tested.

import type { Faq } from "./site-kb-parse.ts";

const NAMES = ["Ava", "Mia", "Nora", "Leo", "Ivy", "Max", "Zoe", "Sam"];

/** A first name for the guide, stable for a business. */
export function guideNameFor(business: string): string {
  let h = 0;
  for (const c of business) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return NAMES[h % NAMES.length];
}

/** It always says it's an AI, so no visitor is misled. */
export function guideFirstMessage(name: string, business: string): string {
  return `Hi, I'm ${name}, your AI guide with ${business}. Need a quick answer? Ask me anything!`;
}

export interface GuideFacts {
  business: string;
  name: string;
  kind: string;
  city?: string;
  phone?: string;
  email?: string;
  website?: string;
  bookingUrl?: string;
  agencyName: string;
}

export function guidePrompt(f: GuideFacts, mode: "demo" | "live"): string {
  const facts = [
    `- Business: ${f.business}, a ${f.kind}${f.city ? ` in ${f.city}` : ""}`,
    f.phone ? `- Phone: ${f.phone}` : "",
    f.email ? `- Email: ${f.email}` : "",
    f.website ? `- Website: ${f.website}` : "",
    f.bookingUrl ? `- Online booking: ${f.bookingUrl}` : "",
  ].filter(Boolean);
  const env =
    mode === "demo"
      ? `This is a demo that ${f.agencyName} built from ${f.business}'s public website to show the owner what an AI guide on their site would do. The person chatting is probably the owner or their staff testing you. Treat them exactly like a real website visitor. If they ask what this is, say ${f.agencyName} built it from their website, and the live version sits on their site day and night, answers visitors and sends the team every lead.`
      : `You are the AI guide on ${f.business}'s website. People reach you by chat or voice while browsing the site: customers, prospective customers, and sometimes suppliers or spam.`;
  return `# Role
You are ${f.name}, the AI guide for ${f.business}. You are an AI, and you say so: introduce yourself as "${f.name}, your AI guide with ${f.business}", and if anyone asks whether you're a person, say you're an AI guide.

# Environment
${env}

# Goal
Give fast, accurate answers from the knowledge base (${f.business}'s website), find out what the visitor needs, and turn interested visitors into leads the team can follow up:
1. Answer the question in one to three short sentences.
2. When they want a quote, a booking, a callback or anything the team must handle, collect their name and phone number or email (read numbers back), and what they need. Say the team will follow up.
3. ${f.bookingUrl ? `For appointments, share the booking link (${f.bookingUrl}) in chat, or offer to text or email it.` : "For appointments, take their preferred day and time with their contact details; the team confirms."}
4. When a page or product link would help: in chat, give the link from the knowledge base with ?utm_source=ai-guide added, so the business sees which visits you sent. By voice, offer to text or email the link, and take their number or email to do it.
5. If something isn't in the knowledge base (an unlisted price, availability, a policy), say you'll have the team confirm, and take their details. Never guess.
6. If someone describes an emergency that puts a person in danger, tell them to call emergency services now.

# Facts
${facts.join("\n")}

# Style
Warm, quick and plain. One question at a time. No lists or formatting when speaking.

# Guardrails
- Never invent prices, availability, staff names, promotions or policies. This step is important.
- No medical, legal or financial advice; offer a callback from the right person.
- Ask only for the details needed to help.
- Stay on ${f.business}; steer back politely if the conversation drifts.`;
}

/** Contact details the guide's conversations are analysed for, after each one. */
export const GUIDE_DATA_COLLECTION = {
  visitor_name: { type: "string", description: "The visitor's name, if they gave it. Empty if not." },
  phone: { type: "string", description: "The visitor's phone number, if they gave it, digits only. Empty if not." },
  email: { type: "string", description: "The visitor's email address, if they gave it. Empty if not." },
  need: { type: "string", description: "In a few words, what the visitor wanted (service, product, booking or question)." },
} as const;

/** Answers where the guide didn't know: material for the knowledge base. */
export function answerLooksUnsure(text: string): boolean {
  return /\b(not sure|don'?t (have|know)|do not (have|know)|couldn'?t find|can'?t find|no information|unable to (find|answer|confirm)|check with the team|have (the|our) team (confirm|follow|get back)|isn'?t (listed|in my)|not (listed|available) in)\b/i.test(text);
}

const NICHE_QUESTIONS: Record<string, string[]> = {
  hvac: ["My furnace stopped working tonight. Can someone come out today?", "Do you offer financing on a new air conditioner?", "How much is a furnace tune-up?", "Do you install heat pumps?"],
  plumber: ["I have a burst pipe right now. Can you send someone today?", "Do you charge extra for weekend calls?", "Can you replace a hot water tank this week?", "Do you clear blocked drains?"],
  roofer: ["My roof is leaking after the storm. How fast can someone look at it?", "Do you do free roof inspections?", "Do you work with insurance claims?", "What roofing materials do you install?"],
  auto_repair: ["My check engine light just came on. Can I bring it in today?", "Do you do brake jobs on weekends?", "How much is an oil change?", "Do you offer a warranty on repairs?"],
  pest_control: ["I found mice in my kitchen. Can someone come this week?", "Is your treatment safe for pets?", "Do you offer a guarantee?", "Do you do wasp nest removal?"],
  dentist: ["I have a bad toothache. Can I get in today?", "Are you taking new patients?", "Do you bill insurance directly?", "Do you offer teeth whitening?"],
  veterinarian: ["My dog ate something he shouldn't have. Can I bring him in now?", "Are you accepting new patients?", "How much is a vaccine visit?", "Do you see cats and exotics?"],
  law_pi: ["I was in a car accident last week. Do I have a case?", "Do you charge anything upfront?", "How long do injury claims usually take?", "Can I get a free consultation?"],
  real_estate: ["What's my house worth?", "Do you help first-time buyers?", "What areas do you cover?", "What's your commission?"],
  accountant: ["Can you file my small business taxes this year?", "Do you do bookkeeping every month?", "What do you charge for a personal return?", "Can you help me with a CRA letter?"],
  landscaping: ["Can you give me a quote for a new patio?", "Do you do weekly lawn care?", "Do you offer snow removal in winter?", "What areas do you serve?"],
};
const GENERIC = ["What are your hours this week?", "How much does it usually cost?", "Can I book an appointment for next week?", "Do you serve my area?"];

/**
 * Five questions to ask the guide in front of the owner: their own site's
 * FAQs first (it should nail those), then the urgent and pricing questions
 * their customers really ask, one about a specific service of theirs, and a
 * booking request that shows lead capture.
 */
export function demoQuestions(input: { nicheId?: string; faqs: Faq[]; services?: string[] }): string[] {
  const out: string[] = [];
  const add = (q?: string) => {
    if (q && out.length < 5 && !out.some((x) => x.toLowerCase() === q.toLowerCase())) out.push(q);
  };
  for (const f of input.faqs.slice(0, 2)) add(f.q);
  const pool = (input.nicheId && NICHE_QUESTIONS[input.nicheId]) || GENERIC;
  add(pool[0]);
  const service = input.services?.find((s) => s.length > 3 && s.length < 50);
  add(service ? `Tell me about your ${service.toLowerCase()}.` : pool[3]);
  add(pool[2]);
  add("Can someone call me back today? My name is Sam and my number is 555-0100.");
  for (const q of [...pool, ...GENERIC]) add(q);
  return out;
}

/** The playbook's prompt, for checking the questions with ChatGPT or Perplexity too. */
export function questionsPrompt(website: string): string {
  return `I've just created a voice AI and a chat widget for ${website}. What five questions would you have me ask the voice AI in front of the owner to prove how good it is?`;
}

export interface Pitch {
  email: { subject: string; body: string };
  sms: string;
  callScript: string;
}

/** Lead with more website leads, not "AI". The offer: install it free for a few weeks, no card. */
export function guidePitch(input: {
  business: string;
  firstName?: string;
  demoUrl: string;
  agencyName: string;
  senderName?: string;
  guideName: string;
  monthly: number;
  trialWeeks?: number;
}): Pitch {
  const weeks = input.trialWeeks ?? 4;
  const hi = input.firstName ? `Hi ${input.firstName},` : "Hi,";
  const from = input.senderName || input.agencyName;
  return {
    email: {
      subject: `10–20% more website leads for ${input.business}?`,
      body: `${hi}

Most visitors to a local business's website leave without calling. I built something that gets ${input.business} 10–20% more leads from the same traffic: a guide on your site that answers visitors' questions by chat or voice, day and night, and passes you their name and number.

I set one up for you from your own website. Try it here: ${input.demoUrl}
Ask it what your customers ask.

If you like it, I'll put it on your real website free for ${weeks} weeks. No credit card. You'll see the leads it brings in before you decide anything.

Worth a 10-minute look this week?

${from}`,
    },
    sms: `${input.firstName ? `Hi ${input.firstName}, it's` : "Hi, it's"} ${from}. I built a website guide for ${input.business} that answers visitors 24/7 and sends you their details. Try it: ${input.demoUrl} Happy to put it on your site free for ${weeks} weeks, no card.`,
    callScript: `OPENER
"Hi, is this the owner of ${input.business}? It's ${from}. I'll be quick: I help local businesses get 10 to 20 percent more leads from the website traffic they already have. Do you have two minutes?"

WHY THEY CARE
"Most people who visit your site leave without calling, especially after hours. When they can ask a question and get an answer right away, more of them leave their name and number."

THE DEMO
"I already built one for you from your own website. ${input.guideName} answers questions about your services and takes callers' details. I'll text you the link: ${input.demoUrl}. Ask it something a customer would ask."

QUESTIONS
1. "How do most of your customers find you now?"
2. "What happens to someone who visits your site at 9 pm?"
3. "What's one new customer worth to you?"

THE OFFER
"I'll put it on your real website free for ${weeks} weeks. No credit card. You'll see every lead it captures. If it's paying for itself, it's $${input.monthly} a month after that; if not, I take it down."

OBJECTIONS
- "We already have a contact form." → "Forms only catch people ready to commit. The guide answers the questions people have before they're ready, then asks for their details."
- "AI will say something wrong." → "It only answers from your own website, says it's an AI, and hands anything it isn't sure about to your team. You can read every conversation."
- "Not interested." → "No problem. Can I text you the demo link anyway, in case it's useful later?"

CLOSE
"Can I set it up on your site this week and send you the first leads report in seven days?"`,
  };
}
