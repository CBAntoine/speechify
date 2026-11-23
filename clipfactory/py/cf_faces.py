"""06 Reframe: find the facecam and lock onto faces.

    python cf_faces.py --video source.mp4 --out faces.json [--windows id:s-e,...]
        [--samples 40] [--engine auto|mediapipe|opencv]

MediaPipe's BlazeFace is a short-range (webcam) detector, so frames are also
scanned in overlapping tiles: a facecam face that is small in a 1080p frame is
large inside a tile. Faces that sit in the same place across the whole VOD are
the facecam; a straight, persistent edge around them is the overlay's border.
"""
import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cf_common import FrameReader, emit, fail, log, model_path, nms, parse_windows, progress, result  # noqa: E402

WORK_W = 1280  # detection runs on frames scaled to this width


class MediaPipeFaces:
    def __init__(self, path):
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision

        self.mp = mp
        opts = vision.FaceDetectorOptions(
            base_options=BaseOptions(model_asset_path=path),
            running_mode=vision.RunningMode.IMAGE,
            min_detection_confidence=0.55,
        )
        self.det = vision.FaceDetector.create_from_options(opts)
        self.name = f"MediaPipe {getattr(mp, '__version__', '')} BlazeFace".strip()

    def _run(self, rgb, ox, oy):
        import numpy as np

        image = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        out = []
        for d in self.det.detect(image).detections:
            bb = d.bounding_box
            score = d.categories[0].score if d.categories else 0.5
            out.append(((bb.origin_x + ox, bb.origin_y + oy, bb.width, bb.height), float(score), "face"))
        return out

    def detect(self, bgr):
        import cv2

        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        h, w = rgb.shape[:2]
        dets = self._run(rgb, 0, 0)
        for frac in (0.55, 0.33):
            size = int(min(h, w) * frac)
            stride = max(16, int(size * 0.6))
            ys = list(range(0, max(1, h - size + 1), stride))
            xs = list(range(0, max(1, w - size + 1), stride))
            if ys[-1] != h - size:
                ys.append(h - size)
            if xs[-1] != w - size:
                xs.append(w - size)
            for y0 in ys:
                for x0 in xs:
                    dets += self._run(rgb[y0 : y0 + size, x0 : x0 + size], x0, y0)
        # Tiles cut faces in half; a detection touching a tile edge is often partial.
        return nms(dets, 0.3)

    def close(self):
        # Close explicitly: MediaPipe's own __del__ fails during interpreter shutdown.
        self.det.close()


class OpenCvFaces:
    def __init__(self):
        import cv2

        self.cv2 = cv2
        path = os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml")
        self.cascade = cv2.CascadeClassifier(path)
        if self.cascade.empty():
            fail("OpenCV's face cascade is missing")
        self.name = f"OpenCV {cv2.__version__} face cascade"

    def close(self):
        pass

    def detect(self, bgr):
        cv2 = self.cv2
        gray = cv2.equalizeHist(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY))
        try:
            rects, _levels, weights = self.cascade.detectMultiScale3(gray, scaleFactor=1.1, minNeighbors=6, minSize=(28, 28), outputRejectLevels=True)
            scores = [min(1.0, max(0.3, float(w) / 6.0)) for w in weights]
        except Exception:
            rects = self.cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(28, 28))
            scores = [0.6] * len(rects)
        return nms([((int(x), int(y), int(w), int(h)), s, "face") for (x, y, w, h), s in zip(rects, scores)], 0.3)


def make_detector(engine):
    face_model = model_path("mediapipe", "blaze_face_short_range.tflite")
    if engine in ("auto", "mediapipe"):
        try:
            import mediapipe  # noqa: F401

            if os.path.exists(face_model):
                return MediaPipeFaces(face_model), True
            log("MediaPipe is installed but its face model is missing; run `npm run setup`.")
        except ImportError:
            if engine == "mediapipe":
                fail("MediaPipe isn't installed")
        except Exception as err:  # e.g. libEGL missing on a headless Linux box
            if engine == "mediapipe":
                fail(f"MediaPipe couldn't start: {err}")
            log(f"MediaPipe couldn't start ({err}); using OpenCV. On Linux: sudo apt install libegl1 libgles2")
    return OpenCvFaces(), False


