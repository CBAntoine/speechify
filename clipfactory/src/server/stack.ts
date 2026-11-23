import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TOOLS, type StackItem, type StackReport, type ToolId } from "../lib/types.ts";
import { claudeEnabled, claudeModel } from "./pipeline/claude.ts";
import { PY_DIR, pythonExe, TOOLS_DIR, WORKSPACE } from "./paths.ts";
import { run, which } from "./proc.ts";

interface PyDoctor {
  python?: string;
  modules: Record<string, string | null>;
  models: { face: boolean; selfie: boolean; yolo: boolean; sam2: boolean };
  cuda?: boolean;
  gpu?: string | null;
  mps?: boolean;
}

export interface Machine {
  report: StackReport;
  py: PyDoctor;
  bins: Record<string, string | null>;
  ffmpegHasLibass: boolean;
  /** zscale + tonemap, for HDR sources. */
  ffmpegToneMap: boolean;
  ytdlp: string[] | null;
  autoEditor: string[] | null;
  deepFilter: string[] | null;
  losslessCut: string | null;
  /** Real-ESRGAN / RIFE ncnn builds: the binary and its model folder. */
  esrgan: { bin: string; models: string } | null;
  rife: { bin: string; model: string } | null;
  cuda: boolean;
}

const g = globalThis as unknown as { __cfStack?: { at: number; machine: Promise<Machine> } };
const TTL = 10 * 60 * 1000;

/** What's installed on this machine. Cached for ten minutes; `fresh` re-checks. */
export function machine(fresh = false): Promise<Machine> {
  if (!fresh && g.__cfStack && Date.now() - g.__cfStack.at < TTL) return g.__cfStack.machine;
  const p = detect();
  g.__cfStack = { at: Date.now(), machine: p };
  p.catch(() => {
    if (g.__cfStack?.machine === p) g.__cfStack = undefined;
  });
  return p;
}

async function firstLine(cmd: string, args: string[]): Promise<string | undefined> {
  try {
    const r = await run(cmd, args, { timeoutMs: 20000, allowFail: true });
    return (r.stdout || r.stderr).trim().split(/\r?\n/)[0];
  } catch {
    return undefined;
  }
}

