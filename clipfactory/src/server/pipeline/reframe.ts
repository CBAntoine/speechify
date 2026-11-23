import fs from "node:fs";
import path from "node:path";
import type { Box, Detection, LayoutKind, ResolvedLayout, Short } from "../../lib/types.ts";
import { py } from "../proc.ts";
import type { Ctx } from "./ctx.ts";
import { buildTrack, facecamCrop, gameCropSize, OUT_W, splitHeights, type TrackPoint } from "./layout.ts";

// Stage 03 · REFRAME — lock faces, track action, 9:16.

type Arr4 = [number, number, number, number];
const toBox = (a: Arr4 | null | undefined): Box | undefined => (a ? { x: a[0], y: a[1], w: a[2], h: a[3] } : undefined);

interface FacesOut {
  engine: string;
  native: boolean;
  kind: "facecam" | "fullcam" | "none";
  facecam: Arr4 | null;
  faces: Arr4[];
  windows: Record<string, { kind: "facecam" | "fullcam" | "none"; samples: { t: number; faces: { box: Arr4; score: number }[] }[] }>;
}

interface TrackOut {
  engine: string;
  native: boolean;
  windows: Record<string, { t: number; cx: number | null; cy: number | null; boxes: { label: string; score: number; box: Arr4; id: number | null }[] }[]>;
}

export function sourcePath(c: Ctx): string {
  const f = c.s.source!.file;
  return path.isAbsolute(f) ? f : c.path(f);
}

function windowsArg(shorts: Short[]): string {
  return shorts.map((s) => `${s.id}:${s.start.toFixed(2)}-${s.end.toFixed(2)}`).join(",");
}

const hasPython = (c: Ctx) => Boolean(c.m.py.modules?.cv2 || c.m.py.modules?.mediapipe);

export async function reframeStage(c: Ctx, shorts: Short[] = c.s.shorts) {
  c.stage("reframe");
  const faces = await findFaces(c, shorts);
  const tracks = await trackAction(c, shorts, faces);
  for (const short of shorts) resolveLayout(c, short, faces, tracks);
  const failed = await masks(c, shorts);
  for (const short of shorts.filter((s) => failed.includes(s.id))) resolveLayout(c, short, faces, tracks, "split");
  c.endStage("reframe");
}

// ── 06 Reframe: facecam + faces ────────────────────────────────────────

async function findFaces(c: Ctx, shorts: Short[]): Promise<FacesOut | null> {
  if (c.s.options.layout === "fit") {
    c.skip("mediapipe", "off", "Off", "The fit layout shows the whole frame");
    return null;
  }
  if (!hasPython(c)) {
    c.skip("mediapipe", "missing", "No face detection", "Run `npm run setup` for MediaPipe; using a centre crop");
    return null;
  }
  const item = c.m.report.items.mediapipe;
  c.begin("mediapipe", item.available ? "native" : "builtin", item.engine, item.available ? "BlazeFace, tiled for small facecams" : "MediaPipe or its model is missing");
  const out = c.path("faces.json");
  let last = 0;
  try {
    await py("cf_faces", ["--video", sourcePath(c), "--out", out, "--windows", windowsArg(shorts), "--samples", "40"], {
      signal: c.signal,
      onEvent: (e) => {
        if (e.type === "frame" && Date.now() - last > 300) {
          last = Date.now();
          // Only confident faces on the monitor; the facecam itself is found by clustering all of them.
          const fs_ = (e.faces as { box: Arr4; score: number }[]).filter((f) => f.score >= 0.75).map((f) => toBox(f.box)!);
          c.live({ t: Number(e.t), faces: fs_, boxes: undefined, crop: undefined });
        }
      },
      onLog: (l) => c.log(l, "info", "mediapipe"),
    });
  } catch (err) {
    if (c.signal.aborted) throw err;
    c.log(`Face detection failed: ${(err as Error).message}`, "warn", "mediapipe");
    c.end("mediapipe", { state: "error", note: "Failed; using a centre crop" });
    return null;
  }
  const data = JSON.parse(fs.readFileSync(out, "utf8")) as FacesOut;
  const cam = toBox(data.facecam);
  c.update((s) => {
    s.analysis.facecam = cam ?? null;
    s.tools.mediapipe = { ...s.tools.mediapipe, engine: data.engine, mode: data.native ? "native" : "builtin" };
  });
  c.live({ facecam: cam, faces: data.faces.map((f) => toBox(f)!) });
  const what = data.kind === "facecam" ? `facecam found (${data.faces.length} face${data.faces.length === 1 ? "" : "s"})` : data.kind === "fullcam" ? "full-screen camera" : "no facecam";
  c.log(`${data.engine}: ${what}`, "info", "mediapipe");
  c.end("mediapipe", { note: what });
  return data;
}