def norm(box, w, h):
    x, y, bw, bh = box
    return [round(x / w, 4), round(y / h, 4), round(bw / w, 4), round(bh / h, 4)]


def cluster(samples):
    """Group face boxes that sit in the same place. samples: list of lists of (box, score)."""
    clusters = []
    for idx, faces in enumerate(samples):
        for box, score in faces:
            cx, cy = box[0] + box[2] / 2, box[1] + box[3] / 2
            best = None
            for c in clusters:
                mx, my, mw = c["cx"] / c["n"], c["cy"] / c["n"], c["w"] / c["n"]
                if math.hypot(cx - mx, cy - my) < max(0.03, 0.6 * mw) and 0.55 < box[2] / max(mw, 1e-6) < 1.8:
                    best = c
                    break
            if best is None:
                best = {"cx": 0.0, "cy": 0.0, "w": 0.0, "h": 0.0, "n": 0, "samples": set(), "score": 0.0}
                clusters.append(best)
            best["cx"] += cx
            best["cy"] += cy
            best["w"] += box[2]
            best["h"] += box[3]
            best["n"] += 1
            best["score"] += score
            best["samples"].add(idx)
    out = []
    for c in clusters:
        n = c["n"]
        w, h = c["w"] / n, c["h"] / n
        out.append(
            {
                "box": [c["cx"] / n - w / 2, c["cy"] / n - h / 2, w, h],
                "seen": len(c["samples"]),
                "score": c["score"] / n,
            }
        )
    return out


def union(boxes):
    x0 = min(b[0] for b in boxes)
    y0 = min(b[1] for b in boxes)
    x1 = max(b[0] + b[2] for b in boxes)
    y1 = max(b[1] + b[3] for b in boxes)
    return [x0, y0, x1 - x0, y1 - y0]


def edge_map(frames):
    """Share of sampled frames in which each pixel is an edge (static overlays score high)."""
    import cv2
    import numpy as np

    acc = None
    for bgr in frames:
        small = cv2.resize(bgr, (640, int(640 * bgr.shape[0] / bgr.shape[1])))
        edges = cv2.Canny(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), 60, 160)
        edges = cv2.dilate(edges, np.ones((3, 3), np.uint8))
        acc = edges.astype("float32") / 255.0 if acc is None else acc + edges.astype("float32") / 255.0
    return acc / max(1, len(frames))


