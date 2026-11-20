import type { Metadata } from "next";
import { AgentConsole } from "@/components/agents/AgentConsole";
import { PageHead } from "@/components/ui";
import { AGENTS } from "@/lib/agents/roster";
import { listRuns } from "@/lib/agents/runner";
import { integrations } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Agents" };

export default async function AgentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const runs = await listRuns();
  const i = integrations();
  return (
    <div className="page">
      <PageHead
        title="Agents"
        sub={
          i.claude
            ? `Your team runs on Claude (${i.agentRuntime === "managed" ? "Managed Agents" : "Messages API"}). Give one a goal in plain English and watch it work. Each run is capped at $${i.runBudgetUsd.toFixed(2)}.`
            : "Give an agent a goal in plain English and watch it work. In demo mode they follow a fixed script with the real tools; add a Claude key to let them think for themselves."
        }
      />
      <AgentConsole
        agents={AGENTS.map((a) => ({ id: a.id, name: a.name, role: a.role, description: a.description, icon: a.icon, color: a.color, presets: a.presets, tools: a.tools, system: a.system }))}
        runs={runs.map(({ events, ...r }) => ({ ...r, steps: events.filter((e) => e.kind === "tool_call").length }))}
        initialAgent={one(sp.agent)}
        initialGoal={one(sp.goal)}
        claude={i.claude}
      />
    </div>
  );
}
