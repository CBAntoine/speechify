// `npm run doctor`: what's connected and working, with free checks only.
const cfg = await import("../src/config.ts");
const { hasFfmpeg } = await import("../src/providers/ffmpeg.ts");
const { browserAvailable, closeBrowser } = await import("../src/providers/browser.ts");
const { elevenCredits, elevenJson } = await import("../src/providers/eleven.ts");
const { getSettings } = await import("../src/db.ts");
const { atlasAgentId, toolMode } = await import("../src/voice/sync.ts");

const line = (okv: boolean | undefined, name: string, note = "") => console.log(`  ${okv === undefined ? "–" : okv ? "✓" : "✗"} ${name.padEnd(22)} ${note}`);
const s = getSettings();
console.log(`\nMainstreet doctor — ${cfg.DEMO ? "DEMO mode" : "LIVE mode"} · data in ${cfg.DATA_DIR}\n`);

async function check(url: string, headers: Record<string, string>): Promise<string> {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    return r.ok ? "ok" : `HTTP ${r.status}`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

if (cfg.keys.anthropic) {
  const r = await check(`https://api.anthropic.com/v1/models/${cfg.CLAUDE_MODEL}`, { "x-api-key": cfg.keys.anthropic, "anthropic-version": "2023-06-01" });
  line(r === "ok", "Claude", r === "ok" ? cfg.CLAUDE_MODEL : r);
} else line(false, "Claude", "ANTHROPIC_API_KEY missing: the crew writes from templates");
line(Boolean(cfg.keys.google), "Google Places", cfg.keys.google ? "key set (checked on the first scan)" : "GOOGLE_PLACES_API_KEY missing: demo businesses only");
if (cfg.keys.eleven) {
  const c = await elevenCredits(true);
  line(Boolean(c), "ElevenLabs", c ? `${c.tier ?? ""} plan, ${c.remaining.toLocaleString()} characters left` : "key rejected or unreachable");
  const id = atlasAgentId();
  if (id) {
    const a = await elevenJson("GET", `/v1/convai/agents/${id}`).then(() => "ok", (e: Error) => e.message);
    line(a === "ok", "Atlas (voice agent)", a === "ok" ? `${id} · ${toolMode()} tools` : a);
  } else line(false, "Atlas (voice agent)", "not created yet: npm run voice:sync");
} else line(false, "ElevenLabs", "ELEVENLABS_API_KEY missing: no voiceovers, hero images or Atlas");
if (cfg.keys.resend) {
  const r = await check("https://api.resend.com/domains", { authorization: `Bearer ${cfg.keys.resend}` });
  line(r === "ok" && Boolean(cfg.MAIL_FROM), "Resend email", r !== "ok" ? r : cfg.MAIL_FROM ? `from ${cfg.MAIL_FROM}` : "set MAIL_FROM");
} else line(false, "Resend email", "RESEND_API_KEY missing: emails go to data/outbox only");
if (cfg.keys.stripe) {
  const r = await check("https://api.stripe.com/v1/balance", { authorization: `Bearer ${cfg.keys.stripe}` });
  line(r === "ok", "Stripe", r === "ok" ? (cfg.keys.stripe.startsWith("sk_test") ? "test mode" : "live") : r);
} else line(undefined, "Stripe", "optional: without it, 'Claim' asks you to send an invoice");
line(await hasFfmpeg(), "FFmpeg", "videos");
const br = await browserAvailable();
line(br.ok, "Headless browser", br.ok ? br.how : br.error);
await closeBrowser();
line(cfg.hasPublicUrl(), "Public URL", cfg.hasPublicUrl() ? cfg.PUBLIC_URL : "PUBLIC_URL not set: proposal links only work on this computer");
line(Boolean(s.owner.postalAddress), "Postal address", s.owner.postalAddress || "add it in Settings (required on every email)");
line(Boolean(cfg.APP_PASSWORD) || cfg.HOST === "127.0.0.1", "Sign-in", cfg.APP_PASSWORD ? "APP_PASSWORD set" : `no password (fine on ${cfg.HOST})`);
line(Boolean(cfg.keys.mcp), "MCP endpoint", cfg.keys.mcp ? "/mcp is on" : "optional: set MCP_TOKEN to control the business from Claude");
console.log("");
process.exit(0);
