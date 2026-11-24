import { countView } from "@/lib/video/make";

// The video's page was opened (not counted for your own previews).

type Params = { params: Promise<{ token: string }> };

export async function POST(_req: Request, { params }: Params) {
  await countView((await params).token).catch(() => undefined);
  return new Response(null, { status: 204 });
}
