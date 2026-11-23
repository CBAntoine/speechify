import fs from "node:fs";
import path from "node:path";

// Next.js runs the server with the app folder as the working directory; the
// CLI sets CF_ROOT from its own location before importing anything.
export const APP_ROOT = path.resolve(/*turbopackIgnore: true*/ process.env.CF_ROOT || process.cwd());

// Plain string joins, not path.join: the bundler statically follows
// path.join(cwd, "…") and would try to pack .venv, models and every job's
// videos into the build. These folders are runtime data.
const under = (...parts: string[]) => [APP_ROOT, ...parts].join(path.sep);

export const WORKSPACE = path.resolve(process.env.CF_WORKSPACE || under("workspace"));
export const PY_DIR = under("py");
export const VENV = under(".venv");
export const TOOLS_DIR = under("tools");
export const TOOLS_BIN = under("tools", "bin");
export const MODELS = under("models");
export const FONTS = under("assets", "fonts");

const WIN = process.platform === "win32";

export function venvBin(): string {
  return [VENV, WIN ? "Scripts" : "bin"].join(path.sep);
}

/** The Python that runs the helper scripts: CF_PYTHON, else the app's .venv, else the system one. */
export function pythonExe(): string {
  if (process.env.CF_PYTHON) return process.env.CF_PYTHON;
  const inVenv = [venvBin(), WIN ? "python.exe" : "python"].join(path.sep);
  if (fs.existsSync(inVenv)) return inVenv;
  return WIN ? "python" : "python3";
}

/** Environment for every child process: the venv and downloaded tools come first on PATH. */
export function childEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const parts = [venvBin(), TOOLS_BIN, process.env.PATH || ""].filter(Boolean);
  return {
    ...process.env,
    PATH: parts.join(path.delimiter),
    PYTHONUNBUFFERED: "1",
    PYTHONWARNINGS: process.env.PYTHONWARNINGS || "ignore::DeprecationWarning,ignore::FutureWarning,ignore::UserWarning",
    PYTHONIOENCODING: "utf-8",
    // Quiet TensorFlow Lite / glog chatter from MediaPipe.
    GLOG_minloglevel: process.env.GLOG_minloglevel || "2",
    TF_CPP_MIN_LOG_LEVEL: process.env.TF_CPP_MIN_LOG_LEVEL || "2",
    // Keep model caches inside the app so `npm run setup` downloads are reused.
    HF_HOME: process.env.HF_HOME || [MODELS, "huggingface"].join(path.sep),
    TORCH_HOME: process.env.TORCH_HOME || [MODELS, "torch"].join(path.sep),
    YOLO_CONFIG_DIR: process.env.YOLO_CONFIG_DIR || [MODELS, "ultralytics"].join(path.sep),
    ...extra,
  };
}

export function jobDir(id: string): string {
  if (!/^[a-z0-9_-]{4,64}$/i.test(id)) throw new Error("Bad job id");
  return path.join(WORKSPACE, id);
}

/** Resolve a path inside a job folder, refusing anything that escapes it. */
export function insideJob(id: string, rel: string): string {
  const root = jobDir(id);
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error("Path escapes the job folder");
  return full;
}

export function rel(id: string, full: string): string {
  return path.relative(jobDir(id), full).split(path.sep).join("/");
}
