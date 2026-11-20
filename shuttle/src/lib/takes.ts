// Turns a finished (or crashed) take into a saved Recording.

import type { CameraLayout, MediaKind, Mode, Recording, RecoverySession, Segment, Marker } from './types.ts';
import { deleteSession, patchRecording, requestPersistence, saveNewRecording, sessionChunks } from './db.ts';
import { makeThumbnail, probe } from './media.ts';
import { defaultTitle } from './format.ts';
import type { EngineResult } from './recorder.ts';

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
    hasCamera: meta.mode === 'cam' || !!cam,
    lang: meta.lang,
    transcript: meta.transcript.filter((s) => s.start < duration + 1),
    transcriptRefined: false,
    markers: meta.markers.filter((m) => m.t < duration),
    edits: {
      trimStart: 0,
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
