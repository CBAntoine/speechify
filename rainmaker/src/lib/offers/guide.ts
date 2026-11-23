import "server-only";
import { randomBytes } from "node:crypto";
import {
  addGuideKnowledge,
  createGuideAgent,
  createKnowledgeText,
  deleteKnowledge,
  embedSnippet,
  guideConversations,
  putGuideOnSite,
  testGuideQuestions,
  unansweredQuestions,
  type GuideConversation,
} from "@/lib/elevenlabs/guide";
import { deleteAgent } from "@/lib/elevenlabs/receptionist";
import { getNiche } from "@/lib/niches";
import { domainOf, normalizeUrl } from "@/lib/net";
import { addActivity, createDraft, createTask, getLead, getProfile } from "@/lib/repo";
import { siteUrlStatic } from "@/lib/site";
import { readDb, update } from "@/lib/store";
import type { GuideDemo, Lead } from "@/lib/types";
import { demoQuestions, guideFirstMessage, guideNameFor, guidePitch, type GuideFacts } from "./guide-content";
import { estimateGuideRoi, leadValueFor } from "./guide-math";
import { scanSite, type SiteScan } from "./site-kb";
import { buildKbText, faqsFromText } from "./site-kb-parse";

// The AI Website Guide offer, run for one lead: read their site into a
// knowledge base, build the guide, give it a private demo page, test the five
// demo questions, write the pitch, put it on their site for a free trial, and
// report what it captured.

export const GUIDE_SESSIONS_PER_DAY = Number(process.env.DEMO_SESSIONS_PER_DAY || 12);

function facts(lead: Lead, name: string, agencyName: string): GuideFacts {
  const niche = getNiche(lead.niche);
  return {
    business: lead.name,
    name,
    kind: niche && niche.id !== "custom" ? niche.label.toLowerCase() : "local business",
    city: lead.city ?? lead.address,
    phone: lead.phone,
    email: lead.email,
    website: lead.website,
    agencyName,
  };
}

export function guidePath(token: string): string {
  return `/guide/${token}`;
}

export function guideUrl(token: string, origin?: string): string {
  return `${(origin ?? siteUrlStatic() ?? "").replace(/\/$/, "")}${guidePath(token)}`;
}

async function saveGuide(leadId: string, change: (g: GuideDemo, l: Lead) => void): Promise<GuideDemo> {
  return update((db) => {
    const l = db.leads.find((x) => x.id === leadId);
    if (!l?.guide) throw new Error("No AI guide for this lead");
    change(l.guide, l);
    l.updatedAt = new Date().toISOString();
    return l.guide;
  });
}

/**
 * Steps 2–4: scan their website, build the guide on it, and give it a
 * private demo page. When their site can't be read (it blocks automated
 * visitors, or there isn't one), build from details the owner gave you.
 */
export async function buildGuide(leadId: string, createdBy = "user", opts: { text?: string } = {}): Promise<GuideDemo> {
  const lead = await getLead(leadId);
  if (!lead) throw new Error("Lead not found");
  if (lead.guide) return lead.guide;
  const pasted = opts.text?.trim().slice(0, 60_000);
  if (pasted !== undefined && pasted.length < 40) throw new Error("Paste a bit more: their services, prices, hours, areas and common questions.");
  if (!lead.website && !pasted) throw new Error("Add their website first: the guide learns everything from it. Or paste the details it should know.");
  const profile = await getProfile();
  const name = guideNameFor(lead.name);
  const f = facts(lead, name, profile.agencyName);
  const kbFacts = [`Type of business: ${f.kind}`, f.city ? `Location: ${f.city}` : "", f.phone ? `Phone: ${f.phone}` : "", f.email ? `Email: ${f.email}` : "", lead.website ? `Website: ${lead.website}` : ""];
  const scan: SiteScan = pasted
    ? {
        home: lead.website ?? "",
        pages: [],
        faqs: faqsFromText(pasted),
        brand: {},
        services: [],
        text: buildKbText({ business: lead.name, facts: kbFacts, faqs: faqsFromText(pasted), pages: [{ url: "details from the business", title: "Details from the business", text: pasted }] }),
      }
    : await scanSite(lead.website!, { business: lead.name, facts: kbFacts });
  const kb = await createKnowledgeText(`${lead.name} ${pasted ? "details" : "website"} (AI guide)`, scan.text);
  let agentId: string;
  try {
    agentId = await createGuideAgent(f, [kb], [lead.niche]);
  } catch (err) {
    await deleteKnowledge(kb.id).catch(() => undefined);
    throw err;
  }
  const guide: GuideDemo = {
    agentId,
    token: randomBytes(12).toString("base64url"),
    createdAt: new Date().toISOString(),
    name,
    knowledge: [kb],
    pages: scan.pages.slice(0, 15),
    faqs: scan.faqs.length,
    brand: { ...scan.brand, services: scan.services },
    questions: demoQuestions({ nicheId: lead.niche, faqs: scan.faqs, services: scan.services }).map((q) => ({ q })),
  };
  const saved = await update((db) => {
    const l = db.leads.find((x) => x.id === leadId);
    if (!l) return undefined;
    if (l.guide) return l.guide; // built twice at once: keep the first
    l.guide = guide;
    l.updatedAt = new Date().toISOString();
    return guide;
  });
  if (!saved || saved.agentId !== agentId) {
    await deleteAgent(agentId).catch(() => undefined);
    await deleteKnowledge(kb.id).catch(() => undefined);
    if (!saved) throw new Error("Lead was deleted");
  }
  const from = pasted ? "details you pasted" : `${scan.pages.length} page${scan.pages.length === 1 ? "" : "s"} of their site`;
  await addActivity({ kind: "lead", text: `${createdBy.startsWith("agent:") || createdBy === "copilot" ? "The copilot" : "You"} built an AI website guide for ${lead.name} from ${from}`, leadId });
  return saved;
}

