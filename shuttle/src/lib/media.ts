// Reading recorded files with Mediabunny: duration and size, the audio
// envelope behind the waveform and silence detection, and thumbnails.

import { ALL_FORMATS, AudioBufferSink, BlobSource, Input, VideoSampleSink, type VideoSample } from 'mediabunny';
import type { Recording } from './types.ts';
import { drawFrame } from './render.ts';
import { keptSegments } from './timeline.ts';

export const ENVELOPE_RATE = 50;

export function openInput(blob: Blob): Input {
  return new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
}

export interface Probe {
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export async function probe(blob: Blob): Promise<Probe> {
  const input = openInput(blob);
  try {
    const v = await input.getPrimaryVideoTrack();
    const a = await input.getPrimaryAudioTrack();
    const duration = await input.computeDuration();
    return {
      duration,
      width: v ? await v.getDisplayWidth() : 0,
      height: v ? await v.getDisplayHeight() : 0,
      hasAudio: !!a,
    };
  } finally {
    input.dispose();
  }
}

/** RMS loudness in 20 ms windows, decoded straight from the file. */
export async function computeEnvelope(
  blob: Blob,
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
): Promise<Float32Array | null> {
  const input = openInput(blob);
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return null;
    const duration = await input.computeDuration();
    const len = Math.max(1, Math.ceil(duration * ENVELOPE_RATE));
    const sums = new Float64Array(len);
    const counts = new Uint32Array(len);
    const sink = new AudioBufferSink(track);
    let lastReport = 0;
    for await (const { buffer, timestamp } of sink.buffers()) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const sr = buffer.sampleRate;
      const chans = buffer.numberOfChannels;
      const c0 = buffer.getChannelData(0);
      const c1 = chans > 1 ? buffer.getChannelData(1) : null;
      const n = buffer.length;
      const samplesPerWindow = sr / ENVELOPE_RATE;
      const startIdx = timestamp * ENVELOPE_RATE;
      for (let i = 0; i < n; i++) {
        const w = Math.floor(startIdx + i / samplesPerWindow);
        if (w < 0 || w >= len) continue;
        const v = c1 ? (c0[i] + c1[i]) * 0.5 : c0[i];
        sums[w] += v * v;
        counts[w]++;
      }
      if (onProgress && timestamp - lastReport > 2) {
        lastReport = timestamp;
        onProgress(Math.min(1, timestamp / duration));
      }
    }
    const env = new Float32Array(len);
    for (let i = 0; i < len; i++) env[i] = counts[i] ? Math.sqrt(sums[i] / counts[i]) : 0;
    onProgress?.(1);
    return env;
  } finally {
    input.dispose();
  }
}

async function sampleNear(input: Input, t: number): Promise<VideoSample | null> {
  const track = await input.getPrimaryVideoTrack();
  if (!track) return null;
  const sink = new VideoSampleSink(track);
  const s = await sink.getSample(t);
  if (s) return s;
  for await (const first of sink.samples()) return first;
  return null;
}

/** A small JPEG of the composed frame, for the library. */
export async function makeThumbnail(rec: Recording, main: Blob, cam?: Blob): Promise<Blob | undefined> {
  const segs = keptSegments(rec.duration, rec.edits);
  const t = segs.length ? Math.min(segs[0][0] + 1.2, (segs[0][0] + segs[0][1]) / 2) : 0;
  const mainIn = openInput(main);
  const camIn = cam && rec.mode === 'screen-cam' && rec.edits.camera.visible ? openInput(cam) : null;
  let m: VideoSample | null = null;
  let c: VideoSample | null = null;
  try {
    [m, c] = await Promise.all([sampleNear(mainIn, t), camIn ? sampleNear(camIn, t) : Promise.resolve(null)]);
    if (!m) return undefined;
    const W = 640;
    const H = Math.max(2, Math.round((W * m.displayHeight) / m.displayWidth));
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    drawFrame(ctx, { W, H, mode: rec.mode, edits: rec.edits, tSrc: t, main: m, cam: c });
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
  } catch {
    return undefined;
  } finally {
    m?.close();
    c?.close();
    mainIn.dispose();
    camIn?.dispose();
  }
}
