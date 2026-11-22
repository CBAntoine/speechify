import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { AcceptProposal } from "@/components/clients/AcceptProposal";
import { fill, PROPOSAL, signalText } from "@/lib/clients/i18n";
import { formatMoney, localeFor, quote } from "@/lib/clients/pricing";
import { leadByProposal, proposalViewed } from "@/lib/clients/proposal";
import { pitchFor, SERVICES } from "@/lib/clients/services";
import { l3 } from "@/lib/clients/templates";
import { paypalEnabled, stripeEnabled } from "@/lib/config";
import { displayPhone } from "@/lib/phone";
import { topSignals } from "@/lib/prospecting/score";
import { marketOf } from "@/lib/regions";
import { getProfile } from "@/lib/repo";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import "../../store/store.css";
import "../doc.css";

// A prospect's proposal: what's costing them customers, the services in the
// order they go live, and the price next to what people doing the same work
// would cost where they are. Private link; never indexed.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Proposal", robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ProposalPage({ params, searchParams }: Props) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const [lead, profile] = await Promise.all([leadByProposal(token), getProfile()]);
  const p = lead?.proposal;
  if (!lead || !p) notFound();
  const h = await headers();
  if (rateLimit(`pview:${token}:${clientIp(new Request("http://x", { headers: h }))}`, 1, 30 * 60_000)) after(() => proposalViewed(token));

  const lang = l3(p.lang);
  const T = PROPOSAL[lang];
  const market = marketOf(p.place, "US");
  const money = (n: number) => formatMoney(n, p.currency, localeFor(lang, market.country.code));
  const q = quote(market.country.code, p.services);
  const services = SERVICES.filter((s) => p.services.includes(s.id));
  const gaps = topSignals(lead.signals, 5).filter((s) => !s.positive);
  const human = Math.max(p.humanMonthly, 1);
  const date = new Date(p.createdAt).toLocaleDateString(localeFor(lang, market.country.code), { year: "numeric", month: "long", day: "numeric" });
  const steps = {
    en: ["A 30-minute kickoff call: your services, hours, prices and where calls should go.", "Week 1: your new website goes live and we start bringing back past customers.", "Then, in order: review requests, instant replies to every new lead, and every call answered.", "Every month you get a results report: calls answered, leads followed up, reviews and bookings."],
    es: ["Una llamada inicial de 30 minutos: sus servicios, horarios, precios y a dónde van las llamadas.", "Semana 1: su nuevo sitio web en línea y empezamos a recuperar clientes anteriores.", "Después, en orden: solicitudes de reseña, respuesta inmediata a cada prospecto y todas las llamadas atendidas.", "Cada mes recibe un reporte de resultados: llamadas atendidas, prospectos atendidos, reseñas y citas."],
    fr: ["Un appel de démarrage de 30 minutes : vos services, heures, prix et où vont les appels.", "Semaine 1 : votre nouveau site est en ligne et nous commençons à faire revenir vos anciens clients.", "Ensuite, dans l'ordre : demandes d'avis, réponse immédiate à chaque demande et chaque appel répondu.", "Chaque mois, un rapport de résultats : appels répondus, demandes suivies, avis et réservations."],
  }[lang];

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
          <span className="store-eyebrow">
            <span className="orb idle tone-lagoon" aria-hidden /> {fill(T.prepared, { a: profile.agencyName, d: date })}
          </span>
          <h1>{fill(T.title, { b: lead.name })}</h1>
          {sp.canceled === "1" && <p className="doc-note">{T.canceled}</p>}

          <section className="doc-section">
            <h2>{T.found}</h2>
            {gaps.length ? (
              <>
                <p className="doc-sub">{fill(T.gaps, { n: gaps.length })}</p>
                <div className="doc-gaps">
                  {gaps.map((g) => (
                    <span key={g.id}>{signalText(g.id, g.label, lang)}</span>
                  ))}
                </div>
              </>
            ) : (
              <p className="doc-sub">{fill(T.foundNone, { b: lead.name })}</p>
            )}
          </section>

          <section className="doc-section">
            <h2>{T.team}</h2>
            <p className="doc-sub">{T.teamSub}</p>
            <div className="doc-team">
              {services.map((s, i) => {
                const pitch = pitchFor(s, lang);
                const line = q.lines.find((l) => l.id === s.id);
                return (
                  <div key={s.id} className="doc-svc">
                    <span className="n">{i + 1}</span>
                    <span>
                      <b>{pitch.title}</b>
                      <p>{pitch.promise}</p>
                    </span>
                    {line && (
                      <span className="cost">
                        {fill(T.role, { r: lang === "en" ? `${/^[aeiou]/i.test(pitch.role) ? "an" : "a"} ${pitch.role}` : pitch.role })}
                        <br />
                        {fill(T.wouldCost, { x: money(line.humanMonthly) })}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="doc-section">
            <h2>{T.compare}</h2>
            <div className="doc-compare">
              <div className="doc-bar">
                <span>{T.people}</span>
                <span className="track">
                  <span className="fill" style={{ width: "100%", display: "block" }} />
                </span>
                <b>{money(p.humanMonthly)}{T.per}</b>
              </div>
              <div className="doc-bar you">
                <span>{T.you}</span>
                <span className="track">
                  <span className="fill" style={{ width: `${Math.max(4, Math.min(100, (p.monthly / human) * 100))}%`, display: "block" }} />
                </span>
                <b>{money(p.monthly)}{T.per}</b>
              </div>
            </div>
            {p.setup > 0 && <p className="doc-note">{fill(T.setup, { x: money(p.setup) })}</p>}
            {p.humanMonthly > p.monthly && <p className="doc-save">{fill(T.save, { x: money(p.humanMonthly - p.monthly) })}</p>}
            <p className="doc-note">
              {fill(T.fte, { n: q.fte })}
              {q.basis === "estimate" ? ` ${T.estimate}` : ""}
            </p>
          </section>

          <section className="doc-section">
            <h2>{T.how}</h2>
            <ol className="doc-steps">
              {steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </section>

          <section className="doc-section doc-faq">
            <h2>{T.faq}</h2>
            {(["1", "2", "3", "4"] as const).map((n) => (
              <details key={n}>
                <summary>{T[`q${n}`]}</summary>
                <p>{T[`a${n}`]}</p>
              </details>
            ))}
          </section>

          <section className="doc-accept">
            <h2>{T.accept}</h2>
            <AcceptProposal
              token={token}
              labels={{ name: T.name, email: T.email, phone: T.phone, card: T.card, paypal: T.paypal, talk: T.talk, noPay: T.noPay, sub: T.acceptSub, acceptBtn: T.acceptBtn, thanks: T.thanks }}
              stripe={stripeEnabled() && !["cup", "xcg"].includes(p.currency)}
              paypal={paypalEnabled() && ["usd", "cad", "mxn", "eur", "dkk"].includes(p.currency)}
              calendarUrl={profile.calendarUrl || undefined}
              email={lead.email}
              accepted={Boolean(p.acceptedAt)}
            />
            <p className="doc-note">{profile.phone ? fill(T.contact, { p: displayPhone(profile.phone) }) : profile.email ? fill(T.contactEmail, { e: profile.email }) : T.contactPlain}</p>
          </section>
        </div>
      </main>
    </div>
  );
}
