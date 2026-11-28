import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { features } from "../config.ts";
import { getSettings, updateLead } from "../db.ts";
import { leadChanged, log, working } from "../events.ts";
import { getNiche } from "../niches.ts";
import { browserAvailable, screenshotFile } from "../providers/browser.ts";
import { askStructured } from "../providers/claude.ts";
import { elevenEnabled, speak, spendCredits } from "../providers/eleven.ts";
import { hasFfmpeg, probeDuration } from "../providers/ffmpeg.ts";
import { PALETTES } from "../site/design.ts";
import type { Lead, VideoAsset } from "../types.ts";
import { errorMessage } from "../util.ts";
import { captionsFromAlignment, captionsFromText, type Caption } from "../video/captions.ts";
import { composeVideo } from "../video/compose.ts";
import { systemSpeech } from "../video/say.ts";
import { ESTIMATE, elevenPreflight, preflight } from "./checker.ts";
import { FILMER_PROMPT } from "./prompts.ts";
import { HeldError } from "./scout.ts";
import { abs, factSheet, leadDir, priceLabel, rel } from "./shared.ts";

// Filmer: a short script, an ElevenLabs voiceover with word timings, and a
// vertical video of the business's new site scrolling on a phone.

const ScriptSchema = z.object({
  script: z.string().describe("28-40 spoken words"),
  hook: z.string().describe("≤ 8 words, on screen"),
  endTitle: z.string().describe("≤ 6 words"),
  endSubtitle: z.string().describe("≤ 8 words"),
});
type Script = z.infer<typeof ScriptSchema>;

let toolsCache: { ok: boolean; why?: string; at: number } | undefined;

export async function videoToolsReady(): Promise<{ ok: boolean; why?: string }> {
  if (toolsCache && Date.now() - toolsCache.at < 5 * 60_000) return toolsCache;
  const [ff, br] = await Promise.all([hasFfmpeg(), browserAvailable()]);
  toolsCache = { ok: ff && br.ok, why: !ff ? "FFmpeg isn't installed" : !br.ok ? `no headless browser (${br.error ?? "run npx playwright install chromium"})` : undefined, at: Date.now() };
  return toolsCache;
}

