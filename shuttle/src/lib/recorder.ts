// Capture engine. Screen and camera are recorded as two separate files that
// start, pause and stop together, so the camera bubble can be moved, resized,
// reshaped or hidden after the fact. Microphone and system audio are mixed
// into the main file. Every second of output is written to IndexedDB while
// recording, so a crashed or closed tab can be recovered.

import type { CameraLayout, Marker, MediaKind, Mode, Segment } from './types.ts';
import { addChunk, deleteSession, putSession } from './db.ts';
import { uid } from './timeline.ts';
import { Transcriber, type TranscriberStatus } from './transcriber.ts';
import { QUALITY_HEIGHT, type Quality } from './settings.ts';

// ------------------------------------------------------------ acquisition

export async function openCamera(deviceId: string, height: number): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: Math.round((height * 16) / 9) },
      height: { ideal: height },
      frameRate: { ideal: 30 },
    },
    audio: false,
  });
}

export async function openMic(deviceId: string, noiseSuppression: boolean): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: true,
      noiseSuppression,
      autoGainControl: true,
      channelCount: { ideal: 1 },
    },
    video: false,
  });
}

export interface ScreenCapture {
  stream: MediaStream;
  surface: string;
  label: string;
}

/** Shows the browser's share picker. Resolves null when the user cancels. */
export async function openScreen(quality: Quality, fps: number, systemAudio: boolean): Promise<ScreenCapture | null> {
  const maxH = QUALITY_HEIGHT[quality];
  const Controller = (window as unknown as { CaptureController?: new () => { setFocusBehavior?: (b: string) => void } }).CaptureController;
  const controller = Controller ? new Controller() : undefined;
  const options: Record<string, unknown> = {
    video: {
      frameRate: { ideal: fps, max: fps },
      width: { max: Math.round((maxH * 16) / 9) * 2 },
      height: { max: maxH },
    },
    audio: systemAudio
      ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false }
      : false,
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    systemAudio: systemAudio ? 'include' : 'exclude',
    monitorTypeSurfaces: 'include',
  };
  if (controller) options.controller = controller;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia(options as DisplayMediaStreamOptions);
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')) return null;
    throw err;
  }
  // Stay on Shuttle after picking a tab or window so the user can press Start.
  try {
    controller?.setFocusBehavior?.('no-focus-change');
  } catch {
    /* only allowed for tabs and windows */
  }
  const track = stream.getVideoTracks()[0];
  try {
    track.contentHint = 'detail';
  } catch {
    /* optional */
  }
  const surface = (track.getSettings() as { displaySurface?: string }).displaySurface ?? 'monitor';
  return { stream, surface, label: track.label };
}

export function stopStream(s: MediaStream | null | undefined): void {
  s?.getTracks().forEach((t) => t.stop());
}

// ------------------------------------------------------------ formats

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=h264,opus',
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/webm',
  'video/mp4',
];

