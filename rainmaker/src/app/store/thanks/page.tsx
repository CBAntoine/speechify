import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { after } from "next/server";
import { CalendarCheck, CircleCheck, Hourglass } from "lucide-react";
import { getOffer } from "@/lib/catalog";
import { reconcileReturn } from "@/lib/payments/reconcile";
import { siteUrlFrom } from "@/lib/site";
import { getStoreView } from "@/lib/store-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Thank you", robots: { index: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ThanksPage({ searchParams }: Props) {
  const q = await searchParams;
  const base = siteUrlFrom(await headers());
  const [v, result] = await Promise.all([
    getStoreView(),
    reconcileReturn({ orderId: one(q.order), sessionId: one(q.session_id), subscriptionId: one(q.subscription_id), base }).catch((err) => {
      console.error("[rainmaker] thank-you reconcile", err);
      return { state: "unknown" as const, order: undefined, fulfill: undefined };
    }),
  ]);
  // Payment confirmed on this visit: start onboarding after the page is sent.
  if (result.fulfill) after(result.fulfill);

  const order = result.order;
  const offer = order ? getOffer(order.offerId) : undefined;
  const paid = result.state === "paid";

  return (
    <div className="narrow">
      <div className="status-hero">
        <span className={`status-icon ${paid ? "" : "wait"}`}>{paid ? <CircleCheck size={28} /> : <Hourglass size={28} />}</span>
        <h1>{paid ? "You're in. Welcome aboard!" : result.state === "processing" ? "Almost there…" : "Thanks for your interest"}</h1>
        <p style={{ margin: 0, fontSize: 17 }}>
          {paid
            ? `Your ${order?.offerName ?? "order"} is confirmed${order?.email ? ` and a receipt is on its way to ${order.email}` : ""}. ${v.brand.name} has already started setting things up.`
            : result.state === "processing"
              ? "Your payment is being confirmed. This usually takes under a minute; refresh this page or watch your inbox."
              : "We couldn't confirm a payment on this page. If you completed checkout, you'll get an email shortly. Otherwise, you can try again anytime."}
        </p>
      </div>

      {paid && offer && (
        <>
          <h2>What happens next</h2>
          <ol className="pd-steps">
            {offer.howItWorks.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <p>{offer.timeToLive}.</p>
        </>
      )}

      <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: 24 }}>
        {paid && v.brand.calendarUrl && (
          <a className="btn primary lg" href={v.brand.calendarUrl} target="_blank" rel="noopener">
            <CalendarCheck size={17} /> Book your kickoff call
          </a>
        )}
        {!paid && (
          <Link className="btn primary lg" href={offer ? `/store/${offer.slug}` : "/store#plans"}>
            Back to {offer ? offer.name : "plans"}
          </Link>
        )}
        <Link className="btn lg" href="/store">
          Store home
        </Link>
      </div>
      {(v.brand.email || v.brand.phone) && (
        <p style={{ marginTop: 28 }}>
          Questions? {v.brand.email && <a className="text-link" href={`mailto:${v.brand.email}`}>{v.brand.email}</a>}
          {v.brand.email && v.brand.phone ? " · " : ""}
          {v.brand.phone}
        </p>
      )}
    </div>
  );
}
