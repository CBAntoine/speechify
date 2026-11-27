import Link from "next/link";
import { ArrowRight, CalendarClock, CircleAlert, CircleDollarSign, Flame, Inbox, ListTodo, Megaphone, MessageSquare, PenLine, Radar, Store, TrendingUp, UserPlus, Zap } from "lucide-react";
import { InstallBanner } from "@/components/today/InstallBanner";
import { QuickStart } from "@/components/today/QuickStart";
import { AgentAvatar, Empty, PageHead, ScoreRing, Stat } from "@/components/ui";
import { AGENTS } from "@/lib/agents/roster";
import { listRuns } from "@/lib/agents/runner";
import { integrations } from "@/lib/config";
import { dueLabel, greeting, money, timeAgo } from "@/lib/format";
import { dollars } from "@/lib/catalog";
import { salesStats } from "@/lib/payments/encode";
import { NICHES, getNiche } from "@/lib/niches";
import { readDb } from "@/lib/store";
import { STAGES } from "@/lib/types";

export const dynamic = "force-dynamic";

const STAGE_COLORS: Record<string, string> = {
  new: "var(--cool)",
  contacted: "var(--brand)",
  replied: "var(--violet)",
  meeting: "var(--teal)",
  proposal: "var(--warm)",
  won: "var(--good)",
  lost: "var(--line-strong)",
};

const ACTIVITY_ICON = { lead: UserPlus, draft: PenLine, ad: Megaphone, agent: Radar, stage: TrendingUp, task: ListTodo, system: Inbox };

