import { timingSafeEqual } from "node:crypto";
import { processAllClients } from "@/lib/clients/engine";
import { siteUrl, siteUrlStatic } from "@/lib/site";

// Scheduled run for client work: lead follow-ups, win-back steps, review and
// referral asks that are due. Vercel Cron calls it with
// "Authorization: Bearer $CRON_SECRET" (see vercel.json); any other scheduler
// (more often than daily, if your plan allows) can call it with the same
// header or ?key=$CRON_SECRET.

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : (new URL(req.url).searchParams.get("key") ?? "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ error: "Set CRON_SECRET to schedule client work" }, { status: 401 });
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const result = await processAllClients({ base: siteUrlStatic() ?? siteUrl(req) }, 250_000);
  return Response.json({ ok: true, ...result });
}
