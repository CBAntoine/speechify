import type { Metadata } from "next";
import { Board } from "@/components/pipeline/Board";
import { PageHead } from "@/components/ui";
import { integrations } from "@/lib/config";
import { money } from "@/lib/format";
import { NICHES } from "@/lib/niches";
import { readDb } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pipeline" };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const db = await readDb();
  const open = db.leads.filter((l) => l.stage !== "won" && l.stage !== "lost");
  const lead = Array.isArray(sp.lead) ? sp.lead[0] : sp.lead;
  return (
    <div className="page wide">
      <PageHead
        title="Pipeline"
        sub={`${open.length} open deals worth ${money(open.reduce((a, l) => a + (l.value ?? 0), 0))}/month. Drag cards between stages; click one for its audit, outreach and ads.`}
      />
      <Board
        initialLeads={db.leads}
        drafts={db.drafts}
        campaigns={db.campaigns}
        niches={NICHES.map((n) => ({ id: n.id, label: n.label, icon: n.icon }))}
        openLeadId={lead}
        claude={integrations().claude}
      />
    </div>
  );
}
