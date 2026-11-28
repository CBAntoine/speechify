import { DEMO } from "../config.ts";
import { budget } from "../crew/checker.ts";
import { draftReply, markPaid, sendReplyNow } from "../crew/closer.ts";
import { applyDecision, describeApproval } from "../crew/decisions.ts";
import { checkResponseRate, runOnLead, scanNow, tick } from "../crew/orchestrator.ts";
import { cancelQueued, sendPitchNow } from "../crew/pitcher.ts";
import { proposalUrl, summarize } from "../crew/shared.ts";
import {
  allLeadNames,
  countEventsSince,
  countInboundSince,
  countSentSince,
  decideApproval,
  getApproval,
  getLead,
  getSettings,
  listApprovals,
  listEvents,
  messagesFor,
  patchSettings,
  pendingApprovalFor,
  responseStats,
  revenueSince,
  saveLead,
  scannedSince,
  searchLeads,
  spendBreakdown,
  spendSince,
  suppress,
  updateLead,
  updateMessage,
} from "../db.ts";
import { AGENTS, agentName, leadChanged, log } from "../events.ts";
import { briefing } from "../insights.ts";
import { NICHES, getNiche, matchNiche } from "../niches.ts";
import { elevenCredits } from "../providers/eleven.ts";
import { markTapDone, oneTapItems } from "../outreach.ts";
import type { AgentId, CommandResult, Lead, LeadStatus, Settings } from "../types.ts";
import { clip, localDayStart, localMonthStart, money, nameScore, newId, nowIso, pct } from "../util.ts";
import { defineCommand, type Args } from "./registry.ts";

// Everything you (or Atlas, or an MCP client) can ask the business to do.
// `say` is written to be spoken: short, specific, no ids or URLs read aloud.

const STATUSES: LeadStatus[] = ["new", "qualified", "skipped", "diagnosed", "built", "filmed", "ready", "pitched", "replied", "negotiating", "won", "lost", "dnc"];
const AGENT_IDS = AGENTS.map((a) => a.id);
const s = () => getSettings();
const str = (v: Args[string]) => (v === undefined ? undefined : String(v));

const STAGE_WORDS: Record<LeadStatus, string> = {
  new: "just found",
  qualified: "qualified, waiting to be built",
  skipped: "skipped",
  diagnosed: "diagnosed, mockups next",
  built: "mockups built, video next",
  filmed: "video done, pitch next",
  ready: "pitch ready",
  pitched: "pitched, waiting for a reply",
  replied: "replied",
  negotiating: "in conversation",
  won: "won",
  lost: "lost",
  dnc: "do not contact",
};

const ACTIVE: LeadStatus[] = ["negotiating", "replied", "ready", "pitched", "filmed", "built", "diagnosed", "qualified", "new", "won"];

/** Find a lead from an id or a spoken name ("bright smile", "the roofer in Boise"). */
function resolveLead(ref: string | undefined): { lead?: Lead; say?: string } {
  if (!ref) return { say: "Which business?" };
  if (/^ld_/.test(ref)) {
    const lead = getLead(ref);
    return lead ? { lead } : { say: "I couldn't find that lead." };
  }
  const q = ref.replace(/\b(the|in|at|from)\b/gi, " ").trim();
  const scored = allLeadNames()
    .map((l) => ({ ...l, score: Math.max(nameScore(q, l.name), nameScore(q, `${l.name} ${l.city}`) - 0.05) }))
    .filter((l) => l.score >= 0.45)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { say: `I couldn't find a business called ${ref}.` };
  const top = scored.filter((x) => x.score >= scored[0].score - 0.05);
  if (top.length > 1) {
    const leads = top.map((t) => getLead(t.id)!).sort((a, b) => ACTIVE.indexOf(a.status) - ACTIVE.indexOf(b.status));
    const distinct = new Set(leads.map((l) => `${l.name}|${l.city}`));
    if (distinct.size > 1) return { say: `I found a few: ${leads.slice(0, 3).map((l) => `${l.name} in ${l.city}`).join(", ")}. Which one?` };
    return { lead: leads[0] };
  }
  return { lead: getLead(top[0].id) };
}

function leadLine(l: Lead): string {
  return `${l.name} in ${l.city} (${STAGE_WORDS[l.status]}${l.score !== undefined ? `, score ${l.score}` : ""})`;
}

// ── Reading the business ────────────────────────────────────────────────

defineCommand({
  name: "get_briefing",
  description: "What's happening in the business right now: today's work by the crew, replies, response rate, revenue, pipeline, anything waiting for the owner's decision, and alerts. Call this first for any 'how are we doing' or 'what's going on' question.",
  risk: "read",
  params: {},
  run: async () => {
    const b = briefing();
    return { ok: true, say: b.text, data: b.data };
  },
});

defineCommand({
  name: "get_metrics",
  description: "Numbers for a period: businesses scanned, leads qualified, mockups built, videos, pitches sent, replies, response rate, deals won, revenue and spend.",
  risk: "read",
  params: { period: { type: "string", enum: ["today", "7d", "30d", "month", "all"], description: "today, 7d, 30d, month (calendar month) or all. Default 7d." } },
  run: async (a) => {
    const tz = s().owner.timezone;
    const period = str(a.period) ?? "7d";
    const since = period === "today" ? localDayStart(tz) : period === "30d" ? new Date(Date.now() - 30 * 86_400_000).toISOString() : period === "month" ? localMonthStart(tz) : period === "all" ? "1970-01-01" : new Date(Date.now() - 7 * 86_400_000).toISOString();
    const r = responseStats(since);
    const rev = revenueSince(since);
    const m = {
      scanned: scannedSince(since),
      qualified: countEventsSince(since, "scout", "success"),
      built: countEventsSince(since, "builder", "success"),
      videos: countEventsSince(since, "filmer", "success"),
      pitches: countSentSince(since, { kind: "pitch" }),
      followups: countSentSince(since, { kind: "followup" }),
      replies: countInboundSince(since),
      responseRate: r.pitched ? Math.round((r.replied / r.pitched) * 1000) / 10 : 0,
      dealsWon: rev.count,
      revenue: money(rev.cents, s().offer.currency),
      spend: `$${spendSince(since).toFixed(2)}`,
    };
    const label = { today: "Today", "7d": "In the last 7 days", "30d": "In the last 30 days", month: "This month", all: "All time" }[period] ?? "Lately";
    return {
      ok: true,
      say: `${label}: ${m.scanned} businesses scanned, ${m.built} mockups built, ${m.videos} videos, ${m.pitches} pitches sent and ${m.replies} replies${m.pitches ? `, a ${m.responseRate}% response rate` : ""}. ${m.dealsWon} deal${m.dealsWon === 1 ? "" : "s"} won for ${m.revenue}, and the crew spent ${m.spend}.`,
      data: m,
    };
  },
});

