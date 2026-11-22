// Words on the pages clients and prospects see (proposal, results report),
// in English, Spanish and French. They describe outcomes in plain language,
// and say honestly how the work is done when asked. Pure.

import type { Lang } from "../markets.ts";
import { l3, type L3 } from "./templates.ts";

export const PROPOSAL: Record<L3, Record<string, string>> = {
  en: {
    title: "Proposal for {b}", prepared: "Prepared by {a} · {d}", found: "What we found", foundNone: "Here's how we'd help {b} win more customers.",
    team: "Your new team", teamSub: "Seven jobs, done every day, deployed in this order so each one builds on the last.", role: "Instead of {r}:", wouldCost: "about {x}/mo",
    compare: "What it would cost to hire for this", people: "People doing this work", you: "Your price", setup: "+ {x} one-time setup", save: "You save about {x} a month",
    fte: "That's about {n} full-time people's worth of work.", how: "How it works", faq: "Questions",
    q1: "Who does the work?", a1: "Our team sets everything up, checks it every week and steps in whenever a customer needs a person. Day-to-day replies and call answering run on software we configure and supervise for you, around the clock.",
    q2: "Do I have to change my phone number?", a2: "No. You keep your number; calls your team can't pick up are forwarded to us.",
    q3: "Is there a contract?", a3: "No long-term contract: it's month to month, and you can cancel anytime.",
    q4: "What do you need from me?", a4: "A 30-minute kickoff call, your list of past customers, and your Google review link. We do the rest.",
    accept: "Accept and get started", acceptSub: "Secure checkout. Your first month and the setup are charged today; then monthly.", contact: "Questions? Reply to our email or call {p}.", contactEmail: "Questions? Write to {e}.", contactPlain: "Questions? Reply to our email.",
    name: "Your name", email: "Email", phone: "Mobile", card: "Pay by card", paypal: "Pay with PayPal", talk: "Book a call first", noPay: "Nothing is charged online: we'll email your invoice.", acceptBtn: "Accept the proposal", thanks: "Thank you! We'll email your invoice and set up your kickoff call.",
    canceled: "Checkout was canceled. Nothing was charged.", estimate: "Wages here are estimated from the local minimum wage.", gaps: "{n} things are costing you customers", per: "/mo",
  },
  es: {
    title: "Propuesta para {b}", prepared: "Preparada por {a} · {d}", found: "Lo que encontramos", foundNone: "Así ayudaríamos a {b} a ganar más clientes.",
    team: "Su nuevo equipo", teamSub: "Siete trabajos, hechos todos los días, en este orden para que cada uno potencie al siguiente.", role: "En lugar de un {r}:", wouldCost: "aprox. {x}/mes",
    compare: "Lo que costaría contratar para esto", people: "Personas haciendo este trabajo", you: "Su precio", setup: "+ {x} de instalación (pago único)", save: "Ahorra aprox. {x} al mes",
    fte: "Equivale a unas {n} personas de tiempo completo.", how: "Cómo funciona", faq: "Preguntas",
    q1: "¿Quién hace el trabajo?", a1: "Nuestro equipo configura todo, lo revisa cada semana e interviene cuando un cliente necesita a una persona. Las respuestas del día a día y la atención de llamadas funcionan con software que configuramos y supervisamos para usted, las 24 horas.",
    q2: "¿Tengo que cambiar mi número?", a2: "No. Conserva su número; las llamadas que su equipo no alcanza a contestar se desvían a nosotros.",
    q3: "¿Hay contrato?", a3: "Sin contrato a largo plazo: es mes a mes y puede cancelar cuando quiera.",
    q4: "¿Qué necesitan de mí?", a4: "Una llamada inicial de 30 minutos, su lista de clientes anteriores y su enlace de reseñas de Google. Nosotros hacemos el resto.",
    accept: "Aceptar y empezar", acceptSub: "Pago seguro. Hoy se cobra el primer mes y la instalación; después, cada mes.", contact: "¿Dudas? Responda a nuestro correo o llame al {p}.", contactEmail: "¿Dudas? Escríbanos a {e}.", contactPlain: "¿Dudas? Responda a nuestro correo.",
    name: "Su nombre", email: "Correo", phone: "Celular", card: "Pagar con tarjeta", paypal: "Pagar con PayPal", talk: "Agendar una llamada primero", noPay: "No se cobra nada en línea: le enviaremos su factura por correo.", acceptBtn: "Aceptar la propuesta", thanks: "¡Gracias! Le enviaremos su factura por correo y agendaremos la llamada inicial.",
    canceled: "Se canceló el pago. No se hizo ningún cargo.", estimate: "Los sueldos aquí se estiman a partir del salario mínimo local.", gaps: "{n} cosas le están costando clientes", per: "/mes",
  },
  fr: {
    title: "Proposition pour {b}", prepared: "Préparée par {a} · {d}", found: "Ce que nous avons constaté", foundNone: "Voici comment nous aiderions {b} à gagner plus de clients.",
    team: "Votre nouvelle équipe", teamSub: "Sept tâches, faites chaque jour, déployées dans cet ordre pour que chacune renforce la suivante.", role: "Au lieu d'un {r} :", wouldCost: "environ {x}/mois",
    compare: "Ce que coûterait l'embauche", people: "Des personnes pour faire ce travail", you: "Votre prix", setup: "+ {x} de mise en place (une fois)", save: "Vous économisez environ {x} par mois",
    fte: "C'est environ {n} personnes à temps plein.", how: "Comment ça marche", faq: "Questions",
    q1: "Qui fait le travail?", a1: "Notre équipe met tout en place, vérifie chaque semaine et intervient dès qu'un client a besoin d'une personne. Les réponses au quotidien et la prise d'appels fonctionnent avec un logiciel que nous configurons et supervisons pour vous, jour et nuit.",
    q2: "Dois-je changer de numéro?", a2: "Non. Vous gardez votre numéro; les appels que votre équipe ne peut pas prendre nous sont transférés.",
    q3: "Y a-t-il un contrat?", a3: "Aucun contrat à long terme : c'est au mois, et vous pouvez annuler en tout temps.",
    q4: "De quoi avez-vous besoin?", a4: "Un appel de démarrage de 30 minutes, votre liste d'anciens clients et votre lien d'avis Google. On s'occupe du reste.",
    accept: "Accepter et commencer", acceptSub: "Paiement sécurisé. Le premier mois et la mise en place sont facturés aujourd'hui, puis chaque mois.", contact: "Des questions? Répondez à notre courriel ou appelez le {p}.", contactEmail: "Des questions? Écrivez-nous à {e}.", contactPlain: "Des questions? Répondez à notre courriel.",
    name: "Votre nom", email: "Courriel", phone: "Cellulaire", card: "Payer par carte", paypal: "Payer avec PayPal", talk: "Réserver un appel d'abord", noPay: "Rien n'est facturé en ligne : nous vous enverrons votre facture par courriel.", acceptBtn: "Accepter la proposition", thanks: "Merci! Nous vous enverrons votre facture par courriel et fixerons l'appel de lancement.",
    canceled: "Le paiement a été annulé. Aucun montant n'a été facturé.", estimate: "Les salaires ici sont estimés à partir du salaire minimum local.", gaps: "{n} choses vous font perdre des clients", per: "/mois",
  },
};

