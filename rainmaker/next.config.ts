import type { NextConfig } from "next";

// This app lives in a subfolder of a repo that has its own lockfile, so pin the
// project root here instead of letting Next.js guess.
const root = process.cwd();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: { position: "bottom-right" },
  // Load the Postgres driver from node_modules at runtime instead of bundling it.
  serverExternalPackages: ["postgres"],
  turbopack: { root },
  outputFileTracingRoot: root,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // Location is used by "near me" search; the microphone by the store's
          // voice assistant and prospect demo pages. Nothing else.
          { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(self)" },
        ],
      },
      {
        // Service worker: never cached, same-origin scripts only.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
