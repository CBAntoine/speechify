import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { readClientData } from "@/lib/clients/data-store";
import { fill, monthName, REPORT } from "@/lib/clients/i18n";
import { formatDuration, monthPeriod, results, type Results } from "@/lib/clients/metrics";
import { formatMoney, localeFor, wagesFor } from "@/lib/clients/pricing";
import { clientByReportToken } from "@/lib/clients/repo";
import { l3 } from "@/lib/clients/templates";
import { monthKey, previousMonth } from "@/lib/clients/view";
import { getProfile } from "@/lib/repo";
import "../../store/store.css";
import "../../proposal/doc.css";

// A client's monthly results, in their language: the outcomes they pay for,
// next to last month. Private link the agency sends each month.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Results", robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ReportPage({ params, searchParams }: Props) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const [client, profile] = await Promise.all([clientByReportToken(token), getProfile()]);
  if (!client) notFound();
  const data = await readClientData(client.id);
  const now = monthKey(new Date());
  const ym = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) && sp.month <= now ? sp.month : now;
  const r: Results = results(client, data, monthPeriod(ym));
  const prev: Results = results(client, data, monthPeriod(previousMonth(ym)));
  const lang = l3(client.lang);
  const T = REPORT[lang];
  const money = (n: number) => formatMoney(n, client.currency, localeFor(lang, client.country));
  const w = wagesFor(client.country);
  const hourly = w.currency === client.currency ? w.hourly.lead_responder * w.burden : 0;
  const months = [now, previousMonth(now), previousMonth(previousMonth(now)), previousMonth(previousMonth(previousMonth(now)))];
  const caught = r.calls.ai + r.calls.textedBack;
  const tiles: { k: string; v: string | number; s?: string; was: number; now: number; show: boolean }[] = [
    { k: T.leads, v: r.leads, s: r.medianResponseSec !== undefined ? fill(T.answered, { t: formatDuration(r.medianResponseSec) }) : undefined, was: prev.leads, now: r.leads, show: true },
    { k: T.calls, v: caught, s: fill(T.callsSub, { a: r.calls.ai, t: r.calls.textedBack }), was: prev.calls.ai + prev.calls.textedBack, now: caught, show: client.services.missed_calls.included },
    { k: T.winback, v: r.winback.replied, s: fill(T.winbackSub, { r: r.winback.replied, b: r.winback.booked }), was: prev.winback.replied, now: r.winback.replied, show: client.services.reactivation.included },
    { k: T.reviews, v: r.reviews.asked, s: fill(T.reviewsSub, { c: r.reviews.clicked }), was: prev.reviews.asked, now: r.reviews.asked, show: client.services.reviews.included },
    { k: T.referrals, v: r.referrals.leads, was: prev.referrals.leads, now: r.referrals.leads, show: client.services.reviews.included },
    { k: T.booked, v: r.booked, s: r.revenue ? fill(T.bookedSub, { x: money(r.revenue) }) : undefined, was: prev.booked, now: r.booked, show: true },
    { k: T.site, v: r.siteViews, was: prev.siteViews, now: r.siteViews, show: Boolean(client.site?.published) },
    { k: T.coaching, v: r.coaching.reviewed, s: r.coaching.average !== undefined ? fill(T.coachingSub, { s: r.coaching.average }) : undefined, was: prev.coaching.reviewed, now: r.coaching.reviewed, show: client.services.sales_coach.included },
    { k: T.ads, v: money(r.ads.spend), s: fill(T.adsSub, { s: money(r.ads.spend), l: r.ads.leads, c: r.ads.costPerBooking !== undefined ? money(r.ads.costPerBooking) : "–" }), was: prev.ads.booked, now: r.ads.booked, show: client.services.ads.included && r.ads.spend > 0 },
    { k: T.work, v: `${r.hours} h`, s: hourly ? fill(T.workSub, { x: money(r.hours * hourly) }) : undefined, was: Math.round(prev.hours), now: Math.round(r.hours), show: true },
  ];
  const empty = !r.leads && !r.calls.total && !r.messagesSent && !r.booked;

  return (
    <div className="store">
      <header className="store-header">
        <div className="store-wrap">
          <span className="store-logo">
            <span className="orb idle tone-sky" aria-hidden />
            {profile.agencyName}
          </span>
        </div>
      </header>
      <main className="doc">
        <div className="store-wrap">
          <h1>{fill(T.title, { b: client.name, m: monthName(ym, lang) })}</h1>
          <p className="doc-sub">{fill(T.sub, { a: profile.agencyName })}</p>
          <nav className="doc-months" aria-label={T.month}>
            {months.map((m) => (
              <Link key={m} href={`/report/${token}?month=${m}`} aria-current={m === ym ? "page" : undefined}>
                {monthName(m, lang)}
              </Link>
            ))}
          </nav>
          {empty ? (
            <p className="doc-sub" style={{ marginTop: 30 }}>{T.none}</p>
          ) : (
            <div className="doc-grid" style={{ marginTop: 26 }}>
              {tiles
                .filter((t) => t.show)
                .map((t) => (
                  <div key={t.k} className="doc-card">
                    <div className="k">{t.k}</div>
                    <div className="v">{t.v}</div>
                    {t.s && <div className="s">{t.s}</div>}
                    <div className="s" style={{ color: "var(--text-3)" }}>
                      {T.last}: {t.was}
                    </div>
                  </div>
                ))}
            </div>
          )}
          <p className="doc-note" style={{ marginTop: 30 }}>{fill(T.footer, { a: [profile.agencyName, profile.email, profile.phone].filter(Boolean).join(" · ") })}</p>
        </div>
      </main>
    </div>
  );
}
