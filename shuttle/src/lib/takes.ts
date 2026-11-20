// Turns a finished (or crashed) take into a saved Recording.

import type { CameraLayout, MediaKind, Mode, Recording, RecoverySession, Segment, Marker } from './types.ts';
import { deleteSession, getRecording, patchRecording, requestPersistence, saveNewRecording, sessionChunks } from './db.ts';
import { makeThumbnail, probe } from './media.ts';
import { defaultTitle } from './format.ts';
import type { EngineResult } from './recorder.ts';
import { DEFAULT_CAMERA } from './layout.ts';
import { uid } from './timeline.ts';
import { Native, nativeRecordingBlob, type NativeRecording } from './native.ts';

interface TakeMeta {
  sessionId: string;
  mode: Mode;
  fps: number;
  lang: string;
  camera: CameraLayout;
  mime: string;
  width: number;
  height: number;
  hasAudio: boolean;
  clockDuration: number;
  transcript: Segment[];
  markers: Marker[];
  startedAt: number;
  recovered?: boolean;
  /** Seconds to trim off the start (the phone app's own screen). */
  trimStart?: number;
  /** The camera is part of the picture (the phone's floating bubble). */
  cameraInPicture?: boolean;
}

async function build(meta: TakeMeta, main: Blob, cam?: Blob): Promise<Recording> {
  let duration = meta.clockDuration;
  let { width, height, hasAudio } = meta;
  try {
    const p = await probe(main);
    if (p.duration > 0) duration = p.duration;
    if (p.width) width = p.width;
    if (p.height) height = p.height;
    hasAudio = p.hasAudio;
  } catch {
    /* keep the clock-based values */
  }
  const id = meta.sessionId;
  const rec: Recording = {
    id,
    title: defaultTitle(new Date(meta.startedAt)),
    createdAt: meta.startedAt,
    updatedAt: Date.now(),
    duration,
    mode: meta.mode,
    width,
    height,
    fps: meta.fps,
    mime: main.type || meta.mime,
    size: main.size + (cam?.size ?? 0),
    hasAudio,
    hasCamera: meta.mode === 'cam' || !!cam || !!meta.cameraInPicture,
    lang: meta.lang,
    transcript: meta.transcript.filter((s) => s.start < duration + 1),
    transcriptRefined: false,
    markers: meta.markers.filter((m) => m.t < duration),
    edits: {
      trimStart: meta.trimStart && meta.trimStart < duration - 1 ? meta.trimStart : 0,
      trimEnd: null,
      cuts: [],
      zooms: [],
      camera: { ...meta.camera, mirror: meta.mode === 'cam' ? false : meta.camera.mirror, visible: meta.mode === 'screen-cam' ? !!cam : true },
      captionsBurnIn: false,
    },
    recovered: meta.recovered,
  };
  const media: Partial<Record<MediaKind, Blob>> = { main };
  if (cam) media.cam = cam;
  await saveNewRecording(rec, media);
  await deleteSession(id).catch(() => undefined);
  void requestPersistence();
  // Thumbnails are a nicety: save first, then add one.
  makeThumbnail(rec, main, cam)
    .then((thumb) => (thumb ? patchRecording(id, { thumbnail: thumb }) : undefined))
    .catch(() => undefined);
  return rec;
}

export async function saveTake(
  result: EngineResult,
  opts: { mode: Mode; fps: number; lang: string; camera: CameraLayout; startedAt: number },
): Promise<Recording> {
  return build(
    {
      sessionId: result.sessionId,
      mode: opts.mode,
      fps: opts.fps,
      lang: opts.lang,
      camera: opts.camera,
      mime: result.mime,
      width: result.width,
      height: result.height,
      hasAudio: result.hasAudio,
      clockDuration: result.duration,
      transcript: result.transcript,
      markers: result.markers,
      startedAt: opts.startedAt,
    },
    result.main,
    result.cam,
  );
}

/** Rebuilds a recording from the chunks a crashed tab left behind. */
export async function recoverTake(sess: RecoverySession): Promise<Recording | null> {
  const chunks = await sessionChunks(sess.id);
  const main = chunks.filter((c) => c.kind === 'main').map((c) => c.blob);
  const cam = chunks.filter((c) => c.kind === 'cam').map((c) => c.blob);
  if (!main.length) {
    await deleteSession(sess.id);
    return null;
  }
  const mime = main[0].type || sess.mime || 'video/webm';
  return build(
    {
      sessionId: sess.id,
      mode: sess.mode,
      fps: sess.fps,
      lang: sess.lang,
      camera: sess.camera,
      mime,
      width: sess.width,
      height: sess.height,
      hasAudio: sess.hasAudio,
      clockDuration: sess.elapsed,
      transcript: sess.transcript,
      markers: sess.markers,
      startedAt: sess.startedAt,
      recovered: true,
    },
    new Blob(main, { type: mime }),
    cam.length ? new Blob(cam, { type: cam[0].type || mime }) : undefined,
  );
}

// ---------------------------------------------------------------- phone app

/** Saves a finished phone screen recording into the library. */
async function importNativeTake(r: NativeRecording, lang: string): Promise<Recording> {
  const blob = await nativeRecordingBlob(r);
  return build(
    {
      sessionId: r.id,
      mode: 'screen',
      fps: 30,
      lang,
      camera: { ...DEFAULT_CAMERA, visible: false },
      mime: 'video/mp4',
      width: r.width,
      height: r.height,
      hasAudio: r.hasAudio,
      clockDuration: r.durationMs / 1000,
      transcript: [],
      markers: (r.markersMs ?? []).map((ms, i) => ({ id: uid('m'), t: ms / 1000, title: `Chapter ${i + 1}` })),
      startedAt: r.startedAt,
      trimStart: (r.trimStartMs ?? 0) / 1000,
      cameraInPicture: r.camera,
    },
    blob,
  );
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Moves every finished phone recording into the library, oldest first, then
 * deletes the phone's copy. Calls run one after another, so a take that
 * finishes while an import is underway is picked up by the next call; a take
 * that is already in the library is only cleaned up. Resolves with the takes
 * this call imported.
 */
export function importFinishedPhoneRecordings(lang: string): Promise<Recording[]> {
  const run = queue.then(async () => {
    const out: Recording[] = [];
    const { recordings } = await Native.listFinished();
    for (const r of [...recordings].sort((a, b) => a.startedAt - b.startedAt)) {
      try {
        const existing = await getRecording(r.id);
        if (!existing) out.push(await importNativeTake(r, lang));
        await Native.deleteFinished({ id: r.id });
      } catch (err) {
        console.warn('Shuttle: could not import phone recording', r.id, err);
      }
    }
    return out;
  });
  queue = run.catch(() => undefined);
  return run;
}
