import { useEffect, useMemo, useState } from "react";
import { Activity as ActivityIcon } from "lucide-react";
import { api } from "../api";
import type { AgentId, CrewEvent } from "../api";
import { ago, AGENT_NAME, AGENT_ORDER, clock } from "../format";
import { href } from "../router";
import { useStore } from "../store";
import { AgentBadge, Button, Card, cx, Empty, ErrorNote, Loading, PageHeader } from "../ui";

export function who(agent: CrewEvent["agent"]): string {
  if (agent === "owner") return "You";
  if (agent === "system") return "System";
  return AGENT_NAME[agent] ?? agent;
}

export function EventRow({ event: e, showTime }: { event: CrewEvent; showTime?: boolean }) {
  return (
    <li className={cx("event", `lvl-${e.level}`)}>
      <AgentBadge id={e.agent} size={28} />
      <div className="event-body">
        <p>{e.message}</p>
        <span className="event-meta">
          <b>{who(e.agent)}</b>
          {e.leadId ? (
            <>
              <span aria-hidden> · </span>
              <a href={href("lead", e.leadId)}>{e.leadName ?? "lead"}</a>
            </>
          ) : null}
          <span aria-hidden> · </span>
          <time dateTime={e.ts} title={new Date(e.ts).toLocaleString()}>
            {showTime ? clock(e.ts) : ago(e.ts)}
          </time>
        </span>
      </div>
    </li>
  );
}

const PAGE = 100;

export function ActivityScreen() {
  const [agent, setAgent] = useState<AgentId | "">("");
  const [loaded, setLoaded] = useState<CrewEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const live = useStore((s) => s.events);

  const fetchPage = async (before?: number) => {
    setBusy(true);
    try {
      const q = new URLSearchParams({ limit: String(PAGE) });
      if (before) q.set("before", String(before));
      if (agent) q.set("agent", agent);
      const r = await api<{ events: CrewEvent[] }>(`/api/events?${q}`);
      setLoaded((cur) => (before ? [...cur, ...r.events] : r.events));
      setDone(r.events.length < PAGE);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setLoaded([]);
    setDone(false);
    void fetchPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);

  // New events from the live stream go on top.
  const events = useMemo(() => {
    const top = loaded[0]?.id ?? 0;
    const fresh = live.filter((e) => e.id > top && (!agent || e.agent === agent));
    const byId = new Map<number, CrewEvent>();
    for (const e of [...fresh, ...loaded]) byId.set(e.id, e);
    return [...byId.values()].sort((a, b) => b.id - a.id);
  }, [live, loaded, agent]);

  // Group by day for scanning.
  const groups = useMemo(() => {
    const out: { day: string; items: CrewEvent[] }[] = [];
    for (const e of events) {
      const day = new Date(e.ts).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
      const g = out[out.length - 1];
      if (g && g.day === day) g.items.push(e);
      else out.push({ day, items: [e] });
    }
    return out;
  }, [events]);

  return (
    <div className="page">
      <PageHeader title="Activity" sub="Everything the crew did, as it happened." />
      <div className="chips-row" role="toolbar" aria-label="Filter by agent">
        <button type="button" className={cx("filter-chip", !agent && "is-on")} onClick={() => setAgent("")}>
          Everyone
        </button>
        {AGENT_ORDER.map((a) => (
          <button key={a} type="button" className={cx("filter-chip", agent === a && "is-on")} onClick={() => setAgent(a)}>
            {AGENT_NAME[a]}
          </button>
        ))}
      </div>
      {error ? <ErrorNote message={error} onRetry={() => void fetchPage()} /> : null}
      {!events.length && busy ? <Loading /> : null}
      {!events.length && !busy && !error ? (
        <Card>
          <Empty icon={ActivityIcon} title="Nothing here yet" body={agent ? `${AGENT_NAME[agent]} hasn't logged anything yet.` : "The crew posts every step here."} />
        </Card>
      ) : null}
      {groups.map((g) => (
        <Card key={g.day} title={g.day} pad={false} className="mt">
          <ol className="feed">
            {g.items.map((e) => (
              <EventRow key={e.id} event={e} showTime />
            ))}
          </ol>
        </Card>
      ))}
      {events.length && !done ? (
        <div className="center mt">
          <Button busy={busy} onClick={() => void fetchPage(events[events.length - 1]?.id)}>
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
