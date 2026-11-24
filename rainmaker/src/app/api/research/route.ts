import { claudeEnabled } from "@/lib/config";
import { researchWeb } from "@/lib/claude/research";
import { HttpError, readBody, route } from "@/lib/http";

export const maxDuration = 180;

export const POST = route(async (req: Request) => {
  const b = await readBody<{ question?: string }>(req);
  if (!claudeEnabled()) throw new HttpError(400, "Web research needs your Claude API key: add it in Settings → API keys");
  if (!b.question?.trim()) throw new HttpError(400, "Ask a question");
  return Response.json(await researchWeb(b.question.trim().slice(0, 800)));
});