defineCommand({
  name: "find_leads",
  description: "Search leads by business name, city, niche or stage. Returns the best matches with their stage and score.",
  risk: "read",
  params: {
    query: { type: "string", description: "Part of the business name, city, phone or email." },
    status: { type: "string", enum: STATUSES, description: "Only leads at this stage." },
    city: { type: "string", description: "Only leads in this city." },
    niche: { type: "string", description: "Only this kind of business, e.g. dentist, roofer." },
    limit: { type: "integer", description: "How many to return (default 5, max 20)." },
  },
  run: async (a) => {
    const niche = str(a.niche) ? matchNiche(str(a.niche))?.id : undefined;
    const { leads, total } = searchLeads({ q: str(a.query), status: a.status as LeadStatus | undefined, city: str(a.city), niche, limit: Math.min(Number(a.limit ?? 5), 20) });
    if (!total) return { ok: true, say: "No leads match that.", data: { total: 0, leads: [] } };
    return {
      ok: true,
      say: `${total} match${total === 1 ? "es" : ""}. ${leads.slice(0, 3).map(leadLine).join("; ")}${total > 3 ? `; and ${total - 3} more on screen` : ""}.`,
      data: { total, leads: leads.map(summarize) },
    };
  },
});

defineCommand({
  name: "get_lead",
  description: "Everything about one business: its stage, what's wrong with its website, the diagnosis, whether the mockups and video are ready, messages sent and received, and what happens next.",
  risk: "read",
  params: { lead: { type: "string", required: true, description: "The business name (or lead id)." } },
  run: async (a) => {
    const r = resolveLead(str(a.lead));
    if (!r.lead) return { ok: false, say: r.say! };
    const l = r.lead;
    const msgs = messagesFor(l.id);
    const lastIn = msgs.filter((m) => m.direction === "in").pop();
    const sent = msgs.filter((m) => m.direction === "out" && m.status === "sent").length;
    const parts = [
      `${l.name} in ${l.city} is ${STAGE_WORDS[l.status]}.`,
      l.diagnosis ? l.diagnosis.headline : l.audit?.findings[0] ?? "",
      l.variants?.length ? `Three mockups are built${l.video ? ` and there's a ${l.video.durationSec}-second video` : ""}.` : "",
      sent ? `We've sent ${sent} email${sent === 1 ? "" : "s"}.` : l.email ? "" : "They have no published email, so they're on your call and text list.",
      lastIn?.analysis ? `Their last reply: ${lastIn.analysis.summary}` : lastIn ? `They replied: "${clip(lastIn.body, 140)}"` : "",
      l.status === "won" ? `They paid ${money(l.dealValueCents ?? l.priceCents, s().offer.currency)}${l.liveSlug ? " and the site is live" : ""}.` : "",
      l.error ? `It's stuck: ${l.error}` : "",
    ].filter(Boolean);
    return {
      ok: true,
      say: parts.join(" "),
      data: {
        id: l.id,
        name: l.name,
        city: l.city,
        niche: getNiche(l.niche).label,
        status: l.status,
        websiteState: l.websiteState,
        score: l.score,
        rating: l.rating,
        reviews: l.reviewCount,
        phone: l.phone,
        email: l.email,
        diagnosis: l.diagnosis?.headline,
        evidence: l.diagnosis?.evidence,
        mockups: l.variants?.map((v) => v.label),
        video: Boolean(l.video),
        price: money(l.dealValueCents ?? l.priceCents, s().offer.currency),
        proposalUrl: proposalUrl(l),
        messages: msgs.slice(-6).map((m) => ({ direction: m.direction, kind: m.kind, status: m.status, subject: m.subject, body: clip(m.body.split("\n—\n")[0], 300), intent: m.analysis?.intent })),
        notes: l.notes,
      },
    };
  },
});

defineCommand({
  name: "list_approvals",
  description: "Decisions waiting for the owner: pitches to approve (review mode), replies drafted by the Closer, deals over the approval limit, budget raises and strategy changes. Returns each with its approval_id.",
  risk: "read",
  params: {},
  run: async () => {
    const list = listApprovals("pending", 30, "oldest");
    if (!list.length) return { ok: true, say: "Nothing needs you right now.", data: { approvals: [] } };
    const deals = list.filter((x) => x.kind === "deal").length;
    return {
      ok: true,
      say: `${list.length} thing${list.length === 1 ? "" : "s"} waiting${deals ? `, including ${deals} deal${deals === 1 ? "" : "s"} over your limit` : ""}. ${list.slice(0, 3).map((x, i) => describeApproval(x, i)).join(". ")}.`,
      data: { approvals: list.map((x, i) => ({ number: i + 1, approval_id: x.id, kind: x.kind, title: x.title, detail: clip(x.detail, 500), amount: x.amountCents ? money(x.amountCents) : undefined, lead: x.leadName })) },
    };
  },
});

