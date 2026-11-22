// Sales-call coaching that works without AI: read a transcript, measure what
// any sales trainer looks at first (who talked, how many questions, whether
// they asked for the booking and set a next step), and score it. Claude adds
// a deeper scorecard on top when it's connected. Pure.

import type { Lang } from "../markets.ts";
import type { Scorecard, TranscriptMetrics } from "../types.ts";
import { l3 } from "./templates.ts";

export interface Turn {
  speaker: "rep" | "customer";
  label: string;
  text: string;
}

const REP_LABELS = /^(rep|agent|sales|salesperson|staff|employee|advisor|me|us|vendedor|asesor|agente|recepci[oó]n|conseiller|vendeur|repr[ée]sentant)/i;
const CUSTOMER_LABELS = /^(customer|client|caller|prospect|lead|patient|buyer|them|cliente|paciente|llamante|prospecto)/i;
const GREETING = /thanks? for calling|thank you for calling|this is \w+|how (can|may) i help|gracias por (llamar|comunicarse)|le atiende|en qu[eé] (le )?puedo ayudar|merci d'appeler|comment puis-je vous aider/i;

/**
 * "Rep: hi…", "[00:12] Customer: …", "Speaker 1: …" or plain alternating
 * lines. The rep is the speaker labelled as staff, else whoever greets with
 * the business, else whoever speaks first (they answered the phone).
 */
