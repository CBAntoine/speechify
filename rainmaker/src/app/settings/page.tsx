import type { Metadata } from "next";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { PageHead } from "@/components/ui";
import { integrations } from "@/lib/config";
import { NICHES } from "@/lib/niches";
import { dataDir, readDb } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const db = await readDb();
  const sampleCount = db.leads.filter((l) => l.sample).length + db.drafts.filter((d) => d.sample).length + db.campaigns.filter((c) => c.sample).length;
  return (
    <div className="page">
      <PageHead title="Settings" sub="Tell your agents who you are and what you sell, and connect the services you use." />
      <SettingsForm
        profile={db.profile}
        integrations={integrations()}
        niches={NICHES.map((n) => ({ id: n.id, label: n.label }))}
        dataDir={await dataDir()}
        passwordSet={Boolean(process.env.APP_PASSWORD)}
        sampleCount={sampleCount}
      />
    </div>
  );
}
