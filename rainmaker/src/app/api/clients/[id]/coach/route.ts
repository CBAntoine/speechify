import { scoreCall } from "@/lib/claude/clients";
import { describeError } from "@/lib/claude/client";
import { claudeEnabled, elevenEnabled } from "@/lib/config";
import { parseTranscript, rulesScorecard, transcriptMetrics } from "@/lib/clients/coach";
import { updateClientData } from "@/lib/clients/data-store";
import { getClient } from "@/lib/clients/repo";
import { practiceTranscript, transcribeCall } from "@/lib/elevenlabs/phone";
import { HttpError, readBody, route, type IdParams } from "@/lib/http";
import { newId } from "@/lib/store";
import type { CallReview, Client } from "@/lib/types";

export const maxDuration = 300;

const MAX_AUDIO = 40 * 1024 * 1024;

async function review(client: Client, input: { transcript: string; rep: string; title: string; source: CallReview["source"]; repLabel?: string }): Promise<{ review: CallReview; note?: string }> {
  const turns = parseTranscript(input.transcript, input.repLabel);
  if (turns.length < 2) throw new HttpError(400, "That doesn't look like a conversation yet. Put each turn on its own line, like \"Rep: …\" and \"Customer: …\".");
  const metrics = transcriptMetrics(turns);
  const rules = rulesScorecard(turns, metrics, client.lang);
  let scorecard = rules;
  let note: string | undefined;
  if (claudeEnabled()) {
    try {
      const normalized = turns.map((t) => `${t.speaker === "rep" ? input.rep || "Rep" : "Customer"}: ${t.text}`).join("\n");
      scorecard = await scoreCall(normalized, { client, rep: input.rep, labels: Object.fromEntries(rules.scores.map((s) => [s.id, s.label])) });
    } catch (err) {
      note = `Scored by the built-in rules: ${describeError(err)}`;
    }
  }
  const r: CallReview = {
    id: newId("rev"),
    rep: input.rep.slice(0, 80) || "Team",
    title: input.title.slice(0, 120) || (input.source === "practice" ? "Practice call" : "Sales call"),
    source: input.source,
    transcript: input.transcript.slice(0, 60_000),
    metrics,
    scorecard,
    createdAt: new Date().toISOString(),
  };
  await updateClientData(client.id, (d) => {
    d.reviews.unshift(r);
  });
  return { review: r, note };
}

/**
 * JSON { transcript, rep?, title?, repLabel? }: score a pasted transcript.
 * JSON { conversationId, rep?, title? }: score a finished practice call.
 * multipart { file, rep?, title? }: transcribe a recording, then score it.
 */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const client = await getClient((await params).id);
  if (!client) throw new HttpError(404, "Client not found");
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    if (!elevenEnabled()) throw new HttpError(400, "Add ELEVENLABS_API_KEY to transcribe recordings, or paste the transcript instead");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new HttpError(400, "Choose a recording");
    if (file.size > MAX_AUDIO) throw new HttpError(400, "Recordings up to 40 MB, please");
    let transcript: string;
    try {
      transcript = await transcribeCall(Buffer.from(await file.arrayBuffer()), file.type || "audio/mpeg", file.name || "call.mp3", client.lang);
    } catch (err) {
      throw new HttpError(502, describeError(err));
    }
    return Response.json(await review(client, { transcript, rep: String(form.get("rep") ?? ""), title: String(form.get("title") ?? file.name ?? ""), source: "recording" }));
  }
  const b = await readBody<{ transcript?: string; conversationId?: string; rep?: string; title?: string; repLabel?: string }>(req);
  if (b.conversationId) {
    if (!elevenEnabled()) throw new HttpError(400, "Practice calls need ELEVENLABS_API_KEY");
    let transcript: string;
    try {
      transcript = await practiceTranscript(b.conversationId);
    } catch (err) {
      throw new HttpError(502, describeError(err));
    }
    return Response.json(await review(client, { transcript, rep: b.rep ?? "", title: b.title ?? "Practice call", source: "practice" }));
  }
  if (!b.transcript?.trim()) throw new HttpError(400, "Paste the conversation first");
  return Response.json(await review(client, { transcript: b.transcript, rep: b.rep ?? "", title: b.title ?? "", source: "transcript", repLabel: b.repLabel }));
});

export const DELETE = route(async (req: Request, { params }: IdParams) => {
  const id = (await params).id;
  const rid = new URL(req.url).searchParams.get("review");
  await updateClientData(id, (d) => {
    d.reviews = d.reviews.filter((r) => r.id !== rid);
  });
  return Response.json({ ok: true });
});
