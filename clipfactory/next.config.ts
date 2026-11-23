import type { NextConfig } from "next";

// This app lives in a subfolder of a repo that has its own lockfile, so pin the
// project root here instead of letting Next.js guess.
const root = process.cwd();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: { position: "bottom-right" },
  turbopack: { root },
  outputFileTracingRoot: root,
  // Runtime data, never part of the build.
  outputFileTracingExcludes: { "/*": [".venv/**", "workspace/**", "models/**", "tools/**", "py/__pycache__/**"] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
