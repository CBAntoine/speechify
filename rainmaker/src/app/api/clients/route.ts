import { clientFromLead, createClient, listClients } from "@/lib/clients/repo";
import { SERVICE_IDS } from "@/lib/clients/services";
import { HttpError, readBody, route } from "@/lib/http";
import type { ServiceId } from "@/lib/types";

export const GET = route(async () => {
  return Response.json({ clients: await listClients() });
});

/** Add a client: from a pipeline lead ({ leadId }) or from scratch. */
export const POST = route(async (req: Request) => {
  const b = await readBody<Record<string, unknown>>(req);
  const str = (k: string, n = 200) => (typeof b[k] === "string" ? (b[k] as string).trim().slice(0, n) : undefined) || undefined;
  const services = Array.isArray(b.services) ? (b.services.filter((s) => SERVICE_IDS.includes(s as ServiceId)) as ServiceId[]) : undefined;
  const num = (k: string) => (typeof b[k] === "number" && Number.isFinite(b[k]) && (b[k] as number) >= 0 ? (b[k] as number) : undefined);
  if (str("leadId")) {
    const client = await clientFromLead(str("leadId")!, { services, monthly: num("monthly"), setup: num("setup") });
    return Response.json({ client });
  }
  const name = str("name", 120);
  if (!name) throw new HttpError(400, "Enter the business name");
  const client = await createClient({
    name,
    niche: str("niche", 60),
    place: str("place", 120),
    contactName: str("contactName", 120),
    email: str("email"),
    phone: str("phone", 40),
    website: str("website", 300),
    address: str("address", 300),
    services,
    monthly: num("monthly"),
    setup: num("setup"),
  });
  return Response.json({ client });
});
