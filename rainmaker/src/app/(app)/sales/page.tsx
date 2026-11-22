import type { Metadata } from "next";
import { Orders } from "@/components/sales/Orders";
import { PageHead } from "@/components/ui";
import { OFFERS } from "@/lib/catalog";
import { salesStats } from "@/lib/payments/encode";
import { readDb } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sales" };

export default async function SalesPage() {
  const db = await readDb();
  return (
    <div className="page">
      <PageHead title="Sales" sub="Every order from your store, what it's worth each month, and where each new client's onboarding stands." />
      <Orders
        orders={db.orders}
        stats={salesStats(db.orders)}
        currency={db.store.currency}
        offers={OFFERS.map((o) => ({ id: o.id, name: o.name, kind: o.kind }))}
        leads={db.leads.filter((l) => !l.sample).map((l) => ({ id: l.id, name: l.name }))}
      />
    </div>
  );
}
