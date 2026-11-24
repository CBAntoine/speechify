// Shared between the pipeline (server) and the dashboard (browser).
// Nothing in here may import Node modules.

export type StageId = "source" | "moment" | "reframe" | "audio" | "caption" | "ship";

export interface StageInfo {
  id: StageId;
  n: number;
  chip: string;
  title: string;
  blurb: string;
}

export const STAGES: StageInfo[] = [
  { id: "source", n: 1, chip: "VOD", title: "SOURCE", blurb: "pull the VOD, find every cut" },
  { id: "moment", n: 2, chip: "MOMENT", title: "FIND THE MOMENT", blurb: "transcript, viral score, kill dead air" },
  { id: "reframe", n: 3, chip: "REFRAME", title: "REFRAME", blurb: "lock faces, track action, 9:16" },
  { id: "audio", n: 4, chip: "AUDIO", title: "AUDIO", blurb: "stems, clean voice, dub" },
  { id: "caption", n: 5, chip: "CAPTION", title: "CAPTIONS", blurb: "word-timed captions, batch" },
  { id: "ship", n: 6, chip: "SHIP", title: "CUT & SHIP", blurb: "trim, arrange, upscale, render" },
];

export type ToolId =
  | "ytdlp"
  | "scenedetect"
  | "whisperx"
  | "shortsgen"
  | "autoeditor"
  | "mediapipe"
  | "yolo"
  | "sam2"
  | "demucs"
  | "deepfilter"
  | "f5tts"
  | "remotion"
  | "moviepy"
  | "losslesscut"
  | "opencut"
  | "esrgan"
  | "rife"
  | "ffmpeg";

export interface ToolInfo {
  id: ToolId;
  n: number;
  name: string;
  /** GitHub owner/name. */
  repo: string;
  stage: StageId;
  /** The one-word job it does, as on the cursor labels ("01 Download"). */
  verb: string;
  /** What it does in this pipeline, one line. */
  does: string;
  /** The short pitch, as in the original thread ("Find every cut"). */
  tagline: string;
  /** What runs instead when the repo isn't installed. */
  builtin: string;
  /** Cursor and highlight colour. */
  color: string;
}

const PINK = "#ff3d6e";
const LIME = "#c8ff3d";
const CYAN = "#3ee0ff";
const VIOLET = "#a98bff";
const AMBER = "#ffb03a";

