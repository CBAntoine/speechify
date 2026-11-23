import { createJob, enqueue, listJobs } from "@/server/app";
import { parseOptions } from "@/server/options";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ jobs: listJobs() });
}

/** Start a job from a URL: {"url": "https://…", "options": {...}} */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { url?: string; options?: unknown } | null;
  const url = body?.url?.trim();
  if (!url || !/^https?:\/\//i.test(url)) return Response.json({ error: "Paste a link that starts with http:// or https://" }, { status: 400 });
  const job = createJob({ ...parseOptions(body?.options), url });
  enqueue(job.id);
  return Response.json({ id: job.id }, { status: 201 });
}
