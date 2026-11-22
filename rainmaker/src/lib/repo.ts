import "server-only";
import { newId, readDb, update } from "./store";
import { deleteAssets } from "./assets";
import { seedDb } from "./seed";
import { getNiche } from "./niches";
import { domainOf } from "./net";
import { STAGES } from "./types";
import type { Activity, AdCampaign, AgencyProfile, Db, Draft, Lead, Prospect, Stage, Task } from "./types";

const now = () => new Date().toISOString();

function pushActivity(db: Db, a: Omit<Activity, "id" | "at">) {
  db.activity.unshift({ id: newId("act"), at: now(), ...a });
}

export async function addActivity(a: Omit<Activity, "id" | "at">) {
  await update((db) => pushActivity(db, a));
}

// ── Profile ───────────────────────────────────────────────────

export async function getProfile(): Promise<AgencyProfile> {
  return (await readDb()).profile;
}

export async function updateProfile(patch: Partial<AgencyProfile>): Promise<AgencyProfile> {
  return update((db) => {
    db.profile = { ...db.profile, ...patch };
    return structuredClone(db.profile);
  });
}

// ── Leads ─────────────────────────────────────────────────────

export async function listLeads(): Promise<Lead[]> {
  return (await readDb()).leads;
}

export async function getLead(id: string): Promise<Lead | undefined> {
  return (await readDb()).leads.find((l) => l.id === id);
}

