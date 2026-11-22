import type { Metadata } from "next";
import { AutopilotPanel } from "@/components/autopilot/AutopilotPanel";
import { PageHead } from "@/components/ui";
import { integrations } from "@/lib/config";
import { NICHES } from "@/lib/niches";
import { readDb } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Autopilot" };

export default async function AutopilotPage() {
  const db = await readDb();
  const running = Boolean(db.autopilot.lockUntil && Date.parse(db.autopilot.lockUntil) > Date.now());
  return (
    <div className="page">
      <PageHead title="Autopilot" sub="Finds clients, builds each one a demo AI receptionist, writes the outreach and sample ads, follows up, and onboards whoever pays. Every day, on its own." />
      <AutopilotPanel
        initial={{ config: db.autopilot.config, runs: db.autopilot.runs.slice(0, 15), running }}
        niches={NICHES.map((n) => ({ id: n.id, label: n.label }))}
        targetNiches={db.profile.targetNiches}
        integrations={integrations()}
        mailingAddress={Boolean(db.profile.mailingAddress.trim())}
        siteUrlSet={Boolean(process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL)}
      />
    </div>
  );
}