defineCommand({
  name: "decide_approval",
  description: "Approve or reject one waiting decision by its approval_id (or its number from list_approvals). Approving a pitch sends it in the next slot; approving a reply sends it; approving a deal sends the next steps at the higher price.",
  risk: "confirm",
  params: {
    approval_id: { type: "string", required: true, description: "The approval_id from list_approvals, or its number in that list (1, 2, 3)." },
    decision: { type: "string", required: true, enum: ["approve", "reject"], description: "approve or reject" },
    note: { type: "string", description: "Optional reason, kept in the log." },
  },
  confirm: (a) => {
    const ap = findApproval(str(a.approval_id));
    return ap ? `${a.decision === "approve" ? "Approve" : "Reject"}: ${bare(ap.title)}.` : undefined;
  },
  run: async (a, ctx) => {
    const ap = findApproval(str(a.approval_id));
    if (!ap) return { ok: false, say: "I couldn't find that decision. Ask me to list what's waiting." };
    const r = await applyDecision(ap.id, a.decision as "approve" | "reject", ctx.via, str(a.note));
    return { ok: r.ok, say: r.say };
  },
});

/** "Send the pitch to X?" → "Send the pitch to X", for sentences. */
const bare = (t: string) => t.replace(/[?.!\s]+$/, "");

function findApproval(ref: string | undefined) {
  if (!ref) return undefined;
  if (/^\d+$/.test(ref)) return listApprovals("pending", 30, "oldest")[Number(ref) - 1];
  return getApproval(ref);
}

// ── Running the crew ─────────────────────────────────────────────────────

defineCommand({
  name: "run_agent",
  description:
    "Put one agent to work now. scout with a city (and region) and niche scans that market right away; diagnoser, builder, filmer or pitcher with a lead redoes that step for that business; orchestrator runs the whole pipeline once; checker reports budget and credits. Long jobs run in the background and report back in the activity feed.",
  risk: "write",
  slow: true,
  params: {
    agent: { type: "string", required: true, enum: AGENT_IDS, description: "Which agent." },
    lead: { type: "string", description: "Business name or id, for diagnoser, builder, filmer, pitcher or closer." },
    city: { type: "string", description: "For scout: the city to scan." },
    region: { type: "string", description: "For scout: state or province code, e.g. OR, TX, ON." },
    niche: { type: "string", description: "For scout: kind of business, e.g. dentists, roofers, plumbers." },
    count: { type: "integer", description: "For scout: how many businesses to pull (max 60)." },
  },
  run: async (a) => {
    const agent = a.agent as AgentId;
    if (agent === "scout") {
      const nicheText = str(a.niche);
      const niche = nicheText ? matchNiche(nicheText) : undefined;
      if (nicheText && !niche) return { ok: false, say: `I don't know the niche "${nicheText}". I can do ${NICHES.slice(0, 8).map((n) => n.plural).join(", ")} and more.` };
      const city = str(a.city);
      if (city) {
        const known = s().targets.cities.find((c) => c.city.toLowerCase() === city.toLowerCase());
        const region = str(a.region)?.toUpperCase() ?? known?.region;
        if (!region) return { ok: false, say: `Which state or province is ${city} in?` };
        const target = { city: known?.city ?? titleCase(city), region, country: countryFor(region) };
        const n = niche ?? getNiche(s().targets.niches[0]);
        const r = await scanNow(target, n.id, a.count ? Math.min(Number(a.count), 60) : undefined);
        return { ok: true, say: `Scanned ${r.found} ${n.plural} in ${target.city}: ${r.added} are new, and the Scout is checking their websites now.`, data: r };
      }
      void tick();
      return { ok: true, say: "The Scout is scanning the next city on the list." };
    }
    if (agent === "orchestrator") {
      void tick();
      return { ok: true, say: "Running the whole pipeline now." };
    }
    if (agent === "checker") {
      checkResponseRate();
      const b = budget();
      const c = await elevenCredits(true);
      return { ok: true, say: `Spent $${b.todayUsd.toFixed(2)} of today's $${b.dailyUsd} budget and $${b.monthUsd.toFixed(2)} of $${b.monthlyUsd} this month.${c ? ` ElevenLabs has ${c.remaining.toLocaleString()} characters left.` : ""}`, data: { budget: b, elevenlabs: c } };
    }
    if (!str(a.lead)) {
      void tick();
      return { ok: true, say: `The ${agentName(agent)} is working through its queue now.` };
    }
    const r = resolveLead(str(a.lead));
    if (!r.lead) return { ok: false, say: r.say ?? "Which business?" };
    const lead = r.lead;
    if (agent === "closer") {
      void draftReply(lead).catch(() => undefined);
      return { ok: true, say: `The Closer is drafting a reply to ${lead.name}. It'll be in your approvals in a moment.` };
    }
    const need: Partial<Record<AgentId, LeadStatus[]>> = {
      diagnoser: ["qualified", "diagnosed", "built", "filmed", "ready", "skipped"],
      builder: ["diagnosed", "built", "filmed", "ready", "pitched"],
      filmer: ["built", "filmed", "ready", "pitched"],
      pitcher: ["built", "filmed", "ready"],
    };
    if (need[agent] && !need[agent]!.includes(lead.status) && !(agent === "diagnoser" && lead.status === "new")) {
      return { ok: false, say: `${lead.name} is ${STAGE_WORDS[lead.status]}, so the ${agentName(agent)} can't work on it now.` };
    }
    if (agent === "pitcher") cancelPendingPitch(lead);
    void runOnLead(agent, lead).catch((err) => log(agent, `Couldn't finish: ${err instanceof Error ? err.message : String(err)}`, { lead, level: "error" }));
    const eta: Partial<Record<AgentId, string>> = { diagnoser: "a few seconds", builder: "about a minute", filmer: "about a minute", pitcher: "a few seconds" };
    return { ok: true, say: `${agentName(agent)} is on ${lead.name}. It usually takes ${eta[agent] ?? "a moment"}; I'll see it in the activity feed.` };
  },
});

