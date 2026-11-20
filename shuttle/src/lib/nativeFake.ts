// A stand-in for the Android recorder, for browser tests of the app's phone
// flow. It never loads for real users: only when isNativeApp() was forced on
// with localStorage['shuttle.fakeNative'] = '1' in a regular browser. It
// "records the screen" by drawing an animation and a tone into a real video,
// so everything after it (import, editing, export) runs for real.

import { WebPlugin } from '@capacitor/core';
import type { FinishedEvent, NativeRecording, NativeState, NativeStatus } from './native.ts';

interface Take {
  rec: NativeRecording;
  url: string;
}

export class FakeShuttleNative extends WebPlugin {
  private state: NativeState = 'idle';
  private startedAt = 0;
  private startClock = 0;
  private pausedTotal = 0;
  private pausedSince = 0;
  private markers: number[] = [];
  private trimStartMs = 0;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private raf = 0;
  private audio: AudioContext | null = null;
  private finished: Take[] = [];
  private files = new Map<string, string[]>();
  /** What the app asked the phone to do with files, for test assertions. */
  readonly log: Array<{ op: string; name?: string; mime?: string; size?: number }> = [];

  constructor() {
    super();
    (window as unknown as { __shuttleFakeNative?: FakeShuttleNative }).__shuttleFakeNative = this;
  }

  private elapsed(): number {
    if (this.state === 'idle') return 0;
    const now = performance.now();
    return now - this.startClock - this.pausedTotal - (this.state === 'paused' ? now - this.pausedSince : 0);
  }

  private emitState() {
    this.notifyListeners('stateChange', { state: this.state, elapsedMs: this.elapsed(), markers: this.markers.length });
  }

  async getStatus(): Promise<NativeStatus> {
    return {
      state: this.state,
      elapsedMs: this.elapsed(),
      markers: this.markers.length,
      camera: false,
      mic: true,
      canDrawOverlays: true,
      micPermission: 'granted',
      cameraPermission: 'granted',
    };
  }

  async startScreenRecording(): Promise<{ camera: boolean; mic: boolean }> {
    if (this.state !== 'idle') throw Object.assign(new Error('A recording is already running.'), { code: 'BUSY' });
    // A "phone screen": 720x1600 portrait with something moving on it.
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 1600;
    const ctx = canvas.getContext('2d')!;
    const draw = (t: number) => {
      ctx.fillStyle = '#1d2330';
      ctx.fillRect(0, 0, 720, 1600);
      ctx.fillStyle = '#ff5a36';
      ctx.beginPath();
      ctx.arc(360 + Math.sin(t / 500) * 220, 800 + Math.cos(t / 700) * 500, 90, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '600 64px sans-serif';
      ctx.fillText(`phone ${(this.elapsed() / 1000).toFixed(1)} s`, 60, 160);
      this.raf = requestAnimationFrame(draw);
    };
    this.raf = requestAnimationFrame(draw);
    const stream = canvas.captureStream(30);
    this.audio = new AudioContext();
    const osc = this.audio.createOscillator();
    const gain = this.audio.createGain();
    gain.gain.value = 0.2;
    const dest = this.audio.createMediaStreamDestination();
    osc.connect(gain).connect(dest);
    osc.start();
    stream.addTrack(dest.stream.getAudioTracks()[0]);
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' });
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(500);
    this.state = 'recording';
    this.startedAt = Date.now();
    this.startClock = performance.now();
    this.pausedTotal = 0;
    this.markers = [];
    this.trimStartMs = 0;
    this.emitState();
    return { camera: false, mic: true };
  }

  async pause(): Promise<void> {
    if (this.state !== 'recording') return;
    this.recorder?.pause();
    this.state = 'paused';
    this.pausedSince = performance.now();
    this.emitState();
  }

  async resume(): Promise<void> {
    if (this.state !== 'paused') return;
    this.recorder?.resume();
    this.pausedTotal += performance.now() - this.pausedSince;
    this.state = 'recording';
    this.emitState();
  }

  async addMarker(): Promise<void> {
    if (this.state !== 'idle') this.markers.push(this.elapsed());
    this.emitState();
  }

  async minimize(): Promise<void> {
    if (this.state !== 'idle' && this.elapsed() < 15000) this.trimStartMs = this.elapsed() + 450;
    this.log.push({ op: 'minimize' });
  }

  async stop(): Promise<FinishedEvent> {
    if (this.state === 'idle' || !this.recorder) return {};
    const durationMs = this.elapsed();
    const rec = this.recorder;
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      if (rec.state === 'paused') rec.resume();
      rec.stop();
    });
    cancelAnimationFrame(this.raf);
    await this.audio?.close();
    rec.stream.getTracks().forEach((t) => t.stop());
    this.state = 'idle';
    const blob = new Blob(this.chunks, { type: 'video/webm' });
    const id = `rec${this.startedAt}`;
    const recording: NativeRecording = {
      id,
      path: URL.createObjectURL(blob),
      startedAt: this.startedAt,
      durationMs,
      width: 720,
      height: 1600,
      hasAudio: true,
      camera: false,
      trimStartMs: this.trimStartMs,
      markersMs: [...this.markers],
    };
    this.finished.push({ rec: recording, url: recording.path });
    this.emitState();
    return { recording };
  }

  /** Like tapping Stop in the notification while Shuttle is in the background. */
  async stopFromNotification(): Promise<void> {
    const r = await this.stop();
    this.notifyListeners('recordingFinished', r, true);
  }

  async listFinished(): Promise<{ recordings: NativeRecording[] }> {
    return { recordings: this.finished.map((t) => t.rec) };
  }

  async deleteFinished({ id }: { id: string }): Promise<void> {
    this.finished = this.finished.filter((t) => t.rec.id !== id);
  }

  async requestOverlayPermission(): Promise<{ granted: boolean }> {
    return { granted: true };
  }

  async writeChunk({ name, data, append }: { name: string; data: string; append: boolean }): Promise<{ path: string }> {
    const parts = append ? (this.files.get(name) ?? []) : [];
    parts.push(data);
    this.files.set(name, parts);
    return { path: `/cache/exports/${name}` };
  }

  private sizeOf(path: string): number {
    const parts = this.files.get(path.split('/').pop() ?? '') ?? [];
    return parts.reduce((n, b64) => n + Math.floor((b64.length * 3) / 4), 0);
  }

  async shareFile({ path, mime }: { path: string; mime: string }): Promise<void> {
    this.log.push({ op: 'share', name: path.split('/').pop(), mime, size: this.sizeOf(path) });
  }

  async saveToGallery({ path, mime }: { path: string; mime: string }): Promise<{ uri: string; folder: string }> {
    const video = mime.startsWith('video/');
    this.log.push({ op: 'gallery', name: path.split('/').pop(), mime, size: this.sizeOf(path) });
    return { uri: `content://media/fake/${path.split('/').pop()}`, folder: video ? 'Movies/Shuttle' : 'Download/Shuttle' };
  }

  async clearExports(): Promise<void> {
    this.files.clear();
  }
}
