import { deleteClient, getClient, patchClient, setServiceStatus, updateClient, type ClientPatch } from "@/lib/clients/repo";
import { SERVICE_IDS } from "@/lib/clients/services";
import { HttpError, readBody, route, type IdParams } from "@/lib/http";
import type { ServiceId, ServiceStatus } from "@/lib/types";
import { randomBytes } from "node:crypto";

export const GET = route(async (_req: Request, { params }: IdParams) => {
  const client = await getClient((await params).id);
  if (!client) throw new HttpError(404, "Client not found");
  return Response.json({ client });
});

/**
 * Edit details and settings ({ ...fields, settings: {...} }), switch a service
 * ({ service, status }), include or drop one from the plan ({ service,
 * included }), or issue new secret links ({ rotate: "intake" | "report" }).
 */
export const PATCH = route(async (req: Request, { params }: IdParams) => {
  const id = (await params).id;
  const b = await readBody<ClientPatch & { service?: string; status?: string; included?: boolean; rotate?: string }>(req);
  if (b.service) {
    if (!SERVICE_IDS.includes(b.service as ServiceId)) throw new HttpError(400, "Unknown service");
    if (typeof b.included === "boolean") {
      const client = await patchClient(id, (c) => {
        const s = c.services[b.service as ServiceId];
        s.included = b.included!;
        if (!b.included) s.status = "off";
      });
      return Response.json({ client });
    }
    if (!["off", "setup", "live", "paused"].includes(b.status ?? "")) throw new HttpError(400, "Unknown status");
    return Response.json({ client: await setServiceStatus(id, b.service as ServiceId, b.status as ServiceStatus) });
  }
  if (b.rotate === "intake" || b.rotate === "report") {
    const client = await patchClient(id, (c) => {
      if (b.rotate === "intake") c.intakeKey = randomBytes(18).toString("base64url");
      else c.reportToken = randomBytes(12).toString("base64url");
    });
    return Response.json({ client });
  }
  try {
    return Response.json({ client: await updateClient(id, b) });
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : String(err));
  }
});

export const DELETE = route(async (_req: Request, { params }: IdParams) => {
  await deleteClient((await params).id);
  return Response.json({ ok: true });
});
