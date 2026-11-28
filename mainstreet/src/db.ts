import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR, DEFAULT_SETTINGS } from "./config.ts";
import type { AgentId, Approval, CrewEvent, Lead, LeadStatus, Message, Settings } from "./types.ts";
import { deepMerge, newId, nowIso } from "./util.ts";

// One SQLite file holds the crew's shared state (the original kept it in loose
// files; a database lets Atlas answer "how many replies this week?" instantly
// and keeps parallel agents from overwriting each other). Every write here is
// synchronous, so a read-modify-write can't interleave with another agent.

const file = process.env.DB_FILE ?? path.join(DATA_DIR, "mainstreet.db");
export const db = new DatabaseSync(file);
db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;");

db.exec(`
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  niche TEXT NOT NULL,
  city TEXT NOT NULL,
  region TEXT,
  country TEXT NOT NULL,
  status TEXT NOT NULL,
  website_state TEXT,
  score INTEGER,
  email TEXT,
  phone TEXT,
  proposal_token TEXT UNIQUE,
  price_cents INTEGER NOT NULL,
  deal_value_cents INTEGER,
  last_contact_at TEXT,
  next_action_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data TEXT NOT NULL,
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS leads_status ON leads(status, score DESC);
CREATE INDEX IF NOT EXISTS leads_updated ON leads(updated_at);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  direction TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  send_after TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_lead ON messages(lead_id, created_at);
CREATE INDEX IF NOT EXISTS messages_status ON messages(status, send_after);
CREATE INDEX IF NOT EXISTS messages_sent ON messages(direction, sent_at);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  lead_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS approvals_status ON approvals(status, created_at);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  agent TEXT NOT NULL,
  level TEXT NOT NULL,
  lead_id TEXT,
  lead_name TEXT,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);

CREATE TABLE IF NOT EXISTS costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  provider TEXT NOT NULL,
  agent TEXT NOT NULL,
  lead_id TEXT,
  usd REAL NOT NULL,
  units REAL,
  unit TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS costs_ts ON costs(ts);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_id TEXT UNIQUE,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  city TEXT NOT NULL,
  region TEXT,
  niche TEXT NOT NULL,
  found INTEGER NOT NULL,
  added INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS suppressions (
  value TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

type Row = Record<string, unknown>;
const all = (sql: string, ...p: unknown[]) => db.prepare(sql).all(...(p as never[])) as Row[];
const one = (sql: string, ...p: unknown[]) => db.prepare(sql).get(...(p as never[])) as Row | undefined;
const run = (sql: string, ...p: unknown[]) => db.prepare(sql).run(...(p as never[]));

/** Run several writes atomically. */
export function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// ── Leads ────────────────────────────────────────────────────────────────

function rowToLead(r: Row | undefined): Lead | undefined {
  return r ? (JSON.parse(r.data as string) as Lead) : undefined;
}

export function saveLead(lead: Lead): Lead {
  lead.updatedAt = nowIso();
  run(
    `INSERT INTO leads (id, source, source_id, name, niche, city, region, country, status, website_state, score, email, phone,
       proposal_token, price_cents, deal_value_cents, last_contact_at, next_action_at, created_at, updated_at, data)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, niche=excluded.niche, city=excluded.city, region=excluded.region,
       status=excluded.status, website_state=excluded.website_state, score=excluded.score, email=excluded.email,
       phone=excluded.phone, proposal_token=excluded.proposal_token, price_cents=excluded.price_cents,
       deal_value_cents=excluded.deal_value_cents, last_contact_at=excluded.last_contact_at,
       next_action_at=excluded.next_action_at, updated_at=excluded.updated_at, data=excluded.data`,
    lead.id,
    lead.source,
    lead.sourceId,
    lead.name,
    lead.niche,
    lead.city,
    lead.region ?? null,
    lead.country,
    lead.status,
    lead.websiteState ?? null,
    lead.score ?? null,
    lead.email?.toLowerCase() ?? null,
    lead.phone ?? null,
    lead.proposalToken ?? null,
    lead.priceCents,
    lead.dealValueCents ?? null,
    lead.lastContactAt ?? null,
    lead.nextActionAt ?? null,
    lead.createdAt,
    lead.updatedAt,
    JSON.stringify(lead),
  );
  return lead;
}

export function getLead(id: string): Lead | undefined {
  return rowToLead(one("SELECT data FROM leads WHERE id = ?", id));
}

export function getLeadByToken(token: string): Lead | undefined {
  return rowToLead(one("SELECT data FROM leads WHERE proposal_token = ?", token));
}

export function getLeadBySource(source: string, sourceId: string): Lead | undefined {
  return rowToLead(one("SELECT data FROM leads WHERE source = ? AND source_id = ?", source, sourceId));
}

export function getLeadByEmail(email: string): Lead | undefined {
  return rowToLead(one("SELECT data FROM leads WHERE email = ? ORDER BY updated_at DESC LIMIT 1", email.toLowerCase()));
}

/** Read-modify-write one lead. Synchronous, so nothing else can write in between. */
export function updateLead(id: string, fn: (lead: Lead) => void): Lead | undefined {
  const lead = getLead(id);
  if (!lead) return undefined;
  fn(lead);
  return saveLead(lead);
}

export function leadsWithStatus(status: LeadStatus | LeadStatus[], opts: { limit?: number; order?: "score" | "oldest" | "newest" } = {}): Lead[] {
  const list = Array.isArray(status) ? status : [status];
  const order = opts.order === "oldest" ? "updated_at ASC" : opts.order === "newest" ? "updated_at DESC" : "score DESC, created_at ASC";
  return all(
    `SELECT data FROM leads WHERE status IN (${list.map(() => "?").join(",")}) ORDER BY ${order} LIMIT ?`,
    ...list,
    opts.limit ?? 1000,
  ).map((r) => rowToLead(r)!);
}

export function searchLeads(opts: { status?: LeadStatus; q?: string; city?: string; niche?: string; limit?: number; offset?: number }): { leads: Lead[]; total: number } {
  const where: string[] = [];
  const p: unknown[] = [];
  if (opts.status) (where.push("status = ?"), p.push(opts.status));
  if (opts.city) (where.push("lower(city) = lower(?)"), p.push(opts.city));
  if (opts.niche) (where.push("niche = ?"), p.push(opts.niche));
  if (opts.q) (where.push("(lower(name) LIKE ? OR lower(city) LIKE ? OR phone LIKE ? OR email LIKE ?)"), p.push(...Array(4).fill(`%${opts.q.toLowerCase()}%`)));
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number(one(`SELECT COUNT(*) AS n FROM leads ${w}`, ...p)?.n ?? 0);
  const leads = all(`SELECT data FROM leads ${w} ORDER BY updated_at DESC LIMIT ? OFFSET ?`, ...p, opts.limit ?? 50, opts.offset ?? 0).map((r) => rowToLead(r)!);
  return { leads, total };
}

export function allLeadNames(): { id: string; name: string; city: string }[] {
  return all("SELECT id, name, city FROM leads").map((r) => ({ id: r.id as string, name: r.name as string, city: r.city as string }));
}

export function countByStatus(): Partial<Record<LeadStatus, number>> {
  const out: Partial<Record<LeadStatus, number>> = {};
  for (const r of all("SELECT status, COUNT(*) AS n FROM leads GROUP BY status")) out[r.status as LeadStatus] = Number(r.n);
  return out;
}

export function countLeadsCreatedSince(iso: string): number {
  return Number(one("SELECT COUNT(*) AS n FROM leads WHERE created_at >= ?", iso)?.n ?? 0);
}

export function pipelineValueCents(): number {
  return Number(
    one(
      `SELECT COALESCE(SUM(COALESCE(deal_value_cents, price_cents)), 0) AS v FROM leads WHERE status IN ('ready','pitched','replied','negotiating')`,
    )?.v ?? 0,
  );
}

// ── Messages ─────────────────────────────────────────────────────────────

export function addMessage(m: Omit<Message, "id" | "createdAt"> & { id?: string; createdAt?: string; sendAfter?: string }): Message {
  const msg: Message = { ...m, id: m.id ?? newId("msg"), createdAt: m.createdAt ?? nowIso() } as Message;
  const sendAfter = (m as { sendAfter?: string }).sendAfter ?? null;
  run(
    "INSERT INTO messages (id, lead_id, channel, direction, kind, status, send_after, created_at, sent_at, data) VALUES (?,?,?,?,?,?,?,?,?,?)",
    msg.id,
    msg.leadId,
    msg.channel,
    msg.direction,
    msg.kind,
    msg.status,
    sendAfter,
    msg.createdAt,
    msg.sentAt ?? null,
    JSON.stringify(msg),
  );
  return msg;
}

export function getMessage(id: string): (Message & { sendAfter?: string }) | undefined {
  const r = one("SELECT data, send_after FROM messages WHERE id = ?", id);
  return r ? { ...(JSON.parse(r.data as string) as Message), sendAfter: (r.send_after as string) ?? undefined } : undefined;
}

export function updateMessage(id: string, patch: Partial<Message> & { sendAfter?: string | null }): Message | undefined {
  const cur = getMessage(id);
  if (!cur) return undefined;
  const { sendAfter, ...rest } = patch;
  const next: Message = { ...cur, ...rest };
  delete (next as { sendAfter?: string }).sendAfter;
  run(
    "UPDATE messages SET status = ?, sent_at = ?, send_after = ?, data = ? WHERE id = ?",
    next.status,
    next.sentAt ?? null,
    sendAfter === undefined ? (cur.sendAfter ?? null) : sendAfter,
    JSON.stringify(next),
    id,
  );
  return next;
}

export function messagesFor(leadId: string): Message[] {
  return all("SELECT data FROM messages WHERE lead_id = ? ORDER BY created_at ASC", leadId).map((r) => JSON.parse(r.data as string) as Message);
}

export function messagesWithStatus(status: Message["status"][], limit = 200): (Message & { sendAfter?: string })[] {
  return all(
    `SELECT data, send_after FROM messages WHERE status IN (${status.map(() => "?").join(",")}) ORDER BY COALESCE(send_after, created_at) ASC LIMIT ?`,
    ...status,
    limit,
  ).map((r) => ({ ...(JSON.parse(r.data as string) as Message), sendAfter: (r.send_after as string) ?? undefined }));
}

export function dueMessages(nowIsoStr: string, limit = 20): Message[] {
  return all(
    "SELECT data FROM messages WHERE status = 'queued' AND channel = 'email' AND (send_after IS NULL OR send_after <= ?) ORDER BY send_after ASC LIMIT ?",
    nowIsoStr,
    limit,
  ).map((r) => JSON.parse(r.data as string) as Message);
}

export function countSentSince(iso: string, opts: { channel?: string; kind?: string } = {}): number {
  const where = ["direction = 'out'", "status = 'sent'", "sent_at >= ?"];
  const p: unknown[] = [iso];
  if (opts.channel) (where.push("channel = ?"), p.push(opts.channel));
  if (opts.kind) (where.push("kind = ?"), p.push(opts.kind));
  return Number(one(`SELECT COUNT(*) AS n FROM messages WHERE ${where.join(" AND ")}`, ...p)?.n ?? 0);
}

export function countInboundSince(iso: string): number {
  return Number(one("SELECT COUNT(*) AS n FROM messages WHERE direction = 'in' AND kind = 'inbound' AND created_at >= ?", iso)?.n ?? 0);
}

export function recentInbound(limit = 30): Message[] {
  return all("SELECT data FROM messages WHERE direction = 'in' ORDER BY created_at DESC LIMIT ?", limit).map((r) => JSON.parse(r.data as string) as Message);
}

/** First pitches sent in a window, and how many of those leads replied. */
export function responseStats(sinceIso: string, untilIso = new Date(Date.now() + 86_400_000).toISOString()): { pitched: number; replied: number } {
  const pitched = all(
    "SELECT DISTINCT lead_id FROM messages WHERE direction = 'out' AND kind = 'pitch' AND status = 'sent' AND sent_at >= ? AND sent_at < ?",
    sinceIso,
    untilIso,
  ).map((r) => r.lead_id as string);
  if (!pitched.length) return { pitched: 0, replied: 0 };
  const replied = Number(
    one(
      `SELECT COUNT(DISTINCT lead_id) AS n FROM messages WHERE direction = 'in' AND kind = 'inbound' AND lead_id IN (${pitched.map(() => "?").join(",")})
       AND json_extract(data, '$.analysis.intent') IS NOT 'auto_reply'`,
      ...pitched,
    )?.n ?? 0,
  );
  return { pitched: pitched.length, replied };
}

// ── Approvals ────────────────────────────────────────────────────────────

export function addApproval(a: Omit<Approval, "id" | "createdAt" | "status"> & { payload?: unknown }): Approval {
  const existing = a.leadId ? one("SELECT data FROM approvals WHERE lead_id = ? AND kind = ? AND status = 'pending'", a.leadId, a.kind) : undefined;
  if (existing) return JSON.parse(existing.data as string) as Approval;
  const ap = { ...a, id: newId("apr"), createdAt: nowIso(), status: "pending" } as Approval & { payload?: unknown };
  run("INSERT INTO approvals (id, kind, lead_id, status, created_at, data) VALUES (?,?,?,?,?,?)", ap.id, ap.kind, ap.leadId ?? null, ap.status, ap.createdAt, JSON.stringify(ap));
  return ap;
}

export function getApproval(id: string): (Approval & { payload?: unknown }) | undefined {
  const r = one("SELECT data FROM approvals WHERE id = ?", id);
  return r ? JSON.parse(r.data as string) : undefined;
}

export function listApprovals(status?: Approval["status"], limit = 100, order: "newest" | "oldest" = "newest"): Approval[] {
  const dir = order === "oldest" ? "ASC" : "DESC";
  const rows = status
    ? all(`SELECT data FROM approvals WHERE status = ? ORDER BY created_at ${dir} LIMIT ?`, status, limit)
    : all(`SELECT data FROM approvals ORDER BY created_at ${dir} LIMIT ?`, limit);
  return rows.map((r) => {
    const a = JSON.parse(r.data as string) as Approval & { payload?: unknown };
    delete a.payload;
    return a;
  });
}

export function pendingApprovalFor(leadId: string, kind: Approval["kind"]): (Approval & { payload?: unknown }) | undefined {
  const r = one("SELECT data FROM approvals WHERE lead_id = ? AND kind = ? AND status = 'pending'", leadId, kind);
  return r ? JSON.parse(r.data as string) : undefined;
}

export function decideApproval(id: string, status: "approved" | "rejected" | "expired", by: string): Approval | undefined {
  const a = getApproval(id);
  if (!a) return undefined;
  a.status = status;
  a.decidedAt = nowIso();
  a.decidedBy = by;
  run("UPDATE approvals SET status = ?, decided_at = ?, data = ? WHERE id = ?", a.status, a.decidedAt, JSON.stringify(a), id);
  return a;
}

// ── Events ───────────────────────────────────────────────────────────────

export function insertEvent(e: Omit<CrewEvent, "id" | "ts"> & { ts?: string }): CrewEvent {
  const ts = e.ts ?? nowIso();
  const r = run("INSERT INTO events (ts, agent, level, lead_id, lead_name, message) VALUES (?,?,?,?,?,?)", ts, e.agent, e.level, e.leadId ?? null, e.leadName ?? null, e.message);
  return { ...e, ts, id: Number(r.lastInsertRowid) };
}

export function listEvents(opts: { before?: number; limit?: number; agent?: string; leadId?: string; since?: string } = {}): CrewEvent[] {
  const where: string[] = [];
  const p: unknown[] = [];
  if (opts.before) (where.push("id < ?"), p.push(opts.before));
  if (opts.agent) (where.push("agent = ?"), p.push(opts.agent));
  if (opts.leadId) (where.push("lead_id = ?"), p.push(opts.leadId));
  if (opts.since) (where.push("ts >= ?"), p.push(opts.since));
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return all(`SELECT * FROM events ${w} ORDER BY id DESC LIMIT ?`, ...p, Math.min(opts.limit ?? 100, 500)).map((r) => ({
    id: Number(r.id),
    ts: r.ts as string,
    agent: r.agent as CrewEvent["agent"],
    level: r.level as CrewEvent["level"],
    leadId: (r.lead_id as string) ?? undefined,
    leadName: (r.lead_name as string) ?? undefined,
    message: r.message as string,
  }));
}

export function countEventsSince(iso: string, agent: AgentId, level?: CrewEvent["level"]): number {
  return level
    ? Number(one("SELECT COUNT(*) AS n FROM events WHERE ts >= ? AND agent = ? AND level = ?", iso, agent, level)?.n ?? 0)
    : Number(one("SELECT COUNT(*) AS n FROM events WHERE ts >= ? AND agent = ?", iso, agent)?.n ?? 0);
}

// ── Costs ────────────────────────────────────────────────────────────────

export function addCost(c: { provider: string; agent: AgentId; leadId?: string; usd: number; units?: number; unit?: string; note?: string; ts?: string }): void {
  run("INSERT INTO costs (ts, provider, agent, lead_id, usd, units, unit, note) VALUES (?,?,?,?,?,?,?,?)", c.ts ?? nowIso(), c.provider, c.agent, c.leadId ?? null, c.usd, c.units ?? null, c.unit ?? null, c.note ?? null);
}

export function spendSince(iso: string): number {
  return Number(one("SELECT COALESCE(SUM(usd), 0) AS v FROM costs WHERE ts >= ?", iso)?.v ?? 0);
}

export function spendForLead(leadId: string): number {
  return Number(one("SELECT COALESCE(SUM(usd), 0) AS v FROM costs WHERE lead_id = ?", leadId)?.v ?? 0);
}

export function spendBreakdown(iso: string): { provider: string; agent: string; usd: number }[] {
  return all("SELECT provider, agent, SUM(usd) AS usd FROM costs WHERE ts >= ? GROUP BY provider, agent ORDER BY usd DESC", iso).map((r) => ({
    provider: r.provider as string,
    agent: r.agent as string,
    usd: Number(r.usd),
  }));
}

// ── Payments ─────────────────────────────────────────────────────────────

export function addPayment(p: { leadId: string; provider: string; externalId: string; amountCents: number; currency: string; status: string; createdAt?: string }): boolean {
  const r = run(
    "INSERT OR IGNORE INTO payments (id, lead_id, provider, external_id, amount_cents, currency, status, created_at) VALUES (?,?,?,?,?,?,?,?)",
    newId("pay"),
    p.leadId,
    p.provider,
    p.externalId,
    p.amountCents,
    p.currency,
    p.status,
    p.createdAt ?? nowIso(),
  );
  return Number(r.changes) > 0;
}

export function revenueSince(iso: string): { cents: number; count: number } {
  const r = one("SELECT COALESCE(SUM(amount_cents), 0) AS c, COUNT(*) AS n FROM payments WHERE status = 'paid' AND created_at >= ?", iso);
  return { cents: Number(r?.c ?? 0), count: Number(r?.n ?? 0) };
}

// ── Scans ────────────────────────────────────────────────────────────────

export function addScan(s: { city: string; region?: string; niche: string; found: number; added: number; ts?: string }): void {
  run("INSERT INTO scans (ts, city, region, niche, found, added) VALUES (?,?,?,?,?,?)", s.ts ?? nowIso(), s.city, s.region ?? null, s.niche, s.found, s.added);
}

export function scannedSince(iso: string): number {
  return Number(one("SELECT COALESCE(SUM(found), 0) AS n FROM scans WHERE ts >= ?", iso)?.n ?? 0);
}

export function lastScan(city: string, niche: string): string | undefined {
  return (one("SELECT ts FROM scans WHERE lower(city) = lower(?) AND niche = ? ORDER BY ts DESC LIMIT 1", city, niche)?.ts as string) ?? undefined;
}

// ── Suppressions (do-not-contact) ────────────────────────────────────────

export function suppress(value: string, kind: "email" | "domain" | "phone" | "place", reason: string): void {
  run("INSERT OR REPLACE INTO suppressions (value, kind, reason, created_at) VALUES (?,?,?,?)", value.toLowerCase().trim(), kind, reason, nowIso());
}

export function isSuppressed(values: (string | undefined)[]): boolean {
  const v = values.filter((x): x is string => Boolean(x)).map((x) => x.toLowerCase().trim());
  if (!v.length) return false;
  return Boolean(one(`SELECT 1 FROM suppressions WHERE value IN (${v.map(() => "?").join(",")}) LIMIT 1`, ...v));
}

// ── Settings & key-value ─────────────────────────────────────────────────

let cachedSettings: Settings | undefined;

export function getSettings(): Settings {
  if (cachedSettings) return cachedSettings;
  const r = one("SELECT value FROM kv WHERE key = 'settings'");
  cachedSettings = deepMerge(DEFAULT_SETTINGS, r ? JSON.parse(r.value as string) : {});
  return cachedSettings;
}

export function saveSettings(s: Settings): Settings {
  run("INSERT OR REPLACE INTO kv (key, value) VALUES ('settings', ?)", JSON.stringify(s));
  cachedSettings = s;
  return s;
}

export function patchSettings(patch: unknown): Settings {
  return saveSettings(deepMerge(getSettings(), patch));
}

export function kvGet<T>(key: string): T | undefined {
  const r = one("SELECT value FROM kv WHERE key = ?", key);
  return r ? (JSON.parse(r.value as string) as T) : undefined;
}

export function kvSet(key: string, value: unknown): void {
  run("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", key, JSON.stringify(value));
}

/** Wipe everything (demo reset). */
export function resetAll(): void {
  db.exec("DELETE FROM leads; DELETE FROM messages; DELETE FROM approvals; DELETE FROM events; DELETE FROM costs; DELETE FROM payments; DELETE FROM scans; DELETE FROM suppressions;");
  db.exec("DELETE FROM kv WHERE key NOT IN ('settings', 'session_secret', 'voice_agent')");
}
