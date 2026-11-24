// The clipping business from the terminal, for an always-on machine.
//
//   npm run autopilot              run the autopilot until Ctrl+C (scan, clip, post, track)
//   npm run autopilot -- --scout   rank your creators, suggest new ones, and exit
//   npm run autopilot -- --stats   refresh view counts, print earnings, and exit
//
// Set it up in the dashboard (npm run dev → Business): creators, campaigns,
// accounts and the autopilot switch. Only one process runs the autopilot at a
// time, so stop the dashboard's server (or set CF_AUTOPILOT=off there) first.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.env.CF_ROOT ??= root;

const { values } = parseArgs({ options: { scout: { type: "boolean" }, stats: { type: "boolean" }, language: { type: "string" } } });

const { compactNum, earnings, PLATFORM_NAME } = await import("../src/lib/biz.ts");
const { biz, saveBizNow } = await import("../src/server/biz/store.ts");

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const pink = (s: string) => `\x1b[38;5;204m${s}\x1b[0m`;
const lime = (s: string) => `\x1b[38;5;155m${s}\x1b[0m`;
const amber = (s: string) => `\x1b[38;5;214m${s}\x1b[0m`;

if (values.scout) {
  const { discover, scoutTracked } = await import("../src/server/biz/scout.ts");
  console.log(`\n${pink("WHO TO CLIP")}  your creators, best first\n`);
  for (const o of await scoutTracked()) {
    const tag = o.blocked ? amber(o.blocked) : lime("ready");
    console.log(`${String(o.score).padStart(3)}  ${o.creatorName.padEnd(22)} ${o.platform.padEnd(8)} ${tag}`);
    for (const r of o.reasons) console.log(dim(`       ${r}`));
  }
  const sug = await discover({ language: values.language });
  console.log(`\n${pink("WORTH A LOOK")}  not tracked yet\n`);
  for (const s of sug.slice(0, 20)) console.log(`${s.name.padEnd(24)} ${s.platform.padEnd(8)} ${dim(s.reasons.join(" · "))}${s.campaignId ? lime("  campaign on file") : ""}`);
  saveBizNow();
  process.exit(0);
}

if (values.stats) {
  const { refreshStats } = await import("../src/server/biz/autopilot.ts");
  await refreshStats();
  const d = biz();
  const e = earnings(d.posts, d.campaigns, d.creators);
  console.log(`\n${pink("EARNINGS")}  ${e.total.posts} posts · ${compactNum(e.total.views)} views · ${lime(`$${e.total.usd.toFixed(2)}`)} earned${e.total.paid ? ` · $${e.total.paid.toFixed(2)} paid` : ""}\n`);
  for (const r of e.byCampaign) console.log(`${r.label.padEnd(28)} ${String(r.posts).padStart(4)} posts ${compactNum(r.views).padStart(7)} views  $${r.usd.toFixed(2)}`);
  if (e.submit.length) {
    console.log(`\n${amber(`${e.submit.length} posts to submit:`)}`);
    for (const s of e.submit) console.log(`  ${s.campaign.name}: ${s.post.url ?? s.post.remoteId} (${compactNum(s.post.views)} views, $${s.usd.toFixed(2)})${s.campaign.url ? dim(`  → ${s.campaign.url}`) : ""}`);
  }
  saveBizNow();
  process.exit(0);
}

// Run: the job pipeline in this process, and the autopilot's timer.
const { installRunner } = await import("../src/server/pipeline/run.ts");
installRunner();
const { releaseLock, runningElsewhere, startAutopilot } = await import("../src/server/biz/autopilot.ts");
if (runningElsewhere()) {
  console.log(`\n${pink("✕")} The autopilot is already running in another process (the dashboard's server?). Stop it, or set CF_AUTOPILOT=off there.\n`);
  process.exit(1);
}
const d0 = biz();
console.log(`\n${pink("CLIP FACTORY")} autopilot  ${d0.autopilot.enabled ? lime("on") : amber("off (turn it on in the dashboard to scan; scheduled posts still go out)")}`);
console.log(dim(`${d0.creators.length} creators · ${d0.campaigns.filter((k) => k.status === "active").length} active campaigns · ${d0.accounts.map((a) => `${a.name} (${PLATFORM_NAME[a.platform]})`).join(", ") || "no accounts"}\n`));
let shown = d0.status.log.length;
const timer = setInterval(() => {
  const log = biz().status.log;
  if (log.length < shown) shown = 0;
  for (const l of log.slice(shown)) console.log(`${dim(new Date(l.t).toLocaleTimeString())} ${l.level === "warn" ? amber(l.msg) : l.msg}`);
  shown = log.length;
}, 2000);
startAutopilot();
const stop = () => {
  clearInterval(timer);
  saveBizNow();
  releaseLock();
  console.log(dim("\nStopped."));
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
// Keep the process alive (the autopilot's own timer doesn't).
setInterval(() => {}, 1 << 30);
