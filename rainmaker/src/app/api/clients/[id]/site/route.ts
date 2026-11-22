import { getClient } from "@/lib/clients/repo";
import { renderSite } from "@/lib/clients/site-html";
import { buildSite, publishSite, saveSiteContent, siteRender } from "@/lib/clients/site";
import { HttpError, readBody, route, type IdParams } from "@/lib/http";
import { siteUrl } from "@/lib/site";
import type { SiteContent } from "@/lib/types";

export const maxDuration = 120;

/** ?export=1: the site as one HTML file to host anywhere (its form still posts here). */
export const GET = route(async (req: Request, { params }: IdParams) => {
  const client = await getClient((await params).id);
  if (!client?.site) throw new HttpError(404, "Build the website first");
  const html = renderSite(siteRender(client, siteUrl(req), { absolute: true }));
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "content-disposition": `attachment; filename="${client.site.slug}.html"` },
  });
});

/** { action: "build", services?, offer?, notes? } | { action: "publish" | "unpublish" } | { action: "save", content } */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const id = (await params).id;
  const b = await readBody<{ action?: string; services?: string; offer?: string; notes?: string; content?: Partial<SiteContent> }>(req);
  const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : undefined) || undefined;
  switch (b.action) {
    case "build": {
      const r = await buildSite(id, { services: clip(b.services, 1000), offer: clip(b.offer, 160), notes: clip(b.notes, 1500) });
      return Response.json(r);
    }
    case "publish":
    case "unpublish":
      return Response.json({ client: await publishSite(id, b.action === "publish") });
    case "save":
      if (!b.content || typeof b.content !== "object") throw new HttpError(400, "Nothing to save");
      return Response.json({ client: await saveSiteContent(id, b.content) });
    default:
      throw new HttpError(400, "Unknown action");
  }
});
