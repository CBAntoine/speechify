// `npm run voice:sync`: create or update Atlas in your ElevenLabs workspace.
const { syncAtlas } = await import("../src/voice/sync.ts");
const { elevenEnabled } = await import("../src/providers/eleven.ts");
if (!elevenEnabled()) {
  console.error("Add ELEVENLABS_API_KEY to .env first.");
  process.exit(1);
}
try {
  const r = await syncAtlas();
  console.log(`\n  ${r.created ? "Created" : "Updated"} Atlas (${r.agentId}) with ${r.tools} ${r.mode} tools.`);
  console.log(`  Put ELEVENLABS_AGENT_ID=${r.agentId} in .env to pin it.`);
  console.log(r.mode === "client" ? "  Talk to Atlas from the dashboard (the orb). Set PUBLIC_URL and sync again to call it by phone.\n" : "  Atlas can now run tools from phone calls too (OWNER_PHONES must list your number).\n");
  process.exit(0);
} catch (err) {
  console.error(`\n  Sync failed: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
}