function cancelPendingPitch(lead: Lead) {
  for (const m of messagesFor(lead.id)) if (m.kind === "pitch" && m.direction === "out" && m.status !== "sent") updateMessage(m.id, { status: "failed", error: "Rewritten" });
  const ap = pendingApprovalFor(lead.id, "pitch");
  if (ap) applyDecisionSilently(ap.id);
}

function applyDecisionSilently(id: string) {
  decideApproval(id, "expired", "system");
}

defineCommand({
  name: "pause_crew",
  description: "Pause the whole crew, or one agent (e.g. pause the pitcher to stop sending).",
  risk: "write",
  params: { agent: { type: "string", enum: AGENT_IDS, description: "One agent to pause. Leave empty to pause everything." } },
  run: async (a) => {
    const agent = a.agent as AgentId | undefined;
    if (!agent || agent === "orchestrator") {
      patchSettings({ crew: { paused: true } });
      log("owner", "Paused the whole crew.", { level: "warn" });
      return { ok: true, say: "The whole crew is paused. Nothing will be scanned, built or sent until you resume." };
    }
    patchSettings({ crew: { pausedAgents: [...new Set([...s().crew.pausedAgents, agent])] } });
    log("owner", `Paused the ${agentName(agent)}.`, { level: "warn" });
    return { ok: true, say: `${agentName(agent)} is paused.${agent === "pitcher" ? " No emails will go out." : ""}` };
  },
});

defineCommand({
  name: "resume_crew",
  description: "Resume the whole crew, or one paused agent.",
  risk: "write",
  params: { agent: { type: "string", enum: AGENT_IDS, description: "One agent to resume. Leave empty to resume everything." } },
  run: async (a) => {
    const agent = a.agent as AgentId | undefined;
    if (!agent || agent === "orchestrator") {
      patchSettings({ crew: { paused: false, pausedAgents: [] } });
      log("owner", "Resumed the crew.", { level: "success" });
      void tick();
      return { ok: true, say: "The crew is back to work." };
    }
    patchSettings({ crew: { pausedAgents: s().crew.pausedAgents.filter((x) => x !== agent) } });
    log("owner", `Resumed the ${agentName(agent)}.`, { level: "success" });
    void tick();
    return { ok: true, say: `${agentName(agent)} is back to work.` };
  },
});

// ── Settings ─────────────────────────────────────────────────────────────

interface SettingDef {
  label: string;
  type: "money" | "int" | "bool" | "percent" | "enum";
  enum?: string[];
  get: (s: Settings) => unknown;
  set: (v: number | boolean | string) => unknown;
  min?: number;
  max?: number;
  /** Needs a yes when the change goes this way. */
  risky?: (from: unknown, to: unknown) => boolean;
}

const up = (from: unknown, to: unknown) => Number(to) > Number(from);
const SETTINGS: Record<string, SettingDef> = {
  price: { label: "the website price", type: "money", get: (x) => x.offer.priceCents, set: (v) => ({ offer: { priceCents: v } }), min: 5000, max: 2_000_000, risky: () => true },
  hosting_monthly: { label: "monthly hosting", type: "money", get: (x) => x.offer.hostingMonthlyCents, set: (v) => ({ offer: { hostingMonthlyCents: v } }), min: 0, max: 100_000, risky: () => true },
  delivery_days: { label: "delivery time in days", type: "int", get: (x) => x.offer.deliveryDays, set: (v) => ({ offer: { deliveryDays: v } }), min: 1, max: 30 },
  daily_budget: { label: "the daily budget", type: "money", get: (x) => x.budget.dailyUsd * 100, set: (v) => ({ budget: { dailyUsd: Number(v) / 100 } }), min: 0, max: 100_000, risky: up },
  monthly_budget: { label: "the monthly budget", type: "money", get: (x) => x.budget.monthlyUsd * 100, set: (v) => ({ budget: { monthlyUsd: Number(v) / 100 } }), min: 0, max: 1_000_000, risky: up },
  per_lead_max: { label: "the per-lead spending cap", type: "money", get: (x) => x.budget.perLeadMaxUsd * 100, set: (v) => ({ budget: { perLeadMaxUsd: Number(v) / 100 } }), min: 10, max: 5000, risky: up },
  deal_limit: { label: "the deal approval limit", type: "money", get: (x) => x.escalation.dealOverCents, set: (v) => ({ escalation: { dealOverCents: v } }), min: 0, max: 10_000_000, risky: up },
  min_response_rate: { label: "the response-rate floor", type: "percent", get: (x) => x.escalation.minResponseRate, set: (v) => ({ escalation: { minResponseRate: v } }), min: 0, max: 1 },
  pitches_per_day: { label: "pitches per day", type: "int", get: (x) => x.quotas.pitchesPerDay, set: (v) => ({ quotas: { pitchesPerDay: v } }), min: 0, max: 200, risky: up },
  leads_per_day: { label: "leads built per day", type: "int", get: (x) => x.quotas.leadsPerDay, set: (v) => ({ quotas: { leadsPerDay: v } }), min: 0, max: 200 },
  scans_per_day: { label: "businesses scanned per day", type: "int", get: (x) => x.quotas.scanPerDay, set: (v) => ({ quotas: { scanPerDay: v } }), min: 0, max: 2000 },
  min_score: { label: "the minimum opportunity score", type: "int", get: (x) => x.qualify.minScore, set: (v) => ({ qualify: { minScore: v } }), min: 0, max: 100 },
  pitching_mode: { label: "the pitching mode", type: "enum", enum: ["review", "auto"], get: (x) => x.pitching.mode, set: (v) => ({ pitching: { mode: v } }), risky: (_f, t) => t === "auto" },
  auto_reply: { label: "auto-replies by the Closer", type: "bool", get: (x) => x.pitching.autoReply, set: (v) => ({ pitching: { autoReply: v } }), risky: (_f, t) => t === true },
  videos: { label: "videos", type: "bool", get: (x) => x.media.video, set: (v) => ({ media: { video: v } }) },
  hero_images: { label: "AI hero images", type: "bool", get: (x) => x.media.heroImages, set: (v) => ({ media: { heroImages: v } }) },
  call_me: { label: "phone calls from Atlas for escalations", type: "bool", get: (x) => x.escalation.callOwner, set: (v) => ({ escalation: { callOwner: v } }) },
  pause_on_low_response: { label: "pausing the Pitcher when the response rate drops", type: "bool", get: (x) => x.escalation.pauseOnLowResponse, set: (v) => ({ escalation: { pauseOnLowResponse: v } }) },
  send_window_start: { label: "the send window start hour", type: "int", get: (x) => x.pitching.sendWindow.startHour, set: (v) => ({ pitching: { sendWindow: { startHour: v } } }), min: 0, max: 23 },
  send_window_end: { label: "the send window end hour", type: "int", get: (x) => x.pitching.sendWindow.endHour, set: (v) => ({ pitching: { sendWindow: { endHour: v } } }), min: 1, max: 24 },
  weekdays_only: { label: "weekday-only sending", type: "bool", get: (x) => x.pitching.sendWindow.weekdaysOnly, set: (v) => ({ pitching: { sendWindow: { weekdaysOnly: v } } }) },
  email_channel: { label: "the email channel", type: "bool", get: (x) => x.pitching.channels.email, set: (v) => ({ pitching: { channels: { email: v } } }) },
  sms_channel: { label: "the text channel", type: "bool", get: (x) => x.pitching.channels.sms, set: (v) => ({ pitching: { channels: { sms: v } } }) },
  dm_channel: { label: "the DM channel", type: "bool", get: (x) => x.pitching.channels.dm, set: (v) => ({ pitching: { channels: { dm: v } } }) },
  call_channel: { label: "the call channel", type: "bool", get: (x) => x.pitching.channels.call, set: (v) => ({ pitching: { channels: { call: v } } }) },
};

