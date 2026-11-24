import type { Db, Lead } from "./types.ts";

// "Start fresh": delete every lead and what hangs off it (drafts, tasks, ad
// campaigns, activity, sample records), keeping paying clients, orders and
// all settings. Pure: plan it, or apply it to the database; the caller then
// deletes the leads' ElevenLabs demo agents and knowledge. Unit tested.

/** A lead stays when it's a paying client: an active or past-due order, or a live receptionist. */
export function isClient(db: Db, l: Lead): boolean {
  return Boolean(l.clientAgentId) || db.orders.some((o) => o.leadId === l.id && (o.status === "active" || o.status === "past_due"));
}

/** The ElevenLabs demo agents and knowledge documents built for a lead (never a client's live receptionist). */
export function elevenResourcesOf(lead: Lead): { agents: string[]; knowledge: string[] } {
  const agents = [lead.demo?.agentId, lead.guide?.agentId].filter((a): a is string => Boolean(a) && a !== lead.clientAgentId);
  const knowledge = [lead.demo?.knowledgeBaseId, ...(lead.guide?.knowledge ?? []).map((k) => k.id)].filter((k): k is string => Boolean(k));
  return { agents: [...new Set(agents)], knowledge: [...new Set(knowledge)] };
}

export interface FreshPlan {
  leads: number;
  drafts: number;
  tasks: number;
  campaigns: number;
  activity: number;
  /** Paying clients that stay. */
  keptClients: string[];
  /** ElevenLabs demo receptionists and AI guides of the deleted leads, to delete afterwards. */
  agents: string[];
  /** Their knowledge base documents. */
  knowledge: string[];
}

function targets(db: Db) {
  const gone = db.leads.filter((l) => !isClient(db, l));
  const ids = new Set(gone.map((l) => l.id));
  const agents = new Set<string>();
  const knowledge = new Set<string>();
  for (const l of gone) {
    const r = elevenResourcesOf(l);
    r.agents.forEach((a) => agents.add(a));
    r.knowledge.forEach((k) => knowledge.add(k));
  }
  const ofGone = (x: { leadId?: string }) => x.leadId !== undefined && ids.has(x.leadId);
  return {
    gone,
    agents: [...agents],
    knowledge: [...knowledge],
    draft: (d: Db["drafts"][number]) => Boolean(d.sample) || ofGone(d),
    task: (t: Db["tasks"][number]) => t.id.startsWith("task_sample") || ofGone(t),
    campaign: (c: Db["campaigns"][number]) => Boolean(c.sample) || ofGone(c),
    activity: (a: Db["activity"][number]) => a.id.startsWith("act_s") || ofGone(a),
    kept: db.leads.filter((l) => !ids.has(l.id)).map((l) => l.name),
  };
}

/** What starting fresh would delete, without changing anything. */
export function planFresh(db: Db): FreshPlan {
  const t = targets(db);
  return {
    leads: t.gone.length,
    drafts: db.drafts.filter(t.draft).length,
    tasks: db.tasks.filter(t.task).length,
    campaigns: db.campaigns.filter(t.campaign).length,
    activity: db.activity.filter(t.activity).length,
    keptClients: t.kept,
    agents: t.agents,
    knowledge: t.knowledge,
  };
}

/** Start fresh on this database (inside an update) and return what was deleted. */
export function startFresh(db: Db): FreshPlan {
  const plan = planFresh(db);
  const t = targets(db);
  const gone = new Set(t.gone.map((l) => l.id));
  db.leads = db.leads.filter((l) => !gone.has(l.id));
  db.drafts = db.drafts.filter((d) => !t.draft(d));
  db.tasks = db.tasks.filter((x) => !t.task(x));
  db.campaigns = db.campaigns.filter((c) => !t.campaign(c));
  db.activity = db.activity.filter((a) => !t.activity(a));
  return plan;
}
