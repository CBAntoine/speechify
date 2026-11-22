import type { Metadata } from "next";
import { headers } from "next/headers";
import { StoreManager } from "@/components/sell/StoreManager";
import { PageHead } from "@/components/ui";
import { OFFERS, monthlyCost } from "@/lib/catalog";
import { integrations } from "@/lib/config";
import { resolveSalesAgentId } from "@/lib/elevenlabs/sales-agent";
import { siteUrlFrom } from "@/lib/site";
import { readDb } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Store & pricing" };

export default async function SellPage() {
  const [db, h, agentId] = await Promise.all([readDb(), headers(), resolveSalesAgentId()]);
  const base = siteUrlFrom(h);
  return (
    <div className="page">
      <PageHead title="Store & pricing" sub="Your public sales page, prices, payments and the AI sales assistant that explains every product." />
      <StoreManager
        base={base}
        store={db.store}
        offers={OFFERS.map((o) => ({ id: o.id, name: o.name, kind: o.kind, category: o.category, slug: o.slug, monthly: o.monthly, setup: o.setup, cost: monthlyCost(o), bundles: o.bundles ?? [] }))}
        integrations={integrations()}
        webhooks={{
          stripe: Boolean(process.env.STRIPE_WEBHOOK_SECRET || db.payments.stripe.webhookSecret),
          stripeUrl: db.payments.stripe.webhookUrl,
          paypal: Boolean(process.env.PAYPAL_WEBHOOK_ID || db.payments.paypal.webhookId),
          paypalUrl: db.payments.paypal.webhookUrl,
        }}
        agentId={agentId}
        passwordSet={Boolean(process.env.APP_PASSWORD)}
      />
    </div>
  );
}