function parseSetting(def: SettingDef, raw: string): { ok: true; value: number | boolean | string } | { ok: false; say: string } {
  const t = raw.trim().toLowerCase();
  if (def.type === "bool") {
    if (["on", "true", "yes", "enable", "enabled", "1"].includes(t)) return { ok: true, value: true };
    if (["off", "false", "no", "disable", "disabled", "0"].includes(t)) return { ok: true, value: false };
    return { ok: false, say: `Should ${def.label} be on or off?` };
  }
  if (def.type === "enum") {
    const hit = def.enum!.find((e) => t.includes(e));
    return hit ? { ok: true, value: hit } : { ok: false, say: `${def.label} can be ${def.enum!.join(" or ")}.` };
  }
  let n = Number(t.replace(/[$,%\s]|dollars?|cents?|percent/g, ""));
  if (!Number.isFinite(n)) return { ok: false, say: `I need a number for ${def.label}.` };
  if (def.type === "money") n = Math.round(n * 100);
  if (def.type === "percent") n = n > 1 ? n / 100 : n;
  if (def.type === "int") n = Math.round(n);
  if ((def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max)) return { ok: false, say: `That's outside the allowed range for ${def.label}.` };
  return { ok: true, value: n };
}

function showSetting(def: SettingDef, v: unknown): string {
  if (def.type === "money") return money(Number(v), getSettings().offer.currency);
  if (def.type === "percent") return pct(Number(v));
  if (def.type === "bool") return v ? "on" : "off";
  return String(v);
}

defineCommand({
  name: "update_setting",
  description: `Change one setting. Names: ${Object.keys(SETTINGS).join(", ")}. Money values are in dollars, rates in percent.`,
  risk: "confirm",
  params: {
    path: { type: "string", required: true, enum: Object.keys(SETTINGS), description: "Which setting." },
    value: { type: "string", required: true, description: "The new value, e.g. 600, 25, on, off, auto, review." },
  },
  confirm: (a) => {
    const def = SETTINGS[String(a.path)];
    if (!def) return undefined;
    const v = parseSetting(def, String(a.value));
    if (!v.ok) return undefined;
    const from = def.get(getSettings());
    return def.risky?.(from, v.value) ? `Change ${def.label} from ${showSetting(def, from)} to ${showSetting(def, v.value)}.` : undefined;
  },
  run: async (a) => {
    const def = SETTINGS[String(a.path)];
    if (!def) return { ok: false, say: "I don't know that setting." };
    const v = parseSetting(def, String(a.value));
    if (!v.ok) return { ok: false, say: v.say };
    const from = def.get(getSettings());
    patchSettings(def.set(v.value));
    log("owner", `Changed ${def.label} from ${showSetting(def, from)} to ${showSetting(def, v.value)}.`);
    return { ok: true, say: `Done: ${def.label} is now ${showSetting(def, v.value)}.` };
  },
});

const CA = new Set(["ON", "QC", "BC", "AB", "MB", "SK", "NS", "NB", "NL", "PE", "YT", "NT", "NU"]);
const countryFor = (region: string) => (CA.has(region.toUpperCase()) ? "CA" : "US") as "US" | "CA";
const titleCase = (t: string) => t.replace(/\b\w/g, (c) => c.toUpperCase());

