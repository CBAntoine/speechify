import { DEMO, features } from "./config.ts";
import { budget, realSendBlockers } from "./crew/checker.ts";
import { dailyCap, sentToday } from "./crew/pitcher.ts";
import {
  countByStatus,
  countEventsSince,
  countInboundSince,
  countLeadsCreatedSince,
  countSentSince,
  db,
  kvGet,
  listApprovals,
  listEvents,
  pipelineValueCents,
  responseStats,
  revenueSince,
  scannedSince,
  spendSince,
} from "./db.ts";
import { getSettings } from "./db.ts";
import { AGENTS, liveState } from "./events.ts";
import { getNiche } from "./niches.ts";
import type { AgentStatus, Alert, Kpis, LeadStatus, Overview } from "./types.ts";
import { localDate, localDayStart, localMonthStart, money, pct } from "./util.ts";

// Numbers for the dashboard, Atlas's briefings and the Orchestrator's
// decisions, computed from the shared database.

export function kpis(): Kpis {
  const s = getSettings();
  const tz = s.owner.timezone;
  const day = localDayStart(tz);
  const month = localMonthStart(tz);
  const r7 = responseStats(new Date(Date.now() - 7 * 86_400_000).toISOString());
  const b = budget();
  const monthRev = revenueSince(month);
  const allRev = revenueSince("1970-01-01");
  const qualifiedMonth = countLeadsCreatedSince(month);
  return {
    revenueMonthCents: monthRev.cents,
    revenueAllCents: allRev.cents,
    dealsWonMonth: monthRev.count,
    pipelineValueCents: pipelineValueCents(),
    scannedToday: scannedSince(day),
    qualifiedToday: countEventsSince(day, "scout", "success") - Number(db.prepare("SELECT COUNT(*) AS n FROM events WHERE ts >= ? AND agent = 'scout' AND level = 'success' AND message LIKE 'Scanned%'").get(day)?.n ?? 0),
    builtToday: countEventsSince(day, "builder", "success"),
    filmedToday: countEventsSince(day, "filmer", "success"),
    pitchedToday: countSentSince(day, { kind: "pitch" }),
    repliesToday: countInboundSince(day),
    responseRate7d: r7.pitched ? r7.replied / r7.pitched : 0,
    responseSample7d: r7.pitched,
    spendTodayUsd: round2(b.todayUsd),
    spendMonthUsd: round2(b.monthUsd),
    budgetDailyUsd: b.dailyUsd,
    costPerLeadUsd: qualifiedMonth ? round2(spendSince(month) / Math.max(1, qualifiedMonth)) : 0,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function funnel(): { status: LeadStatus; count: number }[] {
  const c = countByStatus();
  const order: LeadStatus[] = ["new", "qualified", "diagnosed", "built", "filmed", "ready", "pitched", "replied", "negotiating", "won", "lost", "skipped", "dnc"];
  return order.map((status) => ({ status, count: c[status] ?? 0 }));
}

export function responseTrend(days = 14): { day: string; pitched: number; replies: number }[] {
  const tz = getSettings().owner.timezone;
  const out: { day: string; pitched: number; replies: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = localDayStart(tz, i);
    const end = i === 0 ? new Date(Date.now() + 60_000).toISOString() : localDayStart(tz, i - 1);
    const r = responseStats(start, end);
    out.push({ day: localDate(tz, new Date(Date.parse(start) + 12 * 3_600_000)), pitched: r.pitched, replies: r.replied });
  }
  return out;
}

export function crewStatus(): AgentStatus[] {
  const s = getSettings();
  const day = localDayStart(s.owner.timezone);
  return AGENTS.map((a) => {
    const l = liveState(a.id);
    const paused = s.crew.paused || s.crew.pausedAgents.includes(a.id);
    return {
      id: a.id,
      name: a.name,
      role: a.role,
      state: paused && l.state !== "working" ? "paused" : l.state,
      current: l.current,
      doneToday: countEventsSince(day, a.id, "success"),
      errorsToday: countEventsSince(day, a.id, "error"),
      lastRunAt: l.lastRunAt,
    };
  });
}

export function alerts(): Alert[] {
  const s = getSettings();
  const out: Alert[] = [];
  const low = kvGet<{ since: string; rate: number; sample: number }>("alert:low_response");
  if (low) out.push({ id: "low_response", level: "error", message: `Response rate is ${pct(low.rate)} over ${low.sample} pitches this week, under your ${pct(s.escalation.minResponseRate)} floor.`, since: low.since });
  const b = budget();
  if (b.todayUsd >= b.dailyUsd) out.push({ id: "budget", level: "warn", message: `Today's $${b.dailyUsd} budget is used up; paid work resumes tomorrow (or approve more).`, since: new Date().toISOString() });
  const blockers = realSendBlockers();
  if (blockers.length) out.push({ id: "send_blocked", level: "warn", message: `Real emails can't go out yet: ${blockers.join(" ")}`, since: new Date().toISOString() });
  if (!DEMO && !s.owner.postalAddress.trim()) out.push({ id: "postal", level: "error", message: "Add your postal address in Settings. Every commercial email must include it.", since: new Date().toISOString() });
  const stuck = Number(db.prepare("SELECT COUNT(*) AS n FROM leads WHERE json_extract(data, '$.errorStage') IS NOT NULL AND status NOT IN ('won','lost','dnc','skipped')").get()?.n ?? 0);
  if (stuck) out.push({ id: "stuck", level: "warn", message: `${stuck} lead${stuck === 1 ? " is" : "s are"} stuck after 3 failed tries. Open the lead to retry.`, since: new Date().toISOString() });
  if (s.crew.paused) out.push({ id: "paused", level: "warn", message: "The whole crew is paused.", since: new Date().toISOString() });
  return out;
}

export function overview(): Overview {
  return {
    kpis: kpis(),
    funnel: funnel(),
    crew: crewStatus(),
    approvals: listApprovals("pending", 20),
    alerts: alerts(),
    recent: listEvents({ limit: 30 }),
    paused: getSettings().crew.paused,
    demo: DEMO,
    responseTrend: responseTrend(14),
  };
}

/** What Atlas says when you ask "what's happening?" */
export function briefing(): { text: string; line: string; data: Record<string, unknown> } {
  const s = getSettings();
  const k = kpis();
  const c = countByStatus();
  const pending = listApprovals("pending", 20);
  const al = alerts();
  const cur = s.offer.currency;
  const parts: string[] = [];
  const did = [
    k.scannedToday ? `scanned ${k.scannedToday} businesses` : "",
    k.builtToday ? `built mockups for ${k.builtToday}` : "",
    k.filmedToday ? `filmed ${k.filmedToday} video${k.filmedToday === 1 ? "" : "s"}` : "",
    k.pitchedToday ? `sent ${k.pitchedToday} pitch${k.pitchedToday === 1 ? "" : "es"}` : "",
  ].filter(Boolean);
  parts.push(did.length ? `Today the crew ${did.join(", ")}.` : "The crew hasn't done much yet today.");
  if (k.repliesToday) parts.push(`${k.repliesToday} ${k.repliesToday === 1 ? "reply came" : "replies came"} in.`);
  if (k.responseSample7d) parts.push(`This week's response rate is ${pct(k.responseRate7d)} on ${k.responseSample7d} pitches.`);
  parts.push(k.revenueMonthCents ? `You've made ${money(k.revenueMonthCents, cur)} this month from ${k.dealsWonMonth} deal${k.dealsWonMonth === 1 ? "" : "s"}.` : "No sales yet this month.");
  const waiting = (c.negotiating ?? 0) + (c.replied ?? 0);
  if (waiting) parts.push(`${waiting} lead${waiting === 1 ? " is" : "s are"} in conversation.`);
  const first = listApprovals("pending", 1, "oldest")[0];
  if (pending.length) parts.push(`${pending.length} thing${pending.length === 1 ? " needs" : "s need"} your decision${first ? `, starting with: ${first.title.replace(/[?.!\s]+$/, "")}` : ""}.`);
  for (const a of al.filter((x) => x.level === "error")) parts.push(a.message);
  const line = pending.length
    ? `${pending.length} thing${pending.length === 1 ? " needs" : "s need"} you${k.repliesToday ? ` and ${k.repliesToday} ${k.repliesToday === 1 ? "reply" : "replies"} came in today` : ""}.`
    : k.repliesToday
      ? `${k.repliesToday} ${k.repliesToday === 1 ? "reply" : "replies"} came in today.`
      : did.length
        ? `The crew ${did[0]} today.`
        : "Everything's running.";
  return {
    text: parts.join(" "),
    line,
    data: {
      today: { scanned: k.scannedToday, built: k.builtToday, filmed: k.filmedToday, pitched: k.pitchedToday, replies: k.repliesToday },
      week: { responseRate: Math.round(k.responseRate7d * 1000) / 10, pitches: k.responseSample7d },
      money: { revenueThisMonth: money(k.revenueMonthCents, cur), dealsWon: k.dealsWonMonth, pipeline: money(k.pipelineValueCents, cur), spendToday: `$${k.spendTodayUsd}`, budgetToday: `$${k.budgetDailyUsd}` },
      pipeline: c,
      needsYou: pending.map((p) => ({ id: p.id, kind: p.kind, title: p.title })),
      alerts: al.map((a) => a.message),
      emailsToday: { sent: sentToday(), cap: dailyCap() },
      crewPaused: s.crew.paused,
      mode: DEMO ? "demo (fictional businesses, nothing is really sent)" : "live",
      claude: features.claude,
    },
  };
}

/** Results by niche and city for the strategy review. */
export function groupStats(days = 14): { by: string; key: string; label: string; pitched: number; replied: number; won: number }[] {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = db
    .prepare(
      `SELECT l.niche AS niche, l.city AS city, l.website_state AS state,
              COUNT(DISTINCT l.id) AS pitched,
              COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM messages i WHERE i.lead_id = l.id AND i.direction = 'in') THEN l.id END) AS replied,
              COUNT(DISTINCT CASE WHEN l.status = 'won' THEN l.id END) AS won
       FROM leads l JOIN messages m ON m.lead_id = l.id
       WHERE m.direction = 'out' AND m.kind = 'pitch' AND m.status = 'sent' AND m.sent_at >= ?
       GROUP BY l.niche, l.city, l.website_state`,
    )
    .all(since) as { niche: string; city: string; state: string; pitched: number; replied: number; won: number }[];
  const agg = new Map<string, { by: string; key: string; label: string; pitched: number; replied: number; won: number }>();
  const add = (by: string, key: string, label: string, r: (typeof rows)[number]) => {
    const k = `${by}:${key}`;
    const cur = agg.get(k) ?? { by, key, label, pitched: 0, replied: 0, won: 0 };
    cur.pitched += Number(r.pitched);
    cur.replied += Number(r.replied);
    cur.won += Number(r.won);
    agg.set(k, cur);
  };
  for (const r of rows) {
    add("niche", r.niche, getNiche(r.niche).plural, r);
    add("city", r.city, r.city, r);
    add("website", r.state ?? "none", r.state ?? "none", r);
  }
  return [...agg.values()].sort((a, b) => b.pitched - a.pitched);
}
