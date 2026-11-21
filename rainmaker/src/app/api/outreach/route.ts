import { claudeEnabled } from "@/lib/config";
import { generateOutreach, templateOutreach } from "@/lib/claude/outreach";
import { getLead, getProfile } from "@/lib/repo";
import { HttpError, readBody, route } from "@/lib/http";
import type { Channel } from "@/lib/types";

export const maxDuration = 120;

export const POST = route(async (req: Request) => {
  const b = await readBody<{ leadId?: string; channel?: Channel }>(req);
  const lead = b.leadId ? await getLead(b.leadId) : undefined;
  if (!lead) throw new HttpError(404, "Lead not found");
  const profile = await getProfile();
  const ai = claudeEnabled();
  const content = ai ? await generateOutreach(lead, profile, b.channel ?? "email") : templateOutreach(lead, profile);
  return Response.json({ content, ai });
});