export function parseTranscript(text: string, repLabel?: string): Turn[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[[(]?\d{1,2}:\d{2}(:\d{2})?[\])]?\s*[-–]?\s*/, "").trim())
    .filter(Boolean);
  const raw: { label: string; text: string }[] = [];
  for (const line of lines) {
    const m = line.match(/^([\p{L}][\p{L}\d .'’_-]{0,30}?)\s*:\s+(.+)$/u);
    if (m) raw.push({ label: m[1].trim(), text: m[2].trim() });
    else if (raw.length) raw[raw.length - 1].text += ` ${line}`;
    else raw.push({ label: "", text: line });
  }
  if (!raw.length) return [];
  const labels = [...new Set(raw.map((r) => r.label))];
  let rep: string | undefined;
  if (repLabel) rep = labels.find((l) => l.toLowerCase() === repLabel.toLowerCase());
  rep ??= labels.find((l) => REP_LABELS.test(l));
  if (!rep) {
    const cust = labels.find((l) => CUSTOMER_LABELS.test(l));
    if (cust && labels.length === 2) rep = labels.find((l) => l !== cust);
  }
  rep ??= raw.find((r) => GREETING.test(r.text))?.label;
  if (labels.length === 1 && labels[0] === "") {
    // No labels at all: assume the lines alternate, rep first.
    return raw[0].text.split(/(?<=[.?!])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/).map((t, i) => ({ speaker: i % 2 === 0 ? "rep" : "customer", label: i % 2 === 0 ? "Rep" : "Customer", text: t }));
  }
  rep ??= raw[0].label;
  return raw.map((r) => ({ speaker: r.label === rep ? "rep" : "customer", label: r.label, text: r.text }));
}

const BOOKING = /\b(book|schedule|appointment|come in|set (you|that|it) up|get you in|what time works|which day|reserve|sign (you )?up|agendar|agend|cita|reservar|apart(ar|o)|rendez-vous|r[ée]server|prendre (un )?rdv|inscri)/i;
const PRICE = /(\$|€|\bprice|\bcost|\bquote|\bestimate|\bfee|\bpay\b|\bhow much\b|\bdollars?\b|precio|costo|cuesta|cu[aá]nto (es|sale|cobra)|cotizaci|presupuesto|\bpesos\b|\bprix|co[uû]t|combien|soumission|tarif)/i;
const NEXT = /\b((i|we)('ll| will) (send|call|text|email|see|confirm|follow)|see you (on|at|then|tomorrow)|you're (all )?(set|booked)|confirmation|le (env[ií]o|llamo|esperamos|confirmo)|te (env[ií]o|llamo|espero)|nos vemos|je vous (envoie|rappelle|confirme)|on se voit|[àa] (lundi|mardi|mercredi|jeudi|vendredi|samedi|demain))/i;
const FILLER = /\b(um+|uh+|erm|like,|you know|kind of|sort of|este|eh+|o sea|pues|euh+|genre|tsé|ben là)\b/gi;
const QUESTION_START = /^(what|when|where|who|why|how|which|do|does|did|are|is|can|could|would|will|have|has|qu[eé]|cu[aá]ndo|d[oó]nde|qui[eé]n|por qu[eé]|c[oó]mo|cu[aá]l|est-ce|quand|o[uù]|pourquoi|comment|quel)/i;

const wordsOf = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w)).length;

export function transcriptMetrics(turns: Turn[]): TranscriptMetrics {
  const rep = turns.filter((t) => t.speaker === "rep");
  const cust = turns.filter((t) => t.speaker === "customer");
  const repWords = rep.reduce((a, t) => a + wordsOf(t.text), 0);
  const words = repWords + cust.reduce((a, t) => a + wordsOf(t.text), 0);
  const repText = rep.map((t) => t.text).join(" ");
  const questions = rep.reduce((a, t) => {
    const sentences = t.text.split(/(?<=[.?!])\s+/);
    return a + sentences.filter((s) => s.trim().endsWith("?") || (QUESTION_START.test(s.trim()) && !/[.!]$/.test(s.trim()))).length;
  }, 0);
  const named = cust.map((t) => t.text.match(/(?:^|[\s,.!¡¿])(?:[Mm]y name is|I['’]?m|[Tt]his is|[Ii]t['’]?s|[Mm]e llamo|[Ss]oy|[Hh]abla|[Jj]e m['’]appelle|[Cc]['’]est)\s+(\p{Lu}\p{Ll}+)/u)?.[1]).find(Boolean);
  return {
    words,
    turns: turns.length,
    repShare: words ? Math.round((repWords / words) * 100) : 0,
    repQuestions: questions,
    askedForBooking: BOOKING.test(repText),
    mentionedPrice: PRICE.test(turns.map((t) => t.text).join(" ")),
    nextStepSet: NEXT.test(repText),
    usedName: Boolean(named && new RegExp(`\\b${named}\\b`).test(repText)),
    fillers: (repText.match(FILLER) ?? []).length,
  };
}

const OBJECTION = /(too (expensive|much)|can'?t afford|think about it|call (you )?back|not (sure|right now)|shop around|other quotes|caro|muy caro|lo pienso|pensarlo|despu[eé]s|otras cotizaciones|trop cher|y penser|r[ée]fl[ée]chir|plus tard)/i;

type Words = Record<"en" | "es" | "fr", string>;
const W = (en: string, es: string, fr: string): Words => ({ en, es, fr });

const LABELS: Record<string, Words> = {
  opening: W("Opening", "Apertura", "Accueil"),
  discovery: W("Discovery questions", "Preguntas de diagnóstico", "Questions de découverte"),
  listening: W("Listening", "Escucha", "Écoute"),
  objections: W("Handling objections", "Manejo de objeciones", "Gestion des objections"),
  close: W("Asking for the booking", "Pedir la cita", "Demander le rendez-vous"),
  next: W("Next step", "Siguiente paso", "Prochaine étape"),
};

/** A scorecard from the transcript alone: the fallback when Claude isn't connected. */
export function rulesScorecard(turns: Turn[], m: TranscriptMetrics, lang: Lang | undefined): Scorecard {
  const l = l3(lang);
  const firstRep = turns.find((t) => t.speaker === "rep")?.text ?? "";
  const objection = turns.some((t) => t.speaker === "customer" && OBJECTION.test(t.text));
  const afterObjection = (() => {
    const i = turns.findIndex((t) => t.speaker === "customer" && OBJECTION.test(t.text));
    const reply = i >= 0 ? turns.slice(i + 1).find((t) => t.speaker === "rep")?.text ?? "" : "";
    return /\?|because|so you|that'?s why|value|includes|guarantee|porque|incluye|garant|parce que|inclut|garanti/i.test(reply);
  })();
  const s = (n: number) => Math.max(1, Math.min(5, Math.round(n)));
  const scores = [
    { id: "opening", score: s((GREETING.test(firstRep) ? 3 : 1) + (/\?/.test(firstRep) ? 1 : 0) + (wordsOf(firstRep) <= 35 ? 1 : 0)) },
    { id: "discovery", score: s(m.repQuestions >= 6 ? 5 : m.repQuestions >= 4 ? 4 : m.repQuestions >= 2 ? 3 : m.repQuestions === 1 ? 2 : 1) },
    { id: "listening", score: s(m.repShare <= 55 && m.repShare >= 30 ? 5 : m.repShare <= 65 ? 4 : m.repShare <= 75 ? 3 : 2) },
    { id: "objections", score: s(objection ? (afterObjection ? 4 : 2) : 3) },
    { id: "close", score: s(m.askedForBooking ? 5 : 1) },
    { id: "next", score: s(m.nextStepSet ? 5 : 2) },
  ];
  const NOTE: Record<string, (n: number) => Words> = {
    opening: (n) => (n >= 4 ? W("Warm, quick greeting with the business name and an offer to help.", "Saludo cálido y breve, con el nombre del negocio y oferta de ayuda.", "Accueil chaleureux et bref, avec le nom de l'entreprise et une offre d'aide.") : W("Open with the business name, your name and \"How can I help?\" in one breath.", "Empiece con el nombre del negocio, su nombre y \"¿En qué le puedo ayudar?\".", "Commencez par le nom de l'entreprise, votre nom et « Comment puis-je vous aider? ».")),
    discovery: (n) => (n >= 4 ? W(`${m.repQuestions} questions: good digging before offering.`, `${m.repQuestions} preguntas: buen diagnóstico antes de ofrecer.`, `${m.repQuestions} questions : bonne découverte avant de proposer.`) : W(`Only ${m.repQuestions} question${m.repQuestions === 1 ? "" : "s"}. Ask what they need, how soon, and what matters most before you suggest anything.`, `Solo ${m.repQuestions} pregunta${m.repQuestions === 1 ? "" : "s"}. Pregunte qué necesita, para cuándo y qué es lo más importante antes de sugerir algo.`, `Seulement ${m.repQuestions} question${m.repQuestions === 1 ? "" : "s"}. Demandez le besoin, l'échéance et ce qui compte le plus avant de proposer.`)),
    listening: (n) => (n >= 4 ? W(`You spoke ${m.repShare}% of the time: the customer did plenty of talking.`, `Usted habló el ${m.repShare}% del tiempo: el cliente pudo expresarse.`, `Vous avez parlé ${m.repShare} % du temps : le client a pu s'exprimer.`) : W(`You spoke ${m.repShare}% of the time. Aim for under 55%: ask, then let them talk.`, `Usted habló el ${m.repShare}% del tiempo. Procure quedar por debajo del 55%: pregunte y deje hablar.`, `Vous avez parlé ${m.repShare} % du temps. Visez moins de 55 % : posez la question, puis écoutez.`)),
    objections: (n) => (objection ? (n >= 4 ? W("Met the objection with a question or the value, not a discount.", "Respondió la objeción con una pregunta o el valor, no con descuento.", "Objection traitée par une question ou la valeur, pas un rabais.") : W("When they hesitated, ask what's behind it (\"What would make this an easy yes?\") before answering.", "Cuando dudó, pregunte qué hay detrás (\"¿Qué le haría decir que sí?\") antes de responder.", "Face à l'hésitation, demandez ce qui la cause (« Qu'est-ce qui rendrait ce oui facile? ») avant de répondre.")) : W("No objection came up on this call.", "No hubo objeciones en esta llamada.", "Aucune objection dans cet appel.")),
    close: (n) => (n >= 4 ? W("Asked for the booking directly.", "Pidió la cita directamente.", "A demandé le rendez-vous directement.") : W("Never asked for the booking. Offer two times: \"I have Tuesday at 10 or Thursday at 3, which is better?\"", "Nunca pidió la cita. Ofrezca dos horarios: \"Tengo martes a las 10 o jueves a las 3, ¿cuál le queda mejor?\"", "Le rendez-vous n'a jamais été demandé. Proposez deux choix : « J'ai mardi 10 h ou jeudi 15 h, lequel vous convient? »")),
    next: (n) => (n >= 4 ? W("Ended with a clear next step.", "Terminó con un siguiente paso claro.", "Fin avec une prochaine étape claire.") : W("End every call with a specific next step and when it happens.", "Termine cada llamada con un siguiente paso concreto y cuándo sucede.", "Terminez chaque appel par une prochaine étape précise et sa date.")),
  };
  const withNotes = scores.map((x) => ({ ...x, label: LABELS[x.id][l], note: NOTE[x.id](x.score)[l] }));
  // The fixes worth most first: asking for the booking beats a nicer greeting.
  const PRIORITY = ["close", "next", "discovery", "objections", "listening", "opening"];
  const fixes = withNotes
    .filter((x) => x.score <= 2)
    .sort((a, b) => PRIORITY.indexOf(a.id) - PRIORITY.indexOf(b.id))
    .slice(0, 3)
    .map((x) => ({ issue: x.label, instead: x.note }));
  const strengths = withNotes.filter((x) => x.score >= 4).slice(0, 3).map((x) => x.note);
  const overall = Math.round((withNotes.reduce((a, x) => a + x.score, 0) / (withNotes.length * 5)) * 100);
  const summary = {
    en: `${overall}/100. ${m.askedForBooking ? "Asked for the booking" : "Didn't ask for the booking"}, ${m.repQuestions} question${m.repQuestions === 1 ? "" : "s"}, spoke ${m.repShare}% of the time.`,
    es: `${overall}/100. ${m.askedForBooking ? "Pidió la cita" : "No pidió la cita"}, ${m.repQuestions} pregunta${m.repQuestions === 1 ? "" : "s"}, habló el ${m.repShare}% del tiempo.`,
    fr: `${overall}/100. ${m.askedForBooking ? "Rendez-vous demandé" : "Rendez-vous non demandé"}, ${m.repQuestions} question${m.repQuestions === 1 ? "" : "s"}, ${m.repShare} % du temps de parole.`,
  }[l];
  return { overall, scores: withNotes, strengths, fixes, summary, by: "rules" };
}
