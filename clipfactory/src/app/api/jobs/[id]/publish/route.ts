import { getJob } from "@/server/app";
import { guard } from "@/server/guard";
import { PublishError, publishAll, publishShort } from "@/server/publish";
import type { Privacy } from "@/lib/types";

export const dynamic = "force-dynamic";

const PRIVACY: Privacy[] = ["public", "unlisted", "private"];

/**
 * Post to YouTube.
 * One short: {"shortId", "privacy", "title"?, "description"?, "publishAt"?}
 * All shipped shorts: {"privacy", "startAt"?, "everyHours"?}
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = guard(req);
  if (blocked) return blocked;
  const id = (await params).id;
  if (!getJob(id)) return Response.json({ error: "No such job" }, { status: 404 });
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const privacy = PRIVACY.includes(b.privacy as Privacy) ? (b.privacy as Privacy) : "public";
  const iso = (v: unknown) => (typeof v === "string" && v && Number.isFinite(new Date(v).getTime()) ? new Date(v).toISOString() : undefined);
  try {
    if (typeof b.shortId === "string") {
      const post = publishShort(id, b.shortId, {
        privacy,
        title: typeof b.title === "string" ? b.title : undefined,
        description: typeof b.description === "string" ? b.description : undefined,
        publishAt: iso(b.publishAt),
      });
      return Response.json({ ok: true, post });
    }
    const everyHours = typeof b.everyHours === "number" && b.everyHours >= 0 && b.everyHours <= 24 * 30 ? b.everyHours : undefined;
    const startAt = iso(b.startAt);
    if (startAt && new Date(startAt).getTime() < Date.now() + 60_000) throw new PublishError("Pick a start time at least a minute from now.");
    const queued = publishAll(id, { privacy, startAt, everyHours });
    return Response.json({ ok: true, queued });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't post" }, { status: err instanceof PublishError ? 400 : 500 });
  }
}
