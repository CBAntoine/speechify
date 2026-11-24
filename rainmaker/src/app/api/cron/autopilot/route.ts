import { timingSafeEqual } from "node:crypto";
import { AutopilotBusy, runAutopilot } from "@/lib/autopilot/run";
import { siteUrl, siteUrlStatic } from "@/lib/site";
import { syncSavedKeys } from "@/lib/store";

// Scheduled Autopilot run. Vercel Cron calls it with
// "Authorization: Bearer $CRON_SECRET" (see vercel.json); any other
// scheduler can call it with the same header or ?key=$CRON_SECRET.

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
  await syncSavedKeys().catch(() => undefined);
  if (!process.env.CRON_SECRET) return Response.json({ error: "Set CRON_SECRET to schedule Autopilot" }, { status: 401 });
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const run = await runAutopilot("cron", { base: siteUrlStatic() ?? siteUrl(req), budgetMs: 250_000 });
    return Response.json({ ok: true, status: run.status, counts: run.counts });
  } catch (err) {
    if (err instanceof AutopilotBusy) return Response.json({ ok: true, skipped: "already running" });
    console.error("[rainmaker] cron autopilot", err);
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
