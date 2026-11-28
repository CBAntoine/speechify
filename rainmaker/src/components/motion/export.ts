// Rendering the finished video file in the browser: every frame drawn at
// its exact time (no dropped frames), encoded with WebCodecs into an MP4
// (H.264 and AAC where the device has them) by mediabunny. Browsers
// without WebCodecs record in real time with MediaRecorder instead, up to
// 1080p.

export interface RenderJob {
  width: number;
  height: number;
  fps: number;
  total: number;
  /** Draws time t and returns the canvas holding the frame. */
  frame: (t: number) => HTMLCanvasElement;
  /** The finished mix, if the ad has sound. */
  audio?: AudioBuffer;
  onProgress: (p: number) => void;
  signal?: AbortSignal;
}

export interface Rendered {
  blob: Blob;
  ext: "mp4" | "webm";
  video: string;
  audio?: string;
  realtime: boolean;
}

export function canRenderFrames(): boolean {
  return typeof window !== "undefined" && "VideoEncoder" in window && "VideoFrame" in window;
}

const aborted = () => new DOMException("Cancelled", "AbortError");

/** Whether this browser can encode a video this size, and with what. */
export async function encoderFor(width: number, height: number, fps = 30): Promise<string | null> {
  if (!canRenderFrames()) return null;
  const mb = await import("mediabunny");
  return (await mb.getFirstEncodableVideoCodec(["avc", "hevc", "vp9", "av1"], { width, height, frameRate: fps })) ?? null;
}

export async function renderVideo(job: RenderJob): Promise<Rendered> {
  if (!canRenderFrames()) return recordRealtime(job);
  const mb = await import("mediabunny");
  const { width, height, fps, total } = job;
  const codec = await mb.getFirstEncodableVideoCodec(["avc", "hevc", "vp9", "av1"], { width, height, frameRate: fps });
  if (!codec) throw new Error(`This device can't encode ${width}×${height} video. Try 1080p.`);
  const audioCodec = job.audio ? await mb.getFirstEncodableAudioCodec(["aac", "opus"], { numberOfChannels: 2, sampleRate: job.audio.sampleRate }) : null;
  const target = new mb.BufferTarget();
  const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target });
  const first = job.frame(0);
  const pixels = width * height;
  const video = new mb.CanvasSource(first, {
    codec,
    bitrate: pixels >= 3840 * 2160 * 0.9 ? 24_000_000 : pixels >= 1920 * 1080 * 0.9 ? 9_000_000 : 5_000_000,
    keyFrameInterval: 2,
    latencyMode: "quality",
  });
  output.addVideoTrack(video, { frameRate: fps });
  let audio: InstanceType<typeof mb.AudioBufferSource> | undefined;
  if (job.audio && audioCodec) {
    audio = new mb.AudioBufferSource({ codec: audioCodec, bitrate: 192_000 });
    output.addAudioTrack(audio);
  }
  await output.start();
  const frames = Math.max(1, Math.round(total * fps));
  try {
    for (let i = 0; i < frames; i++) {
      if (job.signal?.aborted) throw aborted();
      job.frame(i / fps);
      await video.add(i / fps, 1 / fps);
      job.onProgress((i + 1) / frames);
      // Let the page breathe (progress bar, Cancel button).
      if (i % 6 === 5) await new Promise((r) => setTimeout(r, 0));
    }
    video.close();
    if (audio && job.audio) {
      await audio.add(job.audio);
      audio.close();
    }
    await output.finalize();
  } catch (err) {
    await output.cancel().catch(() => undefined);
    throw err;
  }
  if (!target.buffer) throw new Error("The video came out empty. Try again.");
  return { blob: new Blob([target.buffer], { type: "video/mp4" }), ext: "mp4", video: codec, audio: audioCodec ?? undefined, realtime: false };
}

/** Fallback: play the ad in real time and record the canvas and the sound. */
async function recordRealtime(job: RenderJob): Promise<Rendered> {
  const types = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  const mime = types.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error("This browser can't make video files. Use Chrome on Android or a computer.");
  const canvas = job.frame(0);
  const stream = canvas.captureStream(job.fps);
  let ctx: AudioContext | undefined;
  if (job.audio) {
    ctx = new AudioContext({ sampleRate: job.audio.sampleRate });
    const dest = ctx.createMediaStreamDestination();
    const src = ctx.createBufferSource();
    src.buffer = job.audio;
    src.connect(dest);
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    await ctx.resume();
    src.start(ctx.currentTime + 0.05);
  }
  const chunks: Blob[] = [];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
  rec.start(250);
  const t0 = ctx ? ctx.currentTime + 0.05 : performance.now() / 1000;
  const now = () => (ctx ? ctx.currentTime : performance.now() / 1000) - t0;
  await new Promise<void>((resolve, reject) => {
    const step = () => {
      if (job.signal?.aborted) return reject(aborted());
      const t = Math.max(0, now());
      job.frame(Math.min(t, job.total));
      job.onProgress(Math.min(1, t / job.total));
      if (t >= job.total) return resolve();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }).finally(() => {
    rec.stop();
    stream.getTracks().forEach((t) => t.stop());
  });
  await stopped;
  await ctx?.close().catch(() => undefined);
  const type = mime.split(";")[0];
  return { blob: new Blob(chunks, { type }), ext: type.includes("mp4") ? "mp4" : "webm", video: type, realtime: true };
}

export function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}
