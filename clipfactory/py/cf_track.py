"""07 Track: follow the action inside each moment, so the 9:16 crop pans with it.

    python cf_track.py --video analysis.mp4 --out track.json --windows id:s-e,...
        [--fps 3] [--exclude x,y,w,h] [--engine auto|yolo|motion]

YOLO tracks people and vehicles (ByteTrack ids); the action point is a
weighted mix of the strongest, fastest-moving objects outside the facecam.
Without YOLO, frame differencing finds where the picture is moving.
"""
import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cf_common import FrameReader, emit, fail, log, model_path, parse_box, parse_windows, progress, result  # noqa: E402

CLASS_WEIGHT = {"person": 1.0, "car": 0.9, "motorcycle": 1.0, "bicycle": 0.8, "truck": 0.7, "bus": 0.7, "airplane": 0.8, "boat": 0.7, "horse": 0.8, "dog": 0.6}
CLASSES = [0, 1, 2, 3, 4, 5, 7, 8, 16, 17]  # person, bicycle, car, motorcycle, airplane, bus, truck, boat, dog, horse


def inside(box, rect, pad=0.02):
    if not rect:
        return False
    cx, cy = box[0] + box[2] / 2, box[1] + box[3] / 2
    x, y, w, h = rect
    return x - pad <= cx <= x + w + pad and y - pad <= cy <= y + h + pad


class YoloTracker:
    def __init__(self, weights):
        from ultralytics import YOLO
        import ultralytics

        self.YOLO = YOLO
        self.weights = weights
        self.name = f"Ultralytics YOLO {ultralytics.__version__} ({os.path.basename(weights)})"
        self.model = None

    def reset(self):
        self.model = self.YOLO(self.weights)
        self.last = {}

    def detect(self, frame):
        """Track with ByteTrack ids; plain detection if the tracker's dependencies are missing."""
        if getattr(self, "plain", False):
            return self.model.predict(frame, classes=CLASSES, conf=0.25, iou=0.5, imgsz=640, verbose=False)[0]
        try:
            return self.model.track(frame, persist=True, classes=CLASSES, conf=0.25, iou=0.5, imgsz=640, verbose=False)[0]
        except (ImportError, ModuleNotFoundError) as err:
            log(f"YOLO tracker unavailable ({err}); detecting without ids. pip install lap to fix.")
            self.plain = True
            self.name += " (detection only)"
            return self.detect(frame)

    def step(self, frame, t, exclude):
        res = self.detect(frame)
        boxes = []
        if res.boxes is not None and len(res.boxes):
            xyxy = res.boxes.xyxyn.tolist()
            conf = res.boxes.conf.tolist()
            cls = res.boxes.cls.tolist()
            ids = res.boxes.id.tolist() if res.boxes.id is not None else [None] * len(xyxy)
            for (x0, y0, x1, y1), c, k, tid in zip(xyxy, conf, cls, ids):
                label = res.names.get(int(k), str(int(k))) if isinstance(res.names, dict) else str(int(k))
                box = [round(x0, 4), round(y0, 4), round(x1 - x0, 4), round(y1 - y0, 4)]
                boxes.append({"label": label, "score": round(float(c), 3), "box": box, "id": None if tid is None else int(tid)})
        point = self.action_point(boxes, exclude)
        return point, boxes

    def action_point(self, boxes, exclude):
        ranked = []
        for b in boxes:
            if inside(b["box"], exclude):
                continue
            x, y, w, h = b["box"]
            cx, cy = x + w / 2, y + h / 2
            speed = 0.0
            if b["id"] is not None and b["id"] in self.last:
                px, py = self.last[b["id"]]
                speed = math.hypot(cx - px, cy - py)
            if b["id"] is not None:
                self.last[b["id"]] = (cx, cy)
            centrality = 1.25 - min(1.0, math.hypot(cx - 0.5, cy - 0.55) * 1.6)
            weight = math.sqrt(w * h) * b["score"] * CLASS_WEIGHT.get(b["label"], 0.5) * (1 + min(2.0, speed * 12)) * centrality
            ranked.append((weight, cx, cy))
        if not ranked:
            return None
        ranked.sort(reverse=True)
        top = ranked[:3]
        total = sum(r[0] for r in top)
        return (sum(r[0] * r[1] for r in top) / total, sum(r[0] * r[2] for r in top) / total)


