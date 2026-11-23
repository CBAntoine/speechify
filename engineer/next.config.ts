import type { NextConfig } from "next";

// This app lives in a subfolder of a repo that has its own lockfile, so pin the
// project root here instead of letting Next.js guess.
const root = process.cwd();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: { root },
  outputFileTracingRoot: root,
  outputFileTracingIncludes: {
    // The sample firewall ships with the app so "use the sample" works when it's deployed.
    "/api/samples": ["./samples/**/*"],
    // The review agent's IDs, read at runtime when they come from the lock file rather than FGT_REVIEW_* variables.
    "/**": ["./claude-lock.json"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // The microphone is for talking to the engineer. Nothing else.
          { key: "Permissions-Policy", value: "geolocation=(), camera=(), microphone=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
