import { NextResponse, type NextRequest } from "next/server";

// Password gate. Set APP_PASSWORD before deploying anywhere public: without
// it, anyone with the URL could use your CRM and spend your API credits.
// The browser shows its built-in login box (HTTP Basic auth); any username works.

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();
  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const pass = decoded.slice(decoded.indexOf(":") + 1);
      if (safeEqual(pass, password)) return NextResponse.next();
    } catch {
      /* fall through to the challenge */
    }
  }
  return new NextResponse("Sign in to Rainmaker", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Rainmaker", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
