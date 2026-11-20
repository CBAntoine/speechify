// The bridge to the Android app (Capacitor). In a normal browser none of this
// runs: isNativeApp() is false and the web recorder is used instead.

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface NativeRecording {
  id: string;
  path: string;
  startedAt: number;
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
  /** The floating camera bubble was on screen (and so is in the video). */
  camera: boolean;
  /** Time spent before Shuttle moved out of the way; trimmed on import. */
  trimStartMs: number;
  markersMs: number[];
}

export type NativeState = 'idle' | 'recording' | 'paused';

export interface NativeStatus {
  state: NativeState;
  elapsedMs: number;
  markers?: number;
  camera?: boolean;
  mic?: boolean;
  canDrawOverlays: boolean;
  micPermission: string;
  cameraPermission: string;
}

export interface FinishedEvent {
  recording?: NativeRecording;
  error?: string;
}

interface ShuttleNativePlugin {
  getStatus(): Promise<NativeStatus>;
  startScreenRecording(options: { mic: boolean; camera: boolean; quality: '720' | '1080' }): Promise<{ camera: boolean; mic: boolean }>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  addMarker(): Promise<void>;
  minimize(): Promise<void>;
  stop(): Promise<FinishedEvent>;
  listFinished(): Promise<{ recordings: NativeRecording[] }>;
  deleteFinished(options: { id: string }): Promise<void>;
  requestOverlayPermission(): Promise<{ granted: boolean }>;
  writeChunk(options: { name: string; data: string; append: boolean }): Promise<{ path: string }>;
  shareFile(options: { path: string; mime: string; title?: string }): Promise<void>;
  saveToGallery(options: { path: string; mime: string }): Promise<{ uri: string; folder: string }>;
  clearExports(): Promise<void>;
  addListener(event: 'recordingFinished', fn: (e: FinishedEvent) => void): Promise<PluginListenerHandle>;
  addListener(event: 'stateChange', fn: (s: { state: NativeState; elapsedMs: number; markers: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'appResumed', fn: () => void): Promise<PluginListenerHandle>;
}

// Tests only: `localStorage['shuttle.fakeNative'] = '1'` makes a browser act like
// the Android app, backed by a stand-in recorder (nativeFake.ts).
const fakeNative = (() => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('shuttle.fakeNative') === '1';
  } catch {
    return false;
  }
})();

export const isNativeApp = (): boolean => Capacitor.isNativePlatform() || fakeNative;

// Capacitor may ask for the web implementation several times before the first
// load finishes; hand out one shared instance so every listener lands on it.
let fake: Promise<object> | null = null;

export const Native = registerPlugin<ShuttleNativePlugin>('ShuttleNative', {
  web: () => (fake ??= import('./nativeFake.ts').then((m) => new m.FakeShuttleNative())),
});

/** Reads a finished phone recording into a Blob the library can store. */
export async function nativeRecordingBlob(r: NativeRecording): Promise<Blob> {
  const res = await fetch(Capacitor.convertFileSrc(r.path));
  if (!res.ok) throw new Error(`Could not read the recording (HTTP ${res.status}).`);
  const blob = await res.blob();
  return blob.type ? blob : new Blob([blob], { type: 'video/mp4' });
}

function base64(part: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(',') + 1));
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(part);
  });
}

const CHUNK = 3 * 1024 * 1024;

/** Copies a Blob into the app's cache, in pieces small enough for the bridge. */
export async function writeNativeFile(blob: Blob, name: string, onProgress?: (p: number) => void): Promise<string> {
  let path = '';
  let offset = 0;
  do {
    const part = blob.slice(offset, offset + CHUNK);
    const data = await base64(part);
    ({ path } = await Native.writeChunk({ name, data, append: offset > 0 }));
    offset += CHUNK;
    onProgress?.(Math.min(1, offset / Math.max(1, blob.size)));
  } while (offset < blob.size);
  return path;
}
