// The seven services, in the order they're deployed. Each one does a job a
// local business already pays a person to do (or doesn't do at all), is
// priced at or below what that person costs, and is described to the client
// as the outcome, not the technology.
//
// Hours are planning assumptions for a typical small business, used only for
// the "what a person doing this would cost" comparison; the owner can change
// prices per client. Pure data, shared by the browser and the server.

import type { Lang } from "../markets.ts";
import type { RoleId } from "../labor-data.ts";
import type { ServiceId } from "../types.ts";

export interface ServiceDef {
  id: ServiceId;
  /** Deployment order, 1-7. */
  step: number;
  /** What the agency calls it. */
  name: string;
  /** Tab label. */
  short: string;
  /** Lucide icon name. */
  icon: string;
  /** The job a person would otherwise do. */
  role: RoleId;
  roleLabel: string;
  /** Hours a month that person would spend on it (planning assumption). */
  hours: number;
  /** One-off hours to set it up (the website build). */
  setupHours?: number;
  /** Default price in US dollars; converted and scaled for other markets. */
  price: { monthly: number; setup: number };
  /** What it costs the agency to deliver at typical use, US dollars a month (texts, call minutes, AI). */
  deliveryUsd: number;
  /** Why it comes at this point in the order. */
  why: string;
  /** What's included. */
  delivers: string[];
  /** Earlier steps that should be live first. */
  after: ServiceId[];
  /** Client-facing name and promise, by language: the outcome, never the technology. */
  pitch: Record<"en" | "es" | "fr", { title: string; promise: string; role: string }>;
}

