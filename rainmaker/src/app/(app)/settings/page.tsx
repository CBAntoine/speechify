import type { Metadata } from "next";
import { KeyRound } from "lucide-react";
import { ApiKeys } from "@/components/settings/ApiKeys";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { PageHead } from "@/components/ui";
import { integrations } from "@/lib/config";
import { keysPolicy, listKeys } from "@/lib/keys";
import { SERVICES } from "@/lib/keys-core";
import { NICHES } from "@/lib/niches";
import { readDb, storageInfo } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const db = await readDb();
  const storage = await storageInfo();
  const keys = await listKeys();
  const sampleCount = db.leads.filter((l) => l.sample).length + db.drafts.filter((d) => d.sample).length + db.campaigns.filter((c) => c.sample).length;
  return (
    <div className="page">
      <PageHead
        title="Settings"
        sub="Tell your agents who you are and what you sell, and connect the services you use."
        actions={
          <a className="btn sm" href="#api-keys">
            <KeyRound size={14} /> API keys
          </a>
        }
      />
      <SettingsForm
        profile={db.profile}
        integrations={integrations()}
        niches={NICHES.map((n) => ({ id: n.id, label: n.label }))}
        storage={storage}
        passwordSet={Boolean(process.env.APP_PASSWORD)}
        sampleCount={sampleCount}
        keysCard={<ApiKeys keys={keys} services={SERVICES} policy={keysPolicy()} persistent={storage.persistent} focus={typeof sp.keys === "string" ? sp.keys : undefined} />}
      />
    </div>
  );
}
