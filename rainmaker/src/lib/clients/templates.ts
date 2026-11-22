// Words the client's customers see when no AI is connected (or as a safe
// fallback): lead follow-ups, win-backs, review and referral asks, the
// missed-call text, opt-out confirmations, owner alerts and a starter
// website. English, Spanish and French; other languages use English.
// Messages speak for the business and never claim a person wrote them.
// Pure.

import type { Lang } from "../markets.ts";
import type { Niche } from "../niches.ts";
import type { SequenceKind, SequenceStepContent, SiteContent } from "../types.ts";

export type L3 = "en" | "es" | "fr";
export const l3 = (lang: Lang | undefined): L3 => (lang === "es" || lang === "fr" ? lang : "en");

const STOP: Record<L3, string> = {
  en: "Reply STOP to opt out.",
  es: "Responda STOP para no recibir más mensajes.",
  fr: "Répondez STOP pour ne plus recevoir de messages.",
};

export function stopLine(lang: Lang | undefined): string {
  return STOP[l3(lang)];
}

/** An opt-out keyword written the way carriers expect it: in capitals. */
const HAS_STOP = /\b(STOP|ALTO|ARRÊT|ARRET|BAJA)\b/;

/**
 * A text that says who is writing and how to stop. Canada's CASL wants both in
 * every commercial message; everywhere else carriers expect them in the first
 * message to someone, so later ones are left as written. Adds only what's missing.
 */
export function identifiedText(body: string, o: { business: string; lang: Lang | undefined; country: string; first: boolean }): string {
  if (o.country.toUpperCase() !== "CA" && !o.first) return body;
  let text = body.trim();
  const name = o.business.trim();
  if (name && !text.toLowerCase().includes(name.toLowerCase())) text = `${name}: ${text}`;
  if (!HAS_STOP.test(text)) text = `${text} ${stopLine(o.lang)}`;
  return text;
}

/** How each language names a niche, for templates (Claude writes the rest itself). */
const NICHE_WORDS: Record<string, { es: string; fr: string }> = {
  dentist: { es: "dentista", fr: "dentiste" },
  med_spa: { es: "clínica estética", fr: "clinique esthétique" },
  roofer: { es: "techos e impermeabilización", fr: "couvreur" },
  hvac: { es: "aire acondicionado y calefacción", fr: "chauffage et climatisation" },
  plumber: { es: "plomería", fr: "plombier" },
  chiropractor: { es: "quiropráctico", fr: "chiropraticien" },
  law_pi: { es: "abogado de lesiones", fr: "avocat en préjudice corporel" },
  real_estate: { es: "bienes raíces", fr: "courtier immobilier" },
  gym: { es: "gimnasio", fr: "centre de conditionnement physique" },
  restaurant: { es: "restaurante", fr: "restaurant" },
  salon: { es: "salón de belleza", fr: "salon de coiffure" },
  auto_repair: { es: "taller mecánico", fr: "garage" },
  cleaning: { es: "servicio de limpieza", fr: "entretien ménager" },
  landscaping: { es: "jardinería", fr: "aménagement paysager" },
  pest_control: { es: "control de plagas", fr: "extermination" },
  veterinarian: { es: "veterinaria", fr: "vétérinaire" },
  physical_therapy: { es: "fisioterapia", fr: "physiothérapie" },
  accountant: { es: "contabilidad", fr: "comptable" },
};

export function nicheWord(niche: Pick<Niche, "id" | "label"> | undefined, lang: Lang | undefined): string {
  const l = l3(lang);
  if (!niche) return { en: "local business", es: "negocio local", fr: "entreprise locale" }[l];
  if (l === "en") return niche.label.toLowerCase();
  return NICHE_WORDS[niche.id]?.[l] ?? niche.label.toLowerCase();
}

export interface SeqContext {
  business: string;
  /** What they'd come back for, e.g. "your next cleaning". */
  service?: string;
  offer?: string;
  referralOffer?: string;
}

type StepText = { delayHours: number; sms: string; subject: string; email: string };

