// Renders the edited video with WebCodecs (through Mediabunny): applies the
// trim and cuts, eases zooms in and out, composites the camera bubble, burns in
// captions if asked, and encodes MP4 (H.264/AAC) or WebM (VP9/Opus). Runs
// faster than real time on most machines because nothing waits for playback.

import {
  AudioBufferSink,
  AudioBufferSource,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
  VideoSampleSink,
  WebMOutputFormat,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  type AudioCodec,
  type VideoCodec,
  type VideoSample,
} from 'mediabunny';
import type { Recording } from './types.ts';
import { keptSegments, outputDuration, outputToSource, findSegmentAt, type Range } from './timeline.ts';
import { outputSize } from './layout.ts';
import { captionCues } from './captions.ts';
import { CAPTION_FONT, drawFrame } from './render.ts';
import { openInput } from './media.ts';

export interface ExportOptions {
  format: 'mp4' | 'webm';
  /** null keeps the recorded resolution */
  height: number | null;
  burnCaptions: boolean;
}

export interface ExportResult {
  blob: Blob;
  mime: string;
  ext: 'mp4' | 'webm';
  width: number;
  height: number;
  duration: number;
  videoCodec: VideoCodec;
  audioCodec: AudioCodec | null;
  /** Set when the requested format could not be produced in this browser. */
  note?: string;
}

/**
 * Collects StreamTarget writes into Blobs. Most writes are sequential; the
 * muxer patches a few header bytes at the end, which are spliced in.
 */
class BlobWriter {
  private parts: Blob[] = [];
  private partStarts: number[] = [];
  private pending: Uint8Array[] = [];
  private pendingStart = 0;
  private pendingSize = 0;
  size = 0;

  write(data: Uint8Array, position: number) {
    const copy = new Uint8Array(data);
    if (position === this.size) {
      this.pending.push(copy);
      this.pendingSize += copy.length;
      this.size += copy.length;
      if (this.pendingSize > 32 * 1024 * 1024) this.flush();
      return;
    }
    this.flush();
    if (position > this.size) {
      this.appendFlushed(new Uint8Array(position - this.size));
      this.appendFlushed(copy);
      return;
    }
    const end = position + copy.length;
    const overlapEnd = Math.min(end, this.size);
    for (let i = 0; i < this.parts.length; i++) {
      const pStart = this.partStarts[i];
      const pEnd = pStart + this.parts[i].size;
      if (pEnd <= position || pStart >= overlapEnd) continue;
      const from = Math.max(position, pStart);
      const to = Math.min(overlapEnd, pEnd);
      const piece = copy.subarray(from - position, to - position);
      const blob = this.parts[i];
      this.parts[i] = new Blob([blob.slice(0, from - pStart), piece as Uint8Array<ArrayBuffer>, blob.slice(to - pStart)]);
    }
    if (end > this.size) this.appendFlushed(copy.subarray(this.size - position));
  }

  private appendFlushed(bytes: Uint8Array) {
    this.partStarts.push(this.size);
    this.parts.push(new Blob([bytes as Uint8Array<ArrayBuffer>]));
    this.size += bytes.length;
    this.pendingStart = this.size;
  }

  flush() {
    if (!this.pending.length) return;
    this.partStarts.push(this.pendingStart);
    this.parts.push(new Blob(this.pending as Uint8Array<ArrayBuffer>[]));
    this.pending = [];
    this.pendingSize = 0;
    this.pendingStart = this.size;
  }

  toBlob(type: string): Blob {
    this.flush();
    return new Blob(this.parts, { type });
  }
}

const abortError = () => new DOMException('Export cancelled', 'AbortError');

async function pickCodecs(format: 'mp4' | 'webm', width: number, height: number, fps: number, audio: { channels: number; rate: number } | null) {
  const videoList: VideoCodec[] = format === 'mp4' ? ['avc', 'hevc', 'vp9', 'av1'] : ['vp9', 'vp8', 'av1'];
  const audioList: AudioCodec[] = format === 'mp4' ? ['aac', 'opus'] : ['opus'];
  const video = await getFirstEncodableVideoCodec(videoList, { width, height, frameRate: fps, quality: QUALITY_HIGH });
  const aud = audio
    ? await getFirstEncodableAudioCodec(audioList, { numberOfChannels: audio.channels, sampleRate: audio.rate, quality: QUALITY_HIGH })
    : null;
  return { video, audio: aud };
}

