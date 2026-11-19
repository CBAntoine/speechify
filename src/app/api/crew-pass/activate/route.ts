import { NextResponse } from "next/server";
import { sign } from "@/lib/server/signing";
import { CREW_COOKIE, CREW_UI_COOKIE, claimsFromCheckout, crewCookieOptions, crewUiCookieOptions } from "@/lib/server/crew";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/** Called by /crew-pass/success after Stripe redirects back with ?session_id=… */
export async function POST(req: Request) {
  if (!rateLimit(`crew:${clientIp(req)}`, 10, 10 * 60_000)) {
    return NextResponse.json({ ok: false, message: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }
  const { sessionId } = (await req.json().catch(() => ({}))) as { sessionId?: string };
  if (!sessionId) return NextResponse.json({ ok: false, message: "Missing checkout session." }, { status: 400 });
  try {
    const result = await claimsFromCheckout(sessionId);
    if ("error" in result) return NextResponse.json({ ok: false, message: result.error }, { status: 400 });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(CREW_COOKIE, sign(result.claims), crewCookieOptions);
    res.cookies.set(CREW_UI_COOKIE, "1", crewUiCookieOptions);
    return res;
  } catch (err) {
    console.error("[crew] activation failed", err);
    return NextResponse.json({ ok: false, message: "We couldn't reach the payment provider. Please refresh." }, { status: 502 });
  }
}
