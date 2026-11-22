import "server-only";
import { putAsset } from "@/lib/assets";
import { getNiche } from "@/lib/niches";
import type { ArtAsset, ArtSize } from "@/lib/types";
import { ElevenError, eleven } from "./client";

// Custom ad art with the ElevenLabs Image & Video API (Pro plan and above).
// The image carries no text: Ad Studio lays the headline, offer and button
// over it, so copy stays crisp and editable and nothing is misspelled.

export const IMAGE_MODEL = process.env.ELEVENLABS_IMAGE_MODEL || "gpt-image-2";
const RATIO: Record<ArtSize, string> = { square: "1:1", story: "9:16", landscape: "16:9" };

const SCENES: Record<string, string> = {
  dentist: "a bright, modern dental clinic treatment room with soft natural light and spotless surfaces",
  chiropractor: "a calm, modern chiropractic clinic with a treatment table and warm natural light",
  physical_therapy: "a modern physiotherapy studio with exercise equipment and morning light",
  veterinarian: "a friendly modern veterinary clinic with a happy dog on the exam table",
  med_spa: "a serene luxury spa treatment room with folded towels, plants and warm soft light",
  salon: "a stylish modern hair salon with mirrors, chairs and warm lighting",
  roofer: "a newly finished roof on a handsome suburban house under a dramatic blue sky",
  hvac: "a modern heat pump unit outside a well-kept home on a sunny day",
  plumber: "a gleaming modern kitchen sink and faucet with tools neatly laid out",
  landscaping: "a lush, freshly landscaped front garden with a crisp lawn at golden hour",
  pest_control: "a spotless, bright family kitchen, calm and pest-free",
  auto_repair: "a clean, well-lit auto repair bay with a car on a lift",
  cleaning: "a sparkling clean, sunlit living room with fresh flowers",
  restaurant: "a beautifully plated signature dish on a rustic wooden table, shallow depth of field",
  gym: "an energetic modern gym with weights and natural light streaming in",
  law_pi: "a calm, trustworthy law office with warm wood, books and soft daylight",
  real_estate: "a beautiful modern home exterior at golden hour with a manicured yard",
  accountant: "a tidy modern office desk with a laptop, coffee and organized documents",
};

export interface ArtBrief {
  businessName: string;
  niche?: string;
  location?: string;
  offer?: string;
  artPrompt?: string;
  palette?: { bg: string; fg: string; accent: string };
  brandColors?: string[];
}

const LAYOUT: Record<ArtSize, string> = {
  square: "Square composition: main subject on the right half, calm uncluttered space on the left half for a headline added later.",
  story: "Vertical 9:16 composition: main subject in the lower half, calm uncluttered space in the top third for a headline added later.",
  landscape: "Wide 16:9 composition: main subject on the right, calm uncluttered space on the left for a headline added later.",
};

export function artPrompt(b: ArtBrief, size: ArtSize): string {
  const niche = getNiche(b.niche);
  const scene = b.artPrompt?.trim() || SCENES[niche?.id ?? ""] || `a welcoming, modern ${niche && niche.id !== "custom" ? niche.label.toLowerCase() : "local business"} setting`;
  const colors = [...(b.brandColors ?? []), ...(b.palette ? [b.palette.bg, b.palette.accent] : [])].filter((c, i, a) => /^#[0-9a-f]{6}$/i.test(c) && a.indexOf(c) === i).slice(0, 3);
  return [
    `High-end advertising photograph: ${scene}.`,
    `For an ad by ${b.businessName}${b.location ? `, ${b.location.split(",")[0]}` : ""}${b.offer ? `, promoting: ${b.offer}` : ""}.`,
    colors.length ? `Colour palette built around ${colors.join(", ")}, used tastefully in props, light and background.` : "",
    LAYOUT[size],
    "Photorealistic, premium lighting, sharp focus.",
    "Absolutely no text, letters, numbers, logos, watermarks or readable signage anywhere in the image.",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 3800);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Generation =
  | { status: "pending" | "generating"; id: string }
  | { status: "completed"; id: string; content_url: string; content_mime_type: string }
  | { status: "failed"; id: string; error_message: string; failure_reason: string };

export async function generateArt(prompt: string, size: ArtSize, timeoutMs = 110_000): Promise<ArtAsset> {
  const created = await eleven<{ id: string }>("POST", "/v1/flows/image", { model_id: IMAGE_MODEL, prompt, aspect_ratio: RATIO[size], quality: "medium", resolution: "1K" });
  const deadline = Date.now() + timeoutMs;
  let wait = 2500;
  for (;;) {
    await sleep(wait);
    wait = Math.min(6000, Math.round(wait * 1.4));
    const g = await eleven<Generation>("GET", `/v1/flows/image/${encodeURIComponent(created.id)}`);
    if (g.status === "completed") {
      const res = await fetch(g.content_url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new ElevenError(`Couldn't download the image (HTTP ${res.status})`, 502);
      const bytes = Buffer.from(await res.arrayBuffer());
      const assetId = await putAsset(bytes, g.content_mime_type || res.headers.get("content-type") || "image/png");
      return { assetId, prompt, model: IMAGE_MODEL, createdAt: new Date().toISOString() };
    }
    if (g.status === "failed") {
      throw new ElevenError(
        g.failure_reason === "moderated" ? "The image was blocked by content moderation. Change the art prompt and try again." : `Image generation failed: ${g.error_message || g.failure_reason}`,
        502
      );
    }
    if (Date.now() > deadline) throw new ElevenError("The image is taking too long. Try again in a minute.", 504);
  }
}
