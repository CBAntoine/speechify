import { writeSequence } from "@/lib/claude/clients";
import { describeError } from "@/lib/claude/client";
import { claudeEnabled } from "@/lib/config";
import { updateClientData } from "@/lib/clients/data-store";
import { ensureSequence } from "@/lib/clients/engine";
import { getClient, updateClient } from "@/lib/clients/repo";
import { defaultSequence } from "@/lib/clients/templates";
import { HttpError, readBody, route, type IdParams } from "@/lib/http";
import { getProfile } from "@/lib/repo";
import { newId } from "@/lib/store";
import type { SequenceKind, SequenceStepContent } from "@/lib/types";

export const maxDuration = 90;

const KINDS: SequenceKind[] = ["nurture", "reactivation", "review", "referral"];

function cleanSteps(v: unknown): SequenceStepContent[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .slice(0, 6)
    .map((s) => ({
      delayHours: Math.max(0, Math.min(24 * 60, Math.round(Number((s as SequenceStepContent).delayHours) || 0))),
      sms: String((s as SequenceStepContent).sms ?? "").slice(0, 640),
      subject: String((s as SequenceStepContent).subject ?? "").slice(0, 120),
      email: String((s as SequenceStepContent).email ?? "").slice(0, 4000),
    }))
    .filter((s) => s.sms.trim() || s.email.trim())
    .sort((a, b) => a.delayHours - b.delayHours);
}

/**
 * { action: "write", kind, service?, offer? }: (re)write a sequence with Claude (or the template).
 * { action: "save", seqId, name?, steps?, status? }: edit one.
 * { action: "new_winback", name? }: another win-back campaign.
 */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const id = (await params).id;
  let client = await getClient(id);
  if (!client) throw new HttpError(404, "Client not found");
  const b = await readBody<{ action?: string; kind?: string; seqId?: string; name?: string; steps?: unknown; status?: string; service?: string; offer?: string }>(req);

  if (b.action === "write") {
    const kind = b.kind as SequenceKind;
    if (!KINDS.includes(kind)) throw new HttpError(400, "Unknown sequence");
    if (typeof b.offer === "string") {
      const key = kind === "referral" ? "referralOffer" : "reactivationOffer";
      if (kind === "referral" || kind === "reactivation") client = await updateClient(id, { settings: { [key]: b.offer } });
    }
    let written: { name: string; steps: SequenceStepContent[] };
    let by: "ai" | "template" = "template";
    let note: string | undefined;
    if (claudeEnabled()) {
      try {
        written = await writeSequence(kind, client, { service: b.service?.slice(0, 120), voice: (await getProfile()).voice });
        by = "ai";
      } catch (err) {
        note = `Used the template: ${describeError(err)}`;
        written = defaultSequence(kind, client.lang, { business: client.name, service: b.service, offer: client.settings.reactivationOffer, referralOffer: client.settings.referralOffer });
      }
    } else {
      written = defaultSequence(kind, client.lang, { business: client.name, service: b.service, offer: client.settings.reactivationOffer, referralOffer: client.settings.referralOffer });
    }
    const c = client;
    const seq = await updateClientData(id, (data) => {
      const s = (b.seqId ? data.sequences.find((x) => x.id === b.seqId) : undefined) ?? ensureSequence(data, c, kind);
      s.name = written.name;
      s.steps = written.steps;
      s.createdBy = by;
      s.updatedAt = new Date().toISOString();
      return structuredClone(s);
    });
    return Response.json({ sequence: seq, by, note });
  }

  if (b.action === "save") {
    const steps = cleanSteps(b.steps);
    const seq = await updateClientData(id, (data) => {
      const s = data.sequences.find((x) => x.id === b.seqId);
      if (!s) throw new HttpError(404, "Sequence not found");
      if (typeof b.name === "string" && b.name.trim()) s.name = b.name.trim().slice(0, 80);
      if (steps?.length) {
        s.steps = steps;
        s.createdBy = "user";
      }
      if (b.status === "running" || b.status === "paused") s.status = b.status;
      s.updatedAt = new Date().toISOString();
      return structuredClone(s);
    });
    return Response.json({ sequence: seq });
  }

  if (b.action === "new_winback") {
    const c = client;
    const seq = await updateClientData(id, (data) => {
      const t = defaultSequence("reactivation", c.lang, { business: c.name, offer: c.settings.reactivationOffer });
      const s = { id: newId("seq"), kind: "reactivation" as const, name: (b.name?.trim() || t.name).slice(0, 80), status: "running" as const, steps: t.steps, createdBy: "template" as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      data.sequences.push(s);
      return s;
    });
    return Response.json({ sequence: seq });
  }
  throw new HttpError(400, "Unknown action");
});
