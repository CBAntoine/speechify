import { useMemo } from "react";
import { ArrowRight, BadgeDollarSign, Banknote, ChartNoAxesColumn, Funnel, Gauge, Mic, Receipt, Sparkles, Users, Wallet } from "lucide-react";
import type { AgentId, AgentStatus, LeadStatus, Me, Overview } from "../api";
import { talkToAtlas } from "../atlas/open";
import { AGENT_NAME, AGENT_ORDER, firstName, greeting, money, num, pct, usd } from "../format";
import { href } from "../router";
import { loadOverview, useStore } from "../store";
import { AgentBadge, Button, Card, cx, Dot, Empty, ErrorNote, Kpi, Progress, Skeleton, STATE_DOT } from "../ui";
import { ApprovalRow } from "./Approvals";
import { EventRow } from "./Activity";

export function Today({ me }: { me: Me }) {
  const overview = useStore((s) => s.overview);
  const error = useStore((s) => s.overviewError);
  const events = useStore((s) => s.events);
  const settings = useStore((s) => s.settings);

  if (!overview) {
    return error ? <ErrorNote message={error} onRetry={() => void loadOverview()} /> : <TodaySkeleton />;
  }

  const k = overview.kpis;
  const minRate = settings?.settings.escalation.minResponseRate ?? 0.12;
  const minSample = settings?.settings.escalation.minSample ?? 40;
  const lowRate = k.responseSample7d >= minSample && k.responseRate7d < minRate;
  const pending = overview.approvals.filter((a) => a.status === "pending");
  const name = firstName(me.ownerName);
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="today">
      <header className="page-head today-head">
        <div className="page-head-row">
          <div className="page-head-text">
            <p className="eyebrow">{today}</p>
            <h1>
              {greeting()}
              {name ? `, ${name}` : ""}.
            </h1>
            <p className="lede">{summarize(overview)}</p>
          </div>
          <div className="page-actions">
            <Button tone="primary" icon={Mic} onClick={talkToAtlas}>
              Ask Atlas
            </Button>
          </div>
        </div>
      </header>

      {overview.alerts.length ? (
        <div className="stack-sm">
          {overview.alerts.map((a) => (
            <div key={a.id} className={cx("callout", a.level === "error" ? "tone-red" : "tone-amber")} role="alert">
              <span>{a.message}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="kpi-grid">
        <Kpi label="Revenue this month" icon={Banknote} value={money(k.revenueMonthCents)} tone="money" sub={`${money(k.revenueAllCents)} all time`} />
        <Kpi
          label="Deals won"
          icon={BadgeDollarSign}
          value={num(k.dealsWonMonth)}
          sub={k.dealsWonMonth ? `${money(Math.round(k.revenueMonthCents / k.dealsWonMonth))} average this month` : "This month"}
        />
        <Kpi label="Pipeline value" icon={Wallet} value={money(k.pipelineValueCents)} sub="Open proposals and conversations" />
        <Kpi label="Response rate · 7 days" icon={Gauge} value={pct(k.responseRate7d)} tone={lowRate ? "warn" : undefined} sub={`${num(k.responseSample7d)} pitches · alert below ${pct(minRate, 0)}`}>
          <Progress value={k.responseRate7d} max={Math.max(0.3, k.responseRate7d * 1.4, minRate * 2)} marker={minRate} tone={lowRate ? "amber" : "green"} label="Response rate against the alert line" />
        </Kpi>
        <Kpi label="Spend today" icon={Receipt} value={usd(k.spendTodayUsd)} tone={k.spendTodayUsd > k.budgetDailyUsd ? "warn" : undefined} sub={`of ${usd(k.budgetDailyUsd)} budget · ${usd(k.spendMonthUsd)} this month`}>
          <Progress value={k.spendTodayUsd} max={Math.max(k.budgetDailyUsd, 0.01)} tone={k.spendTodayUsd > k.budgetDailyUsd * 0.9 ? "amber" : "green"} label="Spend against the daily budget" />
        </Kpi>
        <Kpi label="Cost per lead" icon={Sparkles} value={usd(k.costPerLeadUsd)} sub="AI, maps and media per qualified business" />
      </div>

      <div className="today-grid">
        <div className="today-main">
          <Card
            title="Needs you"
            icon={Users}
            action={
              pending.length ? (
                <a className="card-link" href={href("approvals")}>
                  All approvals <ArrowRight size={14} aria-hidden />
                </a>
              ) : null
            }
          >
            {pending.length ? (
              <div className="list">
                {pending.slice(0, 4).map((a) => (
                  <ApprovalRow key={a.id} approval={a} compact />
                ))}
              </div>
            ) : (
              <Empty title="Nothing needs you" body="Atlas will flag a deal over your limit or a drop in replies the moment it happens." />
            )}
          </Card>

          <FunnelCard overview={overview} />
          <TrendCard trend={overview.responseTrend} />
        </div>

        <div className="today-side">
          <CrewStrip crew={overview.crew} />
          <Card
            title="Live activity"
            action={
              <a className="card-link" href={href("activity")}>
                Full log <ArrowRight size={14} aria-hidden />
              </a>
            }
            pad={false}
          >
            {events.length ? (
              <ol className="feed" aria-live="polite">
                {events.slice(0, 14).map((e) => (
                  <EventRow key={e.id} event={e} />
                ))}
              </ol>
            ) : (
              <div className="pad">
                <Empty title="Quiet so far" body="The crew posts here as it works." />
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function summarize(o: Overview): string {
  const k = o.kpis;
  if (o.paused) return "The crew is paused. Resume it when you're ready.";
  const parts: string[] = [];
  if (k.scannedToday) parts.push(`${num(k.scannedToday)} businesses scanned`);
  if (k.builtToday) parts.push(`${num(k.builtToday)} mockups built`);
  if (k.pitchedToday) parts.push(`${num(k.pitchedToday)} pitches out`);
  if (k.repliesToday) parts.push(`${num(k.repliesToday)} ${k.repliesToday === 1 ? "reply" : "replies"}`);
  const pending = o.approvals.filter((a) => a.status === "pending").length;
  const head = parts.length ? `Today so far: ${joinWords(parts)}.` : "The crew is warming up for the day.";
  return pending ? `${head} ${pending} ${pending === 1 ? "thing needs" : "things need"} your yes.` : head;
}

function joinWords(parts: string[]): string {
  if (parts.length < 2) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// ── Funnel ───────────────────────────────────────────────────────────────

const ORDER: LeadStatus[] = ["new", "qualified", "diagnosed", "built", "filmed", "ready", "pitched", "replied", "negotiating", "won"];

function FunnelCard({ overview }: { overview: Overview }) {
  const k = overview.kpis;
  const steps = useMemo(() => {
    const c = new Map<LeadStatus, number>();
    for (const f of overview.funnel) c.set(f.status, (c.get(f.status) ?? 0) + f.count);
    const at = (s: LeadStatus) => c.get(s) ?? 0;
    const beyond = (s: LeadStatus) => ORDER.slice(ORDER.indexOf(s)).reduce((n, x) => n + at(x), 0);
    // Lost and do-not-contact leads were pitched; skipped ones were only scanned.
    const after = at("lost") + at("dnc");
    const total = [...c.values()].reduce((a, b) => a + b, 0);
    return [
      { label: "Scanned", value: total, today: k.scannedToday },
      { label: "Qualified", value: beyond("qualified") + after, today: k.qualifiedToday },
      { label: "Built", value: beyond("built") + after, today: k.builtToday },
      { label: "Filmed", value: beyond("filmed") + after, today: k.filmedToday },
      { label: "Pitched", value: beyond("pitched") + after, today: k.pitchedToday },
      { label: "Replied", value: beyond("replied"), today: k.repliesToday },
      { label: "Won", value: at("won"), today: undefined as number | undefined },
    ];
  }, [overview.funnel, k]);
  const max = Math.max(1, steps[0].value);
  const won = steps[steps.length - 1].value;

  return (
    <Card title="Funnel" icon={Funnel} action={<span className="muted small">{steps[0].value ? `${pct(won / steps[0].value)} of scanned businesses buy` : "All time"}</span>}>
      <ol className="funnel">
        {steps.map((s, i) => {
          const prev = i > 0 ? steps[i - 1].value : 0;
          return (
            <li key={s.label}>
              <span className="funnel-label">{s.label}</span>
              <span className="funnel-bar">
                <span className={cx("funnel-fill", s.label === "Won" && "is-won")} style={{ width: `${Math.max(2, (s.value / max) * 100)}%` }} />
              </span>
              <span className="funnel-num num">{num(s.value)}</span>
              <span className="funnel-meta muted">
                {s.today ? <span className="plus">+{num(s.today)} today</span> : i > 0 && prev ? `${pct(s.value / prev, 0)}` : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

// ── Trend ────────────────────────────────────────────────────────────────

function TrendCard({ trend }: { trend: Overview["responseTrend"] }) {
  const days = trend.slice(-14);
  const pitched = days.reduce((n, d) => n + d.pitched, 0);
  const replies = days.reduce((n, d) => n + d.replies, 0);
  const max = Math.max(1, ...days.map((d) => d.pitched));
  const W = 560;
  const H = 150;
  const pad = 18;
  const bw = days.length ? (W - pad * 2) / days.length : 0;
  const y = (v: number) => H - 22 - (v / max) * (H - 44);
  const label = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <Card title="Pitches and replies · 14 days" icon={ChartNoAxesColumn} action={<span className="muted small">{pitched ? `${pct(replies / pitched)} replied` : "No pitches yet"}</span>}>
      {days.length ? (
        <figure className="trend">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Last ${days.length} days: ${pitched} pitches, ${replies} replies`}>
            <line x1={pad} x2={W - pad} y1={H - 22} y2={H - 22} className="trend-axis" />
            {days.map((d, i) => {
              const x = pad + i * bw;
              const w = Math.max(4, bw * 0.62);
              return (
                <g key={d.day}>
                  <title>{`${label(d.day)}: ${d.pitched} pitched, ${d.replies} replied`}</title>
                  <rect x={x + (bw - w) / 2} y={y(d.pitched)} width={w} height={H - 22 - y(d.pitched)} rx={3} className="trend-pitched" />
                  <rect x={x + (bw - w) / 2} y={y(d.replies)} width={w} height={H - 22 - y(d.replies)} rx={3} className="trend-replies" />
                </g>
              );
            })}
            <text x={pad} y={H - 5} className="trend-text">
              {label(days[0].day)}
            </text>
            <text x={W - pad} y={H - 5} className="trend-text" textAnchor="end">
              {label(days[days.length - 1].day)}
            </text>
            <text x={W - pad} y={12} className="trend-text" textAnchor="end">
              {max} / day
            </text>
          </svg>
          <figcaption className="legend">
            <span>
              <i className="sw sw-pitched" /> Pitched
            </span>
            <span>
              <i className="sw sw-replies" /> Replied
            </span>
          </figcaption>
        </figure>
      ) : (
        <Empty title="No pitches yet" body="Once the Pitcher starts sending, the daily trend shows here." />
      )}
    </Card>
  );
}

// ── Crew ─────────────────────────────────────────────────────────────────

function CrewStrip({ crew }: { crew: AgentStatus[] }) {
  const agents = useStore((s) => s.agents);
  const list = AGENT_ORDER.map((id) => agents[id] ?? crew.find((c) => c.id === id) ?? fallback(id));
  return (
    <Card
      title="The crew"
      action={
        <a className="card-link" href={href("crew")}>
          Manage <ArrowRight size={14} aria-hidden />
        </a>
      }
      pad={false}
    >
      <ul className="crew-strip">
        {list.map((a) => (
          <li key={a.id}>
            <a href={href("crew")} className={cx("crew-chip", `is-${a.state}`)}>
              <AgentBadge id={a.id} size={34} />
              <span className="crew-chip-text">
                <span className="crew-chip-name">
                  {AGENT_NAME[a.id]} <Dot tone={STATE_DOT[a.state] ?? "grey"} pulse={a.state === "working"} label={a.state} />
                </span>
                <span className="crew-chip-now">{a.state === "paused" ? "Paused" : a.state === "error" ? (a.current ?? "Needs a look") : (a.current ?? "Idle")}</span>
              </span>
              <span className="crew-chip-count num" title="Done today">
                {a.doneToday}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function fallback(id: AgentId): AgentStatus {
  return { id, name: AGENT_NAME[id], role: "", state: "idle", doneToday: 0, errorsToday: 0 };
}

function TodaySkeleton() {
  return (
    <div className="today" aria-busy="true">
      <div className="page-head">
        <Skeleton h={14} w={160} />
        <Skeleton h={34} w={320} />
        <Skeleton h={16} w="70%" />
      </div>
      <div className="kpi-grid">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="kpi">
            <Skeleton h={12} w={110} />
            <Skeleton h={30} w={90} />
            <Skeleton h={12} w={140} />
          </div>
        ))}
      </div>
    </div>
  );
}
