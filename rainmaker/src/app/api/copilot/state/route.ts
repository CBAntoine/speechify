import { integrations } from "@/lib/config";
import { buildAppState } from "@/lib/copilot/state";
import { route } from "@/lib/http";
import { siteUrl } from "@/lib/site";
import { readDb } from "@/lib/store";

// The copilot's live snapshot of the app (signed-in owner only).

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const path = new URL(req.url).searchParams.get("path") ?? undefined;
  return Response.json(buildAppState(await readDb(), integrations(), { baseUrl: siteUrl(req), path }));
});