export default async function Today() {
  const [db, runs] = await Promise.all([readDb(), listRuns()]);
  const i = integrations();
  const { leads, drafts, tasks, profile } = db;
  const open = leads.filter((l) => l.stage !== "won" && l.stage !== "lost");
  const won = leads.filter((l) => l.stage === "won");
  const hot = leads.filter((l) => l.stage === "new" && (l.score ?? 0) >= 70);
  const pending = drafts.filter((d) => d.status === "pending");
  const openTasks = tasks.filter((t) => !t.done).sort((a, b) => (a.due ?? "z").localeCompare(b.due ?? "z"));
  const dueSoon = openTasks.filter((t) => t.due && Date.parse(t.due) < Date.now() + 2 * 86400_000);
  const pipelineValue = open.reduce((a, l) => a + (l.value ?? 0), 0);
  const mrr = won.reduce((a, l) => a + (l.value ?? 0), 0);
  const first = profile.ownerName.split(" ")[0];
  const byStage = STAGES.map((s) => ({ ...s, n: leads.filter((l) => l.stage === s.id).length }));
  const total = Math.max(1, byStage.reduce((a, s) => a + s.n, 0));
  const leadName = (id?: string) => leads.find((l) => l.id === id)?.name;

  const sales = salesStats(db.orders);
  const lastRun = db.autopilot.runs[0];
  const doNext: { href: string; icon: React.ReactNode; title: string; sub: string; tone: string }[] = [];
  for (const o of db.orders.filter((x) => x.status === "past_due").slice(0, 2))
    doNext.push({ href: "/sales", icon: <CircleAlert size={15} />, title: `Payment failed: ${o.business ?? o.email ?? "a client"}`, sub: `${o.offerName}. Check in before it cancels.`, tone: "var(--hot)" });
  for (const o of db.orders.filter((x) => x.status === "active" && x.fulfillment?.status === "error").slice(0, 2))
    doNext.push({ href: "/sales", icon: <CircleAlert size={15} />, title: `Finish onboarding ${o.business ?? o.email ?? "a client"}`, sub: "A setup step needs you", tone: "var(--warm)" });
  if (pending.length)
    doNext.push({ href: "/inbox", icon: <Inbox size={15} />, title: `Approve ${pending.length} message${pending.length > 1 ? "s" : ""}`, sub: "Your agents drafted them. Nothing goes out until you say so.", tone: "var(--hot)" });
  const buyers = (db.reddit?.signals ?? []).filter((s) => s.status === "new" && Date.now() - Date.parse(s.createdAt) < 24 * 3_600_000);
  if (buyers.length) {
    const best = [...buyers].sort((a, b) => b.score - a.score)[0];
    doNext.push({
      href: "/prospects?mode=reddit",
      icon: <MessageSquare size={15} />,
      title: `${buyers.length} ${buyers.length === 1 ? "person" : "people"} on Reddit asked for what you sell`,
      sub: `Best: "${best.title.slice(0, 70)}${best.title.length > 70 ? "…" : ""}" in r/${best.subreddit}. Reach them while it's fresh.`,
      tone: "var(--hot)",
    });
  }
  for (const t of dueSoon.slice(0, 3)) {
    const d = dueLabel(t.due);
    doNext.push({ href: t.leadId ? `/pipeline?lead=${t.leadId}` : "/inbox", icon: <CalendarClock size={15} />, title: t.title, sub: `${d.text}${leadName(t.leadId) ? ` · ${leadName(t.leadId)}` : ""}`, tone: d.overdue ? "var(--hot)" : "var(--warm)" });
  }
  for (const l of hot.slice(0, 3))
    doNext.push({ href: `/pipeline?lead=${l.id}`, icon: <Flame size={15} />, title: `Reach out to ${l.name}`, sub: `Score ${l.score}: ${l.signals?.find((s) => !s.positive)?.label ?? "strong fit"}`, tone: "var(--hot)" });
  for (const l of leads.filter((x) => (x.stage === "replied" || x.stage === "meeting") && x.nextStep).slice(0, 2))
    doNext.push({ href: `/pipeline?lead=${l.id}`, icon: <TrendingUp size={15} />, title: l.nextStep!, sub: `${l.name} · ${STAGES.find((s) => s.id === l.stage)?.label}`, tone: "var(--violet)" });

  return (
    <div className="page">
      <PageHead
        title={`${greeting()}${first ? `, ${first}` : ""}`}
        keepTitle
        sub={
          pending.length || hot.length
            ? [pending.length ? `${pending.length} message${pending.length === 1 ? "" : "s"} to approve` : "", hot.length ? `${hot.length} hot lead${hot.length === 1 ? "" : "s"} to contact` : ""]
                .filter(Boolean)
                .join(" and ") + "."
            : "Your pipeline at a glance. Start by finding a few businesses to help."
        }
        actions={
          <>
            <Link href="/agents" className="btn">
              Run an agent
            </Link>
            <Link href="/prospects" className="btn primary">
              <Radar size={15} /> Find clients
            </Link>
          </>
        }
      />

      <InstallBanner />

      {!i.claude && (
        <div className="tip warn" style={{ marginBottom: 16 }}>
          <span>
            <b>Demo mode.</b>{" "}
            <span className="desktop-only">
              Search, audits, scoring and the pipeline all work now on free map data. Add <span className="mono">ANTHROPIC_API_KEY</span> to let Claude write the ads and emails
              and run the agents.{" "}
            </span>
            <span className="mobile-inline">
              Add a Claude API key to switch on AI ads, emails and agents.{" "}
            </span>
            <Link href="/settings" style={{ textDecoration: "underline" }}>
              How to connect
            </Link>
          </span>
        </div>
      )}

      <QuickStart niches={NICHES.map((n) => ({ id: n.id, label: n.label }))} defaultNiche={profile.targetNiches[0] ?? "dentist"} defaultCity={profile.city} />

      <div className="grid-4" style={{ margin: "18px 0" }}>
        <Stat icon={<CircleDollarSign size={15} />} label="Open pipeline" value={money(pipelineValue, { compact: true })} sub={`${open.length} open deals, per month`} />
        <Stat icon={<TrendingUp size={15} />} label="Monthly recurring" value={money(mrr, { compact: true })} sub={`${won.length} client${won.length === 1 ? "" : "s"} won`} tone="good" />
        <Stat icon={<Flame size={15} />} label="Hot leads" value={hot.length} sub="New, score 70+" tone="hot" />
        <Stat icon={<Inbox size={15} />} label="Waiting on you" value={pending.length + dueSoon.length} sub={`${pending.length} drafts, ${dueSoon.length} tasks due`} tone="violet" />
      </div>

      <section className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">
          <h2>Selling</h2>
          <div className="row" style={{ gap: 6 }}>
            <Link href="/sell" className="btn ghost sm">
              <Store size={14} /> Store
            </Link>
            <Link href="/autopilot" className="btn ghost sm">
              <Zap size={14} /> Autopilot
            </Link>
          </div>
        </div>
        <div className="card-body grid-3" style={{ gap: 14 }}>
          <Link href="/sales" className="stack" style={{ gap: 2 }}>
            <span className="faint small">Store revenue</span>
            <b className="metric">{dollars(sales.mrr, { currency: db.store.currency })}/mo</b>
            <span className="muted small">
              {sales.active} active client{sales.active === 1 ? "" : "s"}
              {sales.pending ? ` · ${sales.pending} unfinished checkout${sales.pending === 1 ? "" : "s"}` : ""}
            </span>
          </Link>
          <Link href="/sales" className="stack" style={{ gap: 2 }}>
            <span className="faint small">Collected this month</span>
            <b className="metric">{dollars(sales.revenueThisMonth, { currency: db.store.currency })}</b>
            <span className="muted small">{sales.newThisMonth} new this month</span>
          </Link>
          <Link href="/autopilot" className="stack" style={{ gap: 2 }}>
            <span className="faint small">Autopilot {db.autopilot.config.enabled ? "is on" : "is off"}</span>
            <b className="metric">{lastRun ? `${lastRun.counts.saved} lead${lastRun.counts.saved === 1 ? "" : "s"}, ${lastRun.counts.drafted} draft${lastRun.counts.drafted === 1 ? "" : "s"}` : "Not run yet"}</b>
            <span className="muted small">{lastRun ? `Last run ${timeAgo(lastRun.startedAt)}${lastRun.counts.demos ? ` · ${lastRun.counts.demos} demos` : ""}` : "Add cities and press Run now"}</span>
          </Link>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>Do next</h2>
            <Link href="/inbox" className="btn ghost sm">
              Inbox <ArrowRight size={14} />
            </Link>
          </div>
          {doNext.length ? (
            <div className="list">
              {doNext.slice(0, 7).map((d, k) => (
                <Link key={k} href={d.href} className="list-item">
                  <span className="feed-dot" style={{ color: d.tone, background: `color-mix(in srgb, ${d.tone} 12%, transparent)` }}>
                    {d.icon}
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600 }} className="truncate">
                      {d.title}
                    </div>
                    <div className="faint small truncate">{d.sub}</div>
                  </span>
                  <ArrowRight size={15} className="faint" style={{ marginTop: 6 }} />
                </Link>
              ))}
            </div>
          ) : (
            <Empty icon={<ListTodo size={18} />} title="All clear">
              Nothing needs you right now. A good time to find new clients.
            </Empty>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Activity</h2>
            <span className="faint small">Agents and you</span>
          </div>
          {db.activity.length ? (
            <div className="list">
              {db.activity.slice(0, 7).map((a) => {
                const Ico = ACTIVITY_ICON[a.kind] ?? Inbox;
                const agent = AGENTS.find((x) => x.id === a.agentId);
                return (
                  <div key={a.id} className="list-item">
                    {agent ? (
                      <AgentAvatar icon={agent.icon} color={agent.color} size="sm" />
                    ) : (
                      <span className="feed-dot">
                        <Ico size={14} />
                      </span>
                    )}
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <div className="small" style={{ fontWeight: 500 }}>
                        {a.text}
                      </div>
                      <div className="faint small">{timeAgo(a.at)}</div>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty title="No activity yet">Run an agent or add a lead and it shows up here.</Empty>
          )}
        </section>
      </div>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="card-head">
          <h2>Pipeline</h2>
          <Link href="/pipeline" className="btn ghost sm">
            Open board <ArrowRight size={14} />
          </Link>
        </div>
        <div className="card-body">
          <div style={{ display: "flex", height: 12, borderRadius: 99, overflow: "hidden", background: "var(--sunken)" }} aria-hidden>
            {byStage.map((s) => (s.n ? <div key={s.id} title={`${s.label}: ${s.n}`} style={{ width: `${(s.n / total) * 100}%`, background: STAGE_COLORS[s.id] }} /> : null))}
          </div>
          <div className="row wrap" style={{ gap: "10px 22px", marginTop: 14 }}>
            {byStage.map((s) => (
              <Link key={s.id} href="/pipeline" className="row small">
                <span className="stage-dot" style={{ background: STAGE_COLORS[s.id] }} />
                <span className="muted">{s.label}</span>
                <b>{s.n}</b>
              </Link>
            ))}
          </div>
          {hot.length > 0 && (
            <div className="stack" style={{ marginTop: 16, gap: 8 }}>
              <div className="label">Hottest new leads</div>
              <div className="grid-3">
                {hot.slice(0, 3).map((l) => (
                  <Link key={l.id} href={`/pipeline?lead=${l.id}`} className="card row" style={{ padding: 12, gap: 10 }}>
                    <ScoreRing score={l.score} size="sm" />
                    <span style={{ minWidth: 0 }}>
                      <div className="truncate" style={{ fontWeight: 600 }}>
                        {l.name}
                      </div>
                      <div className="faint small truncate">
                        {getNiche(l.niche)?.label} · {l.city}
                      </div>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <section style={{ marginTop: 18 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <h2 className="section-title" style={{ margin: 0 }}>
            Your team
          </h2>
          <Link href="/agents" className="btn ghost sm">
            All agents <ArrowRight size={14} />
          </Link>
        </div>
        <div className="grid-4">
          {AGENTS.map((a) => {
            const last = runs.find((r) => r.agentId === a.id);
            return (
              <Link key={a.id} href={`/agents?agent=${a.id}`} className="card" style={{ padding: 14, display: "flex", gap: 12 }}>
                <AgentAvatar icon={a.icon} color={a.color} />
                <span style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 650 }}>{a.name}</div>
                  <div className="faint small">{a.role}</div>
                  <div className="small muted" style={{ marginTop: 6 }}>
                    {last ? `Last run ${timeAgo(last.startedAt)}` : "Ready"}
                  </div>
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
