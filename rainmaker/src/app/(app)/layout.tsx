import Link from "next/link";
import { Sidebar } from "@/components/Sidebar";
import { integrations } from "@/lib/config";
import { readDb, storageInfo } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [db, storage] = await Promise.all([readDb(), storageInfo()]);
  const i = integrations();
  const inbox = db.drafts.filter((d) => d.status === "pending").length;
  return (
    <div className="app">
      <Sidebar inbox={inbox} claude={i.claude} runtime={i.agentRuntime} agencyName={db.profile.agencyName} canSignOut={Boolean(process.env.APP_PASSWORD)} />
      <main className="main">
        {!storage.persistent && (
          <Link href="/settings" className="storage-warning">
            Data on this host isn&apos;t saved permanently. Connect a database to keep it. →
          </Link>
        )}
        {children}
      </main>
    </div>
  );
}
