import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Workspace } from "@/components/clients/Workspace";
import { readClientData } from "@/lib/clients/data-store";
import { twilioEnabled } from "@/lib/clients/twilio";
import { buildView, type TabId } from "@/lib/clients/view";
import { claudeEnabled, elevenEnabled, resendEnabled } from "@/lib/config";
import { NICHES } from "@/lib/niches";
import { siteUrlFrom } from "@/lib/site";
import { readDb } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Client" };

const TABS: TabId[] = ["overview", "website", "reactivation", "reviews", "speed_to_lead", "missed_calls", "sales_coach", "ads", "messages", "contacts", "settings"];

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp, db] = await Promise.all([params, searchParams, readDb()]);
  const client = db.clients.find((c) => c.id === id);
  if (!client) notFound();
  const data = await readClientData(id);
  const base = siteUrlFrom(await headers());
  const campaigns = db.campaigns.filter((c) => client.campaignIds.includes(c.id)).map((c) => ({ id: c.id, businessName: c.businessName, createdAt: c.createdAt }));
  const view = buildView({
    client,
    data,
    base,
    integrations: { claude: claudeEnabled(), twilio: twilioEnabled(), resend: resendEnabled(), eleven: elevenEnabled(), cron: Boolean(process.env.CRON_SECRET) },
    campaigns,
  });
  const tab = typeof sp.tab === "string" && TABS.includes(sp.tab as TabId) ? (sp.tab as TabId) : "overview";
  const contact = typeof sp.contact === "string" ? sp.contact : undefined;
  return (
    <div className="page wide">
      <Workspace key={`${tab}:${contact ?? ""}`} view={view} tab={tab} contactId={contact} niches={NICHES.map((n) => ({ id: n.id, label: n.label }))} agencyName={db.profile.agencyName} />
    </div>
  );
}
