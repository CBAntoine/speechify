// Makes a 90-second fake gameplay VOD to try the factory without a real stream:
// scene cuts, a HUD, a facecam, a talking streamer (synthesised with FFmpeg's
// flite voice), hype moments, explosions and stretches of dead air. It also
// writes a matching .srt, which the factory uses as the transcript when no
// Whisper engine is installed.
//
//   npm run demo-vod -- [--out file.mp4] [--face portrait.jpg] [--prop object.png] [--scenes a.jpg,b.jpg,...] [--hd]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { values } = parseArgs({
  options: {
    out: { type: "string" },
    face: { type: "string" },
    prop: { type: "string" },
    scenes: { type: "string" },
    hd: { type: "boolean" },
  },
});
const out = path.resolve(values.out ?? path.join(root, "workspace", "demo", "demo-vod.mp4"));
const dir = path.dirname(out);
const tmp = path.join(dir, ".demo-tmp");
fs.mkdirSync(tmp, { recursive: true });
const font = path.join(root, "assets", "fonts", "Anton-Regular.ttf");
const [W, H] = values.hd ? [1920, 1080] : [1280, 720];
const k = W / 1280;

function ff(args, what) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) {
    console.error(`ffmpeg failed: ${what}`);
    process.exit(1);
  }
}
function duration(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  return Number(r.stdout.trim());
}

// What the streamer says: [start, text, loud?]
const LINES = [
  [1.0, "Okay chat, welcome back. Today we are robbing the biggest bank in the whole city.", false],
  [9.5, "Alright, here is the plan. We go in fast, we grab the money, and we get out.", false],
  [19.0, "Wait. Do you hear that?", false],
  [23.0, "No way! Did you see that? That was insane!", true],
  [27.6, "Oh my god, the whole building just blew up!", true],
  [34.0, "Run, run, run! The cops are right behind us! Go, go, go!", true],
  [39.2, "Get in the car, get in the car!", true],
  [44.0, "Okay. Okay. We are safe now. That was so close.", false],
  [53.0, "Look at this bike. Let's go! Full send!", true],
  [58.5, "Watch this jump. Three, two, one.", false],
  [62.4, "Oh no! We crashed! I can not believe it. Ha ha ha.", true],
  [68.0, "Chat, that has to be the best fail of the whole stream.", false],
  [77.0, "Alright, let us count the money. Thirteen thousand dollars. Not bad.", false],
  [84.0, "Thanks for watching, chat. Subscribe for more heists.", false],
];
const TOTAL = 92;
const BOOMS = [22.4, 62.3];
const CUTS = [0, 22.4, 40, 62.3, 76, TOTAL];

