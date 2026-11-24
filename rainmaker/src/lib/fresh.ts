import { OLD_PLACEHOLDERS } from "./seed.ts";
import type { Db, Lead } from "./types.ts";

// "Start fresh": delete every lead and what hangs off it (drafts, tasks, ad
// campaigns, activity, sample records), keeping paying clients, orders and
// all settings. Pure: plan it, or apply it to the database; the caller then
// deletes the leads' ElevenLabs demo agents and knowledge. Unit tested.

// The sample workspace earlier versions created (fictional businesses on
// ".example" domains), by its exact ids.
const SAMPLE_TASKS = new Set(["task_sample_1", "task_sample_2", "task_sample_3"]);
const SAMPLE_ACTIVITY = new Set(["act_s1", "act_s2", "act_s3", "act_s4", "act_s5"]);
const isSampleLead = (l: Lead) => Boolean(l.sample) || l.source === "sample" || l.id.startsWith("lead_sample_");

/**
 * Remove all demo data: the sample businesses and everything about them
 * (drafts, tasks, ad campaigns, activity, even ones you made for them), and
 * the placeholder offer and pricing if they were never edited. Runs whenever
 * the database is loaded, so it's gone everywhere. Returns how much it removed.
 */
export function removeDemoData(db: Db): number {
  const gone = new Set(db.leads.filter(isSampleLead).map((l) => l.id));
  const ofGone = (x: { leadId?: string }) => x.leadId !== undefined && gone.has(x.leadId);
  const size = () => db.leads.length + db.drafts.length + db.campaigns.length + db.tasks.length + db.activity.length;
  const before = size();
  db.leads = db.leads.filter((l) => !gone.has(l.id));
  db.drafts = db.drafts.filter((d) => !d.sample && !ofGone(d));
  db.campaigns = db.campaigns.filter((c) => !c.sample && !ofGone(c));
  db.tasks = db.tasks.filter((t) => !SAMPLE_TASKS.has(t.id) && !ofGone(t));
  db.activity = db.activity.filter((a) => !SAMPLE_ACTIVITY.has(a.id) && !ofGone(a));
  let removed = before - size();
  if (db.profile.coreOffer === OLD_PLACEHOLDERS.coreOffer) {
    db.profile.coreOffer = "";
    removed++;
  }
  if (db.profile.pricing === OLD_PLACEHOLDERS.pricing) {
    db.profile.pricing = "";
    removed++;
  }
  return removed;
}

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
    task: (t: Db["tasks"][number]) => SAMPLE_TASKS.has(t.id) || ofGone(t),
    campaign: (c: Db["campaigns"][number]) => Boolean(c.sample) || ofGone(c),
    activity: (a: Db["activity"][number]) => SAMPLE_ACTIVITY.has(a.id) || ofGone(a),
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