export const REPORT: Record<L3, Record<string, string>> = {
  en: {
    title: "{b}: results for {m}", sub: "What your team at {a} did for you this month.", leads: "New customers who reached out", answered: "answered, typically within {t}",
    calls: "Calls your team couldn't pick up, handled", callsSub: "{a} answered for you, {t} texted back", winback: "Past customers who came back", winbackSub: "{r} replied to us, {b} booked",
    reviews: "Review requests", reviewsSub: "opened your review page: {c}", referrals: "Referred customers", booked: "Bookings", bookedSub: "worth about {x}",
    work: "Hours of work done for you", workSub: "about {x} of staff time", ads: "Ads", adsSub: "{s} spent · {l} leads · {c} per booking", site: "Website visits",
    coaching: "Sales calls reviewed", coachingSub: "average score {s}/100", last: "Last month", none: "Nothing to report yet this month.", month: "Month", footer: "Questions about this report? Contact {a}.",
  },
  es: {
    title: "{b}: resultados de {m}", sub: "Lo que su equipo de {a} hizo por usted este mes.", leads: "Nuevos clientes que se comunicaron con usted", answered: "atendidos, normalmente en {t}",
    calls: "Llamadas que su equipo no alcanzó a contestar, atendidas", callsSub: "atendidas por nosotros: {a} · con mensaje de vuelta: {t}", winback: "Clientes anteriores que regresaron", winbackSub: "respondieron: {r} · agendaron: {b}",
    reviews: "Solicitudes de reseña", reviewsSub: "abrieron su página de reseñas: {c}", referrals: "Clientes recomendados", booked: "Citas agendadas", bookedSub: "valen aprox. {x}",
    work: "Horas de trabajo hechas para usted", workSub: "aprox. {x} en tiempo de personal", ads: "Anuncios", adsSub: "{s} invertidos · {l} prospectos · {c} por cita", site: "Visitas al sitio web",
    coaching: "Llamadas de venta revisadas", coachingSub: "calificación promedio {s}/100", last: "Mes anterior", none: "Aún no hay nada que reportar este mes.", month: "Mes", footer: "¿Preguntas sobre este reporte? Contacte a {a}.",
  },
  fr: {
    title: "{b} : résultats de {m}", sub: "Ce que votre équipe chez {a} a fait pour vous ce mois-ci.", leads: "Nouveaux clients qui vous ont contacté", answered: "ont reçu une réponse, en général en {t}",
    calls: "Appels que votre équipe n'a pas pu prendre, traités", callsSub: "répondus pour vous : {a} · rappelés par texto : {t}", winback: "Anciens clients revenus", winbackSub: "ont répondu : {r} · ont réservé : {b}",
    reviews: "Demandes d'avis", reviewsSub: "ont ouvert votre page d'avis : {c}", referrals: "Clients recommandés", booked: "Réservations", bookedSub: "d'une valeur d'environ {x}",
    work: "Heures de travail faites pour vous", workSub: "environ {x} en temps de personnel", ads: "Publicités", adsSub: "{s} investis · {l} demandes · {c} par réservation", site: "Visites du site web",
    coaching: "Appels de vente revus", coachingSub: "note moyenne {s}/100", last: "Mois précédent", none: "Rien à signaler pour l'instant ce mois-ci.", month: "Mois", footer: "Des questions sur ce rapport? Contactez {a}.",
  },
};

