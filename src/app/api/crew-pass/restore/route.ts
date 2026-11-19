import { NextResponse } from "next/server";
import { Resend } from "resend";
import { sign, verify } from "@/lib/server/signing";
import {
  CREW_COOKIE,
  CREW_UI_COOKIE,
  claimsForEmail,
  crewCookieOptions,
  crewUiCookieOptions,
  type CrewClaims,
} from "@/lib/server/crew";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { SITE } from "@/lib/site";

export const dynamic = "force-dynamic";

const GENERIC = "If there's an active Crew Pass for that email, a sign-in link is on its way.";

/** Step 1: member enters their email on a new device → we email a one-time link. */
export async function POST(req: Request) {
  if (!rateLimit(`restore:${clientIp(req)}`, 5, 15 * 60_000)) {
    return NextResponse.json({ ok: false, message: "Too many attempts. Try again later." }, { status: 429 });
  }
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false, message: "Enter a valid email." }, { status: 400 });
  }
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || `${SITE.name} <onboarding@resend.dev>`;
  if (!resendKey) return NextResponse.json({ ok: false, message: "Restoring by email isn't set up yet." }, { status: 503 });

  try {
    const claims = await claimsForEmail(email);
    if (claims) {
      const token = sign({ ...claims, link: Date.now() + 30 * 60_000 });
      const link = `${SITE.url}/api/crew-pass/restore?token=${encodeURIComponent(token)}`;
      await new Resend(resendKey).emails.send({
        from,
        to: email,
        subject: `Your ${SITE.name} Crew Pass sign-in link`,
        html: `<p>Tap to unlock Crew Pass on this device (link valid for 30 minutes):</p><p><a href="${link}">Unlock Crew Pass</a></p><p>If you didn't ask for this, ignore this email.</p>`,
      });
    }
  } catch (err) {
    console.error("[crew] restore failed", err);
  }
  return NextResponse.json({ ok: true, message: GENERIC });
}

/** Step 2: the emailed link lands here, sets the member cookie, then redirects. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  const data = verify<CrewClaims & { link: number }>(token);
  if (!data || data.link < Date.now()) {
    return NextResponse.redirect(`${SITE.url}/crew-pass?restore=expired`);
  }
  const { link: _link, ...claims } = data;
  void _link;
  const res = NextResponse.redirect(`${SITE.url}/crew-pass?restore=ok`);
  res.cookies.set(CREW_COOKIE, sign(claims), crewCookieOptions);
  res.cookies.set(CREW_UI_COOKIE, "1", crewUiCookieOptions);
  return res;
}
