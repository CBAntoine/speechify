import { claudeEnabled } from "@/lib/config";
import { describeError } from "@/lib/claude/client";
import { HttpError, readBody, route } from "@/lib/http";
import type { RedditConfig } from "@/lib/reddit/intent";
import { redditOAuth, redditState, saveRedditConfig, scanReddit } from "@/lib/reddit/scan";

// Reddit buyers. GET: settings, the posts found and the last scan.
// POST { action: "scan" } or { action: "config", config }.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const view = async () => ({ ...(await redditState()), oauth: redditOAuth(), claude: claudeEnabled() });

export const GET = route(async () => Response.json(await view()));

export const POST = route(async (req: Request) => {
  const b = await readBody<{ action?: string; config?: Partial<RedditConfig> }>(req);
  if (b.action === "config") {
    await saveRedditConfig(b.config ?? {});
    return Response.json(await view());
  }
  if (b.action === "scan") {
    try {
      const r = await scanReddit("user");
      return Response.json({ ...(await view()), result: { found: r.found, added: r.added, errors: r.errors } });
    } catch (err) {
      throw new HttpError(502, describeError(err));
    }
  }
  throw new HttpError(400, "Unknown action");
});