/** Find an executable by name anywhere under tools/ (release zips nest folders). */
function findTool(name: string): string | null {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const walk = (dir: string, depth: number): string | null => {
    if (depth > 3 || !fs.existsSync(dir)) return null;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isFile() && e.name === exe) return p;
      if (e.isDirectory()) {
        const hit = walk(p, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  };
  return which(name) ?? walk(TOOLS_DIR, 0);
}

function findLosslessCut(): string | null {
  const onPath = which("losslesscut") || which("LosslessCut");
  if (onPath) return onPath;
  const candidates =
    process.platform === "darwin"
      ? ["/Applications/LosslessCut.app", path.join(os.homedir(), "Applications/LosslessCut.app")]
      : process.platform === "win32"
        ? [path.join(process.env.LOCALAPPDATA || "", "Programs", "LosslessCut", "LosslessCut.exe")]
        : [path.join(os.homedir(), "Applications", "LosslessCut.AppImage")];
  return candidates.find((c) => c && fs.existsSync(c)) ?? null;
}

async function detect(): Promise<Machine> {
  const ffmpegVersion = await firstLine("ffmpeg", ["-version"]);
  let ffmpegHasLibass = false;
  let ffmpegToneMap = false;
  if (ffmpegVersion) {
    const r = await run("ffmpeg", ["-hide_banner", "-filters"], { allowFail: true });
    ffmpegHasLibass = /\bsubtitles\b/.test(r.stdout);
    ffmpegToneMap = /\bzscale\b/.test(r.stdout) && /\btonemap\b/.test(r.stdout);
  }

  let py: PyDoctor = { modules: {}, models: { face: false, selfie: false, yolo: false, sam2: false } };
  try {
    const r = await run(pythonExe(), [path.join(PY_DIR, "cf_doctor.py"), "--gpu"], { timeoutMs: 60000 });
    py = JSON.parse(r.stdout.trim().split(/\r?\n/).pop() || "{}") as PyDoctor;
  } catch {
    /* no Python: every Python step uses its built-in equivalent */
  }
  const mod = (name: string) => py.modules?.[name] ?? null;

  const bins: Record<string, string | null> = {};
  for (const b of ["yt-dlp", "auto-editor", "deep-filter", "deepFilter"]) bins[b] = which(b);
  for (const b of ["realesrgan-ncnn-vulkan", "rife-ncnn-vulkan"]) bins[b] = findTool(b);

  const ytdlp = bins["yt-dlp"] ? [bins["yt-dlp"]!] : mod("yt_dlp") ? [pythonExe(), "-m", "yt_dlp"] : null;
  const autoEditor = bins["auto-editor"] ? [bins["auto-editor"]!] : null;
  // The standalone Rust build ("deep-filter") or the Python package ("deepFilter").
  const deepFilter = bins["deep-filter"] ? [bins["deep-filter"]!, "-D"] : bins.deepFilter ? [bins.deepFilter] : null;
  const esrgan = bins["realesrgan-ncnn-vulkan"] ? { bin: bins["realesrgan-ncnn-vulkan"]!, models: path.join(path.dirname(bins["realesrgan-ncnn-vulkan"]!), "models") } : null;
  const rife = bins["rife-ncnn-vulkan"] ? { bin: bins["rife-ncnn-vulkan"]!, model: path.join(path.dirname(bins["rife-ncnn-vulkan"]!), "rife-v4.6") } : null;
  const losslessCut = findLosslessCut();
  const versions = {
    ytdlp: ytdlp ? await firstLine(ytdlp[0], [...ytdlp.slice(1), "--version"]) : undefined,
    autoEditor: autoEditor ? await firstLine(autoEditor[0], ["--version"]) : undefined,
  };
  const cuda = Boolean(py.cuda);
  const claude = claudeEnabled();

  const item = (id: ToolId, available: boolean, engine: string, extra: Partial<StackItem> = {}): StackItem => ({ id, available, engine, ...extra });
  const pyInstall = "npm run setup";
  const items: Record<ToolId, StackItem> = {
    ytdlp: item("ytdlp", Boolean(ytdlp), ytdlp ? `yt-dlp ${versions.ytdlp ?? ""}`.trim() : "Direct download (plain video links only)", { version: versions.ytdlp, install: pyInstall }),
    scenedetect: item("scenedetect", Boolean(mod("scenedetect")), mod("scenedetect") ? `PySceneDetect ${mod("scenedetect")}` : "FFmpeg scene filter", { version: mod("scenedetect") ?? undefined, install: pyInstall }),
    whisperx: item(
      "whisperx",
      Boolean(mod("whisperx")),
      mod("whisperx") ? "WhisperX" : mod("faster_whisper") ? "faster-whisper" : mod("whisper") ? "Whisper" : "Platform captions or sidecar subtitles only",
      { version: mod("whisperx") ?? undefined, install: "npm run setup -- --full", detail: cuda ? "GPU" : "CPU (base model)" },
    ),
    shortsgen: item("shortsgen", claude, claude ? `Claude (${claudeModel()})` : "Loudness + hype-word scorer", { install: "Set ANTHROPIC_API_KEY in .env.local" }),
    autoeditor: item("autoeditor", Boolean(autoEditor), autoEditor ? `auto-editor ${versions.autoEditor ?? ""}`.trim() : "FFmpeg silencedetect", { version: versions.autoEditor, install: pyInstall }),
    mediapipe: item(
      "mediapipe",
      Boolean(mod("mediapipe") && py.models.face),
      mod("mediapipe") && py.models.face ? `MediaPipe ${mod("mediapipe")}` : mod("cv2") ? "OpenCV face cascade" : "No face detection (centre crop)",
      { version: mod("mediapipe") ?? undefined, install: pyInstall },
    ),
    yolo: item("yolo", Boolean(mod("ultralytics")), mod("ultralytics") ? `Ultralytics ${mod("ultralytics")}` : mod("cv2") ? "Motion tracking (OpenCV)" : "Static centre crop", {
      version: mod("ultralytics") ?? undefined,
      install: "npm run setup -- --full",
    }),
    sam2: item(
      "sam2",
      Boolean(mod("sam2") && py.models.sam2),
      mod("sam2") && py.models.sam2 ? "SAM 2.1" : mod("mediapipe") && py.models.selfie ? "MediaPipe selfie segmenter" : "Unavailable (cutout layout off)",
      { install: "npm run setup -- --sam2" },
    ),
    demucs: item("demucs", Boolean(mod("demucs")), mod("demucs") ? `Demucs ${mod("demucs")}` : "Original mix", { version: mod("demucs") ?? undefined, install: "npm run setup -- --full" }),
    deepfilter: item("deepfilter", Boolean(deepFilter), deepFilter ? (bins["deep-filter"] ? "DeepFilterNet 0.5.6 (deep-filter)" : `DeepFilterNet ${mod("df") ?? ""}`.trim()) : "FFmpeg afftdn", { install: "npm run setup" }),
    f5tts: item("f5tts", Boolean(mod("f5_tts")), mod("f5_tts") ? `F5-TTS ${mod("f5_tts")}` : "Unavailable (dubbing off)", { install: "npm run setup -- --dub" }),
    remotion: item("remotion", false, ffmpegHasLibass ? "libass captions via FFmpeg" : "No captions (FFmpeg lacks libass)", { detail: "Same word-timed look, rendered without a browser" }),
    moviepy: item("moviepy", Boolean(mod("moviepy")), mod("moviepy") ? `MoviePy ${mod("moviepy")}` : "FFmpeg drawtext", { install: pyInstall }),
    losslesscut: item("losslesscut", Boolean(losslessCut), losslessCut ? "FFmpeg stream copy + LosslessCut project" : "FFmpeg stream copy + .llc project", { detail: losslessCut ?? undefined }),
    opencut: item("opencut", false, "Posting order + EDL sequence", { detail: process.env.OPENCUT_URL || undefined }),
    esrgan: item("esrgan", Boolean(esrgan), esrgan ? "Real-ESRGAN ncnn (Vulkan)" : "Lanczos + sharpen", { install: "npm run setup -- --full" }),
    rife: item("rife", Boolean(rife), rife ? "RIFE v4.6 ncnn (Vulkan)" : "FFmpeg minterpolate", { install: "npm run setup -- --full" }),
    ffmpeg: item("ffmpeg", Boolean(ffmpegVersion), ffmpegVersion ? ffmpegVersion.replace(/^ffmpeg version (\S+).*/, "FFmpeg $1") : "Missing: install FFmpeg", {}),
  };

  const report: StackReport = {
    checkedAt: Date.now(),
    python: py.python,
    ffmpeg: ffmpegVersion,
    gpu: py.gpu ?? (py.mps ? "Apple GPU (MPS)" : undefined),
    claude: { enabled: claude, model: claudeModel() },
    items,
    stars: readStars(),
  };
  void refreshStars();
  return { report, py, bins, ffmpegHasLibass, ffmpegToneMap, ytdlp, autoEditor, deepFilter, losslessCut, esrgan, rife, cuda };
}

// ── GitHub stars (for the header's "753K★"), cached for a day ───────────

const STARS_FILE = path.join(WORKSPACE, ".cache", "stars.json");

function readStars(): Partial<Record<ToolId, number>> {
  try {
    const raw = JSON.parse(fs.readFileSync(STARS_FILE, "utf8")) as { at: number; stars: Partial<Record<ToolId, number>> };
    return raw.stars;
  } catch {
    return {};
  }
}

let starsInFlight = false;
async function refreshStars() {
  if (starsInFlight || process.env.CF_NO_STARS) return;
  try {
    const st = fs.statSync(STARS_FILE);
    if (Date.now() - st.mtimeMs < 24 * 3600 * 1000) return;
  } catch {
    /* never fetched */
  }
  starsInFlight = true;
  try {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "clip-factory" };
    if (process.env.CF_GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.CF_GITHUB_TOKEN}`;
    const stars: Partial<Record<ToolId, number>> = { ...readStars() };
    await Promise.all(
      TOOLS.map(async (t) => {
        const res = await fetch(`https://api.github.com/repos/${t.repo}`, { headers, signal: AbortSignal.timeout(10000) });
        if (!res.ok) return;
        const body = (await res.json()) as { stargazers_count?: number };
        if (typeof body.stargazers_count === "number") stars[t.id] = body.stargazers_count;
      }),
    );
    if (Object.keys(stars).length) {
      fs.mkdirSync(path.dirname(STARS_FILE), { recursive: true });
      fs.writeFileSync(STARS_FILE, JSON.stringify({ at: Date.now(), stars }));
      if (g.__cfStack) {
        const m = await g.__cfStack.machine;
        m.report.stars = stars;
      }
    }
  } catch {
    /* offline: no stars */
  } finally {
    starsInFlight = false;
  }
}

