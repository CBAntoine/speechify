import { integrations } from "@/lib/config";
import { getProfile, updateProfile } from "@/lib/repo";
import { readBody, route } from "@/lib/http";
import type { AgencyProfile } from "@/lib/types";

export const GET = route(async () => Response.json({ profile: await getProfile(), integrations: integrations() }));

const TEXT_FIELDS: (keyof AgencyProfile)[] = ["agencyName", "ownerName", "email", "phone", "website", "city", "coreOffer", "pricing", "calendarUrl", "voice", "proof", "mailingAddress"];

export const PUT = route(async (req: Request) => {
  const b = await readBody<Partial<AgencyProfile>>(req);
  const patch: Partial<AgencyProfile> = {};
  for (const k of TEXT_FIELDS) {
    const v = b[k];
    if (typeof v === "string") (patch as Record<string, string>)[k] = v.slice(0, 2000);
  }
  if (Array.isArray(b.services)) patch.services = b.services.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 20);
  if (Array.isArray(b.targetNiches)) patch.targetNiches = b.targetNiches.map(String).slice(0, 10);
  return Response.json({ profile: await updateProfile(patch) });
});