defineCommand({
  name: "add_target",
  description: "Add a city (with its state or province) and/or a kind of business to the Scout's target list.",
  risk: "write",
  params: {
    city: { type: "string", description: "City to add, e.g. Asheville." },
    region: { type: "string", description: "State or province code, e.g. NC, TX, ON." },
    niche: { type: "string", description: "Kind of business to add, e.g. med spas, electricians." },
  },
  run: async (a) => {
    const cur = getSettings();
    const said: string[] = [];
    if (str(a.city)) {
      const region = str(a.region)?.toUpperCase();
      if (!region) return { ok: false, say: `Which state or province is ${a.city} in?` };
      const city = titleCase(str(a.city)!);
      if (!cur.targets.cities.some((c) => c.city.toLowerCase() === city.toLowerCase())) {
        patchSettings({ targets: { cities: [...cur.targets.cities, { city, region, country: countryFor(region) }] } });
        said.push(`${city}, ${region}`);
      }
    }
    if (str(a.niche)) {
      const n = matchNiche(str(a.niche));
      if (!n) return { ok: false, say: `I don't know "${a.niche}". Try ${NICHES.slice(0, 6).map((x) => x.plural).join(", ")}.` };
      if (!getSettings().targets.niches.includes(n.id)) {
        patchSettings({ targets: { niches: [...getSettings().targets.niches, n.id] } });
        said.push(n.plural);
      }
    }
    if (!said.length) return { ok: true, say: "That's already on the list." };
    log("owner", `Added ${said.join(" and ")} to the targets.`);
    void tick();
    return { ok: true, say: `Added ${said.join(" and ")}. The Scout will get to ${said.length > 1 ? "them" : "it"} next.` };
  },
});

defineCommand({
  name: "remove_target",
  description: "Remove a city and/or a kind of business from the Scout's target list.",
  risk: "write",
  params: { city: { type: "string", description: "City to remove." }, niche: { type: "string", description: "Kind of business to remove." } },
  run: async (a) => {
    const cur = getSettings();
    const said: string[] = [];
    if (str(a.city)) {
      const left = cur.targets.cities.filter((c) => c.city.toLowerCase() !== str(a.city)!.toLowerCase());
      if (left.length !== cur.targets.cities.length) (patchSettings({ targets: { cities: left } }), said.push(titleCase(str(a.city)!)));
    }
    if (str(a.niche)) {
      const n = matchNiche(str(a.niche));
      if (n && cur.targets.niches.includes(n.id)) (patchSettings({ targets: { niches: getSettings().targets.niches.filter((x) => x !== n.id) } }), said.push(n.plural));
    }
    if (!said.length) return { ok: false, say: "That wasn't on the target list." };
    log("owner", `Removed ${said.join(" and ")} from the targets.`);
    return { ok: true, say: `Removed ${said.join(" and ")}.` };
  },
});

// ── Outreach ─────────────────────────────────────────────────────────────

defineCommand({
  name: "send_pitch",
  description: "Send the drafted pitch email to one business right now (skipping the queue and send window).",
  risk: "confirm",
  params: { lead: { type: "string", required: true, description: "Business name or id." } },
  confirm: (a) => {
    const r = resolveLead(str(a.lead));
    const m = r.lead && messagesFor(r.lead.id).find((x) => x.kind === "pitch" && x.status !== "sent");
    return r.lead && m ? `Send the pitch to ${r.lead.name} now: "${m.subject}".` : undefined;
  },
  run: async (a) => {
    const r = resolveLead(str(a.lead));
    if (!r.lead) return { ok: false, say: r.say! };
    const ap = pendingApprovalFor(r.lead.id, "pitch");
    if (ap) decideApproval(ap.id, "approved", "voice");
    const res = await sendPitchNow(r.lead);
    return res.ok ? { ok: true, say: `Sent the pitch to ${r.lead.name}${res.simulated ? " (to the outbox; nothing really goes out in demo mode)" : ""}.` } : { ok: false, say: res.error ?? "It didn't send." };
  },
});

defineCommand({
  name: "draft_reply",
  description: "Have the Closer draft a reply to a business, optionally following the owner's instructions (e.g. 'say we can connect their domain'). The draft waits for approval.",
  risk: "write",
  slow: true,
  params: { lead: { type: "string", required: true, description: "Business name or id." }, instructions: { type: "string", description: "What the reply should say." } },
  run: async (a) => {
    const r = resolveLead(str(a.lead));
    if (!r.lead) return { ok: false, say: r.say! };
    const d = await draftReply(r.lead, str(a.instructions));
    if (!d) return { ok: false, say: "There's nothing to reply to yet." };
    return { ok: true, say: `Here's the draft: "${clip(d.body.split("\n—\n")[0], 260)}" Want me to send it?`, data: { messageId: d.id, body: d.body } };
  },
});

defineCommand({
  name: "send_reply",
  description: "Send the Closer's drafted reply to a business (or a reply you dictate in body).",
  risk: "confirm",
  params: { lead: { type: "string", required: true, description: "Business name or id." }, body: { type: "string", description: "Exact reply text, if you're dictating it." } },
  confirm: (a) => {
    const r = resolveLead(str(a.lead));
    if (!r.lead) return undefined;
    const draft = messagesFor(r.lead.id).filter((m) => m.kind === "reply" && m.status === "pending_approval").pop();
    const text = str(a.body) ?? draft?.body.split("\n—\n")[0];
    return text ? `Send this to ${r.lead.name}: "${clip(text, 200)}".` : undefined;
  },
  run: async (a) => {
    const r = resolveLead(str(a.lead));
    if (!r.lead) return { ok: false, say: r.say! };
    const res = await sendReplyNow(r.lead, str(a.body));
    return res.ok ? { ok: true, say: `Sent${res.simulated ? " (to the outbox, demo mode)" : ""}.` } : { ok: false, say: res.error ?? "It didn't send." };
  },
});

const OUTCOMES = ["called_no_answer", "called_interested", "called_not_interested", "texted", "dm_sent", "messaged", "replied", "meeting_booked", "won", "lost", "dnc"] as const;

