import { NextResponse } from "next/server";
import { Resend } from "resend";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!rateLimit(`nl:${clientIp(req)}`, 5, 10 * 60_000)) {
    return NextResponse.json({ ok: false, message: "Slow down a little and try again." }, { status: 429 });
  }
  const { email, website } = (await req.json().catch(() => ({}))) as { email?: string; website?: string };
  if (website) return NextResponse.json({ ok: true }); // honeypot: pretend success for bots
  if (!email || email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false, message: "That email doesn't look right." }, { status: 400 });
  }
  const key = process.env.RESEND_API_KEY;
  const segment = process.env.RESEND_SEGMENT_ID;
  if (!key || !segment) {
    return NextResponse.json({ ok: false, message: "The newsletter opens very soon. Check back tomorrow!" }, { status: 503 });
  }
  const { error } = await new Resend(key).contacts.create({ email, unsubscribed: false, segments: [{ id: segment }] });
  if (error && !/already exists/i.test(error.message)) {
    console.error("[newsletter]", error);
    return NextResponse.json({ ok: false, message: "Couldn't subscribe you right now. Try again shortly." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, message: "You're on the list. The daily Leonida brief lands in your inbox." });
}
