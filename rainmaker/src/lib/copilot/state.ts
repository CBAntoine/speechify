import { OFFERS, isVisible, priceOf } from "../catalog.ts";
import type { Integrations } from "../config.ts";
import { salesStats } from "../payments/encode.ts";
import { STAGES, type Db } from "../types.ts";
import { screenForPath } from "./screens.ts";

// The copilot's live snapshot of Rainmaker: everything it needs to answer
// "what's happening?" and to act, in a few kilobytes. Pure (data in, data out)
// so it's easy to test.

const ago = (iso: string | undefined, now: number) => {
  if (!iso) return null;
  const m = Math.round((now - Date.parse(iso)) / 60_000);
  return m < 60 ? `${Math.max(0, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export function buildAppState(db: Db, i: Integrations, opts: { baseUrl: string; path?: string; now?: Date }) {
  const nowDate = opts.now ?? new Date();
  const now = nowDate.getTime();
  const open = db.leads.filter((l) => l.stage !== "won" && l.stage !== "lost");
  const pending = db.drafts.filter((d) => d.status === "pending");
  const openTasks = db.tasks.filter((t) => !t.done);
  const overdue = openTasks.filter((t) => t.due && Date.parse(t.due) < now);
  const leadName = (id?: string) => (id ? db.leads.find((l) => l.id === id)?.name : undefined);
  const sales = salesStats(db.orders, nowDate);
  const ap = db.autopilot;
  const lastRun = ap.runs[0];
  const storeUrl = `${opts.baseUrl}/store`;

  return {
    now: nowDate.toISOString(),
    screen: opts.path ? screenForPath(opts.path).label : undefined,
    agency: { name: db.profile.agencyName, owner: db.profile.ownerName || null, city: db.profile.city || null, postal_address_set: Boolean(db.profile.mailingAddress?.trim()) },
    connected: {
      claude_ai: i.claude,
      elevenlabs_voice: i.elevenlabs,
      store_sales_assistant: i.salesAgent,
      stripe: i.stripe ? (i.stripeMode ?? "on") : false,
      paypal: i.paypal ? i.paypalMode : false,
      email_sending_resend: i.resend,
      google_places: i.googlePlaces,
      daily_autopilot_schedule: i.cron,
    },
    pipeline: {
      leads_by_stage: Object.fromEntries(STAGES.map((s) => [s.id, db.leads.filter((l) => l.stage === s.id).length])),
      open_value_per_month: open.reduce((a, l) => a + (l.value ?? 0), 0),
      won_value_per_month: db.leads.filter((l) => l.stage === "won").reduce((a, l) => a + (l.value ?? 0), 0),
      hot_new_leads: db.leads.filter((l) => l.stage === "new" && (l.score ?? 0) >= 70).length,
      top_open_leads: [...open]
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 8)
        .map((l) => ({ lead_id: l.id, name: l.name, stage: l.stage, score: l.score ?? null, niche: l.niche, city: l.city ?? null, next_step: l.nextStep ?? null })),
    },
    inbox: {
      drafts_waiting: pending.length,
      newest: pending.slice(0, 5).map((d) => ({ draft_id: d.id, lead: d.leadName ?? leadName(d.leadId) ?? null, channel: d.channel, subject: d.subject ?? null, written: ago(d.createdAt, now) })),
    },
    tasks: {
      open: openTasks.length,
      overdue: overdue.length,
      next: [...openTasks]
        .sort((a, b) => (a.due ? Date.parse(a.due) : Infinity) - (b.due ? Date.parse(b.due) : Infinity))
        .slice(0, 5)
        .map((t) => ({ task_id: t.id, title: t.title, due: t.due ?? null, lead: leadName(t.leadId) ?? null })),
    },
    autopilot: {
      on: ap.config.enabled,
      cities: ap.config.cities,
      niches: ap.config.niches,
      per_run: { businesses: ap.config.leadsPerRun, min_score: ap.config.minScore, personal_work: ap.config.personalizePerRun },
      does: {
        demo_receptionists: ap.config.buildDemos,
        outreach_emails: ap.config.draftOutreach,
        sample_ads: ap.config.buildAds,
        custom_art: ap.config.makeArt,
        follow_ups: ap.config.followUps,
        onboard_paying_clients: ap.config.fulfillOrders,
        auto_send_email: ap.config.autoSend,
        summary_email: ap.config.emailSummary,
      },
      last_run: lastRun ? { when: ago(lastRun.startedAt, now), status: lastRun.status, trigger: lastRun.trigger, counts: lastRun.counts } : null,
    },
    store: {
      open: db.store.enabled,
      url: storeUrl,
      currency: db.store.currency.toUpperCase(),
      yearly_billing: db.store.annual,
      setup_waived_on_yearly: db.store.waiveSetupOnAnnual,
      assistant_name: db.store.assistantName,
      offers: OFFERS.filter((o) => isVisible(o, db.store)).map((o) => {
        const p = priceOf(o, db.store);
        return { id: o.id, name: o.name, kind: o.kind, monthly: p.monthly, setup: p.setup, page: `${storeUrl}/${o.slug}` };
      }),
      checkout_link_for_a_lead: `${storeUrl}/<product slug>?lead=<lead_id> (a purchase through it moves that lead to Won)`,
    },
    sales: {
      monthly_recurring_revenue: sales.mrr,
      active_clients: sales.active,
      collected_this_month: sales.revenueThisMonth,
      new_this_month: sales.newThisMonth,
      cancelled_this_month: sales.churnedThisMonth,
      unfinished_checkouts: sales.pending,
      recent_orders: db.orders.slice(0, 5).map((o) => ({ order_id: o.id, client: o.business ?? o.name ?? o.email ?? null, product: o.offerName, status: o.status, amount: o.amount, interval: o.interval, onboarding: o.fulfillment?.status ?? null })),
    },
    ai_website_guides: (() => {
      const withGuide = db.leads.filter((l) => l.guide);
      return {
        built: withGuide.length,
        live_trials: withGuide
          .filter((l) => l.guide?.trial)
          .map((l) => ({ lead_id: l.id, business: l.name, domain: l.guide!.trial!.domain, trial_ends: l.guide!.trial!.endsAt.slice(0, 10) })),
        demos_not_yet_pitched_or_live: withGuide.filter((l) => !l.guide?.trial).slice(0, 8).map((l) => ({ lead_id: l.id, business: l.name, stage: l.stage, tested: Boolean(l.guide?.testedAt) })),
      };
    })(),
    reddit_buyers: {
      watching: db.reddit?.config.subreddits ?? [],
      last_scan: ago(db.reddit?.lastScanAt, now),
      new: (db.reddit?.signals ?? [])
        .filter((s) => s.status === "new")
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((s) => ({ post_id: s.id, subreddit: s.subreddit, title: s.title.slice(0, 120), posted: ago(s.createdAt, now), score: s.score, why: s.reasons.slice(0, 3) })),
    },
    ad_campaigns: { total: db.campaigns.length, latest: db.campaigns.slice(0, 3).map((c) => ({ campaign_id: c.id, business: c.businessName, made: ago(c.createdAt, now) })) },
    agent_runs: db.runs.slice(0, 3).map((r) => ({ run_id: r.id, agent: r.agentId, goal: r.goal.slice(0, 140), status: r.status, started: ago(r.startedAt, now) })),
    recent_activity: db.activity.slice(0, 8).map((a) => `${ago(a.at, now)}: ${a.text}`),
  };
}
