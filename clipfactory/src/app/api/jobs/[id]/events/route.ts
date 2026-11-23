import { getJob, subscribe } from "@/server/app";
import { guard } from "@/server/guard";

export const dynamic = "force-dynamic";

/** Server-sent events: the whole job state, at most ~8 times a second. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = guard(req, "read");
  if (blocked) return blocked;
  const id = (await params).id;
  const job = getJob(id);
  if (!job) return Response.json({ error: "No such job" }, { status: 404 });
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (data: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(data));
        } catch {
          close();
        }
      };
      const unsubscribe = subscribe(id, (state) => send(`data: ${JSON.stringify(state)}\n\n`));
      const ping = setInterval(() => send(": ping\n\n"), 15000);
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      cleanup = close;
      req.signal.addEventListener("abort", close);
      send(`retry: 2000\ndata: ${JSON.stringify(getJob(id))}\n\n`);
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