// ── 07 Track: follow the action ─────────────────────────────────────────

async function trackAction(c: Ctx, shorts: Short[], faces: FacesOut | null): Promise<TrackOut | null> {
  if (c.s.options.layout === "fit") {
    c.skip("yolo", "off", "Off", "The fit layout doesn't crop");
    return null;
  }
  if (!c.m.py.modules?.cv2) {
    c.skip("yolo", "missing", "Static centre crop", "Run `npm run setup` for motion tracking or YOLO");
    return null;
  }
  const item = c.m.report.items.yolo;
  c.begin("yolo", item.available ? "native" : "builtin", item.engine);
  const out = c.path("track.json");
  const args = ["--video", c.path("analysis.mp4"), "--out", out, "--windows", windowsArg(shorts), "--fps", "3"];
  if (faces?.facecam) args.push("--exclude", faces.facecam.join(","));
  let last = 0;
  try {
    await py("cf_track", args, {
      signal: c.signal,
      onEvent: (e) => {
        if (e.type !== "frame" || Date.now() - last < 250) return;
        last = Date.now();
        const boxes: Detection[] = ((e.boxes as { label: string; score: number; box: Arr4; id: number | null }[]) ?? []).map((b) => ({ label: b.label, score: b.score, box: toBox(b.box)!, id: b.id ?? undefined }));
        c.live({ t: Number(e.t), shortId: String(e.window), boxes, faces: undefined });
      },
      onLog: (l) => c.log(l, "info", "yolo"),
    });
  } catch (err) {
    if (c.signal.aborted) throw err;
    c.log(`Tracking failed: ${(err as Error).message}`, "warn", "yolo");
    c.end("yolo", { state: "error", note: "Failed; using a centre crop" });
    return null;
  }
  const data = JSON.parse(fs.readFileSync(out, "utf8")) as TrackOut;
  const n = Object.values(data.windows).reduce((a, w) => a + w.reduce((k, p) => k + p.boxes.length, 0), 0);
  c.update((s) => {
    s.tools.yolo = { ...s.tools.yolo, engine: data.engine, mode: data.native ? "native" : "builtin" };
  });
  c.end("yolo", { note: data.native ? `${n} detections` : "motion" });
  return data;
}

// ── Layout per short ─────────────────────────────────────────────────