export const TOOLS: ToolInfo[] = [
  { id: "ytdlp", n: 1, name: "yt-dlp", repo: "yt-dlp/yt-dlp", stage: "source", verb: "Download", does: "Pulls the VOD from YouTube, Twitch, Kick and 1,800 other sites", tagline: "Download the source video", builtin: "Direct HTTP download (plain video links only)", color: PINK },
  { id: "scenedetect", n: 2, name: "PySceneDetect", repo: "Breakthrough/PySceneDetect", stage: "source", verb: "Cuts", does: "Finds every scene cut so shorts never start mid-transition", tagline: "Find every cut", builtin: "FFmpeg scene-change filter", color: VIOLET },
  { id: "whisperx", n: 3, name: "WhisperX", repo: "m-bain/whisperX", stage: "moment", verb: "Transcribe", does: "Word-level transcript with exact timings", tagline: "Word-level transcript + who's talking", builtin: "faster-whisper, then Whisper, then the platform's own captions", color: AMBER },
  { id: "shortsgen", n: 4, name: "AI Shorts Generator", repo: "SamurAIGPT/AI-Youtube-Shorts-Generator", stage: "moment", verb: "Score", does: "LLM highlight picking: Claude reads the transcript and scores every moment", tagline: "Find the viral moment", builtin: "Loudness + hype-word scorer (no API key needed)", color: PINK },
  { id: "autoeditor", n: 5, name: "auto-editor", repo: "WyattBlue/auto-editor", stage: "moment", verb: "Silence", does: "Cuts dead air out of each moment", tagline: "Kill every dead second", builtin: "FFmpeg silencedetect", color: LIME },
  { id: "mediapipe", n: 6, name: "MediaPipe", repo: "google-ai-edge/mediapipe", stage: "reframe", verb: "Reframe", does: "Finds the facecam and locks onto faces", tagline: "Face tracking for auto-reframe", builtin: "OpenCV face cascade", color: AMBER },
  { id: "yolo", n: 7, name: "Ultralytics YOLO", repo: "ultralytics/ultralytics", stage: "reframe", verb: "Track", does: "Tracks people and cars so the 9:16 crop follows the action", tagline: "Track people and objects", builtin: "Motion tracking (frame differencing)", color: CYAN },
  { id: "sam2", n: 8, name: "SAM 2", repo: "facebookresearch/sam2", stage: "reframe", verb: "Mask", does: "Cuts the streamer out of the facecam for the cutout layout", tagline: "Cut out anyone in one click", builtin: "MediaPipe selfie segmentation", color: VIOLET },
  { id: "demucs", n: 9, name: "Demucs", repo: "facebookresearch/demucs", stage: "audio", verb: "Stems", does: "Splits voice from game audio so the game can duck under speech", tagline: "Split voice from music", builtin: "Original mix, voice band shown for reference", color: PINK },
  { id: "deepfilter", n: 10, name: "DeepFilterNet", repo: "Rikorose/DeepFilterNet", stage: "audio", verb: "Denoise", does: "Removes mic noise and fan hum from the voice", tagline: "Studio-clean audio", builtin: "FFmpeg FFT denoiser (afftdn)", color: PINK },
  { id: "f5tts", n: 11, name: "F5-TTS", repo: "SWivid/F5-TTS", stage: "audio", verb: "Dub", does: "Dubs each short into other languages in the streamer's own voice", tagline: "Voiceover and dubbing", builtin: "Skipped (dubbing needs F5-TTS)", color: LIME },
  { id: "remotion", n: 12, name: "Remotion", repo: "remotion-dev/remotion", stage: "caption", verb: "Type", does: "Word-timed animated captions", tagline: "Animated captions in code", builtin: "libass captions burned in by FFmpeg (same look, no browser)", color: AMBER },
  { id: "moviepy", n: 13, name: "MoviePy", repo: "Zulko/moviepy", stage: "caption", verb: "Batch", does: "Batch-builds every short's cover image", tagline: "Batch-edit 50 clips at once", builtin: "FFmpeg drawtext covers", color: CYAN },
  { id: "losslesscut", n: 14, name: "LosslessCut", repo: "mifi/lossless-cut", stage: "ship", verb: "Trim", does: "Lossless raw cuts of every moment, plus a project file to fine-tune them", tagline: "Instant trims, zero re-encode", builtin: "FFmpeg stream copy (what LosslessCut does under the hood)", color: VIOLET },
  { id: "opencut", n: 15, name: "OpenCut", repo: "OpenCut-app/OpenCut", stage: "ship", verb: "Arrange", does: "Arranges the shorts into a posting order and an editable sequence", tagline: "Full timeline editor", builtin: "Posting order + an EDL sequence for any editor", color: AMBER },
  { id: "esrgan", n: 16, name: "Real-ESRGAN", repo: "xinntao/Real-ESRGAN", stage: "ship", verb: "Upscale", does: "AI upscaling for low-resolution sources", tagline: "Upscale to crisp 4K", builtin: "Lanczos scale + sharpen", color: PINK },
  { id: "rife", n: 17, name: "RIFE", repo: "hzwer/ECCV2022-RIFE", stage: "ship", verb: "Slow-mo", does: "Frame interpolation for the slow-motion replay", tagline: "Buttery 120fps slow-mo", builtin: "FFmpeg motion interpolation (minterpolate)", color: LIME },
  { id: "ffmpeg", n: 18, name: "FFmpeg", repo: "FFmpeg/FFmpeg", stage: "ship", verb: "Export", does: "Composites, encodes and exports every short", tagline: "Render and ship", builtin: "Required", color: CYAN },
];

