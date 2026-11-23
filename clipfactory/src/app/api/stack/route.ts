import { machine } from "@/server/app";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.has("fresh");
  const m = await machine(fresh);
  return Response.json(m.report);
}
