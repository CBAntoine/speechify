import { NextResponse } from "next/server";
import { makeSession, safeEqual, SESSION_COOKIE } from "@/lib/auth";

function secure(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  return proto === "https";
}

export async function POST(req: Request) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.json({ ok: true, open: true });
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  if (typeof body.password !== "string" || !safeEqual(body.password, password)) {
    // Slow down guessing.
    await new Promise((r) => setTimeout(r, 700));
    return NextResponse.json({ error: "That password isn't right." }, { status: 401 });
  }
  const { value, maxAge } = await makeSession(password);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, value, { httpOnly: true, secure: secure(req), sameSite: "lax", path: "/", maxAge });
  return res;
}