export const TOOL: Record<ToolId, ToolInfo> = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<ToolId, ToolInfo>;

export const COLORS = { PINK, LIME, CYAN, VIOLET, AMBER };

// ── What actually ran ────────────────────────────────────────────────

export type ToolState = "idle" | "active" | "done" | "skipped" | "error";
/** native: the repo itself ran. builtin: the built-in equivalent ran. off: turned off for this job. missing: needed but not installed, step skipped. */
export type ToolMode = "native" | "builtin" | "off" | "missing";

export interface ToolRun {
  state: ToolState;
  mode?: ToolMode;
  /** Human name of what ran, e.g. "PySceneDetect 0.7.3" or "FFmpeg scene filter". */
  engine?: string;
  note?: string;
  ms?: number;
}

// ── The installed stack ──────────────────────────────────────────────

export interface StackItem {
  id: ToolId;
  available: boolean;
  version?: string;
  /** What will run for this step on this machine. */
  engine: string;
  /** How to install the real thing. */
  install?: string;
  detail?: string;
}

export interface StackReport {
  checkedAt: number;
  python?: string;
  ffmpeg?: string;
  gpu?: string;
  claude: { enabled: boolean; model: string };
  items: Record<ToolId, StackItem>;
  stars: Partial<Record<ToolId, number>>;
}

// ── Jobs ─────────────────────────────────────────────────────────────

export type Layout = "auto" | "split" | "crop" | "fit" | "cutout";
export type Privacy = "public" | "unlisted" | "private";

/** Post every shipped short when the job finishes: now, or one every N hours from startAt. */
export interface PublishPlan {
  privacy: Privacy;
  /** ISO time of the first post. With it, shorts are scheduled (YouTube publishes them). */
  startAt?: string;
  /** Hours between scheduled posts. */
  everyHours?: number;
}
export type CaptionStyle = "pop" | "karaoke" | "clean";

export interface JobOptions {
  url?: string;
  /** Local file: an uploaded file inside the job folder, or a path given to the CLI. */
  file?: string;
  /** The local file's original name, used as the VOD title. */
  sourceName?: string;
  name?: string;
  count: number;
  minSec: number;
  maxSec: number;
  layout: Layout;
  /** Share of the 9:16 frame the facecam gets in the split layout. */
  facecamShare: number;
  captions: boolean;
  captionStyle: CaptionStyle;
  hook: boolean;
  removeSilence: boolean;
  denoise: boolean;
  stems: boolean;
  /** ISO 639-1 codes to dub into, e.g. ["es","de","ja"]. */
  dub: string[];
  /** auto: AI-upscale low-res sources to 1080p. 4k: export 2160×3840. */
  upscale: "auto" | "4k" | "off";
  slowmo: boolean;
  /** Open on 1–2 s of the payoff, then rewind to the setup (cold open). */
  teaser: boolean;
  /** Hard zoom-ins on reactions and the climax. */
  punchIns: boolean;
  /** A headline box at the top for the whole short. */
  titleBar: boolean;
  /** A thin progress bar along the bottom. */
  progressBar: boolean;
  /** Mask swear words in captions and bleep them in the audio. */
  censor: boolean;
  /** Whoosh on the cold-open cut, boom on the climax zoom. */
  sfx: boolean;
  /** Use YouTube's Most replayed graph, live-chat replay and timestamped comments when the VOD has them. */
  audience: boolean;
  /** Your handle, burned small on every short (discourages reuploads). */
  watermark?: string;
  /** Paid-promotion disclosure burned into the video, e.g. "#ad". */
  disclosure?: string;
  /** Names and slang for the transcription to spell right. */
  vocabulary?: string[];
  /** Transcription language hint (ISO 639-1). Empty = detect. */
  language?: string;
  /** Extra direction for picking moments, e.g. "only funny fails". */
  instructions?: string;
  /** Post to the connected YouTube channel when the job finishes. */
  publish?: PublishPlan;
}

