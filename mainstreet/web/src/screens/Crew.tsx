import { Pause, Play, Zap } from "lucide-react";
import type { AgentId, AgentStatus } from "../api";
import { run } from "../commands";
import { ago, AGENT_ABOUT, AGENT_NAME, AGENT_ORDER } from "../format";
import { formDialog, useStore } from "../store";
import { AgentBadge, Button, Chip, cx, Loading, PageHeader, STATE_DOT, useBusy } from "../ui";

const STATE_TEXT: Record<AgentStatus["state"], string> = { idle: "Idle", working: "Working", paused: "Paused", error: "Needs a look" };

export function Crew() {
  const overview = useStore((s) => s.overview);
  const agents = useStore((s) => s.agents);
  if (!overview) return <Loading />;
  const paused = overview.paused;

  return (
    <div className="page">
      <PageHeader
        title="The crew"
        sub="Seven specialists and Atlas, the orchestrator. They share one database, so every step is visible here and to Atlas."
        actions={
          paused ? (
            <Button tone="primary" icon={Play} onClick={() => void run("resume_crew", {})}>
              Resume everything
            </Button>
          ) : (
            <Button
              tone="danger"
              icon={Pause}
              onClick={() => void run("pause_crew", {}, { confirm: { title: "Pause the whole crew?", body: "Nothing new is searched, built or sent until you resume. Replies still come in.", confirmLabel: "Pause everything", tone: "danger" } })}
            >
              Pause everything
            </Button>
          )
        }
      />
      <div className="crew-grid">
        {AGENT_ORDER.map((id) => (
          <AgentCard key={id} id={id} status={agents[id] ?? overview.crew.find((c) => c.id === id)} crewPaused={paused} />
        ))}
      </div>
    </div>
  );
}

function AgentCard({ id, status, crewPaused }: { id: AgentId; status?: AgentStatus; crewPaused: boolean }) {
  const [busy, act] = useBusy();
  const about = AGENT_ABOUT[id];
  const state = status?.state ?? "idle";
  const paused = state === "paused";

  const runNow = () =>
    act(async () => {
      if (id === "scout") {
        const v = await formDialog({
          title: "Send the Scout out",
          body: "Leave the town empty to scan the next target in rotation.",
          confirmLabel: "Scout now",
          fields: [
            { name: "city", label: "Town or city", placeholder: "Bend" },
            { name: "region", label: "State or province", placeholder: "OR" },
            { name: "niche", label: "Niche", placeholder: "dentist" },
            { name: "count", label: "How many businesses", type: "number", value: "20" },
          ],
        });
        if (!v) return;
        await run("run_agent", { agent: id, city: v.city, region: v.region, niche: v.niche, count: v.count ? Number(v.count) : undefined });
        return;
      }
      await run("run_agent", { agent: id });
    });

  return (
    <article className={cx("agent-card", `is-${state}`)}>
      <header className="agent-card-head">
        <AgentBadge id={id} size={46} />
        <div>
          <h2>{AGENT_NAME[id]}</h2>
          <span className="muted small">{about.role}</span>
        </div>
        <Chip tone={STATE_DOT[state]}>
          <span className={cx("dot", `tone-${STATE_DOT[state]}`, state === "working" && "pulse")} aria-hidden /> {STATE_TEXT[state]}
        </Chip>
      </header>
      <p className="agent-now">{state === "working" ? (status?.current ?? "Working…") : state === "error" ? (status?.current ?? "The last run failed.") : (status?.current ?? (paused ? "Paused." : "Waiting for the next job."))}</p>
      <p className="muted small">{about.does}</p>
      <dl className="agent-stats">
        <div>
          <dt>Done today</dt>
          <dd className="num">{status?.doneToday ?? 0}</dd>
        </div>
        <div>
          <dt>Errors</dt>
          <dd className={cx("num", (status?.errorsToday ?? 0) > 0 && "text-red")}>{status?.errorsToday ?? 0}</dd>
        </div>
        <div>
          <dt>Last run</dt>
          <dd>{status?.lastRunAt ? ago(status.lastRunAt) : "—"}</dd>
        </div>
      </dl>
      <div className="agent-actions">
        {paused ? (
          <Button size="sm" tone="primary" icon={Play} busy={busy} onClick={() => act(() => run("resume_crew", { agent: id }))}>
            Resume
          </Button>
        ) : (
          <Button size="sm" icon={Pause} busy={busy} onClick={() => act(() => run("pause_crew", { agent: id }))}>
            Pause
          </Button>
        )}
        <Button size="sm" tone="ghost" icon={Zap} disabled={busy || crewPaused || paused} onClick={runNow} title={crewPaused ? "Resume the crew first" : undefined}>
          Run now
        </Button>
      </div>
    </article>
  );
}
