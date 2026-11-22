// What happens after someone pays: automated steps Rainmaker runs itself, and
// the onboarding checklist for the parts only a person can do (forwarding a
// phone line, getting consent for a voice clone). Pure, so it's tested.

import type { Offer } from "../catalog.ts";
import type { FulfillmentStep } from "../types.ts";

export const AGENT_PRODUCTS = ["ai-receptionist", "website-agent", "follow-up-calls", "whatsapp-agent", "live-interpreter"];
export const AD_PRODUCTS = ["ad-campaigns", "ad-creative"];

export function offerIncludes(offer: Pick<Offer, "id" | "bundles">, productId: string): boolean {
  return offer.id === productId || Boolean(offer.bundles?.includes(productId));
}

export function plannedSteps(offer: Pick<Offer, "id" | "bundles">): FulfillmentStep[] {
  const steps: FulfillmentStep[] = [];
  if (AGENT_PRODUCTS.some((p) => offerIncludes(offer, p))) steps.push({ id: "agent", label: "Build their AI agent from their website", status: "todo" });
  if (AD_PRODUCTS.some((p) => offerIncludes(offer, p))) steps.push({ id: "campaign", label: "Write their launch ad campaign", status: "todo" });
  steps.push({ id: "tasks", label: "Create the onboarding checklist", status: "todo" });
  steps.push({ id: "welcome", label: "Send the welcome email", status: "todo" });
  return steps;
}

const TASKS: Record<string, string[]> = {
  "ai-receptionist": [
    "Kickoff call: hours, services, prices, booking tool and transfer number",
    "Forward their phone line (or buy a local number) and assign it to their agent in ElevenLabs",
    "Make 3 test calls and send them the recordings",
  ],
  "website-agent": ["Install the website widget (ElevenLabs agent → Widget → embed code) and match their colours"],
  "follow-up-calls": ["Get their opted-in contact list and approve the call scripts with them"],
  "whatsapp-agent": ["Connect their WhatsApp Business number to the agent"],
  multilingual: ["Confirm their customers' top languages; add brand names to a pronunciation dictionary"],
  "live-interpreter": ["Set up the interpreter on their front-desk device and run a 15-minute staff demo"],
  voiceovers: ["Collect the first voiceover briefs"],
  "brand-voice": ["Brand voice: send 3–5 designed options, or collect written consent and 30 minutes of audio for a clone"],
  "video-dubbing": ["Collect the first videos and target languages"],
  "podcast-studio": ["Collect blog or newsletter links and set up the podcast feed"],
  "listen-button": ["Pick the pages to narrate and install the audio player"],
  "music-jingles": ["Get the music brief: mood, genre, reference tracks"],
  "ad-creative": ["Collect their logo, brand photos and current offers"],
  "ai-spokesperson": ["Get the presenter photo and written consent (or choose an AI presenter)"],
  transcription: ["Connect their call recordings or set up an upload folder"],
  captions: ["Collect the first videos to caption"],
  "audio-cleanup": ["Collect the first files to clean"],
  "ad-campaigns": ["Get access to their Meta and Google ad accounts (or confirm they'll launch themselves)"],
};

/** Human onboarding tasks for an offer (a plan gets every bundled product's). */
export function onboardingTasks(offer: Pick<Offer, "id" | "bundles">): string[] {
  const ids = offer.bundles?.length ? offer.bundles : [offer.id];
  return [...new Set(ids.flatMap((id) => TASKS[id] ?? []))];
}