/** Audit findings in the prospect's words. English labels come from the audit itself. */
const SIGNALS: Record<string, Partial<Record<L3, string>>> = {
  no_website: { es: "No tiene sitio web", fr: "Pas de site web" },
  site_down: { es: "Su sitio web no carga", fr: "Votre site web ne charge pas" },
  few_reviews: { es: "Pocas reseñas en Google", fr: "Peu d'avis Google" },
  low_rating: { es: "Calificación baja en Google", fr: "Note Google faible" },
  no_https: { es: "El sitio aparece como \"No seguro\"", fr: "Le site s'affiche « Non sécurisé »" },
  not_mobile: { es: "El sitio no está hecho para celular", fr: "Le site n'est pas adapté aux mobiles" },
  slow: { es: "El sitio tarda en cargar", fr: "Le site est lent à charger" },
  no_booking: { es: "No se puede agendar en línea", fr: "Pas de réservation en ligne" },
  no_pixel: { es: "Sin medición de anuncios", fr: "Aucun suivi des publicités" },
  no_chat: { es: "No hay forma de escribirle desde el sitio", fr: "Impossible de vous écrire depuis le site" },
  stale_site: { es: "El sitio se ve desactualizado", fr: "Le site semble à l'abandon" },
  no_form: { es: "No hay formulario de contacto", fr: "Pas de formulaire de contact" },
  no_click_to_call: { es: "El teléfono no se puede tocar para llamar", fr: "Le numéro n'est pas cliquable" },
  weak_seo: { es: "Google no muestra bien su negocio", fr: "Google affiche mal votre entreprise" },
  no_schema: { es: "Google no ve sus horarios ni servicios", fr: "Google ne voit pas vos heures ni vos services" },
  no_social: { es: "Sin redes sociales en el sitio", fr: "Aucun réseau social sur le site" },
};

export function signalText(id: string, englishLabel: string, lang: Lang | undefined): string {
  const l = l3(lang);
  return l === "en" ? englishLabel : (SIGNALS[id]?.[l] ?? englishLabel);
}

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (w, k: string) => (k in vars ? String(vars[k]) : w));
}

const MONTHS: Record<L3, string[]> = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
  fr: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
};

/** "2026-11" → "November 2026" / "noviembre de 2026" / "novembre 2026". */
export function monthName(ym: string, lang: Lang | undefined): string {
  const [y, m] = ym.split("-").map(Number);
  const l = l3(lang);
  const name = MONTHS[l][(m || 1) - 1];
  return l === "es" ? `${name} de ${y}` : `${name} ${y}`;
}