defineCommand({
  name: "log_outcome",
  description: "Record what happened with a business outside the app: a call (no answer / interested / not interested), a text or DM you sent, a meeting booked, a sale (won, with amount in dollars), lost, or do-not-contact.",
  risk: "write",
  params: {
    lead: { type: "string", required: true, description: "Business name or id." },
    outcome: { type: "string", required: true, enum: OUTCOMES, description: "What happened." },
    note: { type: "string", description: "Anything worth remembering." },
    amount: { type: "number", description: "For won: what they paid, in dollars." },
  },
  run: async (a) => {
    const r = resolveLead(str(a.lead));
    if (!r.lead) return { ok: false, say: r.say! };
    const l = r.lead;
    const outcome = String(a.outcome) as (typeof OUTCOMES)[number];
    const note = str(a.note);
    const stamp = (text: string) => `${l.notes ? `${l.notes}\n` : ""}${new Date().toLocaleDateString("en-US")}: ${text}${note ? ` (${note})` : ""}`;
    if (outcome === "won") {
      const cents = a.amount !== undefined ? Math.round(Number(a.amount) * 100) : (l.dealValueCents ?? l.priceCents);
      await markPaid(l, { amountCents: cents, currency: s().offer.currency, externalId: newId("manual"), provider: "manual" });
      return { ok: true, say: `Marked ${l.name} as won for ${money(cents, s().offer.currency)}. Their site is going live.` };
    }
    if (outcome === "dnc") {
      if (l.email) suppress(l.email, "email", "owner marked do-not-contact");
      if (l.phone) suppress(l.phone, "phone", "owner marked do-not-contact");
      suppress(l.sourceId, "place", "owner marked do-not-contact");
      cancelQueued(l.id, "Do not contact");
      leadChanged(updateLead(l.id, (x) => ((x.status = "dnc"), (x.notes = stamp("Do not contact"))))!);
      return { ok: true, say: `${l.name} is on the do-not-contact list.` };
    }
    const map: Record<string, { status?: LeadStatus; text: string; tap?: "call" | "sms" | "dm" }> = {
      called_no_answer: { text: "Called, no answer", tap: "call" },
      called_interested: { status: "negotiating", text: "Called: interested", tap: "call" },
      called_not_interested: { status: "lost", text: "Called: not interested", tap: "call" },
      texted: { text: "Sent a text", tap: "sms" },
      dm_sent: { text: "Sent a DM", tap: "dm" },
      messaged: { text: "Sent a DM", tap: "dm" },
      replied: { status: "replied", text: "They replied" },
      meeting_booked: { status: "negotiating", text: "Meeting booked" },
      lost: { status: "lost", text: "Lost" },
    };
    const m = map[outcome];
    if (m.tap) markTapDone(l.id, m.tap);
    if (m.status === "lost" || m.status === "negotiating") cancelQueued(l.id, m.text);
    const updated = updateLead(l.id, (x) => {
      if (m.status) x.status = m.status;
      if (m.tap) x.lastContactAt = nowIso();
      if (m.tap && x.status === "ready") x.status = "pitched";
      if (m.tap) x.firstPitchAt ??= nowIso();
      x.notes = stamp(m.text);
    })!;
    leadChanged(updated);
    log("owner", `${m.text}${note ? `: ${note}` : ""}`, { lead: updated });
    return { ok: true, say: `Logged: ${m.text.toLowerCase()} for ${l.name}.` };
  },
});

defineCommand({
  name: "add_note",
  description: "Add a note to a business.",
  risk: "write",
  params: { lead: { type: "string", required: true, description: "Business name or id." }, note: { type: "string", required: true, description: "The note." } },
  run: async (a) => {
    const r = resolveLead(str(a.lead));
    if (!r.lead) return { ok: false, say: r.say! };
    updateLead(r.lead.id, (x) => (x.notes = `${x.notes ? `${x.notes}\n` : ""}${new Date().toLocaleDateString("en-US")}: ${a.note}`));
    log("owner", `Note: ${a.note}`, { lead: r.lead });
    return { ok: true, say: "Noted." };
  },
});

defineCommand({
  name: "add_lead",
  description: "Add a business by hand (someone you met, a referral). The Scout checks its website and the crew takes it from there. Set has_permission only if they asked you to contact them.",
  risk: "write",
  params: {
    name: { type: "string", required: true, description: "Business name." },
    city: { type: "string", required: true, description: "City." },
    region: { type: "string", description: "State or province code." },
    niche: { type: "string", description: "Kind of business." },
    phone: { type: "string", description: "Phone number." },
    website: { type: "string", description: "Current website, if any." },
    email: { type: "string", description: "Email address." },
    has_permission: { type: "boolean", description: "True if they asked you to get in touch, so emailing them is fine." },
  },
  run: async (a) => {
    const now = nowIso();
    const niche = matchNiche(str(a.niche))?.id ?? getSettings().targets.niches[0] ?? "plumber";
    const region = str(a.region)?.toUpperCase();
    const lead: Lead = {
      id: newId("ld"),
      source: "manual",
      sourceId: newId("manual"),
      name: String(a.name),
      niche,
      city: titleCase(String(a.city)),
      region,
      country: region ? countryFor(region) : "US",
      phone: str(a.phone),
      website: str(a.website),
      email: str(a.email)?.toLowerCase(),
      consent: a.has_permission ? { basis: "inquiry", at: now, note: "Added by the owner, who has permission to contact them" } : undefined,
      status: "new",
      priceCents: getSettings().offer.priceCents,
      followupsSent: 0,
      createdAt: now,
      updatedAt: now,
    };
    if (DEMO && !lead.website) lead.demo = { state: "none" };
    saveLead(lead);
    leadChanged(lead);
    log("owner", `Added ${lead.name} (${lead.city}) by hand.`, { lead });
    void tick();
    return { ok: true, say: `Added ${lead.name}. The Scout is checking them now.`, data: { id: lead.id } };
  },
});