function steps(list: StepText[]): SequenceStepContent[] {
  return list.map((s) => ({ ...s, sms: s.sms.replace(/\s+/g, " ").trim() }));
}

/** A ready-to-run sequence for one kind, in the client's language. */
export function defaultSequence(kind: SequenceKind, lang: Lang | undefined, ctx: SeqContext): { name: string; steps: SequenceStepContent[] } {
  const l = l3(lang);
  const svc = ctx.service?.trim();
  const offer = ctx.offer?.trim();
  const ref = ctx.referralOffer?.trim();
  const T = {
    nurture: {
      en: {
        name: "Lead follow-up",
        steps: [
          { delayHours: 0, sms: `Hi {first_name}, thanks for contacting {business}! We got your request. What day and time work best for you? You can also book here: {booking_link} ${STOP.en}`, subject: "We got your request", email: "Hi {first_name},\n\nThanks for contacting {business}. We got your request and we're on it.\n\nWhat day and time work best for you? You can reply to this email, or book here: {booking_link}\n\nTalk soon,\n{business}" },
          { delayHours: 24, sms: "Hi {first_name}, checking in from {business}. Still need a hand? Reply here or grab a time: {booking_link}", subject: "Still need a hand?", email: "Hi {first_name},\n\nJust checking in. Do you still need help? Reply to this email, or pick a time that suits you: {booking_link}\n\n{business}" },
          { delayHours: 72, sms: "{first_name}, we'd love to help. Booking takes under a minute: {booking_link}. Any questions? Just reply.", subject: "Any questions?", email: "Hi {first_name},\n\nIf anything's holding you back, just ask: we're happy to answer. Booking takes under a minute: {booking_link}\n\n{business}" },
          { delayHours: 168, sms: "Hi {first_name}, I'll close this out for now. If you still need {business}, reply anytime and we'll get you booked.", subject: "Closing this out", email: "Hi {first_name},\n\nWe haven't heard back, so we'll close this out for now. If you still need us, just reply and we'll pick it up right away.\n\n{business}" },
        ],
      },
      es: {
        name: "Seguimiento de prospectos",
        steps: [
          { delayHours: 0, sms: `Hola {first_name}, gracias por contactar a {business}. Recibimos su solicitud. ¿Qué día y hora le quedan mejor? También puede reservar aquí: {booking_link} ${STOP.es}`, subject: "Recibimos su solicitud", email: "Hola {first_name}:\n\nGracias por contactar a {business}. Recibimos su solicitud y ya la estamos atendiendo.\n\n¿Qué día y hora le quedan mejor? Puede responder a este correo o reservar aquí: {booking_link}\n\nSaludos,\n{business}" },
          { delayHours: 24, sms: "Hola {first_name}, le escribe {business}. ¿Todavía necesita ayuda? Responda aquí o elija un horario: {booking_link}", subject: "¿Todavía necesita ayuda?", email: "Hola {first_name}:\n\nSolo para darle seguimiento. ¿Todavía necesita ayuda? Responda a este correo o elija el horario que le convenga: {booking_link}\n\n{business}" },
          { delayHours: 72, sms: "{first_name}, con gusto le ayudamos. Reservar toma menos de un minuto: {booking_link}. ¿Dudas? Solo responda.", subject: "¿Tiene alguna duda?", email: "Hola {first_name}:\n\nSi tiene alguna duda, pregúntenos con confianza. Reservar toma menos de un minuto: {booking_link}\n\n{business}" },
          { delayHours: 168, sms: "Hola {first_name}, por ahora cerramos su solicitud. Si todavía necesita a {business}, responda cuando guste y le agendamos.", subject: "Cerramos su solicitud por ahora", email: "Hola {first_name}:\n\nNo hemos tenido respuesta, así que por ahora cerramos su solicitud. Si todavía nos necesita, responda y la retomamos de inmediato.\n\n{business}" },
        ],
      },
      fr: {
        name: "Suivi des demandes",
        steps: [
          { delayHours: 0, sms: `Bonjour {first_name}, merci d'avoir contacté {business}! Nous avons bien reçu votre demande. Quel jour et quelle heure vous conviennent? Vous pouvez aussi réserver ici : {booking_link} ${STOP.fr}`, subject: "Nous avons reçu votre demande", email: "Bonjour {first_name},\n\nMerci d'avoir contacté {business}. Nous avons bien reçu votre demande et nous nous en occupons.\n\nQuel jour et quelle heure vous conviennent? Répondez à ce courriel ou réservez ici : {booking_link}\n\nÀ bientôt,\n{business}" },
          { delayHours: 24, sms: "Bonjour {first_name}, petit suivi de {business}. Avez-vous toujours besoin d'aide? Répondez ici ou choisissez un moment : {booking_link}", subject: "Toujours besoin d'aide?", email: "Bonjour {first_name},\n\nUn petit suivi : avez-vous toujours besoin d'aide? Répondez à ce courriel ou choisissez le moment qui vous convient : {booking_link}\n\n{business}" },
          { delayHours: 72, sms: "{first_name}, nous serions ravis de vous aider. Réserver prend moins d'une minute : {booking_link}. Des questions? Répondez simplement.", subject: "Des questions?", email: "Bonjour {first_name},\n\nSi quelque chose vous fait hésiter, demandez-nous : nous répondrons avec plaisir. Réserver prend moins d'une minute : {booking_link}\n\n{business}" },
          { delayHours: 168, sms: "Bonjour {first_name}, nous fermons votre demande pour l'instant. Si vous avez encore besoin de {business}, répondez quand vous voulez.", subject: "Nous fermons votre demande", email: "Bonjour {first_name},\n\nSans nouvelles de votre part, nous fermons votre demande pour l'instant. Si vous avez encore besoin de nous, répondez et nous reprendrons tout de suite.\n\n{business}" },
        ],
      },
    },
    reactivation: {
      en: {
        name: "Past-customer win-back",
        steps: [
          { delayHours: 0, sms: `Hi {first_name}, it's {business}. It's been a while! ${svc ? `Is it time for ${svc}?` : "Can we help you with anything?"}${offer ? ` This month: ${offer}.` : ""} Reply YES and we'll find you a time. ${STOP.en}`, subject: `{first_name}, it's been a while`, email: `Hi {first_name},\n\nIt's been a while since we saw you at {business}. ${svc ? `Is it time for ${svc}?` : "Can we help you with anything?"}${offer ? `\n\nThis month: ${offer}.` : ""}\n\nJust reply to this email, or book here: {booking_link}\n\n{business}` },
          { delayHours: 48, sms: "Hi {first_name}, just making sure you saw this. We have openings this week. Want one?", subject: "Openings this week", email: "Hi {first_name},\n\nJust making sure you saw our last note: we have openings this week. Want one? Reply, or book here: {booking_link}\n\n{business}" },
          { delayHours: 120, sms: "Last note from {business}: if now isn't a good time, no worries. Reply anytime when you're ready.", subject: "Whenever you're ready", email: "Hi {first_name},\n\nIf now isn't a good time, no worries at all. Whenever you're ready, just reply and we'll take care of you.\n\n{business}" },
        ],
      },
      es: {
        name: "Recuperar clientes anteriores",
        steps: [
          { delayHours: 0, sms: `Hola {first_name}, le escribe {business}. ¡Hace tiempo que no le vemos! ${svc ? `¿Ya es momento de ${svc}?` : "¿Le podemos ayudar en algo?"}${offer ? ` Este mes: ${offer}.` : ""} Responda SÍ y le buscamos un horario. ${STOP.es}`, subject: "{first_name}, hace tiempo que no le vemos", email: `Hola {first_name}:\n\nHace tiempo que no le vemos en {business}. ${svc ? `¿Ya es momento de ${svc}?` : "¿Le podemos ayudar en algo?"}${offer ? `\n\nEste mes: ${offer}.` : ""}\n\nResponda a este correo o reserve aquí: {booking_link}\n\n{business}` },
          { delayHours: 48, sms: "Hola {first_name}, solo para confirmar que vio nuestro mensaje. Tenemos espacios esta semana. ¿Le apartamos uno?", subject: "Espacios esta semana", email: "Hola {first_name}:\n\nSolo para confirmar que vio nuestro mensaje: tenemos espacios esta semana. ¿Le apartamos uno? Responda o reserve aquí: {booking_link}\n\n{business}" },
          { delayHours: 120, sms: "Último mensaje de {business}: si ahora no es buen momento, no se preocupe. Responda cuando guste.", subject: "Cuando usted guste", email: "Hola {first_name}:\n\nSi ahora no es buen momento, no se preocupe. Cuando guste, responda y con gusto le atendemos.\n\n{business}" },
        ],
      },
      fr: {
        name: "Retour des anciens clients",
        steps: [
          { delayHours: 0, sms: `Bonjour {first_name}, ici {business}. Ça fait un moment! ${svc ? `Est-il temps pour ${svc}?` : "Pouvons-nous vous aider?"}${offer ? ` Ce mois-ci : ${offer}.` : ""} Répondez OUI et nous vous trouvons un moment. ${STOP.fr}`, subject: "{first_name}, ça fait un moment", email: `Bonjour {first_name},\n\nÇa fait un moment que nous ne vous avons pas vu chez {business}. ${svc ? `Est-il temps pour ${svc}?` : "Pouvons-nous vous aider?"}${offer ? `\n\nCe mois-ci : ${offer}.` : ""}\n\nRépondez à ce courriel ou réservez ici : {booking_link}\n\n{business}` },
          { delayHours: 48, sms: "Bonjour {first_name}, nous voulions être sûrs que vous aviez vu notre message. Il nous reste des places cette semaine. Une pour vous?", subject: "Des places cette semaine", email: "Bonjour {first_name},\n\nNous voulions être sûrs que vous aviez vu notre message : il nous reste des places cette semaine. Une pour vous? Répondez ou réservez ici : {booking_link}\n\n{business}" },
          { delayHours: 120, sms: "Dernier message de {business} : si ce n'est pas le bon moment, aucun souci. Répondez quand vous serez prêt.", subject: "Quand vous serez prêt", email: "Bonjour {first_name},\n\nSi ce n'est pas le bon moment, aucun souci. Quand vous serez prêt, répondez et nous nous occuperons de vous.\n\n{business}" },
        ],
      },
    },
    review: {
      en: {
        name: "Review request",
        steps: [
          { delayHours: 0, sms: `Hi {first_name}, thanks for choosing {business}! Would you take 30 seconds to share how we did? {review_link} ${STOP.en}`, subject: "How did we do?", email: "Hi {first_name},\n\nThank you for choosing {business}! Would you take 30 seconds to share how we did? Every review helps people nearby find us.\n\n{review_link}\n\nThank you,\n{business}" },
          { delayHours: 72, sms: "Hi {first_name}, a quick reminder from {business}: your review really helps people find us. {review_link} Thank you!", subject: "A quick reminder", email: "Hi {first_name},\n\nA quick reminder: if you have a moment, your review would really help. {review_link}\n\nThank you,\n{business}" },
        ],
      },
      es: {
        name: "Solicitud de reseña",
        steps: [
          { delayHours: 0, sms: `Hola {first_name}, ¡gracias por elegir a {business}! ¿Nos regala 30 segundos para contar cómo le fue? {review_link} ${STOP.es}`, subject: "¿Cómo le fue con nosotros?", email: "Hola {first_name}:\n\n¡Gracias por elegir a {business}! ¿Nos regala 30 segundos para contar cómo le fue? Cada reseña ayuda a que más personas nos encuentren.\n\n{review_link}\n\nGracias,\n{business}" },
          { delayHours: 72, sms: "Hola {first_name}, un recordatorio de {business}: su reseña nos ayuda muchísimo. {review_link} ¡Gracias!", subject: "Un breve recordatorio", email: "Hola {first_name}:\n\nUn breve recordatorio: si tiene un momento, su reseña nos ayudaría muchísimo. {review_link}\n\nGracias,\n{business}" },
        ],
      },
      fr: {
        name: "Demande d'avis",
        steps: [
          { delayHours: 0, sms: `Bonjour {first_name}, merci d'avoir choisi {business}! Auriez-vous 30 secondes pour nous dire comment ça s'est passé? {review_link} ${STOP.fr}`, subject: "Comment ça s'est passé?", email: "Bonjour {first_name},\n\nMerci d'avoir choisi {business}! Auriez-vous 30 secondes pour nous dire comment ça s'est passé? Chaque avis aide les gens du coin à nous trouver.\n\n{review_link}\n\nMerci,\n{business}" },
          { delayHours: 72, sms: "Bonjour {first_name}, petit rappel de {business} : votre avis nous aide vraiment. {review_link} Merci!", subject: "Petit rappel", email: "Bonjour {first_name},\n\nPetit rappel : si vous avez un moment, votre avis nous aiderait vraiment. {review_link}\n\nMerci,\n{business}" },
        ],
      },
    },
    referral: {
      en: {
        name: "Referral ask",
        steps: [
          { delayHours: 24, sms: `Thank you so much, {first_name}! If you know someone who could use ${svc ?? "{business}"}, send them this link${ref ? ` (they get ${ref})` : ""}: {referral_link}`, subject: "Know someone we could help?", email: `Hi {first_name},\n\nThank you so much for your support! If you know someone who could use ${svc ?? "{business}"}, just forward them this link${ref ? `; they'll get ${ref}` : ""}:\n\n{referral_link}\n\nThank you,\n{business}` },
        ],
      },
      es: {
        name: "Pedir recomendaciones",
        steps: [
          { delayHours: 24, sms: `¡Muchas gracias, {first_name}! Si conoce a alguien que necesite ${svc ?? "{business}"}, compártale este enlace${ref ? ` (recibe ${ref})` : ""}: {referral_link}`, subject: "¿Conoce a alguien a quien podamos ayudar?", email: `Hola {first_name}:\n\n¡Muchas gracias por su apoyo! Si conoce a alguien que necesite ${svc ?? "{business}"}, compártale este enlace${ref ? `; recibirá ${ref}` : ""}:\n\n{referral_link}\n\nGracias,\n{business}` },
        ],
      },
      fr: {
        name: "Demande de recommandation",
        steps: [
          { delayHours: 24, sms: `Merci beaucoup, {first_name}! Si vous connaissez quelqu'un qui aurait besoin de ${svc ?? "{business}"}, partagez-lui ce lien${ref ? ` (il obtient ${ref})` : ""} : {referral_link}`, subject: "Vous connaissez quelqu'un que nous pourrions aider?", email: `Bonjour {first_name},\n\nMerci beaucoup de votre confiance! Si vous connaissez quelqu'un qui aurait besoin de ${svc ?? "{business}"}, transférez-lui ce lien${ref ? `; il obtiendra ${ref}` : ""} :\n\n{referral_link}\n\nMerci,\n{business}` },
        ],
      },
    },
  } satisfies Record<SequenceKind, Record<L3, { name: string; steps: StepText[] }>>;
  const t = T[kind][l];
  return { name: t.name, steps: steps(t.steps) };
}

/** What a missed caller gets by text. {business} is filled in by render(). */
export function textBackTemplate(lang: Lang | undefined): string {
  return {
    en: "Hi, this is {business}. Sorry we missed your call! How can we help? Reply here and we'll take care of you.",
    es: "Hola, le escribe {business}. ¡Perdón por no contestar su llamada! ¿En qué le podemos ayudar? Responda aquí y le atendemos.",
    fr: "Bonjour, ici {business}. Désolés d'avoir manqué votre appel! Comment pouvons-nous vous aider? Répondez ici et on s'occupe de vous.",
  }[l3(lang)];
}

/** A holding reply when the AI is off or couldn't answer. */
export function holdingReply(lang: Lang | undefined): string {
  return {
    en: "Thanks for your message! Someone from {business} will reply shortly.",
    es: "¡Gracias por su mensaje! Alguien de {business} le responderá en breve.",
    fr: "Merci pour votre message! Quelqu'un de {business} vous répondra sous peu.",
  }[l3(lang)];
}

export function optOutConfirmation(lang: Lang | undefined): string {
  return {
    en: "You're unsubscribed from {business} and won't get more messages. Reply START to resubscribe.",
    es: "Listo, ya no recibirá mensajes de {business}. Responda START para volver a suscribirse.",
    fr: "C'est noté, vous ne recevrez plus de messages de {business}. Répondez START pour vous réabonner.",
  }[l3(lang)];
}

/** Footer for every email to a contact: who it's from, where, and how to stop. */
export function emailFooter(lang: Lang | undefined, business: string, address: string | undefined, unsubscribe: string): string {
  const l = l3(lang);
  const stop = { en: "Don't want these emails?", es: "¿No desea recibir estos correos?", fr: "Vous ne voulez plus recevoir ces courriels?" }[l];
  const word = { en: "Unsubscribe", es: "Darse de baja", fr: "Se désabonner" }[l];
  return `\n\n--\n${business}${address ? `\n${address}` : ""}\n${stop} ${word}: ${unsubscribe}`;
}

/** Short alerts to the business owner (their own staff phone or email). */
export function ownerAlert(kind: "new_lead" | "needs_you" | "booked" | "missed_call", lang: Lang | undefined, v: { business: string; name?: string; phone?: string; text?: string; seconds?: number; link?: string }): string {
  const l = l3(lang);
  const who = [v.name, v.phone].filter(Boolean).join(" ") || { en: "someone", es: "alguien", fr: "quelqu'un" }[l];
  const said = v.text ? ` "${v.text.slice(0, 120)}${v.text.length > 120 ? "…" : ""}"` : "";
  const link = v.link ? ` ${v.link}` : "";
  const M: Record<typeof kind, Record<L3, string>> = {
    new_lead: {
      en: `New lead for ${v.business}: ${who}.${said}${v.seconds !== undefined ? ` Answered in ${v.seconds}s.` : ""}${link}`,
      es: `Nuevo prospecto para ${v.business}: ${who}.${said}${v.seconds !== undefined ? ` Atendido en ${v.seconds} s.` : ""}${link}`,
      fr: `Nouveau client potentiel pour ${v.business} : ${who}.${said}${v.seconds !== undefined ? ` Réponse en ${v.seconds} s.` : ""}${link}`,
    },
    needs_you: {
      en: `${who} needs a person at ${v.business}.${said}${link}`,
      es: `${who} necesita hablar con una persona de ${v.business}.${said}${link}`,
      fr: `${who} veut parler à quelqu'un chez ${v.business}.${said}${link}`,
    },
    booked: {
      en: `${who} wants to book with ${v.business}.${said} Confirm the time with them.${link}`,
      es: `${who} quiere agendar con ${v.business}.${said} Confirme el horario.${link}`,
      fr: `${who} veut réserver chez ${v.business}.${said} Confirmez l'heure avec cette personne.${link}`,
    },
    missed_call: {
      en: `Missed call at ${v.business} from ${who}. We texted them back.${link}`,
      es: `Llamada perdida en ${v.business} de ${who}. Ya le enviamos un mensaje.${link}`,
      fr: `Appel manqué chez ${v.business} de ${who}. Nous lui avons écrit.${link}`,
    },
  };
  return M[kind][l];
}

// ── Starter website (no AI) ───────────────────────────────────

export interface SiteFacts {
  business: string;
  niche?: Niche;
  city?: string;
  phone?: string;
  address?: string;
  description?: string;
  brandColor?: string;
  bookingUrl?: string;
}

const PALETTES = [
  { primary: "#1f5eff", ink: "#0b1533", soft: "#eef3ff" },
  { primary: "#0f8f80", ink: "#08211e", soft: "#e6f5f3" },
  { primary: "#c2410c", ink: "#2a1206", soft: "#fdf0e8" },
  { primary: "#7c3aed", ink: "#1d0d3a", soft: "#f3ecfe" },
  { primary: "#15803d", ink: "#0a2414", soft: "#e9f6ee" },
];

function paletteFor(seed: string, brand?: string): SiteContent["colors"] {
  if (brand && /^#[0-9a-f]{6}$/i.test(brand)) return { primary: brand.toLowerCase(), ink: "#111318", soft: "#f4f5f7" };
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTES[h % PALETTES.length];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Services from the niche's search keywords ("teeth cleaning" → "Teeth cleaning"). */
function nicheServices(n: Niche | undefined): string[] {
  if (!n) return [];
  return n.keywords
    .map((k) => k.replace(/\b(near me|cost|prices?|best|cheap|local)\b/gi, "").replace(/\s+/g, " ").trim())
    .filter((k) => k.length > 3 && !k.toLowerCase().includes(n.label.toLowerCase()))
    .slice(0, 3)
    .map(cap);
}

export function templateSite(f: SiteFacts, lang: Lang | undefined): SiteContent {
  const l = l3(lang);
  const word = nicheWord(f.niche, l);
  const where = f.city?.split(",")[0]?.trim();
  const booking = f.niche?.booking ?? false;
  const C = {
    en: {
      headline: `${cap(word)}${where ? ` in ${where}` : ""} you can count on`,
      sub: f.description?.slice(0, 160) || `${f.business}: call, text or send the form and we'll get back to you within minutes.`,
      cta: booking ? "Book an appointment" : "Get a free quote",
      about: `${f.business} has served ${where ?? "the community"} with honest ${word} work. Tell us what you need and we'll explain your options in plain language.`,
      services: (nicheServices(f.niche).length ? nicheServices(f.niche) : ["Consultations", "Repairs and maintenance", "Urgent help"]).map((t) => ({ title: t, text: `Ask us about ${t.toLowerCase()}: we'll explain your options before any work starts.` })),
      benefits: [
        { title: "Fast replies", text: "Call, text or send the form. We get back to you within minutes, even after hours." },
        { title: "Straight answers", text: "Ask anything. We explain your options in plain language." },
        { title: "Local", text: `Serving ${where ?? "your area"} and nearby.` },
      ],
      steps: [
        { title: "Tell us what you need", text: "Tap call, or send the short form." },
        { title: "Pick a time", text: "We reply in minutes with the first times available." },
        { title: "We take care of it", text: "You'll know what happens next at every step." },
      ],
      faqs: [
        { q: "How fast can you help?", a: "Send the form or call. We reply within minutes and offer the first available time." },
        { q: "Where are you located?", a: f.address ? `We're at ${f.address}.` : `We serve ${where ?? "the area"} and nearby.` },
        { q: "How do I book?", a: booking ? "Tap Book, or send the form and we'll confirm a time by text." : "Tap Call, or send the form and we'll confirm a time by text." },
      ],
      formTitle: booking ? "Request an appointment" : "Get your free quote",
      formButton: "Send",
      area: where ? `${where} and nearby` : "",
      seoTitle: `${f.business}${where ? ` | ${cap(word)} in ${where}` : ""}`,
      seoDesc: `${f.business}${where ? `, ${word} in ${where}` : ""}. Call or send a request and we'll get back to you within minutes.`,
    },
    es: {
      headline: `${cap(word)} de confianza${where ? ` en ${where}` : ""}`,
      sub: f.description?.slice(0, 160) || `${f.business}: llame, escriba o envíe el formulario y le respondemos en minutos.`,
      cta: booking ? "Agendar una cita" : "Pedir cotización gratis",
      about: `${f.business} atiende a ${where ?? "la comunidad"} con trabajo honesto. Cuéntenos qué necesita y le explicamos sus opciones con claridad.`,
      services: ["Consultas y diagnóstico", "Servicio y mantenimiento", "Atención urgente"].map((t) => ({ title: t, text: "Pregúntenos: le explicamos sus opciones antes de empezar cualquier trabajo." })),
      benefits: [
        { title: "Respuesta rápida", text: "Llame, escriba o envíe el formulario. Le respondemos en minutos, incluso fuera de horario." },
        { title: "Respuestas claras", text: "Pregunte lo que quiera. Le explicamos todo sin rodeos." },
        { title: "Locales", text: `Atendemos ${where ?? "su zona"} y alrededores.` },
      ],
      steps: [
        { title: "Cuéntenos qué necesita", text: "Llame o envíe el formulario." },
        { title: "Elija un horario", text: "Le respondemos en minutos con los primeros horarios disponibles." },
        { title: "Nos encargamos", text: "Sabrá qué sigue en cada paso." },
      ],
      faqs: [
        { q: "¿Qué tan rápido me pueden atender?", a: "Envíe el formulario o llame. Le respondemos en minutos con el primer horario disponible." },
        { q: "¿Dónde están?", a: f.address ? `Estamos en ${f.address}.` : `Atendemos ${where ?? "la zona"} y alrededores.` },
        { q: "¿Cómo agendo?", a: "Toque Llamar o envíe el formulario y le confirmamos el horario por mensaje." },
      ],
      formTitle: booking ? "Solicite una cita" : "Pida su cotización gratis",
      formButton: "Enviar",
      area: where ? `${where} y alrededores` : "",
      seoTitle: `${f.business}${where ? ` | ${cap(word)} en ${where}` : ""}`,
      seoDesc: `${f.business}${where ? `, ${word} en ${where}` : ""}. Llame o envíe su solicitud y le respondemos en minutos.`,
    },
    fr: {
      headline: `${cap(word)} de confiance${where ? ` à ${where}` : ""}`,
      sub: f.description?.slice(0, 160) || `${f.business} : appelez, écrivez ou envoyez le formulaire, on vous répond en quelques minutes.`,
      cta: booking ? "Prendre rendez-vous" : "Obtenir une soumission gratuite",
      about: `${f.business} sert ${where ?? "la communauté"} avec un travail honnête. Dites-nous ce dont vous avez besoin et nous vous expliquerons vos options clairement.`,
      services: ["Consultations", "Entretien et réparations", "Urgences"].map((t) => ({ title: t, text: "Demandez-nous : nous vous expliquons vos options avant de commencer." })),
      benefits: [
        { title: "Réponse rapide", text: "Appelez, écrivez ou envoyez le formulaire. Nous répondons en quelques minutes, même en soirée." },
        { title: "Réponses claires", text: "Posez vos questions. Nous expliquons tout simplement." },
        { title: "D'ici", text: `Nous servons ${where ?? "votre région"} et les environs.` },
      ],
      steps: [
        { title: "Dites-nous ce qu'il vous faut", text: "Appelez ou envoyez le court formulaire." },
        { title: "Choisissez un moment", text: "Nous répondons en quelques minutes avec les premières disponibilités." },
        { title: "On s'en occupe", text: "Vous savez ce qui suit à chaque étape." },
      ],
      faqs: [
        { q: "En combien de temps pouvez-vous m'aider?", a: "Envoyez le formulaire ou appelez. Nous répondons en quelques minutes avec la première disponibilité." },
        { q: "Où êtes-vous situés?", a: f.address ? `Nous sommes au ${f.address}.` : `Nous servons ${where ?? "la région"} et les environs.` },
        { q: "Comment réserver?", a: "Touchez Appeler ou envoyez le formulaire et nous confirmerons l'heure par texto." },
      ],
      formTitle: booking ? "Demander un rendez-vous" : "Demander une soumission gratuite",
      formButton: "Envoyer",
      area: where ? `${where} et les environs` : "",
      seoTitle: `${f.business}${where ? ` | ${cap(word)} à ${where}` : ""}`,
      seoDesc: `${f.business}${where ? `, ${word} à ${where}` : ""}. Appelez ou envoyez votre demande et nous répondons en quelques minutes.`,
    },
  }[l];
  return {
    lang: lang ?? "en",
    headline: C.headline,
    subheadline: C.sub,
    cta: C.cta,
    offer: "",
    about: C.about,
    services: C.services,
    benefits: C.benefits,
    steps: C.steps,
    faqs: C.faqs,
    testimonials: [],
    hours: [],
    serviceArea: C.area,
    formTitle: C.formTitle,
    formButton: C.formButton,
    seoTitle: C.seoTitle.slice(0, 60),
    seoDescription: C.seoDesc.slice(0, 155),
    colors: paletteFor(f.business, f.brandColor),
  };
}
