import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath, SESSION_COOKIE, verifySession } from "@/lib/auth";

// Sign-in gate. Set APP_PASSWORD before deploying anywhere public: without it,
// anyone with the address could run reviews on your API keys.

export async function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  if (await verifySession(request.cookies.get(SESSION_COOKIE)?.value, password)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
