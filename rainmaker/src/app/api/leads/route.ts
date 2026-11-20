import { createLead, listLeads, saveProspects } from "@/lib/repo";
import { HttpError, readBody, route } from "@/lib/http";
import type { Lead, Prospect } from "@/lib/types";

export const GET = route(async () => Response.json({ leads: await listLeads() }));

export const POST = route(async (req: Request) => {
  const b = await readBody<{ prospects?: Prospect[]; lead?: Partial<Lead> & { name?: string } }>(req);
  if (Array.isArray(b.prospects)) {
    const res = await saveProspects(b.prospects.slice(0, 100), { createdBy: "user" });
    return Response.json(res);
  }
  if (b.lead?.name?.trim()) {
    const lead = await createLead({ ...b.lead, name: b.lead.name.trim() });
    return Response.json({ lead });
  }
  throw new HttpError(400, "Send prospects or a lead with a name");
});
