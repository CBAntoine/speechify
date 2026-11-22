// Practice calls for step 6: the client's staff talk to a realistic customer
// (an ElevenLabs agent) and get a scorecard afterwards. Scenarios are the
// calls small businesses lose most often. Pure, shared by browser and server.

import type { Lang } from "../markets.ts";
import { l3 } from "./templates.ts";

export interface Scenario {
  id: string;
  label: string;
  /** What the trainee should practise. */
  tip: string;
  /** Instructions for the customer the agent plays. */
  brief: string;
  opening: Record<"en" | "es" | "fr", string>;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "price",
    label: "Price shopper",
    tip: "Ask about their situation before giving a number, then ask for the booking.",
    brief: "You're phoning three businesses like this one to compare prices. You ask for the price in your first or second sentence and push for a number. You soften if they ask about your situation and explain what's included. You book only if they clearly ask for the booking and offer a time.",
    opening: { en: "Hi, how much do you charge?", es: "Hola, ¿cuánto cobran?", fr: "Bonjour, combien vous chargez?" },
  },
  {
    id: "hesitant",
    label: "Not sure yet",
    tip: "Find out what's behind \"I'll think about it\" and make the next step easy.",
    brief: "You need the service but you're nervous about it and about the cost. When they suggest booking, you say you want to think about it. You book if they gently find out what's holding you back and make the next step feel small and safe.",
    opening: { en: "Hi, I'm just calling to ask a few questions.", es: "Hola, solo quería hacer unas preguntas.", fr: "Bonjour, j'appelle juste pour poser quelques questions." },
  },
  {
    id: "urgent",
    label: "Urgent problem",
    tip: "Stay calm, get the key facts fast and offer the first available time.",
    brief: "You have an urgent problem today and you're stressed and a bit impatient. You want to know how soon they can help. You book with the first business that gives you a clear time and tells you what happens next.",
    opening: { en: "Hi, I've got a problem and I need someone today. Can you help?", es: "Hola, tengo un problema y necesito a alguien hoy. ¿Me pueden ayudar?", fr: "Bonjour, j'ai un problème et j'ai besoin de quelqu'un aujourd'hui. Pouvez-vous m'aider?" },
  },
  {
    id: "skeptical",
    label: "Burned before",
    tip: "Acknowledge the bad experience, ask what went wrong, and show how this time is different.",
    brief: "You had a bad experience with a similar business last year (hidden fees and no follow-up). You're skeptical and a bit blunt. You book only if they acknowledge it, ask what went wrong, and explain clearly how they handle it differently.",
    opening: { en: "Hi. Before anything, I want to know there won't be surprise fees.", es: "Hola. Antes que nada, quiero saber que no habrá cargos sorpresa.", fr: "Bonjour. Avant tout, je veux être sûr qu'il n'y aura pas de frais surprise." },
  },
  {
    id: "winback",
    label: "Past customer",
    tip: "Welcome them back, ask what's changed, and book them in.",
    brief: "You used this business about a year ago and just got their text asking if you need anything. You're mildly interested but busy. You book if they're friendly, remember to ask what you need now, and offer a convenient time.",
    opening: { en: "Hi, I got your text. I used you guys last year.", es: "Hola, recibí su mensaje. Ya había ido con ustedes el año pasado.", fr: "Bonjour, j'ai reçu votre texto. J'ai fait affaire avec vous l'an dernier." },
  },
];

export function scenarioById(id: string | undefined): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}

const NAMES = { en: ["Jordan", "Taylor", "Morgan", "Casey", "Riley"], es: ["Lucía", "Carlos", "Mariana", "Jorge", "Sofía"], fr: ["Camille", "Mathieu", "Julie", "Alexandre", "Émilie"] };

/** The variables the practice agent reads at the start of a call. */
export function practiceVariables(s: Scenario, ctx: { business: string; niche: string; lang: Lang | undefined }): Record<string, string> {
  const l = l3(ctx.lang);
  const names = NAMES[l];
  return {
    business: ctx.business,
    niche: ctx.niche,
    scenario_brief: s.brief,
    customer_name: names[Math.floor(Math.random() * names.length)],
    language: { en: "English", es: "Spanish", fr: "French" }[l],
    opening_line: s.opening[l],
  };
}