export const SERVICES: ServiceDef[] = [
  {
    id: "website",
    step: 1,
    name: "Website that converts",
    short: "Website",
    icon: "Globe",
    role: "web_designer",
    roleLabel: "Web designer",
    hours: 4,
    setupHours: 30,
    price: { monthly: 97, setup: 997 },
    deliveryUsd: 2,
    why: "Fix the bucket before pouring more water in. A fast, mobile-first site with one clear action stops the visitors they already get from leaving, and every later step sends people to it.",
    delivers: [
      "A fast single-page site written for their customers, in their language",
      "Tap-to-call, a short lead form and their reviews above the fold",
      "Local search basics: titles, descriptions and business details Google reads",
      "Every form goes straight into instant follow-up (step 4)",
    ],
    after: [],
    pitch: {
      en: { title: "A website that turns visitors into customers", promise: "Loads fast on phones, shows why to choose you, and makes calling or booking one tap.", role: "web designer" },
      es: { title: "Un sitio web que convierte visitas en clientes", promise: "Carga rápido en el celular, muestra por qué elegir su negocio y permite llamar o reservar con un toque.", role: "diseñador web" },
      fr: { title: "Un site web qui transforme les visiteurs en clients", promise: "Rapide sur mobile, il montre pourquoi vous choisir et permet d'appeler ou de réserver en un geste.", role: "concepteur web" },
    },
  },
  {
    id: "reactivation",
    step: 2,
    name: "Past-customer win-back",
    short: "Win-back",
    icon: "RotateCcw",
    role: "appointment_setter",
    roleLabel: "Appointment setter",
    hours: 20,
    price: { monthly: 297, setup: 0 },
    deliveryUsd: 30,
    why: "The fastest money in the business: people who already bought once. Reaching their old list brings revenue back without spending a cent on new marketing.",
    delivers: [
      "Their past-customer and old-lead list cleaned and loaded",
      "A short, personal win-back sequence by text or email, in their voice",
      "Every reply answered right away and steered to a booking",
      "Only contacts who agreed to hear from them; opt-outs honoured instantly",
    ],
    after: ["website"],
    pitch: {
      en: { title: "Past customers, back on your calendar", promise: "We reach the people who already bought from you and book the ones who are ready again.", role: "appointment setter" },
      es: { title: "Clientes anteriores, de vuelta en su agenda", promise: "Contactamos a quienes ya le compraron y agendamos a los que están listos para volver.", role: "agente de citas" },
      fr: { title: "Vos anciens clients, de retour dans votre agenda", promise: "Nous recontactons ceux qui ont déjà acheté chez vous et réservons ceux qui sont prêts à revenir.", role: "agent de prise de rendez-vous" },
    },
  },
  {
    id: "reviews",
    step: 3,
    name: "Reviews and referrals",
    short: "Reviews",
    icon: "Star",
    role: "review_coordinator",
    roleLabel: "Review and referral coordinator",
    hours: 10,
    price: { monthly: 197, setup: 0 },
    deliveryUsd: 5,
    why: "More recent reviews win the Google map pack and the answers AI search tools give. Asking every customer, then asking reviewers for referrals, turns happy customers into new ones.",
    delivers: [
      "A review request to every finished job, with their direct review link",
      "One friendly reminder; no filtering of who gets asked",
      "A referral ask after each review, with a tracked share link",
      "Monthly count of requests, clicks and referred leads",
    ],
    after: ["website"],
    pitch: {
      en: { title: "More 5-star reviews and referrals", promise: "Every customer is asked for a review, and happy reviewers are asked to send friends your way.", role: "review and referral coordinator" },
      es: { title: "Más reseñas de 5 estrellas y recomendaciones", promise: "Pedimos una reseña a cada cliente e invitamos a quienes lo recomiendan a enviarle a sus conocidos.", role: "coordinador de reseñas" },
      fr: { title: "Plus d'avis 5 étoiles et de recommandations", promise: "Chaque client est invité à laisser un avis, et les clients ravis à vous recommander à leurs proches.", role: "coordonnateur des avis" },
    },
  },
  {
    id: "speed_to_lead",
    step: 4,
    name: "Instant lead follow-up",
    short: "Lead follow-up",
    icon: "Zap",
    role: "lead_responder",
    roleLabel: "Inside sales rep",
    hours: 60,
    price: { monthly: 297, setup: 0 },
    deliveryUsd: 15,
    why: "Most businesses take hours or days to answer a web enquiry (a widely cited study measured 42 hours on average). Replying within a minute, every day of the week, wins the job before a competitor calls back.",
    delivers: [
      "Every website form and ad lead answered by text and email in seconds",
      "Questions answered from their own information, then a nudge to book",
      "Follow-ups on day 1, 3 and 7 until they reply",
      "Hand-off to the owner the moment a lead is ready or asks for a person",
    ],
    after: ["website"],
    pitch: {
      en: { title: "Every new lead answered in under a minute", promise: "Day or night, each enquiry gets a personal reply in seconds and follow-ups until it books.", role: "inside sales rep" },
      es: { title: "Cada cliente potencial atendido en menos de un minuto", promise: "De día o de noche, cada solicitud recibe una respuesta personal en segundos y seguimiento hasta agendar.", role: "ejecutivo de ventas" },
      fr: { title: "Chaque nouveau client potentiel rappelé en moins d'une minute", promise: "Jour et nuit, chaque demande reçoit une réponse personnelle en quelques secondes et un suivi jusqu'à la réservation.", role: "représentant aux ventes" },
    },
  },
  {
    id: "missed_calls",
    step: 5,
    name: "Every call answered",
    short: "Calls",
    icon: "PhoneCall",
    role: "receptionist",
    roleLabel: "Receptionist",
    hours: 86,
    price: { monthly: 397, setup: 197 },
    deliveryUsd: 45,
    why: "A large share of calls to local businesses go unanswered (the figure often quoted is 62%), and most callers don't leave a voicemail: they call the next business. Whenever staff can't pick up, the call is answered, and anyone who hangs up gets a text right away.",
    delivers: [
      "Calls staff can't take are answered in a natural voice, 24/7",
      "Questions, bookings and messages handled; urgent calls passed on",
      "Anyone who hangs up gets a text back within seconds",
      "A log of every call, with a summary",
    ],
    after: ["website", "speed_to_lead"],
    pitch: {
      en: { title: "Every call answered, even when you're busy", promise: "When your team can't pick up, callers are answered right away, and anyone who hangs up gets a text back.", role: "receptionist" },
      es: { title: "Todas las llamadas contestadas, aunque esté ocupado", promise: "Cuando su equipo no puede contestar, atendemos al instante, y quien cuelga recibe un mensaje de inmediato.", role: "recepcionista" },
      fr: { title: "Chaque appel répondu, même quand vous êtes occupé", promise: "Quand votre équipe ne peut pas répondre, l'appel est pris sur-le-champ, et qui raccroche reçoit un texto aussitôt.", role: "réceptionniste" },
    },
  },
  {
    id: "sales_coach",
    step: 6,
    name: "Sales coaching",
    short: "Coaching",
    icon: "GraduationCap",
    role: "sales_trainer",
    roleLabel: "Sales trainer",
    hours: 8,
    price: { monthly: 197, setup: 0 },
    deliveryUsd: 7,
    why: "Steps 2 to 5 create far more conversations. They only turn into revenue if the team closes them, so every recorded call is reviewed and the team practises the hard ones.",
    delivers: [
      "Recorded calls and chats scored on opening, discovery, objections and close",
      "Specific coaching: what to say instead, line by line",
      "Practice calls with a realistic customer, any time",
      "A monthly scorecard per person",
    ],
    after: ["speed_to_lead", "missed_calls"],
    pitch: {
      en: { title: "A team that closes more of its calls", promise: "Every sales call is reviewed with clear coaching, and your team practises tough customers before they meet them.", role: "sales trainer" },
      es: { title: "Un equipo que cierra más llamadas", promise: "Revisamos cada llamada de ventas con consejos claros, y su equipo practica con clientes difíciles antes de enfrentarlos.", role: "capacitador de ventas" },
      fr: { title: "Une équipe qui conclut plus d'appels", promise: "Chaque appel de vente est revu avec des conseils clairs, et votre équipe s'exerce avec des clients difficiles avant de les rencontrer.", role: "formateur en vente" },
    },
  },
  {
    id: "ads",
    step: 7,
    name: "Paid ads, managed",
    short: "Ads",
    icon: "Megaphone",
    role: "media_buyer",
    roleLabel: "Media buyer",
    hours: 15,
    price: { monthly: 497, setup: 0 },
    deliveryUsd: 6,
    why: "Last, on purpose: once the site converts, every lead is answered in seconds and every call is picked up, paid ads scale lead flow without leaking it. Every new lead flows straight into follow-up.",
    delivers: [
      "Meta and Google campaigns written for their offer, with creative in their colours",
      "Every ad lead followed up instantly by step 4",
      "Monthly spend, cost per lead and cost per booking",
      "Changes each month based on what booked, not what clicked",
    ],
    after: ["website", "speed_to_lead", "missed_calls"],
    pitch: {
      en: { title: "Ads that turn into booked jobs", promise: "Campaigns built for your offer, measured on bookings, with every lead followed up in seconds.", role: "ads specialist" },
      es: { title: "Anuncios que se convierten en trabajos agendados", promise: "Campañas hechas para su oferta, medidas por citas, con cada cliente potencial atendido en segundos.", role: "especialista en anuncios" },
      fr: { title: "Des publicités qui deviennent des rendez-vous", promise: "Des campagnes pensées pour votre offre, mesurées en réservations, avec chaque client potentiel rappelé en quelques secondes.", role: "spécialiste en publicité" },
    },
  },
];

export const SERVICE_IDS = SERVICES.map((s) => s.id);

/** Monthly price for all seven when sold together, US dollars (less than the parts). */
export const BUNDLE_USD = { monthly: 1497, setup: 997 } as const;

export function serviceById(id: string | undefined): ServiceDef | undefined {
  return SERVICES.find((s) => s.id === id);
}

/** Pitch copy in a language, English when there's no translation. */
export function pitchFor(s: ServiceDef, lang: Lang) {
  return s.pitch[lang === "es" || lang === "fr" ? lang : "en"];
}

/** Earlier steps that aren't live yet, so a step isn't switched on before its foundations. */
export function missingFoundations(id: ServiceId, status: Partial<Record<ServiceId, { status: string }>>): ServiceDef[] {
  const s = serviceById(id);
  if (!s) return [];
  return s.after.map((a) => serviceById(a)!).filter((d) => status[d.id]?.status !== "live");
}

/** The next service to work on: the first in order that isn't live. */
export function nextService(status: Partial<Record<ServiceId, { status: string }>>): ServiceDef | undefined {
  return SERVICES.find((s) => status[s.id]?.status !== "live" && status[s.id]?.status !== "paused");
}
