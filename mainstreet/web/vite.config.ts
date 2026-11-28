import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dashboard. `npm run build` writes web/dist, which the server serves.
// In development (`npm run dev`) Vite proxies the API, files and public
// pages to the server.
const root = fileURLToPath(new URL(".", import.meta.url));
const target = `http://localhost:${process.env.PORT || 8787}`;
const proxied = ["/api", "/files", "/p", "/u", "/live", "/webhooks", "/mcp"];

export default defineConfig({
  root,
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: Number(process.env.WEB_PORT || 5173),
    proxy: Object.fromEntries(
      proxied.map((p) => [
        p,
        {
          target,
          changeOrigin: true,
          // Server-Sent Events: keep the connection open and unbuffered.
          configure: (proxy) => {
            proxy.on("proxyRes", (res) => {
              if (String(res.headers["content-type"] || "").includes("text/event-stream")) res.headers["cache-control"] = "no-cache, no-transform";
            });
          },
        },
      ]),
    ),
  },
});