export const DEFAULT_OPTIONS: JobOptions = {
  count: 6,
  minSec: 15,
  maxSec: 45,
  layout: "auto",
  facecamShare: 0.42,
  captions: true,
  captionStyle: "pop",
  hook: true,
  removeSilence: true,
  denoise: true,
  stems: true,
  dub: [],
  upscale: "auto",
  slowmo: true,
  teaser: true,
  punchIns: true,
  titleBar: false,
  progressBar: false,
  censor: false,
  sfx: true,
  audience: true,
};

/** Normalised rectangle: 0..1 of the source frame. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Detection {
  label: string;
  score: number;
  box: Box;
  id?: number;
}

/** A keyframe for a moving crop: centre of the crop in normalised source coordinates, at output time t (seconds). */
export interface TrackKey {
  t: number;
  cx: number;
  cy: number;
}

export interface Word {
  w: string;
  s: number;
  e: number;
  /** Speaker index from WhisperX diarization ("who's talking"), when available. */
  sp?: number;
  /** Stressed in the captions (a word that carries the moment). */
  em?: boolean;
}

export interface Transcript {
  engine: string;
  language?: string;
  speakers?: number;
  words: Word[];
  segments: { s: number; e: number; text: string }[];
}

export type LayoutKind = "split" | "crop" | "fit" | "cutout";

export interface ResolvedLayout {
  kind: LayoutKind;
  /** Facecam crop (split and cutout). */
  facecam?: Box;
  /** Size of the moving crop over the gameplay, in normalised source units. */
  crop: { w: number; h: number };
  /** Where the moving crop's centre goes over time (output seconds). */
  track: TrackKey[];
  /** Why this layout was picked. */
  why: string;
}

export type ShortStatus = "planned" | "queued" | "rendering" | "done" | "failed";

export interface YouTubePost {
  status: "queued" | "uploading" | "processing" | "posted" | "scheduled" | "failed";
  /** Upload progress 0..1. */
  progress: number;
  privacy: Privacy;
  publishAt?: string;
  title: string;
  videoId?: string;
  url?: string;
  error?: string;
  /** Something worth knowing that isn't a failure, e.g. the channel's defaults made it private. */
  note?: string;
  postedAt?: number;
}

/** A hard zoom-in, in source seconds. */
export interface Punch {
  s: number;
  e: number;
  /** cam: the facecam panel, game: the gameplay panel, all: the whole frame. */
  panel: "cam" | "game" | "all";
  zoom: number;
  why: string;
}

export interface Short {
  id: string;
  n: number;
  title: string;
  /** The big punch line on screen, e.g. "FULL SEND." */
  hook: string;
  reason: string;
  /** 0–100. */
  score: number;
  description: string;
  hashtags: string[];
  /** The moment in the source, in seconds. */
  start: number;
  end: number;
  /** Source ranges kept after dead air is cut. */
  keep: [number, number][];
  deadAir: number;
  /** Output length in seconds, replay included. */
  duration: number;
  /** Source time to replay in slow motion at the end. */
  replayAt?: number;
  /** Cold open: source span of the payoff shown first. */
  teaser?: [number, number];
  punches?: Punch[];
  /** Words to keep highlighted in the captions. */
  emphasis?: string[];
  /** Text for the optional title bar. */
  headline?: string;
  /** What kind of moment: fail, clutch, funny, reaction… */
  category?: string;
  /** Claude's score after watching the moment (0–100). */
  watched?: number;
  layout?: ResolvedLayout;
  status: ShortStatus;
  progress: number;
  /** Paths relative to the job folder. */
  file?: string;
  cover?: string;
  raw?: string;
  dubs: { lang: string; file?: string; error?: string }[];
  qa?: { ok: boolean; notes: string[] };
  error?: string;
  /** Posting order after Arrange (1 = post first). */
  order?: number;
  /** Where it was posted on YouTube. */
  youtube?: YouTubePost;
}

