// Installs the open-source stack into this folder (.venv, tools/, models/).
// Every tool is optional: whatever isn't installed falls back to a built-in
// FFmpeg/OpenCV equivalent, and `npm run doctor` shows what runs where.
//
//   npm run setup                 core: yt-dlp, PySceneDetect, faster-whisper, auto-editor,
//                                 MediaPipe (+ face and selfie models), MoviePy, DeepFilterNet
//   npm run setup -- --full       + WhisperX, Ultralytics YOLO, Demucs, Real-ESRGAN, RIFE
//   npm run setup -- --dub        + F5-TTS (dubbing)
//   npm run setup -- --sam2       + SAM 2.1 and its checkpoint (cutout layout)
//   npm run setup -- --all        everything
//   add --cpu to install the smaller CPU-only PyTorch (Linux/Windows without an NVIDIA GPU)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = new Set(process.argv.slice(2));
const all = args.has("--all");
const want = {
  full: all || args.has("--full"),
  dub: all || args.has("--dub"),
  sam2: all || args.has("--sam2"),
  cpu: args.has("--cpu"),
};
const WIN = process.platform === "win32";
const venv = path.join(root, ".venv");
const vbin = path.join(venv, WIN ? "Scripts" : "bin");
const vpy = path.join(vbin, WIN ? "python.exe" : "python");
const tools = path.join(root, "tools");
const models = path.join(root, "models");
const results = [];

const green = (s) => `\x1b[38;5;155m${s}\x1b[0m`;
const amber = (s) => `\x1b[38;5;214m${s}\x1b[0m`;
const pink = (s) => `\x1b[38;5;204m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function sh(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { stdio: opts.quiet ? "pipe" : "inherit", encoding: "utf8", env: { ...process.env, ...opts.env }, cwd: opts.cwd });
  return r.status === 0 ? (r.stdout ?? "") : null;
}
const has = (cmd) => sh(WIN ? "where" : "which", [cmd], { quiet: true }) !== null;

console.log(`\n${pink("CLIP FACTORY")} /18 setup\n`);

// ── FFmpeg is the one hard requirement ──
if (!has("ffmpeg") || !has("ffprobe")) {
  console.log(pink("FFmpeg isn't installed. Install it first:"));
  console.log("  macOS:   brew install ffmpeg\n  Ubuntu:  sudo apt install ffmpeg\n  Windows: winget install Gyan.FFmpeg\n");
  process.exit(1);
}
console.log(green("✓ FFmpeg"));

// ── Python virtual environment ──
const uv = has("uv");
if (!fs.existsSync(vpy)) {
  console.log("Creating .venv …");
  let ok = false;
  if (uv) ok = sh("uv", ["venv", "-p", "3.12", venv]) !== null || sh("uv", ["venv", venv]) !== null;
  if (!ok) {
    for (const py of WIN ? ["py -3.12", "py -3.11", "python"] : ["python3.12", "python3.11", "python3.13", "python3"]) {
      const [cmd, ...rest] = py.split(" ");
      if (!has(cmd)) continue;
      if (sh(cmd, [...rest, "-m", "venv", venv]) !== null) {
        ok = true;
        break;
      }
    }
  }
  if (!ok) {
    console.log(pink("Couldn't create a Python environment. Install Python 3.11 or 3.12 (python.org) and run this again."));
    process.exit(1);
  }
  if (!uv) sh(vpy, ["-m", "pip", "install", "-q", "-U", "pip"]);
}
console.log(green(`✓ Python ${sh(vpy, ["-c", "import sys;print(sys.version.split()[0])"], { quiet: true })?.trim()} in .venv`));

function pip(label, packages, extra = []) {
  console.log(`\n${label}: ${dim(packages.join(" "))}`);
  const ok = uv
    ? sh("uv", ["pip", "install", "--python", vpy, ...extra, ...packages]) !== null
    : sh(vpy, ["-m", "pip", "install", ...extra, ...packages]) !== null;
  results.push([label, ok]);
  return ok;
}

async function download(url, dest, label) {
  if (fs.existsSync(dest)) return true;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  process.stdout.write(`  ↓ ${label} … `);
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    console.log(green("ok"));
    return true;
  } catch (err) {
    console.log(amber(`failed (${err.message})`));
    return false;
  }
}

function unzip(zip, dir) {
  fs.mkdirSync(dir, { recursive: true });
  return sh(vpy, ["-m", "zipfile", "-e", zip, dir], { quiet: true }) !== null;
}

// ── Core ──
pip("Core tools", ["yt-dlp", "scenedetect", "auto-editor", "mediapipe", "moviepy", "faster-whisper"]);
// auto-editor fetches its own binary on first run.
sh(path.join(vbin, WIN ? "auto-editor.exe" : "auto-editor"), ["--version"], { quiet: true });
await download("https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite", path.join(models, "mediapipe", "blaze_face_short_range.tflite"), "MediaPipe face model");
await download("https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite", path.join(models, "mediapipe", "selfie_segmenter.tflite"), "MediaPipe selfie segmenter");

// DeepFilterNet's standalone Rust build: no PyTorch needed.
const arch = os.arch();
const dfAsset =
  process.platform === "linux" && arch === "x64" ? "deep-filter-0.5.6-x86_64-unknown-linux-musl"
  : process.platform === "darwin" ? (arch === "arm64" ? "deep-filter-0.5.6-aarch64-apple-darwin" : "deep-filter-0.5.6-x86_64-apple-darwin")
  : WIN ? "deep-filter-0.5.6-x86_64-pc-windows-msvc.exe"
  : null;
if (dfAsset) {
  const dest = path.join(tools, "bin", WIN ? "deep-filter.exe" : "deep-filter");
  const ok = await download(`https://github.com/Rikorose/DeepFilterNet/releases/download/v0.5.6/${dfAsset}`, dest, "DeepFilterNet (deep-filter)");
  if (ok && !WIN) fs.chmodSync(dest, 0o755);
  results.push(["DeepFilterNet", ok]);
}