export async function exportVideo(
  rec: Recording,
  media: { main: Blob; cam?: Blob },
  opts: ExportOptions,
  onProgress: (p: number) => void,
  signal: AbortSignal,
): Promise<ExportResult> {
  const segs = keptSegments(rec.duration, rec.edits);
  const outDur = outputDuration(segs);
  if (outDur <= 0.05) throw new Error('Everything is cut. Restore part of the timeline to export.');

  const mainIn = openInput(media.main);
  const useCam = rec.mode === 'screen-cam' && !!media.cam && rec.edits.camera.visible;
  const camIn = useCam ? openInput(media.cam!) : null;
  let output: Output | null = null;
  try {
    const vTrack = await mainIn.getPrimaryVideoTrack();
    if (!vTrack) throw new Error('The recording has no video track.');
    const aTrack = await mainIn.getPrimaryAudioTrack();
    const camTrack = camIn ? await camIn.getPrimaryVideoTrack() : null;
    const srcW = await vTrack.getDisplayWidth();
    const srcH = await vTrack.getDisplayHeight();
    const { width, height } = outputSize(srcW, srcH, opts.height);
    const fps = Math.min(60, Math.max(24, Math.round(rec.fps || 30)));

    const audioInfo = aTrack && (await aTrack.canDecode())
      ? { channels: await aTrack.getNumberOfChannels(), rate: await aTrack.getSampleRate() }
      : null;

    let format = opts.format;
    let note: string | undefined;
    let codecs = await pickCodecs(format, width, height, fps, audioInfo);
    if (!codecs.video && format === 'mp4') {
      format = 'webm';
      note = 'This browser cannot encode MP4 video, so the export is WebM.';
      codecs = await pickCodecs(format, width, height, fps, audioInfo);
    }
    if (!codecs.video) throw new Error('This browser cannot encode video. Use a recent Chrome, Edge or Safari.');
    if (audioInfo && !codecs.audio) note = (note ? note + ' ' : '') + 'This browser cannot encode the audio, so the export is silent.';

    const writer = new BlobWriter();
    const target = new StreamTarget(
      new WritableStream({ write: (chunk) => writer.write(chunk.data, chunk.position) }),
      { chunked: true, chunkSize: 8 * 1024 * 1024 },
    );
    output = new Output({
      format: format === 'mp4' ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat(),
      target,
    });

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas is not available.');
    const videoSource = new CanvasSource(canvas, {
      codec: codecs.video,
      bitrate: QUALITY_HIGH,
      keyFrameInterval: 2,
    });
    output.addVideoTrack(videoSource, { frameRate: fps });

    let audioSource: AudioBufferSource | null = null;
    if (audioInfo && codecs.audio && aTrack) {
      audioSource = new AudioBufferSource({ codec: codecs.audio, bitrate: QUALITY_HIGH });
      output.addAudioTrack(audioSource);
    }
    output.setMetadataTags({ title: rec.title, date: new Date(rec.createdAt) });
    await output.start();

    if (opts.burnCaptions) await document.fonts?.load(`600 32px ${CAPTION_FONT}`).catch(() => undefined);
    const cues = opts.burnCaptions ? captionCues(rec.transcript) : [];

    const frameCount = Math.max(1, Math.ceil(outDur * fps - 1e-6));
    const srcTimes = new Float64Array(frameCount);
    for (let k = 0; k < frameCount; k++) srcTimes[k] = outputToSource(k / fps, segs);

    const videoLoop = async () => {
      const mainIter = new VideoSampleSink(vTrack).samplesAtTimestamps(srcTimes);
      const camIter = camTrack ? new VideoSampleSink(camTrack).samplesAtTimestamps(srcTimes) : null;
      let lastMain: VideoSample | null = null;
      let lastCam: VideoSample | null = null;
      try {
        for (let k = 0; k < frameCount; k++) {
          if (signal.aborted) throw abortError();
          const [m, c] = await Promise.all([mainIter.next(), camIter ? camIter.next() : Promise.resolve(null)]);
          // A null sample means no frame yet at that time; hold the previous one.
          if (m.value) {
            lastMain?.close();
            lastMain = m.value;
          }
          if (c && c.value) {
            lastCam?.close();
            lastCam = c.value;
          }
          const tSrc = srcTimes[k];
          const cueIdx = cues.length ? findSegmentAt(cues, tSrc) : -1;
          drawFrame(ctx, {
            W: width,
            H: height,
            mode: rec.mode,
            edits: rec.edits,
            tSrc,
            main: lastMain,
            cam: lastCam,
            caption: cueIdx >= 0 ? cues[cueIdx].text : undefined,
          });
          await videoSource.add(k / fps, 1 / fps);
          if (k % 10 === 0) onProgress(k / frameCount);
        }
      } finally {
        lastMain?.close();
        lastCam?.close();
        await mainIter.return(undefined);
        await camIter?.return(undefined);
      }
      videoSource.close();
    };

    const audioLoop = async () => {
      if (!audioSource || !aTrack || !audioInfo) return;
      const sink = new AudioBufferSink(aTrack);
      const sr = audioInfo.rate;
      const channels = audioInfo.channels;
      const fadeLen = Math.round(sr * 0.004);
      const silence = async (secs: number) => {
        const n = Math.round(secs * sr);
        if (n > 0) await audioSource!.add(new AudioBuffer({ length: n, numberOfChannels: channels, sampleRate: sr }));
      };
      for (const [a, b] of segs as Range[]) {
        let cursor = a;
        let first = true;
        for await (const wb of sink.buffers(a, b)) {
          if (signal.aborted) throw abortError();
          const bs = wb.timestamp;
          const be = wb.timestamp + wb.duration;
          const s = Math.max(a, bs, cursor);
          const e = Math.min(b, be);
          if (e - s <= 1 / sr) continue;
          if (s - cursor > 0.002) await silence(s - cursor);
          const i0 = Math.max(0, Math.round((s - bs) * sr));
          const i1 = Math.min(wb.buffer.length, Math.round((e - bs) * sr));
          const n = i1 - i0;
          if (n <= 0) continue;
          const out = new AudioBuffer({ length: n, numberOfChannels: channels, sampleRate: sr });
          for (let ch = 0; ch < channels; ch++) {
            const src = wb.buffer.getChannelData(Math.min(ch, wb.buffer.numberOfChannels - 1)).subarray(i0, i1);
            const dst = out.getChannelData(ch);
            dst.set(src);
            // Short fades at every cut keep the joins from clicking.
            if (first) for (let i = 0; i < Math.min(fadeLen, n); i++) dst[i] *= i / fadeLen;
            if (b - e < 1 / sr + 1e-6) for (let i = 0; i < Math.min(fadeLen, n); i++) dst[n - 1 - i] *= i / fadeLen;
          }
          first = false;
          await audioSource.add(out);
          cursor = e;
        }
        if (b - cursor > 0.002) await silence(b - cursor);
      }
      audioSource.close();
    };

    await Promise.all([videoLoop(), audioLoop()]);
    await output.finalize();
    onProgress(1);
    const mime = (await output.getMimeType().catch(() => '')) || (format === 'mp4' ? 'video/mp4' : 'video/webm');
    return {
      blob: writer.toBlob(mime.split(';')[0] === 'video/mp4' || format === 'mp4' ? 'video/mp4' : 'video/webm'),
      mime,
      ext: format,
      width,
      height,
      duration: outDur,
      videoCodec: codecs.video,
      audioCodec: audioSource ? codecs.audio : null,
      note,
    };
  } catch (err) {
    if (output && output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => undefined);
    throw err;
  } finally {
    mainIn.dispose();
    camIn?.dispose();
  }
}