/**
 * Step 6: ask the guide the five demo questions (graded ElevenLabs agent
 * tests) and flag any answer that dodged the question, so you can add the
 * missing facts before the demo.
 */
export async function testGuide(leadId: string): Promise<GuideDemo> {
  const lead = await getLead(leadId);
  if (!lead?.guide) throw new Error("Build the guide first");
  const g = lead.guide;
  const results = await testGuideQuestions(
    g.agentId,
    guideFirstMessage(g.name, lead.name),
    g.questions.map((q) => q.q),
    `${lead.name} demo questions`
  );
  return saveGuide(leadId, (saved) => {
    saved.questions = results.map((r) => ({ q: r.q, answer: r.answer ?? r.note ?? "(No answer)", unsure: !r.passed, note: r.passed ? undefined : r.note }));
    saved.testedAt = new Date().toISOString();
  });
}

export async function setQuestions(leadId: string, questions: string[]): Promise<GuideDemo> {
  const clean = questions.map((q) => q.trim().slice(0, 300)).filter(Boolean).slice(0, 8);
  if (!clean.length) throw new Error("Add at least one question");
  return saveGuide(leadId, (g) => {
    g.questions = clean.map((q) => g.questions.find((x) => x.q === q) ?? { q });
  });
}

/** Step 1 inputs: their monthly visitors (from Semrush or their Google Analytics) and a lead's worth. */
export async function setGuideRoi(leadId: string, roi: { monthlyVisitors?: number; leadValue?: number }): Promise<Lead> {
  return update((db) => {
    const l = db.leads.find((x) => x.id === leadId);
    if (!l) throw new Error("Lead not found");
    const clean = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined);
    l.guideRoi = { monthlyVisitors: clean(roi.monthlyVisitors), leadValue: clean(roi.leadValue) };
    l.updatedAt = new Date().toISOString();
    return l;
  });
}

export function guideRoiFor(lead: Lead) {
  return estimateGuideRoi({
    monthlyVisitors: lead.guideRoi?.monthlyVisitors ?? 0,
    leadValue: lead.guideRoi?.leadValue ?? leadValueFor(lead.niche),
    pages: lead.guide?.pages.length,
  });
}

/** Step 7: the risk-free trial pitch as drafts in the Inbox (email, text, call script). Nothing is sent. */
export async function draftGuidePitch(leadId: string, origin?: string, createdBy = "user"): Promise<number> {
  const lead = await getLead(leadId);
  if (!lead?.guide) throw new Error("Build the guide first, so the pitch can link to their demo");
  const profile = await getProfile();
  const roi = guideRoiFor(lead);
  const pitch = guidePitch({
    business: lead.name,
    demoUrl: guideUrl(lead.guide.token, origin),
    agencyName: profile.agencyName,
    senderName: profile.ownerName,
    guideName: lead.guide.name,
    monthly: roi.price.monthly,
  });
  const why = "AI Website Guide pitch: more website leads, demo link, free trial with no card.";
  await createDraft({ leadId, channel: "email", subject: pitch.email.subject, body: pitch.email.body, rationale: why, createdBy });
  await createDraft({ leadId, channel: "sms", body: pitch.sms, rationale: why, createdBy });
  await createDraft({ leadId, channel: "call", body: pitch.callScript, rationale: why, createdBy });
  await addActivity({ kind: "draft", text: `Drafted the AI website guide pitch for ${lead.name}: email, text and call script`, leadId });
  return 3;
}

