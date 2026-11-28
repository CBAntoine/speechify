// Offline voiceover for demo mode (no ElevenLabs key): macOS `say`, or
// espeak-ng / espeak on Linux. Returns false when no engine is installed, and
// the Filmer then makes a captioned video with a silent track.

import { spawn } from "node:child_process";
import { access, constants, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runFfmpeg } from "../providers/ffmpeg.ts";

async function findExecutable(name: string): Promise<string | null> {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      try {
        await access(p, constants.X_OK);
        return p;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

function run(bin: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stderr.on("data", (d: Buffer) => {
      if (err.length < 4000) err += d.toString("utf8");
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(bin)} exited with ${code}: ${err.trim()}`));
    });
  });
}

/** Speak text into an MP3 with the computer's own voice. False when there's no voice engine. */
export async function systemSpeech(text: string, outMp3: string): Promise<boolean> {
  const clean = text.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return false;
  const say = process.platform === "darwin" ? await findExecutable("say") : null;
  const espeak = say ? null : ((await findExecutable("espeak-ng")) ?? (await findExecutable("espeak")));
  if (!say && !espeak) return false;

  const tmp = await mkdtemp(path.join(os.tmpdir(), "ms-say-"));
  try {
    // Text goes in a file so nothing in it can be read as a command-line flag.
    const textFile = path.join(tmp, "script.txt");
    await writeFile(textFile, clean, "utf8");
    let raw: string;
    if (say) {
      raw = path.join(tmp, "speech.aiff");
      const args = ["-o", raw, "-f", textFile];
      if (process.env.SYSTEM_VOICE) args.unshift("-v", process.env.SYSTEM_VOICE);
      await run(say, args, 60_000);
    } else {
      raw = path.join(tmp, "speech.wav");
      await run(espeak!, ["-s", "165", "-w", raw, "-f", textFile], 60_000);
    }
    await mkdir(path.dirname(outMp3), { recursive: true });
    await runFfmpeg(["-i", raw, "-ac", "2", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "128k", outMp3], { timeoutMs: 60_000 });
    return true;
  } catch {
    return false;
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
