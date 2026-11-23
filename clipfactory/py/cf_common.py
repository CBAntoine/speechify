"""Shared helpers for Clip Factory's Python adapters.

Every adapter talks to the Node pipeline the same way: one JSON object per
line on stdout ({"type": "progress" | "event" | "result" | ...}), human logs
on stderr.
"""
import json
import os
import sys

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(APP_ROOT, "models")


def emit(event_type, /, **fields):
    sys.stdout.write(json.dumps({"type": event_type, **fields}, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def progress(p, msg=None):
    emit("progress", p=round(max(0.0, min(1.0, float(p))), 4), msg=msg)


def result(**fields):
    emit("result", **fields)


def log(*parts):
    print(*parts, file=sys.stderr, flush=True)


def fail(msg, code=2):
    emit("error", msg=str(msg))
    log(msg)
    sys.exit(code)


def parse_box(text):
    """'x,y,w,h' (normalised 0..1) -> tuple or None."""
    if not text:
        return None
    vals = [float(v) for v in text.split(",")]
    return tuple(vals) if len(vals) == 4 else None


def parse_windows(text):
    """'id:start-end,id2:start-end' -> [(id, start, end)]."""
    out = []
    for part in (text or "").split(","):
        part = part.strip()
        if not part:
            continue
        wid, span = part.split(":", 1)
        s, e = span.split("-", 1)
        out.append((wid, float(s), float(e)))
    return out


def model_path(*parts):
    return os.path.join(MODELS, *parts)


def torch_device():
    try:
        import torch  # noqa: WPS433

        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
    except Exception:  # torch missing or broken
        pass
    return "cpu"


def box_iou(a, b):
    ax2, ay2 = a[0] + a[2], a[1] + a[3]
    bx2, by2 = b[0] + b[2], b[1] + b[3]
    iw = max(0.0, min(ax2, bx2) - max(a[0], b[0]))
    ih = max(0.0, min(ay2, by2) - max(a[1], b[1]))
    inter = iw * ih
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


def nms(dets, iou=0.4):
    """dets: list of (box, score, label). Keeps the best of overlapping boxes."""
    keep = []
    for d in sorted(dets, key=lambda d: -d[1]):
        if all(box_iou(d[0], k[0]) < iou for k in keep):
            keep.append(d)
    return keep


class FrameReader:
    """Seeks a video with OpenCV and returns RGB frames at given times."""

    def __init__(self, path):
        import cv2

        self.cv2 = cv2
        self.cap = cv2.VideoCapture(path)
        if not self.cap.isOpened():
            fail(f"OpenCV can't open {path}")
        self.fps = self.cap.get(cv2.CAP_PROP_FPS) or 30.0
        self.width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        frames = self.cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
        self.duration = frames / self.fps if frames and self.fps else 0.0
        self.pos = None

    def at(self, t):
        """BGR frame at time t (seconds), or None."""
        cv2 = self.cv2
        frame_no = int(round(t * self.fps))
        # Reading forward a little is cheaper than seeking.
        if self.pos is None or frame_no < self.pos or frame_no - self.pos > int(self.fps * 2):
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, frame_no)
            self.pos = frame_no
        frame = None
        while self.pos <= frame_no:
            ok, frame = self.cap.read()
            if not ok:
                return None
            self.pos += 1
        return frame

    def close(self):
        self.cap.release()
