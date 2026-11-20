import "server-only";
import { STAGES, type Lead, type Prospect, type Stage } from "@/lib/types";
import { claudeEnabled } from "@/lib/config";
import { getNiche } from "@/lib/niches";
import { domainOf } from "@/lib/net";
import { auditWebsite } from "@/lib/prospecting/audit";
import { deriveSignals, scoreProspect, topSignals } from "@/lib/prospecting/score";
import { findBusinesses, resolveNiche, scoreAll } from "@/lib/prospecting/search";
import { generateCampaign, templateCampaign, toCampaign } from "@/lib/claude/ads";
import { researchWeb } from "@/lib/claude/research";
import {
  createDraft,
  createTask,
  getLead,
  getProfile,
  listDrafts,
  listLeads,
  listTasks,
  saveCampaign,
  saveProspects,
  updateLead,
} from "@/lib/repo";
import type { AgentId, ToolName } from "./roster";

export interface ToolContext {
  runId: string;
  agentId: AgentId;
  /** Prospects returned by find_businesses in this run, by key. */
  prospects: Map<string, Prospect>;
}

export interface ToolDef {
  name: ToolName;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  /** Human-readable step for the run timeline. */
  describe: (input: Record<string, unknown>) => string;
  run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<{ result: unknown; summary: string }>;
}

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);
const int = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : dflt;
};
const STAGE_IDS = STAGES.map((s) => s.id);

function compactLead(l: Lead, drafts: number) {
  return {
    lead_id: l.id,
    name: l.name,
    niche: l.niche,
    stage: l.stage,
    score: l.score,
    city: l.city ?? l.address,
    website: domainOf(l.website) ?? null,
    phone: l.phone ?? null,
    email: l.email ?? null,
    rating: l.rating ?? null,
    reviews: l.reviewCount ?? null,
    top_gaps: topSignals(l.signals, 3).map((s) => s.label),
    next_step: l.nextStep ?? null,
    last_contact: l.lastContactAt ?? null,
    pending_drafts: drafts,
  };
}