export interface SourceInfo {
  title: string;
  uploader?: string;
  url?: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  vcodec?: string;
  /** Path relative to the job folder. */
  file: string;
  /** Path relative to the job folder of what the browser plays. */
  media: string;
}

export interface LiveInfo {
  /** Source time the monitor should show. */
  t?: number;
  shortId?: string;
  download?: { pct: number; speed?: string; size?: string; format?: string };
  cut?: { index: number; t: number };
  deadAir?: number;
  boxes?: Detection[];
  crop?: Box;
  facecam?: Box;
  faces?: Box[];
  mask?: Detection;
  dub?: { from: string; to: string[]; done: string[] };
  caption?: string;
  tag?: string;
  upscale?: { from: number; to: number; factor: number };
  stems?: { name: string; peaks: number[] }[];
  noise?: { before: number; after: number };
  silence?: { peaks: number[]; regions: [number, number][]; span: [number, number] };
  /** Contact sheet Claude is looking at (job-relative path). */
  sheet?: string;
  wave?: number[];
}

export interface Analysis {
  /** Whole-VOD loudness envelope, 0..1. */
  peaks: number[];
  /** Voice and game envelopes over the moments that were split into stems (else derived from the mix). */
  voice: number[];
  game: number[];
  /** Timeline thumbnails: one horizontal strip image. */
  sprite?: { file: string; count: number; w: number; h: number };
  cuts: number[];
  facecam?: Box | null;
  /** refined: the model of the second, captions-only pass. whisperError: why Whisper couldn't run. */
  transcript?: { engine: string; language?: string; words: number; speakers?: number; refined?: string; whisperError?: string };
  /** Audience interest over the VOD, 0..1 (same length as peaks), and where it came from. */
  audience?: number[];
  audienceSources?: string[];
}

export interface LogLine {
  t: number;
  level: "info" | "warn" | "error";
  tool?: ToolId;
  msg: string;
}

export type JobStatus = "queued" | "running" | "done" | "failed" | "canceled";
export type StageStatus = "pending" | "active" | "done";

export interface JobState {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  status: JobStatus;
  stage: StageId | null;
  stages: Record<StageId, StageStatus>;
  activeTool: ToolId | null;
  tools: Record<ToolId, ToolRun>;
  options: JobOptions;
  orchestrator: { engine: "claude" | "heuristic"; model?: string; note?: string; usd?: number };
  source?: SourceInfo;
  analysis: Analysis;
  shorts: Short[];
  shipped: number;
  live: LiveInfo;
  log: LogLine[];
  error?: string;
}

export interface YouTubeChannel {
  id: string;
  title: string;
  handle?: string;
  thumbnail?: string;
  subscribers?: number;
  videos?: number;
}

export interface YouTubeStatus {
  /** An OAuth client (ID + secret) is set up. */
  configured: boolean;
  connected: boolean;
  /** The redirect URI to register on a "Web application" OAuth client. */
  redirectUri: string;
  clientType?: "web" | "installed";
  channel?: YouTubeChannel;
  /** Set when the saved login stopped working (revoked, expired). */
  error?: string;
}

export interface JobSummary {
  id: string;
  name: string;
  status: JobStatus;
  createdAt: number;
  shipped: number;
  total: number;
  duration?: number;
}

export function emptyTools(): Record<ToolId, ToolRun> {
  return Object.fromEntries(TOOLS.map((t) => [t.id, { state: "idle" } satisfies ToolRun])) as Record<ToolId, ToolRun>;
}

export function emptyStages(): Record<StageId, StageStatus> {
  return Object.fromEntries(STAGES.map((s) => [s.id, "pending" satisfies StageStatus])) as Record<StageId, StageStatus>;
}

/** URL the browser uses for a file inside a job folder. */
export function fileUrl(jobId: string, rel: string): string {
  return `/api/jobs/${encodeURIComponent(jobId)}/files/${rel.split("/").map(encodeURIComponent).join("/")}`;
}