export async function film(lead: Lead): Promise<Lead | undefined> {
  return working("filmer", `Filming ${lead.name}'s video`, async () => {
    const s = getSettings();
    const primary = lead.variants?.[0];
    const tools = await videoToolsReady();
    if (!s.media.video || !primary || !lead.spec || !tools.ok) {
      const why = !s.media.video ? "videos are turned off in Settings" : !primary || !lead.spec ? "there's no mockup to film" : tools.why;
      const updated = updateLead(lead.id, (l) => (l.status = "filmed"));
      if (updated) {
        leadChanged(updated);
        log("filmer", `No video for this one: ${why}. The pitch goes out with the mockups.`, { lead: updated, level: "warn" });
      }
      return updated;
    }

    let sc: Script;
    if (features.claude) {
      const v = preflight(ESTIMATE.script(), { agent: "filmer", what: "a video script", lead });
      if (!v.ok) throw new HeldError(v.reason);
      sc = await askStructured({
        agent: "filmer",
        leadId: lead.id,
        system: FILMER_PROMPT,
        prompt: `${factSheet(lead)}\n\nDiagnosis: ${lead.diagnosis?.headline ?? ""}\nHooks: ${lead.diagnosis?.hooks.join("; ") ?? ""}\nPrice (only for the end card if you like): ${priceLabel(lead.dealValueCents ?? lead.priceCents, s)}, live in ${s.offer.deliveryDays} days.`,
        schema: ScriptSchema,
        effort: "low",
        maxTokens: 4000,
        label: "video script",
      });
    } else {
      sc = demoScript(lead, priceLabel(lead.dealValueCents ?? lead.priceCents, s), s.offer.deliveryDays);
    }

    const dir = leadDir(lead, "video");
    let audioPath: string | undefined;
    let captions: Caption[] = [];
    let voice: VideoAsset["voice"] = "silent";
    if (elevenEnabled()) {
      const cost = preflight(ESTIMATE.voice(sc.script.length), { agent: "filmer", what: "the voiceover", lead });
      const credits = cost.ok ? await elevenPreflight(sc.script.length, lead) : cost;
      if (cost.ok && credits.ok) {
        try {
          const out = await speak(sc.script, { voiceId: s.media.voiceId, agent: "filmer", leadId: lead.id });
          spendCredits(sc.script.length);
          audioPath = path.join(dir, "voice.mp3");
          fs.writeFileSync(audioPath, out.audio);
          const dur = await probeDuration(audioPath).catch(() => 12);
          captions = out.alignment ? captionsFromAlignment(out.alignment, 3) : captionsFromText(sc.script, dur, 3);
          voice = "elevenlabs";
        } catch (err) {
          log("filmer", `ElevenLabs voiceover failed (${errorMessage(err)}); trying a fallback voice.`, { lead, level: "warn" });
          audioPath = undefined;
        }
      }
    }
    if (!audioPath) {
      const p = path.join(dir, "voice.mp3");
      if (await systemSpeech(sc.script, p).catch(() => false)) {
        audioPath = p;
        voice = "system";
        captions = captionsFromText(sc.script, await probeDuration(p).catch(() => 12), 3);
      } else {
        captions = captionsFromText(sc.script, 12, 3);
      }
    }

    const shotPath = path.join(dir, "site-full.jpg");
    fs.writeFileSync(shotPath, await screenshotFile(abs(primary.path), { width: 390, height: 844, scale: 3, fullPage: true, type: "jpeg", quality: 88, hide: [".ms-preview-bar"] }));
    const pal = PALETTES[lead.spec.palette];
    const res = await composeVideo({
      siteShot: shotPath,
      outDir: dir,
      audioPath,
      durationSec: audioPath ? undefined : 12,
      captions,
      hook: sc.hook,
      endCard: { title: sc.endTitle, subtitle: sc.endSubtitle },
      brand: { primary: pal.primary, accent: pal.accent, ink: pal.ink, bg: pal.bg },
      businessName: lead.name,
    });
    const video: VideoAsset = { path: rel(res.videoPath), poster: rel(res.posterPath), durationSec: Math.round(res.durationSec * 10) / 10, script: sc.script, voice };
    const updated = updateLead(lead.id, (l) => {
      l.video = video;
      l.status = "filmed";
    });
    if (updated) {
      leadChanged(updated);
      log("filmer", `Made a ${video.durationSec}s vertical video${voice === "elevenlabs" ? " with an ElevenLabs voiceover" : voice === "system" ? " with the computer's voice" : " with captions (no voice)"}.`, { lead: updated, level: "success" });
    }
    return updated;
  });
}

export function demoScript(lead: Lead, price: string, days: number): Script {
  const niche = getNiche(lead.niche);
  const rated = lead.rating && (lead.reviewCount ?? 0) >= 3 ? `${lead.rating.toFixed(1)} stars on Google` : undefined;
  const problem: Record<string, string> = {
    none: "but no website",
    social_only: "but only a social page",
    dead: "but your website link is broken",
    outdated: "but a website that's hard to use on a phone",
    weak: "but a website that's missing the basics",
  };
  const opener = rated ? `${lead.name}, you've got ${rated}, ${problem[lead.websiteState ?? "none"] ?? "but no website"}.` : `${lead.name}, people in ${lead.city} are searching for a ${niche.label.toLowerCase()} like you.`;
  return {
    script: `${opener} So we built you one. Your hours, your services and your best reviews, on a page that works on any phone. Take a look, and if you like it, it's yours.`,
    hook: `We built ${lead.name} a new website`.split(" ").slice(0, 8).join(" "),
    endTitle: `${price} · live in ${days} days`,
    endSubtitle: "Reply to claim it",
  };
}
