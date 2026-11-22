import { cookies } from "next/headers";
import { after } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { updateClientData } from "@/lib/clients/data-store";
import { clientBySlug } from "@/lib/clients/repo";
import { renderSite } from "@/lib/clients/site-html";
import { siteRender } from "@/lib/clients/site";
import { localTime } from "@/lib/clients/rules";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { siteUrl } from "@/lib/site";

// A client's website, as one standalone HTML page (no app shell). Published
// sites are public; an unpublished one is a preview for the signed-in agency.

export const dynamic = "force-dynamic";

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse/i;

async function signedIn(): Promise<boolean> {
  const password = process.env.APP_PASSWORD;
  if (!password) return true;
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value, password);
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const client = await clientBySlug((await params).slug);
  const preview = Boolean(client?.site && !client.site.published);
  if (!client?.site || (preview && !(await signedIn()))) {
    return new Response("<!doctype html><title>Not found</title><p style=\"font-family:system-ui;padding:40px\">This page isn't available.</p>", { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  }
  const url = new URL(req.url);
  const q = url.searchParams;
  const utm: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "gclid", "fbclid"]) {
    const v = q.get(k);
    if (v) utm[k] = v.slice(0, 100);
  }
  const html = renderSite(
    siteRender(client, siteUrl(req), {
      sent: q.get("sent") === "1",
      error: q.get("error") === "required" ? "required" : undefined,
      refCode: /^[a-z0-9]{6}$/.test(q.get("ref") ?? "") ? q.get("ref")! : undefined,
      utm,
      preview,
    })
  );
  if (!preview && !BOT.test(req.headers.get("user-agent") ?? "") && rateLimit(`view:${client.id}:${clientIp(req)}`, 1, 30 * 60_000)) {
    after(() =>
      updateClientData(client.id, (d) => {
        const day = localTime(new Date(), client.timezone).day;
        const e = (d.daily[day] ??= { sent: 0, views: 0 });
        e.views += 1;
      }).catch(() => undefined)
    );
  }
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": preview ? "no-store" : "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
      "x-frame-options": "SAMEORIGIN",
    },
  });
}