/**
 * The trial: the guide goes on their real website (only their domain can use
 * it), and tasks remind you to send the first leads report and to convert.
 */
export async function startGuideTrial(leadId: string, website: string, weeks = 4): Promise<{ guide: GuideDemo; snippet: string }> {
  const lead = await getLead(leadId);
  if (!lead?.guide) throw new Error("Build the guide first");
  const domain = domainOf(normalizeUrl(website)) ?? domainOf(normalizeUrl(lead.website));
  if (!domain) throw new Error("Which website will it go on?");
  const profile = await getProfile();
  const bare = domain.replace(/^www\./, "");
  const app = domainOf(siteUrlStatic());
  await putGuideOnSite(lead.guide.agentId, facts(lead, lead.guide.name, profile.agencyName), lead.guide.knowledge, [bare, `www.${bare}`, app ?? "", app ? `www.${app}` : ""].filter(Boolean));
  const start = new Date();
  const end = new Date(start.getTime() + Math.max(1, Math.min(8, weeks)) * 7 * 86_400_000);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const guide = await saveGuide(leadId, (g, l) => {
    g.trial = { domain, startedAt: start.toISOString(), endsAt: end.toISOString() };
    if (l.stage === "new" || l.stage === "contacted") l.stage = "meeting";
  });
  const monthly = guideRoiFor(lead).price.monthly;
  await createTask({ title: `${lead.name}: send the first week's AI guide leads report`, leadId, due: day(new Date(start.getTime() + 7 * 86_400_000)), createdBy: "rainmaker" });
  await createTask({ title: `${lead.name}: trial ends, move them to $${monthly}/mo or take it down`, leadId, due: day(end), createdBy: "rainmaker" });
  await addActivity({ kind: "lead", text: `Started a ${weeks}-week AI guide trial on ${domain} for ${lead.name}`, leadId });
  return { guide, snippet: embedSnippet(lead.guide.agentId) };
}

export interface GuideReport {
  conversations: GuideConversation[];
  /** Conversations where the visitor left a phone number or email. */
  leads: GuideConversation[];
  unanswered: string[];
  last30: { conversations: number; leads: number };
}

/** Step 8: what the guide has done, and what it couldn't answer (for monthly tuning). */
export async function guideReport(leadId: string, withGaps = true): Promise<GuideReport> {
  const lead = await getLead(leadId);
  if (!lead?.guide) throw new Error("Build the guide first");
  const conversations = await guideConversations(lead.guide.agentId);
  const leads = conversations.filter((c) => c.contact.phone || c.contact.email);
  const since = Date.now() - 30 * 86_400_000;
  const recent = conversations.filter((c) => Date.parse(c.at) >= since);
  return {
    conversations,
    leads,
    unanswered: withGaps ? await unansweredQuestions(conversations.map((c) => c.id)) : [],
    last30: { conversations: recent.length, leads: recent.filter((c) => c.contact.phone || c.contact.email).length },
  };
}

/** Teach the guide an answer it was missing. */
export async function addKnowledge(leadId: string, text: string): Promise<GuideDemo> {
  const lead = await getLead(leadId);
  if (!lead?.guide) throw new Error("Build the guide first");
  const body = text.trim().slice(0, 20_000);
  if (body.length < 10) throw new Error("Write the answer the guide should give");
  const kb = await addGuideKnowledge(lead.guide.agentId, lead.guide.knowledge, `${lead.name} answers ${new Date().toISOString().slice(0, 10)}`, body);
  return saveGuide(leadId, (g) => {
    g.knowledge = kb;
  });
}

export async function removeGuide(leadId: string): Promise<void> {
  const lead = await getLead(leadId);
  if (!lead?.guide) return;
  const g = lead.guide;
  if (lead.clientAgentId !== g.agentId) await deleteAgent(g.agentId);
  for (const k of g.knowledge) await deleteKnowledge(k.id).catch(() => undefined);
  await update((db) => {
    const l = db.leads.find((x) => x.id === leadId);
    if (l) delete l.guide;
  });
}

export async function leadByGuideToken(token: string): Promise<Lead | undefined> {
  if (!/^[A-Za-z0-9_-]{10,40}$/.test(token)) return undefined;
  return (await readDb()).leads.find((l) => l.guide?.token === token);
}

/** Count one demo session against today's allowance. False when it's used up. */
export async function useGuideSession(leadId: string): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  return update((db) => {
    const l = db.leads.find((x) => x.id === leadId);
    if (!l?.guide) return false;
    const usage = l.guide.usage?.day === day ? l.guide.usage : { day, sessions: 0 };
    if (usage.sessions >= GUIDE_SESSIONS_PER_DAY) return false;
    l.guide.usage = { day, sessions: usage.sessions + 1 };
    return true;
  });
}
