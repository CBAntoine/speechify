// Shared data model. Every time value is in seconds on the *source* timeline
// (the raw recording), unless a name says otherwise. Cuts are applied only when
// mapping to the output timeline (see timeline.ts).

export type Mode = 'screen-cam' | 'screen' | 'cam';

export type BubbleShape = 'circle' | 'rounded' | 'wide';

export interface CameraLayout {
  visible: boolean;
  shape: BubbleShape;
  /** Bubble height as a fraction of the frame height. */
  size: number;
  /** Bubble centre, normalized 0..1 across the frame. */
  x: number;
  y: number;
  mirror: boolean;
}

export type CutKind = 'manual' | 'silence' | 'transcript';

export interface Cut {
  id: string;
  start: number;
  end: number;
  kind: CutKind;
}

export interface Zoom {
  id: string;
  start: number;
  end: number;
  /** 1.25 .. 3 */
  scale: number;
  /** Focus point, normalized 0..1. */
  x: number;
  y: number;
}

export interface Marker {
  id: string;
  t: number;
  title: string;
}

export interface Segment {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface Edits {
  trimStart: number;
  /** null = end of recording */
  trimEnd: number | null;
  cuts: Cut[];
  zooms: Zoom[];
  camera: CameraLayout;
  captionsBurnIn: boolean;
}

export interface Summary {
  text: string;
  actionItems: string[];
  generatedAt: number;
}

export interface Recording {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Source duration in seconds. */
  duration: number;
  mode: Mode;
  /** Pixel size of the main track (screen, or camera in camera-only mode). */
  width: number;
  height: number;
  fps: number;
  mime: string;
  /** Total bytes of all media blobs. */
  size: number;
  hasAudio: boolean;
  hasCamera: boolean;
  lang: string;
  transcript: Segment[];
  transcriptRefined: boolean;
  markers: Marker[];
  edits: Edits;
  summary?: Summary;
  thumbnail?: Blob;
  recovered?: boolean;
}

export interface Analysis {
  id: string;
  /** RMS per window, linear 0..1 */
  envelope: Float32Array;
  /** windows per second */
  rate: number;
}

export type MediaKind = 'main' | 'cam';

export interface RecoverySession {
  id: string;
  startedAt: number;
  mode: Mode;
  mime: string;
  fps: number;
  width: number;
  height: number;
  hasAudio: boolean;
  hasCamera: boolean;
  lang: string;
  elapsed: number;
  transcript: Segment[];
  markers: Marker[];
  camera: CameraLayout;
}

export interface ChunkRecord {
  key?: number;
  session: string;
  kind: MediaKind;
  seq: number;
  blob: Blob;
}