function norm(s: string | undefined) {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Find an existing lead that is the same business as this prospect. */
export function findDuplicate(leads: Lead[], p: { name: string; sourceId?: string; website?: string; address?: string; city?: string }): Lead | undefined {
  const dom = domainOf(p.website);
  return leads.find(
    (l) =>
      (p.sourceId && l.sourceId === p.sourceId) ||
      (dom && domainOf(l.website) === dom) ||
      (norm(l.name) === norm(p.name) && (norm(l.address) === norm(p.address) || norm(l.city) === norm(p.city)))
  );
}

export async function saveProspects(
  prospects: Prospect[],
  opts: { createdBy: string; stage?: Stage; note?: string }
): Promise<{ saved: Lead[]; skipped: { name: string; reason: string; leadId?: string }[] }> {
  return update((db) => {
    const saved: Lead[] = [];
    const skipped: { name: string; reason: string; leadId?: string }[] = [];
    for (const p of prospects) {
      const dup = findDuplicate(db.leads, p);
      if (dup) {
        skipped.push({ name: p.name, reason: "Already in your pipeline", leadId: dup.id });
        continue;
      }
      const niche = getNiche(p.niche);
      const lead: Lead = {
        id: newId("lead"),
        name: p.name,
        niche: p.niche,
        category: p.category,
        address: p.address,
        city: p.city,
        phone: p.phone,
        email: p.email ?? p.audit?.emails[0],
        website: p.website,
        mapsUrl: p.mapsUrl,
        lat: p.lat,
        lon: p.lon,
        rating: p.rating,
        reviewCount: p.reviewCount,
        source: p.source,
        sourceId: p.sourceId,
        stage: opts.stage ?? "new",
        value: niche?.retainerMid,
        score: p.score,
        signals: p.signals,
        audit: p.audit,
        notes: opts.note,
        sample: p.source === "sample" ? true : undefined,
        createdBy: opts.createdBy,
        createdAt: now(),
        updatedAt: now(),
      };
      db.leads.unshift(lead);
      saved.push(lead);
    }
    if (saved.length) {
      const who = opts.createdBy.startsWith("agent:") ? "An agent" : "You";
      pushActivity(db, {
        kind: "lead",
        text:
          saved.length === 1
            ? `${who} added ${saved[0].name} to the pipeline`
            : `${who} added ${saved.length} leads to the pipeline`,
        leadId: saved.length === 1 ? saved[0].id : undefined,
        agentId: opts.createdBy.startsWith("agent:") ? opts.createdBy.slice(6) : undefined,
      });
    }
    return structuredClone({ saved, skipped });
  });
}

export async function createLead(input: Partial<Lead> & { name: string }, createdBy = "user"): Promise<Lead> {
  const [lead] = (
    await saveProspects(
      [
        {
          key: newId("manual"),
          name: input.name,
          niche: input.niche ?? "dentist",
          website: input.website,
          phone: input.phone,
          email: input.email,
          city: input.city,
          address: input.address,
          source: "manual",
          score: input.score,
          signals: input.signals,
        },
      ],
      { createdBy, stage: input.stage }
    )
  ).saved;
  if (!lead) throw new Error("A lead with that name or website already exists");
  if (input.contactName || input.notes) return updateLead(lead.id, { contactName: input.contactName, notes: input.notes });
  return lead;
}

const EDITABLE: (keyof Lead)[] = [
  "name", "niche", "category", "address", "city", "phone", "email", "website", "stage", "value", "score",
  "signals", "audit", "notes", "tags", "contactName", "nextStep", "lastContactAt", "rating", "reviewCount",
];

export async function updateLead(id: string, patch: Partial<Lead>, actor = "user"): Promise<Lead> {
  return update((db) => {
    const lead = db.leads.find((l) => l.id === id);
    if (!lead) throw new Error("Lead not found");
    const prevStage = lead.stage;
    for (const key of EDITABLE) {
      if (key in patch) (lead as unknown as Record<string, unknown>)[key] = patch[key];
    }
    if (patch.stage && !STAGES.some((s) => s.id === patch.stage)) lead.stage = prevStage;
    lead.updatedAt = now();
    if (lead.stage !== prevStage) {
      const label = STAGES.find((s) => s.id === lead.stage)?.label ?? lead.stage;
      pushActivity(db, {
        kind: "stage",
        text: `${lead.name} moved to ${label}${lead.stage === "won" && lead.value ? ` ($${lead.value.toLocaleString()}/mo)` : ""}`,
        leadId: lead.id,
        agentId: actor.startsWith("agent:") ? actor.slice(6) : undefined,
      });
      if (lead.stage === "contacted" && !lead.lastContactAt) lead.lastContactAt = now();
    }
    return structuredClone(lead);
  });
}

export async function deleteLead(id: string): Promise<void> {
  await update((db) => {
    db.leads = db.leads.filter((l) => l.id !== id);
    db.tasks = db.tasks.filter((t) => t.leadId !== id);
    db.drafts = db.drafts.filter((d) => d.leadId !== id || d.status === "sent");
  });
}

// ── Drafts (outreach waiting for your approval) ───────────────

export async function listDrafts(): Promise<Draft[]> {
  return (await readDb()).drafts;
}

export async function createDraft(input: Omit<Draft, "id" | "createdAt" | "status"> & { status?: Draft["status"] }): Promise<Draft> {
  return update((db) => {
    const lead = input.leadId ? db.leads.find((l) => l.id === input.leadId) : undefined;
    const draft: Draft = {
      ...input,
      leadName: input.leadName ?? lead?.name,
      to: input.to ?? (input.channel === "email" ? lead?.email : input.channel === "sms" || input.channel === "call" ? lead?.phone : undefined),
      id: newId("draft"),
      status: input.status ?? "pending",
      createdAt: now(),
    };
    db.drafts.unshift(draft);
    const agent = input.createdBy.startsWith("agent:") ? input.createdBy.slice(6) : undefined;
    pushActivity(db, {
      kind: "draft",
      text: `${agent ? "An agent" : "You"} drafted ${draft.channel === "email" ? "an email" : draft.channel === "sms" ? "a text" : draft.channel === "dm" ? "a DM" : "a call script"}${draft.leadName ? ` for ${draft.leadName}` : ""}`,
      leadId: draft.leadId,
      agentId: agent,
    });
    return structuredClone(draft);
  });
}

export async function updateDraft(id: string, patch: Partial<Pick<Draft, "subject" | "body" | "to" | "status" | "sentAt" | "sentVia" | "error">>): Promise<Draft> {
  return update((db) => {
    const d = db.drafts.find((x) => x.id === id);
    if (!d) throw new Error("Draft not found");
    Object.assign(d, patch);
    if (patch.status === "sent" && d.leadId) {
      const lead = db.leads.find((l) => l.id === d.leadId);
      if (lead) {
        lead.lastContactAt = now();
        if (lead.stage === "new") lead.stage = "contacted";
        lead.updatedAt = now();
      }
      pushActivity(db, { kind: "draft", text: `Sent ${d.channel === "email" ? "email" : d.channel} to ${d.leadName ?? d.to ?? "lead"}`, leadId: d.leadId });
    }
    return structuredClone(d);
  });
}

// ── Ad campaigns ──────────────────────────────────────────────

export async function listCampaigns(): Promise<AdCampaign[]> {
  return (await readDb()).campaigns;
}

export async function getCampaign(id: string): Promise<AdCampaign | undefined> {
  return (await readDb()).campaigns.find((c) => c.id === id);
}

export async function saveCampaign(c: Omit<AdCampaign, "id" | "createdAt"> & { id?: string }): Promise<AdCampaign> {
  return update((db) => {
    const campaign: AdCampaign = { ...c, id: c.id ?? newId("camp"), createdAt: now() };
    db.campaigns = [campaign, ...db.campaigns.filter((x) => x.id !== campaign.id)];
    const agent = c.createdBy.startsWith("agent:") ? c.createdBy.slice(6) : undefined;
    pushActivity(db, {
      kind: "ad",
      text: `${agent ? "An agent" : "You"} built an ad campaign for ${campaign.businessName}`,
      leadId: campaign.leadId,
      agentId: agent,
    });
    return structuredClone(campaign);
  });
}

export async function deleteCampaign(id: string): Promise<void> {
  const removed = await update((db) => {
    const c = db.campaigns.find((x) => x.id === id);
    db.campaigns = db.campaigns.filter((x) => x.id !== id);
    return c;
  });
  const assets = [...Object.values(removed?.art ?? {}).map((a) => a?.assetId), ...(removed?.voiceovers ?? []).map((v) => v.assetId)].filter((x): x is string => Boolean(x));
  await deleteAssets(assets).catch(() => undefined);
}

/** Change a saved campaign in place (art, voiceovers, creative edits) without logging a new campaign. */
export async function patchCampaign(id: string, fn: (c: AdCampaign) => void): Promise<AdCampaign> {
  return update((db) => {
    const c = db.campaigns.find((x) => x.id === id);
    if (!c) throw new Error("Campaign not found");
    fn(c);
    return structuredClone(c);
  });
}

// ── Tasks ─────────────────────────────────────────────────────

export async function listTasks(): Promise<Task[]> {
  return (await readDb()).tasks;
}

export async function createTask(input: { title: string; leadId?: string; due?: string; createdBy: string }): Promise<Task> {
  return update((db) => {
    const task: Task = { id: newId("task"), title: input.title, leadId: input.leadId, due: input.due, done: false, createdBy: input.createdBy, createdAt: now() };
    db.tasks.unshift(task);
    return structuredClone(task);
  });
}

export async function updateTask(id: string, patch: Partial<Pick<Task, "title" | "done" | "due">>): Promise<Task> {
  return update((db) => {
    const t = db.tasks.find((x) => x.id === id);
    if (!t) throw new Error("Task not found");
    Object.assign(t, patch);
    return structuredClone(t);
  });
}

// ── Sample data ───────────────────────────────────────────────

export async function clearSamples(): Promise<void> {
  await update((db) => {
    db.leads = db.leads.filter((l) => !l.sample);
    db.drafts = db.drafts.filter((d) => !d.sample);
    db.campaigns = db.campaigns.filter((c) => !c.sample);
    db.tasks = db.tasks.filter((t) => !t.id.startsWith("task_sample"));
    db.activity = db.activity.filter((a) => !a.id.startsWith("act_s"));
  });
}

export async function loadSamples(): Promise<void> {
  const s = seedDb({ withSamples: true });
  await update((db) => {
    const ids = new Set(db.leads.map((l) => l.id));
    db.leads = [...s.leads.filter((l) => !ids.has(l.id)), ...db.leads];
    const dids = new Set(db.drafts.map((d) => d.id));
    db.drafts = [...s.drafts.filter((d) => !dids.has(d.id)), ...db.drafts];
    const cids = new Set(db.campaigns.map((c) => c.id));
    db.campaigns = [...s.campaigns.filter((c) => !cids.has(c.id)), ...db.campaigns];
    const tids = new Set(db.tasks.map((t) => t.id));
    db.tasks = [...s.tasks.filter((t) => !tids.has(t.id)), ...db.tasks];
    const aids = new Set(db.activity.map((a) => a.id));
    db.activity = [...s.activity.filter((a) => !aids.has(a.id)), ...db.activity];
  });
}