function resolveLayout(c: Ctx, short: Short, faces: FacesOut | null, tracks: TrackOut | null, override?: LayoutKind) {
  const o = c.s.options;
  const src = c.s.source!;
  const cam = toBox(faces?.facecam);
  const win = faces?.windows?.[short.id];
  const camHere = Boolean(cam && (win?.kind ?? faces?.kind) === "facecam");
  let kind: LayoutKind;
  let why: string;
  switch (override ? `override-${override}` : o.layout) {
    case "override-split":
      kind = "split";
      why = "Cutout failed; facecam on top instead";
      break;
    case "split":
      kind = camHere ? "split" : "crop";
      why = camHere ? "Facecam on top, gameplay below" : "Asked for split, but no facecam in this moment";
      break;
    case "cutout":
      kind = camHere ? "cutout" : "crop";
      why = camHere ? "Streamer cut out over the gameplay" : "Asked for cutout, but no facecam in this moment";
      break;
    case "crop":
      kind = "crop";
      why = "9:16 crop that follows the action";
      break;
    case "fit":
      kind = "fit";
      why = "Whole frame over a blurred background";
      break;
    default:
      if (camHere) {
        kind = "split";
        why = "Facecam found: facecam on top, gameplay below";
      } else if (win?.kind === "fullcam") {
        kind = "crop";
        why = "Full-screen camera: 9:16 crop locked on the face";
      } else {
        kind = "crop";
        why = "No facecam: 9:16 crop that follows the action";
      }
  }

  const crop = gameCropSize(kind === "cutout" ? "crop" : kind, src.width, src.height, o.facecamShare);
  let points: TrackPoint[] = [];
  if (win?.kind === "fullcam" && kind === "crop") {
    points = win.samples.map((smp) => {
      const big = [...smp.faces].sort((a, b) => b.box[2] - a.box[2])[0];
      return big ? { t: smp.t, cx: big.box[0] + big.box[2] / 2, cy: big.box[1] + big.box[3] / 2 } : { t: smp.t, cx: null, cy: null };
    });
  } else if (tracks?.windows?.[short.id]) {
    points = tracks.windows[short.id].map((p) => ({ t: p.t, cx: p.cx, cy: p.cy }));
  }
  const cuts = c.s.analysis.cuts.filter((t) => t > short.start && t < short.end);
  const track = kind === "fit" ? [{ t: 0, cx: 0.5, cy: 0.5 }] : buildTrack(points, short.keep, crop, { cuts, avoid: kind === "split" ? cam : null });

  let facecam: Box | undefined;
  if (cam && (kind === "split" || kind === "cutout")) {
    const camFaces = (faces?.faces ?? []).map((f) => toBox(f)!);
    const aspect = kind === "split" ? OUT_W / splitHeights(o.facecamShare).top : cam.w * src.width / (cam.h * src.height);
    facecam = kind === "split" ? facecamCrop(cam, camFaces, aspect, src.width, src.height) : cam;
  }
  const layout: ResolvedLayout = { kind, facecam, crop, track, why };
  c.update((s) => {
    const sh = s.shorts.find((x) => x.id === short.id);
    if (sh) sh.layout = layout;
  });
  const k0 = track[0];
  c.live({
    t: short.start,
    shortId: short.id,
    crop: kind === "fit" ? undefined : { x: k0.cx - crop.w / 2, y: k0.cy - crop.h / 2, w: crop.w, h: crop.h },
    facecam: facecam,
    boxes: undefined,
  });
}

// ── 08 Mask: SAM 2 cutout ───────────────────────────────────────────────

/** Cut the streamer out for cutout shorts. Returns the ids that failed (they fall back to split). */
async function masks(c: Ctx, shorts: Short[]): Promise<string[]> {
  const cut = c.s.shorts.filter((s) => shorts.some((x) => x.id === s.id) && s.layout?.kind === "cutout");
  const failed: string[] = [];
  if (!cut.length) {
    c.skip("sam2", "off", c.m.report.items.sam2.engine, "Only the cutout layout uses masks");
    return failed;
  }
  const item = c.m.report.items.sam2;
  c.begin("sam2", item.available ? "native" : "builtin", item.engine);
  const cam = c.s.analysis.facecam!;
  for (const short of cut) {
    c.check();
    const out = c.path("shorts", short.id, "matte.mp4");
    try {
      const { result } = await py(
        "cf_segment",
        ["--video", sourcePath(c), "--start", short.start.toFixed(3), "--end", short.end.toFixed(3), "--rect", [cam.x, cam.y, cam.w, cam.h].join(","), "--out", out, "--fps", String(c.s.source!.fps)],
        {
          signal: c.signal,
          onEvent: (e) => {
            if (e.type === "mask") c.live({ t: short.start, shortId: short.id, mask: { label: "obj_1 · mask", score: Number(e.score), box: cam } });
          },
          onLog: (l) => c.log(l, "info", "sam2"),
        },
      );
      if (result) c.update((s) => (s.tools.sam2 = { ...s.tools.sam2, engine: String(result.engine), mode: result.native ? "native" : "builtin" }));
    } catch (err) {
      if (c.signal.aborted) throw err;
      c.log(`Couldn't cut out the streamer for ${short.id} (${(err as Error).message}); using the split layout`, "warn", "sam2");
      failed.push(short.id);
    }
  }
  c.end("sam2", { note: `${cut.length - failed.length} cutouts` });
  return failed;
}
