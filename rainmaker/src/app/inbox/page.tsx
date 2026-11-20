import type { Metadata } from "next";
import { Inbox } from "@/components/inbox/Inbox";
import { PageHead } from "@/components/ui";
import { AGENTS } from "@/lib/agents/roster";
import { resendEnabled } from "@/lib/config";
import { readDb } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage() {
  const db = await readDb();
  return (
    <div className="page">
      <PageHead title="Inbox" sub="Your approval queue. Agents never send anything on their own: you read, edit and send." />
      <Inbox
        drafts={db.drafts}
        tasks={db.tasks}
        agents={AGENTS.map((a) => ({ id: a.id, name: a.name, icon: a.icon, color: a.color }))}
        resend={resendEnabled()}
        leads={db.leads.map((l) => ({ id: l.id, name: l.name }))}
      />
    </div>
  );
}