// ── Full ──
if (want.full || want.dub || want.sam2) {
  if (want.cpu) pip("PyTorch (CPU)", ["torch", "torchaudio", "torchvision"], ["--index-url", "https://download.pytorch.org/whl/cpu"]);
}
if (want.full) {
  // lap: ByteTrack's matcher, which Ultralytics' tracker imports but doesn't install.
  pip("Ultralytics YOLO", ["ultralytics", "lap"]);
  await download("https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n.pt", path.join(models, "yolo", "yolo11n.pt"), "YOLO11n weights");
  pip("Demucs", ["demucs"]);
  pip("WhisperX", ["whisperx"]);

  // Real-ESRGAN and RIFE: ncnn builds that run on any Vulkan GPU (NVIDIA, AMD, Intel, Apple).
  const plat = process.platform === "darwin" ? "macos" : WIN ? "windows" : process.platform === "linux" && arch === "x64" ? "ubuntu" : null;
  if (plat) {
    for (const [name, url, folder] of [
      ["Real-ESRGAN", `https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-${plat}.zip`, "realesrgan"],
      ["RIFE", `https://github.com/nihui/rife-ncnn-vulkan/releases/download/20221029/rife-ncnn-vulkan-20221029-${plat}.zip`, "rife"],
    ]) {
      const zip = path.join(tools, `${folder}.zip`);
      const dir = path.join(tools, folder);
      let ok = fs.existsSync(dir);
      if (!ok && (await download(url, zip, name))) {
        ok = unzip(zip, dir);
        fs.rmSync(zip, { force: true });
      }
      if (ok && !WIN) {
        // Zips don't keep the executable bit.
        for (const f of walk(dir)) if (/ncnn-vulkan$/.test(f)) fs.chmodSync(f, 0o755);
      }
      results.push([name, ok]);
    }
  } else {
    console.log(amber("Real-ESRGAN and RIFE have no build for this platform; the FFmpeg fallbacks will run."));
  }
}
if (want.dub) pip("F5-TTS", ["f5-tts"]);
if (want.sam2) {
  pip("SAM 2", ["git+https://github.com/facebookresearch/sam2.git"]);
  await download("https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt", path.join(models, "sam2", "sam2.1_hiera_small.pt"), "SAM 2.1 small checkpoint");
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

console.log("");
for (const [label, ok] of results) console.log(`${ok ? green("✓") : amber("✕")} ${label}`);
console.log(`\nSee what runs where: ${green("npm run doctor")}`);
if (!want.full) console.log(dim("For WhisperX, YOLO, Demucs, Real-ESRGAN and RIFE: npm run setup -- --full"));
console.log("");