console.log("Synthesising the streamer's voice…");
const lineFiles = LINES.map(([, text], i) => {
  const f = path.join(tmp, `line${i}.wav`);
  const safe = String(text).replace(/[':\\]/g, "");
  ff(["-f", "lavfi", "-i", `flite=text='${safe}':voice=kal16`, "-ar", "48000", "-ac", "1", f], `line ${i}`);
  return f;
});
const srt = LINES.map(([start, text], i) => {
  const end = Number(start) + duration(lineFiles[i]);
  const ts = (s) => {
    const ms = Math.round(s * 1000);
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const sec = Math.floor((ms % 60000) / 1000);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  };
  return `${i + 1}\n${ts(Number(start))} --> ${ts(end)}\n${text}\n`;
});
fs.writeFileSync(out.replace(/\.mp4$/, ".srt"), srt.join("\n"));

console.log("Mixing game audio…");
const audioIn = lineFiles.flatMap((f) => ["-i", f]);
const parts = [];
const labels = [];
LINES.forEach(([start, , loud], i) => {
  const ms = Math.round(Number(start) * 1000);
  parts.push(`[${i}:a]volume=${loud ? 2.4 : 1.1},adelay=${ms}:all=1[l${i}]`);
  labels.push(`[l${i}]`);
});
// A quiet game bed the whole way through, explosions, an engine.
parts.push(`anoisesrc=d=${TOTAL}:c=pink:a=0.02,lowpass=f=2500[bed]`);
labels.push("[bed]");
BOOMS.forEach((t, i) => {
  parts.push(`anoisesrc=d=2.5:c=brown:a=0.95,afade=t=out:st=0.15:d=2.3,lowpass=f=700,volume=2,adelay=${Math.round(t * 1000)}:all=1[b${i}]`);
  labels.push(`[b${i}]`);
});
parts.push(`sine=f=62:d=9,tremolo=f=9:d=0.8,volume=0.35,adelay=53000:all=1[eng]`);
labels.push("[eng]");
parts.push(`${labels.join("")}amix=inputs=${labels.length}:normalize=0:duration=longest,alimiter=limit=0.9,atrim=0:${TOTAL}[a]`);
const audio = path.join(tmp, "audio.wav");
ff([...audioIn, "-filter_complex", parts.join(";"), "-map", "[a]", "-ac", "2", "-ar", "48000", audio], "audio mix");

console.log("Rendering gameplay, HUD and facecam…");
const scenes = (values.scenes ?? "").split(",").filter(Boolean).map((p) => path.resolve(p));
const vIn = [];
const vf = [];
let n = 0;
for (let i = 0; i < CUTS.length - 1; i++) {
  const len = CUTS[i + 1] - CUTS[i];
  const img = scenes.length ? scenes[i % scenes.length] : null;
  if (img) {
    vIn.push("-loop", "1", "-framerate", "30", "-t", String(len), "-i", img);
    // Pan across a blown-up still; shake after an explosion.
    const shake = BOOMS.some((b) => Math.abs(b - CUTS[i]) < 0.5) ? `+${Math.round(18 * k)}*sin(t*43)*exp(-t*1.2)` : "";
    vf.push(`[${n}:v]scale=${Math.round(W * 1.6)}:${Math.round(H * 1.6)}:force_original_aspect_ratio=increase,crop=${W}:${H}:x='(in_w-${W})*t/${len}${shake}':y='(in_h-${H})/2${shake}',setsar=1,fps=30,format=yuv420p[s${i}]`);
  } else {
    const LAVFI = [
      `mandelbrot=s=${W}x${H}:r=30`,
      `cellauto=s=${W}x${H}:rule=110:r=30`,
      `testsrc2=s=${W}x${H}:r=30`,
      `life=s=${W}x${H}:mold=10:ratio=0.1:death_color=#1a1a40:life_color=#ff3d6e:r=30`,
      `mandelbrot=s=${W}x${H}:end_scale=0.5:r=30`,
    ];
    vIn.push("-f", "lavfi", "-t", String(len), "-i", LAVFI[i % LAVFI.length]);
    vf.push(`[${n}:v]scale=${W}:${H},setsar=1,fps=30,format=yuv420p[s${i}]`);
  }
  n++;
}
vf.push(`${CUTS.slice(0, -1).map((_, i) => `[s${i}]`).join("")}concat=n=${CUTS.length - 1}:v=1:a=0[bg]`);
let last = "[bg]";
if (values.prop) {
  vIn.push("-loop", "1", "-framerate", "30", "-t", String(TOTAL), "-i", path.resolve(values.prop));
  const pw = Math.round(440 * k);
  vf.push(`[${n}:v]scale=${pw}:-2,setsar=1[prop]`);
  // The object rides across the screen during the chase and the jump.
  vf.push(`${last}[prop]overlay=x='if(between(t,40,62.3),-${pw}+(t-40)*${Math.round(70 * k)},-2000)':y=${Math.round(H * 0.38)}:eval=frame[wp]`);
  last = "[wp]";
  n++;
}
const camW = Math.round(400 * k);
const camH = Math.round(300 * k);
const border = Math.max(2, Math.round(3 * k));
if (values.face) {
  vIn.push("-loop", "1", "-framerate", "30", "-t", String(TOTAL), "-i", path.resolve(values.face));
  vf.push(`[${n}:v]scale=${camW * 1.25}:-2,crop=${camW}:${camH}:(in_w-${camW})/2:${Math.round(10 * k)},noise=alls=7:allf=t,pad=${camW + 2 * border}:${camH + 2 * border}:${border}:${border}:white,setsar=1[cam]`);
  n++;
} else {
  vIn.push("-f", "lavfi", "-t", String(TOTAL), "-i", `color=c=#2a2a3a:s=${camW}x${camH}:r=30`);
  vf.push(`[${n}:v]drawtext=fontfile='${font}':text='CAM':fontcolor=white:fontsize=${Math.round(60 * k)}:x=(w-text_w)/2:y=(h-text_h)/2,pad=${camW + 2 * border}:${camH + 2 * border}:${border}:${border}:white,setsar=1[cam]`);
  n++;
}
const pad = Math.round(24 * k);
vf.push(`${last}[cam]overlay=x=${pad}:y=H-h-${pad}[wc]`);
vf.push(
  `[wc]drawtext=fontfile='${font}':text='%{eif\\:4*3600+16*60+19-t\\:d}':fontcolor=#ff4a5a:fontsize=${Math.round(54 * k)}:borderw=3:bordercolor=black:x=${pad}:y=${pad},` +
    `drawtext=fontfile='${font}':text='$13,812':fontcolor=#3dff6a:fontsize=${Math.round(54 * k)}:borderw=3:bordercolor=black:x=w-text_w-${pad}:y=${pad}[v]`,
);
ff([...vIn, "-i", audio, "-filter_complex", vf.join(";"), "-map", "[v]", "-map", `${n}:a`, "-t", String(TOTAL), "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out], "video");
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nDemo VOD: ${out}\nCaptions: ${out.replace(/\.mp4$/, ".srt")}\n\nTry it:  npm run factory -- "${out}"\n`);