export const TOOLS: Record<ToolName, ToolDef> = {
  pipeline_summary: {
    name: "pipeline_summary",
    description: "Counts of leads per stage, pipeline value, hot leads, drafts waiting for approval and overdue tasks. Call this first to orient yourself.",
    input_schema: { type: "object", properties: {} },
    describe: () => "Reviewing the pipeline",
    run: async () => {
      const [leads, drafts, tasks] = await Promise.all([listLeads(), listDrafts(), listTasks()]);
      const byStage = Object.fromEntries(STAGES.map((s) => [s.id, leads.filter((l) => l.stage === s.id).length]));
      const open = leads.filter((l) => l.stage !== "won" && l.stage !== "lost");
      const now = Date.now();
      const result = {
        leads_by_stage: byStage,
        open_pipeline_value_per_month: open.reduce((a, l) => a + (l.value ?? 0), 0),
        won_value_per_month: leads.filter((l) => l.stage === "won").reduce((a, l) => a + (l.value ?? 0), 0),
        hot_new_leads: leads.filter((l) => l.stage === "new" && (l.score ?? 0) >= 70).length,
        stale_contacted: leads.filter((l) => l.stage === "contacted" && l.lastContactAt && now - Date.parse(l.lastContactAt) > 5 * 86400_000).length,
        drafts_awaiting_approval: drafts.filter((d) => d.status === "pending").length,
        open_tasks: tasks.filter((t) => !t.done).length,
        overdue_tasks: tasks.filter((t) => !t.done && t.due && Date.parse(t.due) < now).length,
      };
      return { result, summary: `${open.length} open leads, ${result.drafts_awaiting_approval} drafts waiting` };
    },
  },

  find_businesses: {
    name: "find_businesses",
    description:
      "Search for local businesses in a niche around a city (Google Places if configured, otherwise OpenStreetMap). Optionally audits the websites of the first results. Returns businesses with an opportunity score (0-100, higher = more need and ability to pay) and their biggest gaps. Results are NOT saved; call save_leads with their keys.",
    input_schema: {
      type: "object",
      properties: {
        niche: { type: "string", description: "Niche id or plain words, e.g. 'dentist', 'med spa', 'roofer', 'hvac'" },
        location: { type: "string", description: "City and province or state, e.g. 'Toronto, ON', 'Halifax, NS' or 'Austin, TX'. Other countries: 'City, Country'." },
        limit: { type: "integer", description: "How many businesses to return, 5-40. Default 20." },
        audit_top: { type: "integer", description: "Audit the websites of this many results, 0-15. Default 10." },
        radius_km: { type: "integer", description: "Search radius for map search, 2-40 km. Default 12." },
      },
      required: ["niche", "location"],
    },
    describe: (i) => `Searching for ${resolveNiche(String(i.niche ?? "")).plural} near ${String(i.location ?? "")}`,
    run: async (input, ctx) => {
      const res = await findBusinesses({
        niche: String(input.niche ?? ""),
        location: String(input.location ?? ""),
        limit: int(input.limit, 5, 40, 20),
        audit: int(input.audit_top, 0, 15, 10),
        radiusKm: int(input.radius_km, 2, 40, 12),
      });
      for (const p of res.prospects) ctx.prospects.set(p.key, p);
      const audited = res.prospects.filter((p) => p.audit).length;
      return {
        result: {
          source: res.source,
          note: res.note ?? null,
          businesses: res.prospects.map((p) => ({
            key: p.key,
            name: p.name,
            address: p.address ?? null,
            website: domainOf(p.website) ?? null,
            phone: p.phone ?? null,
            rating: p.rating ?? null,
            reviews: p.reviewCount ?? null,
            score: p.score,
            audited: Boolean(p.audit),
            site_error: p.audit && !p.audit.reachable ? p.audit.error ?? "unreachable" : null,
            gaps: topSignals(p.signals, 4).map((s) => s.label),
            strengths: (p.signals ?? []).filter((s) => s.positive).map((s) => s.label),
            already_in_pipeline: Boolean(p.savedLeadId),
          })),
        },
        summary: `Found ${res.prospects.length} businesses${audited ? `, audited ${audited} websites` : ""}`,
      };
    },
  },

  audit_website: {
    name: "audit_website",
    description:
      "Fetch a business website and report what it has and lacks: HTTPS, mobile-friendliness, speed, online booking, chat, ad pixels, analytics, contact form, schema, socials, emails. If lead_id is given, the audit and its findings are saved on that lead.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Website URL or domain" },
        lead_id: { type: "string", description: "Optional lead to attach the audit to" },
      },
      required: ["url"],
    },
    describe: (i) => `Auditing ${domainOf(String(i.url ?? "")) ?? String(i.url ?? "website")}`,
    run: async (input) => {
      const a = await auditWebsite(String(input.url ?? ""));
      const leadId = str(input.lead_id, 80);
      let signals = deriveSignals({ website: String(input.url), audit: a });
      if (leadId) {
        const lead = await getLead(leadId);
        if (lead) {
          const niche = getNiche(lead.niche);
          const base = { website: lead.website ?? String(input.url), phone: lead.phone, rating: lead.rating, reviewCount: lead.reviewCount, booking: niche?.booking, retainerMid: niche?.retainerMid, audit: a, source: lead.source };
          signals = deriveSignals(base);
          await updateLead(leadId, { audit: a, signals, score: scoreProspect(base, signals), email: lead.email ?? a.emails[0] });
        }
      }
      return {
        result: {
          reachable: a.reachable,
          error: a.error ?? null,
          https: a.https,
          mobile_friendly: a.mobileViewport,
          response_ms: a.responseMs ?? null,
          title: a.title ?? null,
          main_heading: a.h1 ?? null,
          booking: a.booking,
          chat: a.chat,
          ad_pixels: a.pixels,
          analytics: a.analytics,
          platform: a.cms ?? null,
          contact_form: a.hasContactForm,
          click_to_call: a.hasClickToCall,
          copyright_year: a.copyrightYear ?? null,
          socials: a.socials,
          emails_found: a.emails,
          findings: signals.map((s) => ({ finding: s.label, detail: s.detail, sells: s.pitch ?? null, positive: Boolean(s.positive) })),
        },
        summary: a.reachable ? `${signals.filter((s) => !s.positive).length} gaps found` : `Site didn't load (${a.error ?? "error"})`,
      };
    },
  },

  save_leads: {
    name: "save_leads",
    description:
      "Save businesses to the pipeline as new leads. Pass keys from find_businesses (preferred), or name + details for a business you found another way. Duplicates are skipped automatically.",
    input_schema: {
      type: "object",
      properties: {
        leads: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string", description: "Key from find_businesses" },
              name: { type: "string" },
              niche: { type: "string" },
              website: { type: "string" },
              phone: { type: "string" },
              email: { type: "string" },
              address: { type: "string" },
              notes: { type: "string", description: "One sentence: why it's a fit and the best opening angle" },
            },
          },
        },
      },
      required: ["leads"],
    },
    describe: (i) => `Saving ${Array.isArray(i.leads) ? i.leads.length : 0} leads to the pipeline`,
    run: async (input, ctx) => {
      const items = Array.isArray(input.leads) ? (input.leads as Record<string, unknown>[]).slice(0, 40) : [];
      const notes = new Map<string, string>();
      const prospects: Prospect[] = [];
      for (const it of items) {
        const key = str(it.key, 200);
        const cached = key ? ctx.prospects.get(key) : undefined;
        let p: Prospect | undefined = cached;
        if (!p) {
          const name = str(it.name, 160);
          if (!name) continue;
          const niche = resolveNiche(str(it.niche, 60) ?? "custom");
          [p] = scoreAll(
            [{ key: `agent:${name}`, name, niche: niche.id, website: str(it.website, 300), phone: str(it.phone, 40), email: str(it.email, 120), address: str(it.address, 200), source: "agent" }],
            niche
          );
        }
        prospects.push(p);
        const note = str(it.notes, 500);
        if (note) notes.set(p.name, note);
      }
      const { saved, skipped } = await saveProspects(prospects, { createdBy: `agent:${ctx.agentId}` });
      for (const l of saved) {
        const note = notes.get(l.name);
        if (note) await updateLead(l.id, { notes: note }, `agent:${ctx.agentId}`);
      }
      return {
        result: { saved: saved.map((l) => ({ lead_id: l.id, name: l.name, score: l.score })), skipped },
        summary: `Saved ${saved.length}${skipped.length ? `, skipped ${skipped.length} duplicates` : ""}`,
      };
    },
  },

  list_leads: {
    name: "list_leads",
    description: "List leads in the pipeline, highest score first, with their stage, gaps, next step and pending drafts.",
    input_schema: {
      type: "object",
      properties: {
        stage: { type: "string", enum: STAGE_IDS, description: "Only this stage" },
        niche: { type: "string", description: "Only this niche" },
        min_score: { type: "integer", description: "Only leads scoring at least this" },
        without_pending_draft: { type: "boolean", description: "Skip leads that already have a draft waiting" },
        limit: { type: "integer", description: "Max results, default 15" },
      },
    },
    describe: (i) => `Looking at ${i.stage ? `${String(i.stage)} ` : ""}leads`,
    run: async (input) => {
      const [leads, drafts] = await Promise.all([listLeads(), listDrafts()]);
      const pending = new Map<string, number>();
      for (const d of drafts) if (d.status === "pending" && d.leadId) pending.set(d.leadId, (pending.get(d.leadId) ?? 0) + 1);
      const stage = str(input.stage, 20) as Stage | undefined;
      const niche = str(input.niche, 40);
      const minScore = typeof input.min_score === "number" ? input.min_score : undefined;
      let rows = leads.filter(
        (l) =>
          (!stage || l.stage === stage) &&
          (!niche || l.niche === niche || resolveNiche(niche).id === l.niche) &&
          (minScore === undefined || (l.score ?? 0) >= minScore) &&
          (!input.without_pending_draft || !pending.get(l.id))
      );
      rows = rows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, int(input.limit, 1, 50, 15));
      return { result: { count: rows.length, leads: rows.map((l) => compactLead(l, pending.get(l.id) ?? 0)) }, summary: `${rows.length} leads` };
    },
  },

  get_lead: {
    name: "get_lead",
    description: "Everything about one lead: contact details, audit findings, notes, next step and drafts.",
    input_schema: { type: "object", properties: { lead_id: { type: "string" } }, required: ["lead_id"] },
    describe: () => "Reading a lead",
    run: async (input) => {
      const lead = await getLead(String(input.lead_id ?? ""));
      if (!lead) return { result: { error: "No lead with that id" }, summary: "Lead not found" };
      const drafts = (await listDrafts()).filter((d) => d.leadId === lead.id);
      const niche = getNiche(lead.niche);
      return {
        result: {
          ...compactLead(lead, drafts.filter((d) => d.status === "pending").length),
          contact_name: lead.contactName ?? null,
          address: lead.address ?? null,
          notes: lead.notes ?? null,
          findings: (lead.signals ?? []).map((s) => ({ finding: s.label, detail: s.detail, sells: s.pitch ?? null, positive: Boolean(s.positive) })),
          audited: Boolean(lead.audit),
          site_title: lead.audit?.title ?? null,
          drafts: drafts.slice(0, 5).map((d) => ({ channel: d.channel, status: d.status, subject: d.subject ?? null, created: d.createdAt })),
          niche_context: niche ? { pain_points: niche.painPoints, offers_that_work: niche.offers, typical_retainer: niche.retainer } : null,
        },
        summary: lead.name,
      };
    },
  },

  update_lead: {
    name: "update_lead",
    description: "Update a lead: stage, next step, contact name, email, or append a note. Only change the stage when the data clearly supports it.",
    input_schema: {
      type: "object",
      properties: {
        lead_id: { type: "string" },
        stage: { type: "string", enum: STAGE_IDS },
        next_step: { type: "string" },
        contact_name: { type: "string" },
        email: { type: "string" },
        append_note: { type: "string" },
      },
      required: ["lead_id"],
    },
    describe: (i) => (i.stage ? `Moving a lead to ${String(i.stage)}` : "Updating a lead"),
    run: async (input, ctx) => {
      const lead = await getLead(String(input.lead_id ?? ""));
      if (!lead) return { result: { error: "No lead with that id" }, summary: "Lead not found" };
      const patch: Partial<Lead> = {};
      const stage = str(input.stage, 20) as Stage | undefined;
      if (stage && STAGE_IDS.includes(stage)) patch.stage = stage;
      if (str(input.next_step)) patch.nextStep = str(input.next_step, 300);
      if (str(input.contact_name)) patch.contactName = str(input.contact_name, 120);
      if (str(input.email)) patch.email = str(input.email, 160);
      const note = str(input.append_note, 800);
      if (note) patch.notes = [lead.notes, note].filter(Boolean).join("\n");
      const updated = await updateLead(lead.id, patch, `agent:${ctx.agentId}`);
      return { result: { ok: true, lead_id: updated.id, stage: updated.stage, next_step: updated.nextStep ?? null }, summary: updated.name };
    },
  },

  draft_message: {
    name: "draft_message",
    description:
      "Save an outreach message as a DRAFT for the owner to approve. Nothing is sent. Channels: email (needs subject), sms, dm, call (a call script).",
    input_schema: {
      type: "object",
      properties: {
        lead_id: { type: "string" },
        channel: { type: "string", enum: ["email", "sms", "dm", "call"] },
        subject: { type: "string", description: "Email subject, under 50 characters" },
        body: { type: "string" },
        rationale: { type: "string", description: "One sentence on why this message and angle" },
      },
      required: ["lead_id", "channel", "body"],
    },
    describe: (i) => `Drafting ${i.channel === "email" ? "an email" : i.channel === "sms" ? "a text" : i.channel === "dm" ? "a DM" : "a call script"}`,
    run: async (input, ctx) => {
      const lead = await getLead(String(input.lead_id ?? ""));
      if (!lead) return { result: { error: "No lead with that id" }, summary: "Lead not found" };
      const channel = (["email", "sms", "dm", "call"].includes(String(input.channel)) ? input.channel : "email") as "email" | "sms" | "dm" | "call";
      const body = str(input.body, 4000);
      if (!body) return { result: { error: "body is required" }, summary: "Empty draft" };
      const d = await createDraft({
        leadId: lead.id,
        channel,
        subject: str(input.subject, 120),
        body,
        rationale: str(input.rationale, 300),
        createdBy: `agent:${ctx.agentId}`,
        runId: ctx.runId,
      });
      return { result: { ok: true, draft_id: d.id, to: d.to ?? null, note: d.to ? undefined : "No address on file; the owner will add one before sending." }, summary: `For ${lead.name}` };
    },
  },

  create_ad_campaign: {
    name: "create_ad_campaign",
    description:
      "Write and save a full ad campaign for one business (Meta ads, Google search ads, short video scripts, landing page copy and a creative card). Give a tight brief with real facts you found; the writer won't invent facts.",
    input_schema: {
      type: "object",
      properties: {
        lead_id: { type: "string", description: "Lead in the pipeline, if any" },
        business_name: { type: "string" },
        niche: { type: "string" },
        location: { type: "string" },
        website: { type: "string" },
        goal: { type: "string", description: "e.g. 'Book first-time Botox consults'" },
        offer: { type: "string", description: "The single strongest offer" },
        research_notes: { type: "string", description: "Concrete facts: services, prices/specials they advertise, what reviews praise, competitor offers" },
      },
      required: ["business_name", "goal"],
    },
    describe: (i) => `Building an ad campaign for ${String(i.business_name ?? "a business")}`,
    run: async (input, ctx) => {
      const lead = str(input.lead_id, 80) ? await getLead(String(input.lead_id)) : undefined;
      const brief = {
        leadId: lead?.id,
        businessName: str(input.business_name, 160) ?? lead?.name ?? "Business",
        niche: lead?.niche ?? resolveNiche(str(input.niche, 60) ?? "").id,
        location: str(input.location, 120) ?? lead?.city ?? lead?.address,
        website: str(input.website, 300) ?? lead?.website,
        goal: str(input.goal, 200) ?? "Get more booked appointments",
        offer: str(input.offer, 300),
        research: str(input.research_notes, 4000),
        rating: lead?.rating,
        reviewCount: lead?.reviewCount,
        audit: lead?.audit,
      };
      const content = claudeEnabled() ? await generateCampaign(brief, await getProfile()) : templateCampaign(brief);
      const c = await saveCampaign(toCampaign(content, brief, `agent:${ctx.agentId}`));
      return {
        result: {
          ok: true,
          campaign_id: c.id,
          strategy: c.strategy.summary,
          meta_headlines: c.meta.map((m) => m.headline),
          google_headlines_sample: c.google.headlines.slice(0, 5),
          creative_headline: c.creative.headline,
        },
        summary: `Saved "${c.creative.headline}"`,
      };
    },
  },

  create_task: {
    name: "create_task",
    description: "Create a to-do for the owner, optionally tied to a lead, due in N days.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Clear, actionable, under 80 characters" },
        lead_id: { type: "string" },
        due_in_days: { type: "integer", description: "0 = today" },
      },
      required: ["title"],
    },
    describe: (i) => `Adding task: ${str(i.title, 60) ?? ""}`,
    run: async (input, ctx) => {
      const title = str(input.title, 160);
      if (!title) return { result: { error: "title is required" }, summary: "No title" };
      const days = int(input.due_in_days, 0, 60, 1);
      const due = new Date(Date.now() + days * 86400_000);
      due.setHours(17, 0, 0, 0);
      const t = await createTask({ title, leadId: str(input.lead_id, 80), due: due.toISOString(), createdBy: `agent:${ctx.agentId}` });
      return { result: { ok: true, task_id: t.id, due: t.due }, summary: title };
    },
  },

  list_tasks: {
    name: "list_tasks",
    description: "List the owner's open tasks (and done ones if asked), with due dates.",
    input_schema: { type: "object", properties: { include_done: { type: "boolean" } } },
    describe: () => "Checking the to-do list",
    run: async (input) => {
      const tasks = (await listTasks()).filter((t) => input.include_done || !t.done).slice(0, 40);
      return {
        result: { tasks: tasks.map((t) => ({ task_id: t.id, title: t.title, lead_id: t.leadId ?? null, due: t.due ?? null, done: t.done })) },
        summary: `${tasks.length} tasks`,
      };
    },
  },

  research_web: {
    name: "research_web",
    description:
      "Research a question on the live web (Claude web search). Use for facts about a specific business (services, specials, reviews, owner name, whether a website exists) or a local market. Ask one focused question.",
    input_schema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] },
    describe: (i) => `Researching: ${str(i.question, 80) ?? ""}`,
    run: async (input) => {
      if (!claudeEnabled()) return { result: { error: "Web research needs an Anthropic API key" }, summary: "Unavailable in demo mode" };
      const q = str(input.question, 600);
      if (!q) return { result: { error: "question is required" }, summary: "No question" };
      const r = await researchWeb(q);
      return { result: { answer: r.answer.slice(0, 6000), sources: r.sources }, summary: `${r.sources.length} sources` };
    },
  },
};

export function toolsFor(names: ToolName[]): ToolDef[] {
  return names.map((n) => TOOLS[n]);
}

/** Run a tool and always return a string result plus an error flag. */
export async function executeTool(name: string, input: unknown, ctx: ToolContext, allowed: ToolName[]): Promise<{ text: string; isError: boolean; summary: string }> {
  const tool = (allowed as string[]).includes(name) ? TOOLS[name as ToolName] : undefined;
  if (!tool) return { text: JSON.stringify({ error: `Unknown tool ${name}` }), isError: true, summary: "Unknown tool" };
  const args = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  try {
    const { result, summary } = await tool.run(args, ctx);
    const text = JSON.stringify(result);
    return { text: text.length > 60_000 ? text.slice(0, 60_000) : text, isError: false, summary };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: JSON.stringify({ error: msg }), isError: true, summary: msg };
  }
}