defineCommand({
  name: "rebuild",
  description: "Redo part of a lead's work: new mockups, a new video, a rewritten pitch, or all of it.",
  risk: "write",
  params: { lead: { type: "string", required: true, description: "Business name or id." }, what: { type: "string", required: true, enum: ["mockups", "video", "pitch", "all"], description: "What to redo." } },
  run: async (a) => {
    const r = resolveLead(str(a.lead));
    if (!r.lead) return { ok: false, say: r.say! };
    const l = r.lead;
    if (["pitched", "replied", "negotiating", "won"].includes(l.status) && a.what !== "video" && a.what !== "mockups") return { ok: false, say: `${l.name} has already been pitched, so I won't rewrite what they've seen.` };
    const to: Record<string, LeadStatus> = { mockups: "diagnosed", video: "built", pitch: "filmed", all: "qualified" };
    cancelPendingPitch(l);
    const updated = updateLead(l.id, (x) => {
      if (!["pitched", "replied", "negotiating", "won"].includes(x.status)) x.status = to[String(a.what)];
      x.error = undefined;
      x.errorStage = undefined;
      x.attempts = 0;
      x.retryAt = undefined;
      if (a.what === "mockups" || a.what === "all") x.variants = undefined;
    })!;
    leadChanged(updated);
    if (["pitched", "replied", "negotiating", "won"].includes(l.status)) void runOnLead(a.what === "video" ? "filmer" : "builder", updated).catch(() => undefined);
    else void tick();
    return { ok: true, say: `Redoing the ${a.what === "all" ? "whole thing" : a.what} for ${l.name}. It'll take a minute or two.` };
  },
});

defineCommand({
  name: "get_activity",
  description: "The latest things the crew did, optionally for one agent.",
  risk: "read",
  params: { agent: { type: "string", enum: [...AGENT_IDS, "owner", "system"], description: "Only this agent." }, limit: { type: "integer", description: "How many (default 8, max 30)." } },
  run: async (a) => {
    const ev = listEvents({ agent: str(a.agent), limit: Math.min(Number(a.limit ?? 8), 30) });
    if (!ev.length) return { ok: true, say: "Nothing yet.", data: { events: [] } };
    return {
      ok: true,
      say: ev.slice(0, 3).map((e) => `${agentName(e.agent)}: ${e.leadName ? `${e.leadName}, ` : ""}${clip(e.message, 120)}`).join(". "),
      data: { events: ev.map((e) => ({ when: e.ts, agent: agentName(e.agent), level: e.level, lead: e.leadName, message: e.message })) },
    };
  },
});

defineCommand({
  name: "get_spend",
  description: "What the crew spent (Claude, Google, ElevenLabs, email) against the daily and monthly budgets, plus the ElevenLabs credit balance.",
  risk: "read",
  params: { period: { type: "string", enum: ["today", "month"], description: "today or month (default today)." } },
  run: async (a) => {
    const tz = s().owner.timezone;
    const since = str(a.period) === "month" ? localMonthStart(tz) : localDayStart(tz);
    const b = budget();
    const rows = spendBreakdown(since);
    const byProvider = new Map<string, number>();
    for (const r of rows) byProvider.set(r.provider, (byProvider.get(r.provider) ?? 0) + r.usd);
    const c = await elevenCredits();
    const top = [...byProvider].sort((x, y) => y[1] - x[1]);
    return {
      ok: true,
      say: `${str(a.period) === "month" ? "This month" : "Today"} the crew spent $${(str(a.period) === "month" ? b.monthUsd : b.todayUsd).toFixed(2)} of $${str(a.period) === "month" ? b.monthlyUsd : b.dailyUsd}${top.length ? `, mostly ${top.slice(0, 2).map(([p, v]) => `${p} at $${v.toFixed(2)}`).join(" and ")}` : ""}.${c ? ` ElevenLabs has ${c.remaining.toLocaleString()} characters left.` : ""}`,
      data: { budget: b, byProvider: Object.fromEntries(top.map(([p, v]) => [p, Math.round(v * 100) / 100])), byAgent: rows, elevenlabs: c },
    };
  },
});

defineCommand({
  name: "get_call_list",
  description: "Today's one-tap list: businesses to call, text or DM from the owner's phone (mostly ones with no published email), with phone numbers and what to say.",
  risk: "read",
  params: {},
  run: async () => {
    const items = oneTapItems(30).filter((i) => !i.done);
    const calls = items.filter((i) => i.channel === "call");
    if (!items.length) return { ok: true, say: "Your call and text list is clear.", data: { items: [] } };
    return {
      ok: true,
      say: `${calls.length} call${calls.length === 1 ? "" : "s"} and ${items.length - calls.length} texts or DMs to send. ${calls[0] ? `First call: ${calls[0].leadName}, ${calls[0].phone}.` : ""} The scripts are on your Outreach screen.`,
      data: { items: items.map((i) => ({ lead: i.leadName, channel: i.channel, phone: i.phone, say: clip(i.text, 400) })) },
    };
  },
});

// Handled by the dashboard (navigation); listed so Atlas knows it exists.
defineCommand({
  name: "open_screen",
  description: "Show a screen in the app: today, pipeline, outreach, approvals, crew, settings, activity, or a lead (pass lead_id). Only works in the app, not on phone calls.",
  risk: "read",
  clientOnly: true,
  params: {
    screen: { type: "string", required: true, enum: ["today", "pipeline", "outreach", "approvals", "crew", "settings", "activity", "lead"], description: "Which screen." },
    lead_id: { type: "string", description: "For screen=lead: the lead id from find_leads or get_lead." },
  },
  run: async () => ({ ok: false, say: "Opening screens only works in the app." }),
});

export const COMMANDS_READY = true;

/** For the dashboard: run a confirmed command result into an approval decision. */
export async function quickDecision(id: string, decision: "approve" | "reject"): Promise<CommandResult> {
  const r = await applyDecision(id, decision, "dashboard");
  return { ok: r.ok, say: r.say };
}
