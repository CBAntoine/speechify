import type { Metadata } from "next";
import { ClientsList } from "@/components/clients/ClientsList";
import { PageHead } from "@/components/ui";
import { readClientData } from "@/lib/clients/data-store";
import { monthPeriod, results } from "@/lib/clients/metrics";
import { monthKey } from "@/lib/clients/view";
import { NICHES } from "@/lib/niches";
import { readDb } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage() {
  const db = await readDb();
  const period = monthPeriod(monthKey(new Date()));
  const rows = await Promise.all(
    db.clients.slice(0, 80).map(async (client) => {
      const data = await readClientData(client.id);
      return {
        client: { id: client.id, name: client.name, niche: client.niche, place: client.place, country: client.country, lang: client.lang, currency: client.currency, status: client.status, monthly: client.monthly, services: client.services, sample: client.sample },
        results: results(client, data, period),
        drafts: data.messages.filter((m) => m.status === "draft" && m.direction === "out").length,
        needsHuman: data.contacts.filter((c) => c.needsHuman && !c.optedOutAt).length,
      };
    })
  );
  const leads = db.leads
    .filter((l) => !l.clientId && l.stage !== "lost")
    .sort((a, b) => (a.stage === "won" ? -1 : b.stage === "won" ? 1 : (b.score ?? 0) - (a.score ?? 0)))
    .slice(0, 200)
    .map((l) => ({ id: l.id, name: l.name, niche: l.niche, city: l.city, stage: l.stage }));
  return (
    <div className="page wide">
      <PageHead
        title="Clients"
        sub="Every business you deliver the seven services to, in order: website, win-back, reviews, instant follow-up, every call answered, sales coaching, then ads. Sold as outcomes, priced under what the people would cost."
      />
      <ClientsList rows={rows} leads={leads} niches={NICHES.map((n) => ({ id: n.id, label: n.label }))} defaultPlace={db.profile.city} />
    </div>
  );
}
