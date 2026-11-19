export const dynamic = "force-static";

/** ads.txt for Google AdSense (required for ads to serve at full rates). */
export function GET() {
  const client = process.env.NEXT_PUBLIC_ADSENSE_CLIENT || "";
  const pub = client.replace(/^ca-/, "");
  const body = pub ? `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n` : "# Ads not configured\n";
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