export function pickMime(withAudio: boolean): string {
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video. Try Chrome, Edge, Firefox or Safari.');
  for (const m of MIME_CANDIDATES) {
    const candidate = withAudio ? m : m.replace(/,(opus|mp4a\.40\.2)/, '');
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return '';
}

function videoBitrate(w: number, h: number, fps: number): number {
  const effectiveFps = fps <= 30 ? fps : 30 + (fps - 30) * 0.5;
  return Math.round(Math.min(24e6, Math.max(1.5e6, w * h * effectiveFps * 0.08)));
}

// ------------------------------------------------------------ engine

export type EngineState = 'idle' | 'recording' | 'paused' | 'stopping' | 'stopped';

export interface EngineInput {
  mode: Mode;
  screen?: MediaStream;
  camera?: MediaStream;
  mic?: MediaStream;
  fps: number;
  lang: string;
  captions: boolean;
  camera_layout: CameraLayout;
}

export interface EngineResult {
  sessionId: string;
  main: Blob;
  cam?: Blob;
  mime: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  transcript: Segment[];
  markers: Marker[];
}

export interface EngineEvents {
  onState?: (s: EngineState) => void;
  onTranscript?: (segments: Segment[], interim: string) => void;
  onCaptionStatus?: (s: TranscriberStatus, detail?: string) => void;
  onSourceEnded?: () => void;
  onStorageWarning?: (message: string) => void;
}

export class RecordingEngine {
  readonly sessionId = uid('r');
  state: EngineState = 'idle';
  private input: EngineInput;
  private events: EngineEvents;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelBuf: Float32Array<ArrayBuffer> | null = null;
  private recorders: Array<{ kind: MediaKind; rec: MediaRecorder; chunks: Blob[]; seq: number }> = [];
  private mime = '';
  private accum = 0;
  private activeSince = 0;
  private transcriber: Transcriber | null = null;
  private markers: Marker[] = [];
  private metaTimer = 0;
  private width = 0;
  private height = 0;
  private hasAudio = false;
  private wakeLock: { release: () => Promise<void> } | null = null;
  private storageWarned = false;

  constructor(input: EngineInput, events: EngineEvents = {}) {
    this.input = input;
    this.events = events;
  }

  elapsed(): number {
    return this.accum + (this.state === 'recording' ? (performance.now() - this.activeSince) / 1000 : 0);
  }

  /** Microphone level, RMS 0..1. */
  level(): number {
    if (!this.analyser || !this.levelBuf) return 0;
    this.analyser.getFloatTimeDomainData(this.levelBuf);
    let s = 0;
    for (let i = 0; i < this.levelBuf.length; i++) s += this.levelBuf[i] * this.levelBuf[i];
    return Math.sqrt(s / this.levelBuf.length);
  }

  get markerList(): Marker[] {
    return this.markers;
  }

  async start(): Promise<void> {
    const { mode, screen, camera, mic } = this.input;
    const mainVideo = mode === 'cam' ? camera?.getVideoTracks()[0] : screen?.getVideoTracks()[0];
    if (!mainVideo) throw new Error(mode === 'cam' ? 'No camera is available.' : 'Choose a screen, window or tab to share first.');

    // Mix microphone and shared-tab/system audio into one track.
    const sysTrack = screen?.getAudioTracks()[0];
    const micTrack = mic?.getAudioTracks()[0];
    let mixed: MediaStreamTrack | undefined;
    if (micTrack || sysTrack) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      await this.ctx.resume().catch(() => undefined);
      const dest = this.ctx.createMediaStreamDestination();
      if (micTrack) {
        const src = this.ctx.createMediaStreamSource(new MediaStream([micTrack]));
        src.connect(dest);
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 1024;
        this.levelBuf = new Float32Array(this.analyser.fftSize);
        src.connect(this.analyser);
      }
      if (sysTrack) {
        const src = this.ctx.createMediaStreamSource(new MediaStream([sysTrack]));
        const gain = this.ctx.createGain();
        gain.gain.value = 0.85;
        src.connect(gain).connect(dest);
      }
      mixed = dest.stream.getAudioTracks()[0];
    }
    this.hasAudio = !!mixed;

    const settings = mainVideo.getSettings();
    this.width = settings.width ?? 1280;
    this.height = settings.height ?? 720;
    const fps = settings.frameRate ? Math.min(60, Math.round(settings.frameRate)) : this.input.fps;

    this.mime = pickMime(!!mixed);
    const mainStream = new MediaStream(mixed ? [mainVideo, mixed] : [mainVideo]);
    this.addRecorder('main', mainStream, {
      mimeType: this.mime || undefined,
      videoBitsPerSecond: videoBitrate(this.width, this.height, fps),
      audioBitsPerSecond: 128_000,
    });
    const camTrack = camera?.getVideoTracks()[0];
    if (mode === 'screen-cam' && camTrack) {
      const cs = camTrack.getSettings();
      this.addRecorder('cam', new MediaStream([camTrack]), {
        mimeType: pickMime(false) || undefined,
        videoBitsPerSecond: videoBitrate(cs.width ?? 1280, cs.height ?? 720, 30),
      });
    }

    mainVideo.addEventListener('ended', () => this.events.onSourceEnded?.(), { once: true });

    if (this.input.captions) {
      this.transcriber = new Transcriber(this.input.lang, () => this.elapsed(), {
        onUpdate: (segs, interim) => this.events.onTranscript?.(segs, interim),
        onStatus: (s, d) => this.events.onCaptionStatus?.(s, d),
      });
    }

    await putSession(this.sessionMeta()).catch(() => this.warnStorage());

    // Start every recorder in the same task so the files line up.
    for (const r of this.recorders) r.rec.start(1000);
    this.activeSince = performance.now();
    this.setState('recording');
    this.transcriber?.start(micTrack);
    this.metaTimer = window.setInterval(() => {
      putSession(this.sessionMeta()).catch(() => this.warnStorage());
    }, 4000);
    try {
      const wl = (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock;
      this.wakeLock = (await wl?.request('screen')) ?? null;
    } catch {
      /* not granted; recording continues */
    }
  }

  pause(): void {
    if (this.state !== 'recording') return;
    for (const r of this.recorders) if (r.rec.state === 'recording') r.rec.pause();
    this.accum += (performance.now() - this.activeSince) / 1000;
    this.transcriber?.pause();
    this.setState('paused');
  }

  resume(): void {
    if (this.state !== 'paused') return;
    for (const r of this.recorders) if (r.rec.state === 'paused') r.rec.resume();
    this.activeSince = performance.now();
    this.transcriber?.resume();
    this.setState('recording');
  }

  addMarker(title?: string): Marker {
    const m: Marker = { id: uid('m'), t: this.elapsed(), title: title ?? `Chapter ${this.markers.length + 1}` };
    this.markers.push(m);
    return m;
  }

  async stop(): Promise<EngineResult> {
    if (this.state === 'recording') this.accum += (performance.now() - this.activeSince) / 1000;
    this.setState('stopping');
    const transcript = this.transcriber?.stop() ?? [];
    await Promise.all(
      this.recorders.map(
        (r) =>
          new Promise<void>((resolve) => {
            if (r.rec.state === 'inactive') return resolve();
            r.rec.addEventListener('stop', () => resolve(), { once: true });
            try {
              r.rec.stop();
            } catch {
              resolve();
            }
          }),
      ),
    );
    this.cleanup();
    const main = this.recorders.find((r) => r.kind === 'main')!;
    const cam = this.recorders.find((r) => r.kind === 'cam');
    const result: EngineResult = {
      sessionId: this.sessionId,
      main: new Blob(main.chunks, { type: main.rec.mimeType || this.mime || 'video/webm' }),
      cam: cam && cam.chunks.length ? new Blob(cam.chunks, { type: cam.rec.mimeType || 'video/webm' }) : undefined,
      mime: main.rec.mimeType || this.mime || 'video/webm',
      duration: this.accum,
      width: this.width,
      height: this.height,
      hasAudio: this.hasAudio,
      transcript: [...transcript],
      markers: [...this.markers],
    };
    this.setState('stopped');
    return result;
  }

  /** Throws the take away. */
  async cancel(): Promise<void> {
    this.transcriber?.stop();
    for (const r of this.recorders) {
      r.rec.ondataavailable = null;
      if (r.rec.state !== 'inactive') {
        try {
          r.rec.stop();
        } catch {
          /* already stopped */
        }
      }
    }
    this.cleanup();
    this.setState('stopped');
    await deleteSession(this.sessionId).catch(() => undefined);
  }

  private addRecorder(kind: MediaKind, stream: MediaStream, opts: MediaRecorderOptions) {
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, opts);
    } catch {
      rec = new MediaRecorder(stream);
    }
    const entry = { kind, rec, chunks: [] as Blob[], seq: 0 };
    rec.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return;
      entry.chunks.push(e.data);
      const seq = entry.seq++;
      addChunk({ session: this.sessionId, kind, seq, blob: e.data }).catch(() => this.warnStorage());
    };
    rec.onerror = () => {
      this.events.onStorageWarning?.('The recorder hit an error. Stop to keep what was recorded so far.');
    };
    this.recorders.push(entry);
  }

  private sessionMeta() {
    return {
      id: this.sessionId,
      startedAt: Date.now() - this.elapsed() * 1000,
      mode: this.input.mode,
      mime: this.mime,
      fps: this.input.fps,
      width: this.width,
      height: this.height,
      hasAudio: this.hasAudio,
      hasCamera: this.recorders.some((r) => r.kind === 'cam') || this.input.mode === 'cam',
      lang: this.input.lang,
      elapsed: this.elapsed(),
      transcript: this.transcriber ? [...this.transcriber.segments] : [],
      markers: [...this.markers],
      camera: this.input.camera_layout,
    };
  }

  private warnStorage() {
    if (this.storageWarned) return;
    this.storageWarned = true;
    this.events.onStorageWarning?.('Backup to browser storage failed (disk full?). The recording continues in memory; stop soon to save it.');
  }

  private cleanup() {
    clearInterval(this.metaTimer);
    this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.analyser = null;
    stopStream(this.input.screen);
    stopStream(this.input.camera);
    stopStream(this.input.mic);
  }

  private setState(s: EngineState) {
    this.state = s;
    this.events.onState?.(s);
  }
}