def find_border(persist, faces):
    """Look for the facecam overlay's straight edges around the face union (all normalised)."""
    import numpy as np

    H, W = persist.shape
    fx, fy, fw, fh = faces
    y0, y1 = int(max(0, fy - 0.3 * fh) * H), int(min(1, fy + fh * 1.3) * H)
    x0, x1 = int(max(0, fx - 0.3 * fw) * W), int(min(1, fx + fw * 1.3) * W)

    def scan(coords, line):
        """The outermost strong, persistent straight line: the overlay's border, not a shelf behind the streamer."""
        scores = [(c, float(np.mean(line(c)))) for c in coords]
        if not scores:
            return None
        best = max(s for _, s in scores)
        if best < 0.42:
            return None
        strong = [c for c, s in scores if s >= max(0.42, best * 0.75)]
        return strong[-1]

    # A webcam frame is usually 3–5 face-widths wide; look that far for its edges.
    reach_x, reach_y = int(3.2 * fw * W) + 4, int(2.6 * fh * H) + 4
    left = scan(range(int(fx * W) - 2, max(-1, int(fx * W) - reach_x), -1), lambda c: persist[y0:y1, c])
    right = scan(range(int((fx + fw) * W) + 2, min(W, int((fx + fw) * W) + reach_x)), lambda c: persist[y0:y1, c])
    top = scan(range(int(fy * H) - 2, max(-1, int(fy * H) - reach_y), -1), lambda r: persist[r, x0:x1])
    bottom = scan(range(int((fy + fh) * H) + 2, min(H, int((fy + fh) * H) + reach_y)), lambda r: persist[r, x0:x1])

    def pick(found, edge_val, fallback, near_edge):
        if found is not None:
            return found
        return edge_val if near_edge else fallback

    L = pick(None if left is None else left / W, 0.0, max(0.0, fx - 0.9 * fw), fx < 0.2)
    R = pick(None if right is None else right / W, 1.0, min(1.0, fx + fw * 1.9), fx + fw > 0.8)
    T = pick(None if top is None else top / H, 0.0, max(0.0, fy - 0.9 * fh), fy < 0.2)
    B = pick(None if bottom is None else bottom / H, 1.0, min(1.0, fy + fh * 2.0), fy + fh > 0.8)
    found = sum(v is not None for v in (left, right, top, bottom))
    return [round(L, 4), round(T, 4), round(R - L, 4), round(B - T, 4)], found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--windows", default="")
    ap.add_argument("--samples", type=int, default=40)
    ap.add_argument("--per-window", type=int, default=6)
    ap.add_argument("--engine", default="auto")
    args = ap.parse_args()

    import cv2

    detector, native = make_detector(args.engine)
    reader = FrameReader(args.video)
    duration = reader.duration
    if duration <= 0:
        fail("Couldn't read the video's length")
    windows = parse_windows(args.windows)

    def detect_at(t):
        frame = reader.at(t)
        if frame is None:
            return None, []
        scale = WORK_W / frame.shape[1] if frame.shape[1] > WORK_W else 1.0
        work = cv2.resize(frame, (int(frame.shape[1] * scale), int(frame.shape[0] * scale))) if scale != 1.0 else frame
        h, w = work.shape[:2]
        faces = [(norm(b, w, h), s) for b, s, _ in detector.detect(work)]
        # Ignore specks: a face under 1.5% of the frame width is noise at this scale.
        faces = [(b, s) for b, s in faces if b[2] > 0.015]
        return frame, faces

    total = args.samples + len(windows) * args.per_window
    done = 0
    global_faces, frames = [], []
    times = [duration * (0.02 + 0.96 * i / max(1, args.samples - 1)) for i in range(args.samples)]
    for t in times:
        frame, faces = detect_at(t)
        done += 1
        progress(done / total)
        if frame is None:
            continue
        global_faces.append(faces)
        if len(frames) < 24:
            frames.append(frame)
        emit("frame", t=round(t, 2), faces=[{"box": b, "score": round(s, 3)} for b, s in faces])

    clusters = cluster(global_faces)
    n = max(1, len(global_faces))
    small = [c for c in clusters if c["seen"] / n >= 0.3 and c["box"][2] < 0.2]
    big = [c for c in clusters if c["seen"] / n >= 0.3 and c["box"][2] >= 0.2]
    kind, facecam, cam_faces, borders = "none", None, [], 0
    if small:
        kind = "facecam"
        cam_faces = [c["box"] for c in small]
        persist = edge_map(frames)
        facecam, borders = find_border(persist, union(cam_faces))
    elif big:
        kind = "fullcam"
        cam_faces = [c["box"] for c in big]

    def in_cam(box):
        if not cam_faces:
            return False
        cx, cy = box[0] + box[2] / 2, box[1] + box[3] / 2
        return any(abs(cx - (f[0] + f[2] / 2)) < max(0.04, f[2]) and abs(cy - (f[1] + f[3] / 2)) < max(0.04, f[3]) for f in cam_faces)

    per_window = {}
    for wid, start, end in windows:
        samples = []
        for i in range(args.per_window):
            t = start + (end - start) * (i + 0.5) / args.per_window
            _frame, faces = detect_at(t)
            done += 1
            progress(done / total)
            samples.append({"t": round(t, 2), "faces": [{"box": b, "score": round(s, 3)} for b, s in faces]})
        with_cam = sum(1 for s in samples if any(in_cam(f["box"]) for f in s["faces"]))
        with_big = sum(1 for s in samples if any(f["box"][2] >= 0.15 for f in s["faces"]))
        wkind = "none"
        if kind == "facecam" and with_cam >= max(1, len(samples) // 3):
            wkind = "facecam"
        elif with_big >= max(1, len(samples) // 2):
            wkind = "fullcam"
        per_window[wid] = {"kind": wkind, "samples": samples}

    reader.close()
    detector.close()
    out = {
        "engine": detector.name,
        "native": native,
        "kind": kind,
        "facecam": facecam,
        "borders": borders,
        "faces": [[round(v, 4) for v in b] for b in cam_faces],
        "samples": len(global_faces),
        "windows": per_window,
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh)
    progress(1)
    result(engine=detector.name, native=native, kind=kind, facecam=facecam, faces=len(cam_faces))


if __name__ == "__main__":
    main()
