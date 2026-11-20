import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sign, verify, secureCookie } from "@/lib/server/signing";
import { CREW_COOKIE, crewCookieOptions, readCrew } from "@/lib/server/crew";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const QUOTA_COOKIE = "na_q";
const DEFAULT_AGENT_ID = "agent_7001m7t6yy2fekkta6jf0fnq0t14";
const LIMITS = {
  free: {
    voice: Number(process.env.VOICE_FREE_SESSIONS_PER_DAY || 3),
    text: Number(process.env.TEXT_FREE_SESSIONS_PER_DAY || 15),
  },
  crew: {
    voice: Number(process.env.VOICE_CREW_SESSIONS_PER_DAY || 60),
    text: Number(process.env.TEXT_CREW_SESSIONS_PER_DAY || 300),
  },
};

interface Quota {
  d: string; // UTC day
  v: number; // voice sessions used
  t: number; // text sessions used
}

const quotaCookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: secureCookie, path: "/", maxAge: 2 * 86_400 };

/**
 * Issues a short-lived ElevenLabs credential for one conversation.
 * - Voice → WebRTC conversation token. Text → WebSocket signed URL.
 * - Enforces daily allowances per tier, so the API key never leaves the server
 *   and free traffic can't run up the bill.
 * - A session counts once the browser reports it connected ({ event: "connected" }),
 *   so a declined mic prompt or a failed connection doesn't use up an allowance.
 *   The per-network rate limit below is the hard cap either way.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { mode?: string; event?: string };
  const mode: "voice" | "text" = body.mode === "text" ? "text" : "voice";

  const jar = await cookies();
  const crew = await readCrew(jar.get(CREW_COOKIE)?.value);
  const tier = crew.claims ? "crew" : "free";
  const limit = LIMITS[tier][mode];

  const today = new Date().toISOString().slice(0, 10);
  const q = verify<Quota>(jar.get(QUOTA_COOKIE)?.value);
  const used: Quota = q && q.d === today ? q : { d: today, v: 0, t: 0 };
  const count = mode === "voice" ? used.v : used.t;

  if (body.event === "connected") {
    const next: Quota = { ...used, v: used.v + (mode === "voice" ? 1 : 0), t: used.t + (mode === "text" ? 1 : 0) };
    const res = NextResponse.json({ ok: true, tier, limit, remaining: Math.max(0, limit - count - 1) });
    res.cookies.set(QUOTA_COOKIE, sign(next), quotaCookieOptions);
    if (crew.refreshed) res.cookies.set(CREW_COOKIE, crew.refreshed, crewCookieOptions);
    return res;
  }

  if (!rateLimit(`voice:${clientIp(req)}`, 20, 60 * 60_000)) {
    return NextResponse.json(
      { ok: false, error: "quota", message: "Too many sessions from this network. Take a breather and try again later." },
      { status: 429 },
    );
  }

  // The "Sol" agent built for this site is the default once a server key is set.
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID || process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID || (apiKey ? DEFAULT_AGENT_ID : undefined);
  if (!agentId) {
    return NextResponse.json(
      { ok: false, error: "unconfigured", message: "The voice guide isn't switched on yet. Check back soon." },
      { status: 503 },
    );
  }

  if (count >= limit) {
    return NextResponse.json(
      {
        ok: false,
        error: "quota",
        tier,
        limit,
        message:
          tier === "crew"
            ? "You've reached today's Crew Pass allowance. It resets at midnight UTC."
            : mode === "voice"
              ? `That's your ${limit} free voice sessions for today. Crew Pass members get ${LIMITS.crew.voice} a day, or keep chatting by text.`
              : `That's today's free text chats. Crew Pass members get ${LIMITS.crew.text} a day.`,
      },
      { status: 429 },
    );
  }

  let auth: { conversationToken: string } | { signedUrl: string } | { agentId: string };
  if (apiKey) {
    const endpoint = mode === "voice" ? "token" : "get-signed-url";
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/${endpoint}?agent_id=${encodeURIComponent(agentId)}`,
      { headers: { "xi-api-key": apiKey }, cache: "no-store" },
    ).catch(() => null);
    if (!upstream?.ok) {
      console.error("[voice] ElevenLabs credential request failed", upstream?.status, await upstream?.text().catch(() => ""));
      return NextResponse.json(
        { ok: false, error: "upstream", message: "The voice guide is busy right now. Try again in a moment." },
        { status: 502 },
      );
    }
    const data = (await upstream.json()) as { token?: string; signed_url?: string };
    if (mode === "voice" && data.token) auth = { conversationToken: data.token };
    else if (mode === "text" && data.signed_url) auth = { signedUrl: data.signed_url };
    else {
      return NextResponse.json({ ok: false, error: "upstream", message: "Unexpected response from the voice service." }, { status: 502 });
    }
  } else {
    // No server key: the agent must be public. Fine for development; set ELEVENLABS_API_KEY in production.
    auth = { agentId };
  }

  // Not counted yet: the browser confirms with { event: "connected" } once the conversation starts.
  const res = NextResponse.json({ ok: true, tier, limit, remaining: Math.max(0, limit - count), auth });
  if (crew.refreshed) res.cookies.set(CREW_COOKIE, crew.refreshed, crewCookieOptions);
  return res;
}
