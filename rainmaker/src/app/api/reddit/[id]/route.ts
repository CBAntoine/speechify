import { describeError } from "@/lib/claude/client";
import { HttpError, readBody, route, type IdParams } from "@/lib/http";
import { emailSignal, replyToSignal, saveSignalAsLead, setSignalStatus } from "@/lib/reddit/scan";

// One Reddit post. POST { action }: reply (draft a public reply), lead (save
// to the pipeline), email (draft the email, to an address they published),
// replied, dismiss or restore.

export const maxDuration = 60;

export const POST = route(async (req: Request, { params }: IdParams) => {
  const id = (await params).id;
  const b = await readBody<{ action?: string; to?: string }>(req);
  try {
    switch (b.action) {
      case "reply":
        return Response.json({ signal: await replyToSignal(id) });
      case "lead":
        return Response.json(await saveSignalAsLead(id));
      case "email":
        return Response.json(await emailSignal(id, b.to));
      case "replied":
      case "dismiss":
      case "restore":
        return Response.json({ signal: await setSignalStatus(id, b.action === "replied" ? "replied" : b.action === "dismiss" ? "dismissed" : "new") });
      default:
        throw new HttpError(400, "Unknown action");
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, describeError(err));
  }
});
