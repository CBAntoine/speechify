import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { APP_PASSWORD, DEMO, HOST, PORT, ROOT, features, hasPublicUrl, keys, publicBase } from "./config.ts";
import { mcp } from "./api/mcp.ts";
import { pub } from "./api/public.ts";
import { api } from "./api/routes.ts";
import { hooks } from "./api/webhooks.ts";
import { safeJoin, sendFile } from "./api/files.ts";
import { startCrew, stopCrew } from "./crew/orchestrator.ts";
import { getSettings } from "./db.ts";
import { closeBrowser } from "./providers/browser.ts";
import { elevenEnabled } from "./providers/eleven.ts";
import { atlasAgentId } from "./voice/sync.ts";

// Mainstreet: one process runs the dashboard, the public proposal pages, the
// webhooks, Atlas's tools and the crew's 24/7 loop.

const app = new Hono();
app.route("/", hooks);
app.route("/", mcp);
app.route("/", pub);
app.route("/", api);

const DIST = path.join(ROOT, "web", "dist");
app.get("*", (c) => {
  if (!fs.existsSync(path.join(DIST, "index.html"))) {
    return c.html(`<!doctype html><meta charset="utf-8"><title>Mainstreet</title><body style="font:16px system-ui;padding:40px;max-width:560px">
<h1>Mainstreet is running</h1><p>The dashboard hasn't been built yet. Run <code>npm run build</code> (or <code>npm run dev</code> while developing) and reload.</p></body>`);
  }
  const rel = c.req.path === "/" ? "index.html" : c.req.path.slice(1);
  const file = safeJoin(DIST, rel);
  if (file && fs.existsSync(file) && fs.statSync(file).isFile()) return sendFile(c, file, { cache: rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache" });
  return sendFile(c, path.join(DIST, "index.html"), { cache: "no-cache" });
});

app.onError((err, c) => {
  console.error("[server]", err);
  return c.json({ error: "Something went wrong on the server." }, 500);
});

const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  const s = getSettings();
  const on = (b: boolean) => (b ? "on " : "off");
  console.log(`\n  Mainstreet is running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${info.port}${hasPublicUrl() ? `  (public: ${publicBase()})` : ""}`);
  console.log(`  Mode: ${DEMO ? "DEMO — fictional businesses, nothing is really sent" : "LIVE"}`);
  console.log(`  Claude ${on(features.claude)} · Google Places ${on(features.places)} · ElevenLabs ${on(elevenEnabled())} · Resend ${on(features.resend)} · Stripe ${on(features.stripe)} · Atlas ${atlasAgentId() ? "ready" : "not synced"} · MCP ${on(Boolean(keys.mcp))}\n`);
  if (!APP_PASSWORD && HOST !== "127.0.0.1" && HOST !== "localhost") console.warn("  ⚠  No APP_PASSWORD set and the server is reachable from other machines. Set APP_PASSWORD in .env.\n");
  if (!DEMO && !s.owner.postalAddress) console.warn("  ⚠  Add your postal address in Settings before any email can go out (CAN-SPAM / CASL).\n");
});

if (process.env.CREW !== "off" && !process.argv.includes("--no-crew")) startCrew();

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log("\n  Stopping the crew…");
  stopCrew();
  await closeBrowser().catch(() => undefined);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