class MotionTracker:
    name = "Motion tracking (OpenCV frame differencing)"

    def reset(self):
        self.prev = None

    def step(self, frame, t, exclude):
        import cv2
        import numpy as np

        small = cv2.resize(frame, (320, int(320 * frame.shape[0] / frame.shape[1])))
        gray = cv2.GaussianBlur(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), (5, 5), 0)
        prev, self.prev = self.prev, gray
        if prev is None:
            return None, []
        diff = cv2.absdiff(gray, prev)
        _, mask = cv2.threshold(diff, 22, 255, cv2.THRESH_BINARY)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        h, w = mask.shape
        if exclude:
            x, y, bw, bh = exclude
            mask[int(y * h) : int((y + bh) * h), int(x * w) : int((x + bw) * w)] = 0
        # Static HUD corners shouldn't pull the crop; weight towards the middle.
        ys, xs = np.nonzero(mask)
        if len(xs) < mask.size * 0.002:
            return None, []
        cx, cy = xs / w, ys / h
        weight = 1.3 - np.minimum(1.0, np.hypot(cx - 0.5, cy - 0.55) * 1.5)
        return (float(np.sum(cx * weight) / np.sum(weight)), float(np.sum(cy * weight) / np.sum(weight))), []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--windows", required=True)
    ap.add_argument("--fps", type=float, default=3.0)
    ap.add_argument("--exclude", default="")
    ap.add_argument("--engine", default="auto")
    args = ap.parse_args()

    exclude = parse_box(args.exclude)
    windows = parse_windows(args.windows)
    tracker, native = None, False
    if args.engine in ("auto", "yolo"):
        weights = model_path("yolo", "yolo11n.pt")
        try:
            import ultralytics  # noqa: F401

            if not os.path.exists(weights):
                os.makedirs(os.path.dirname(weights), exist_ok=True)
                log("YOLO weights missing; Ultralytics will download yolo11n.pt")
                cwd = os.getcwd()
                os.chdir(os.path.dirname(weights))
                try:
                    from ultralytics import YOLO

                    YOLO("yolo11n.pt")
                finally:
                    os.chdir(cwd)
            tracker, native = YoloTracker(weights), True
        except Exception as err:
            if args.engine == "yolo":
                fail(f"YOLO unavailable: {err}")
            log(f"YOLO unavailable ({err}); using motion tracking")
    if tracker is None:
        tracker = MotionTracker()

    reader = FrameReader(args.video)
    total = sum(max(1, int((e - s) * args.fps)) for _, s, e in windows)
    done = 0
    out = {}
    for wid, start, end in windows:
        tracker.reset()
        steps = max(1, int((end - start) * args.fps))
        points = []
        for i in range(steps):
            t = start + i / args.fps
            frame = reader.at(t)
            done += 1
            if frame is None:
                break
            point, boxes = tracker.step(frame, t, exclude)
            points.append({"t": round(t, 2), "cx": None if point is None else round(point[0], 4), "cy": None if point is None else round(point[1], 4), "boxes": boxes})
            if i % 3 == 0:
                emit("frame", window=wid, t=round(t, 2), boxes=boxes[:12], point=points[-1]["cx"] is not None and [points[-1]["cx"], points[-1]["cy"]])
                progress(done / max(1, total))
        out[wid] = points
    reader.close()
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump({"engine": tracker.name, "native": native, "windows": out}, fh)
    progress(1)
    result(engine=tracker.name, native=native, windows=len(out))


if __name__ == "__main__":
    main()
