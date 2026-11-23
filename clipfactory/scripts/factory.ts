// Clip Factory from the terminal.
//
//   npm run factory -- <url-or-file> [options]
//   npm run doctor
//
// Options: --count 6  --min 15  --max 45  --layout auto|split|crop|fit|cutout
//          --style pop|karaoke|clean  --no-captions  --no-hook  --keep-silence
//          --no-denoise  --no-stems  --dub es,de,ja  --upscale auto|4k|off
//          --no-slowmo  --name NAME  --lang en  --direction "only the funny fails"
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.env.CF_ROOT ??= root;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    count: { type: "string" },
    min: { type: "string" },
    max: { type: "string" },
    layout: { type: "string" },
    style: { type: "string" },
    "no-captions": { type: "boolean" },
    "no-hook": { type: "boolean" },
    "keep-silence": { type: "boolean" },
    "no-denoise": { type: "boolean" },
    "no-stems": { type: "boolean" },
    dub: { type: "string" },
    upscale: { type: "string" },
    "no-slowmo": { type: "boolean" },
    name: { type: "string" },
    lang: { type: "string" },
    direction: { type: "string" },
    doctor: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

const { TOOLS, STAGES } = await import("../src/lib/types.ts");
const { machine } = await import("../src/server/stack.ts");

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const pink = (s: string) => `\x1b[38;5;204m${s}\x1b[0m`;
const lime = (s: string) => `\x1b[38;5;155m${s}\x1b[0m`;
const amber = (s: string) => `\x1b[38;5;214m${s}\x1b[0m`;

if (values.help) {
  console.log("Usage: npm run factory -- <url-or-file> [--count 6] [--min 15] [--max 45] [--layout auto] [--dub es,de] [--upscale auto|4k|off] ...");
  process.exit(0);
}

if (values.doctor || !positionals.length) {
  const m = await machine(true);
  const r = m.report;
  console.log(`\n${pink("CLIP FACTORY")} /18   python ${r.python ?? "missing"} · ${r.ffmpeg?.split(" ").slice(0, 3).join(" ") ?? "ffmpeg missing"} · ${r.gpu ?? "CPU only"}`);
  console.log(`Orchestrator: ${r.claude.enabled ? lime(`Claude (${r.claude.model})`) : amber("built-in scorer (set ANTHROPIC_API_KEY for Claude)")}\n`);
  for (const t of TOOLS) {
    const it = r.items[t.id];
    const mark = it.available ? lime("●") : amber("○");
    console.log(`${mark} ${String(t.n).padStart(2, "0")} ${t.name.padEnd(20)} ${it.engine}${!it.available && it.install ? dim(`  → ${it.install}`) : ""}`);
  }
  console.log(dim("\n● the repo itself runs   ○ a built-in equivalent runs instead\n"));
  if (!positionals.length && !values.doctor) console.log("Make shorts: npm run factory -- <url-or-file>\n");
  process.exit(0);
}

const { createJob, getJob, subscribe, saveNow } = await import("../src/server/jobs.ts");
const { runPipeline } = await import("../src/server/pipeline/run.ts");

const input = positionals[0];
const isUrl = /^https?:\/\//i.test(input);
const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));
const opts = Object.fromEntries(
  Object.entries({
    url: isUrl ? input : undefined,
    file: isUrl ? undefined : path.resolve(input),
    name: values.name,
    count: num(values.count),
    minSec: num(values.min),
    maxSec: num(values.max),
    layout: values.layout,
    captionStyle: values.style,
    captions: values["no-captions"] ? false : undefined,
    hook: values["no-hook"] ? false : undefined,
    removeSilence: values["keep-silence"] ? false : undefined,
    denoise: values["no-denoise"] ? false : undefined,
    stems: values["no-stems"] ? false : undefined,
    dub: values.dub ? values.dub.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    upscale: values.upscale,
    slowmo: values["no-slowmo"] ? false : undefined,
    language: values.lang,
    instructions: values.direction,
  }).filter(([, v]) => v !== undefined),
);

const job = createJob(opts);
console.log(`\n${pink("CLIP FACTORY")} /18  job ${job.id}\n`);
let stage: string | null = null;
let tool: string | null = null;
const seen = new Set<string>();
const unsub = subscribe(job.id, (s) => {
  if (s.stage !== stage && s.stage) {
    stage = s.stage;
    const st = STAGES.find((x) => x.id === stage)!;
    console.log(`\n${pink(`${String(st.n).padStart(2, "0")} / 06`)} ${st.title} ${dim(`— ${st.blurb}`)}`);
  }
  if (s.activeTool !== tool) {
    tool = s.activeTool;
    if (tool) {
      const t = TOOLS.find((x) => x.id === tool)!;
      const run = s.tools[t.id];
      console.log(`  ${String(t.n).padStart(2, "0")} ${t.verb.padEnd(10)} ${run.mode === "native" ? lime(run.engine ?? t.name) : amber(run.engine ?? t.builtin)}`);
    }
  }
  for (const line of s.log) {
    const key = `${line.t}|${line.msg}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`     ${line.level === "error" ? pink(line.msg) : line.level === "warn" ? amber(line.msg) : dim(line.msg)}`);
  }
});

await runPipeline(job.id);
unsub();
saveNow(job.id);
const done = getJob(job.id)!;
if (done.status !== "done") {
  console.log(`\n${pink("✕")} ${done.error ?? done.status}\n`);
  process.exit(1);
}
console.log(`\n${lime("SHORTS SHIPPED")} ${done.shipped}\n`);
for (const s of [...done.shorts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
  console.log(`  ${lime("✓")} ${s.file}  ${dim(`${s.duration.toFixed(1)} s · score ${s.score} · ${s.hook}`)}${s.qa && !s.qa.ok ? amber(`  QA: ${s.qa.notes.join("; ")}`) : ""}`);
}
console.log(`\n${dim(`Everything is in ${path.join(process.env.CF_WORKSPACE || path.join(root, "workspace"), job.id, "export")}`)}\n`);
process.exit(0);
