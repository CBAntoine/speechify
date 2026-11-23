"""08 Mask: cut the streamer out of the facecam (cutout layout).

    python cf_segment.py --video source.mp4 --start S --end E --rect x,y,w,h
        --out matte.mp4 [--fps 30] [--engine auto|sam2|mediapipe]

Writes a greyscale matte video (white = streamer) the size of the facecam
crop. SAM 2 is prompted with the person box on the first frame and propagates
through the clip; MediaPipe's selfie segmenter runs frame by frame.
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cf_common import FrameReader, emit, fail, log, model_path, parse_box, progress, result, torch_device  # noqa: E402


def open_writer(path, w, h, fps):
    return subprocess.Popen(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{w}x{h}", "-r", str(fps), "-i", "-",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", path],
        stdin=subprocess.PIPE,
    )


def crop_px(rect, fw, fh):
    x, y, w, h = rect
    x0, y0 = int(x * fw) & ~1, int(y * fh) & ~1
    cw, ch = int(w * fw) & ~1, int(h * fh) & ~1
    return x0, y0, max(2, min(cw, fw - x0)), max(2, min(ch, fh - y0))


def run_mediapipe(reader, times, rect, writer_args):
    import cv2
    import mediapipe as mp
    import numpy as np
    from mediapipe.tasks.python import BaseOptions, vision

    path = model_path("mediapipe", "selfie_segmenter.tflite")
    if not os.path.exists(path):
        fail("MediaPipe selfie segmenter model is missing; run `npm run setup`")
    seg = vision.ImageSegmenter.create_from_options(
        vision.ImageSegmenterOptions(base_options=BaseOptions(model_asset_path=path), running_mode=vision.RunningMode.VIDEO, output_confidence_masks=True)
    )
    writer, score_sum = None, 0.0
    for i, t in enumerate(times):
        frame = reader.at(t)
        if frame is None:
            break
        x0, y0, cw, ch = crop_px(rect, frame.shape[1], frame.shape[0])
        crop = cv2.cvtColor(frame[y0 : y0 + ch, x0 : x0 + cw], cv2.COLOR_BGR2RGB)
        res = seg.segment_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(crop)), int(t * 1000))
        mask = res.confidence_masks[-1].numpy_view()
        matte = (np.clip((mask - 0.35) / 0.3, 0, 1) * 255).astype("uint8")
        matte = cv2.GaussianBlur(matte, (5, 5), 0)
        score_sum += float(mask[mask > 0.5].mean()) if (mask > 0.5).any() else 0.0
        if writer is None:
            writer = open_writer(*writer_args(cw, ch))
        writer.stdin.write(matte.tobytes())
        if i % 10 == 0:
            progress(i / len(times))
    seg.close()
    return writer, score_sum / max(1, len(times)), f"MediaPipe {getattr(mp, '__version__', '')} selfie segmenter".strip()


def run_sam2(reader, times, rect, writer_args):
    import cv2
    import numpy as np
    import torch
    from sam2.build_sam import build_sam2_video_predictor

    ckpt = os.environ.get("CF_SAM2_CHECKPOINT") or model_path("sam2", "sam2.1_hiera_small.pt")
    cfg = os.environ.get("CF_SAM2_CONFIG") or "configs/sam2.1/sam2.1_hiera_s.yaml"
    if not os.path.exists(ckpt):
        raise RuntimeError(f"SAM 2 checkpoint not found at {ckpt}")
    device = torch_device()
    predictor = build_sam2_video_predictor(cfg, ckpt, device=device)
    tmp = tempfile.mkdtemp(prefix="cf_sam2_")
    try:
        crop_size = None
        for i, t in enumerate(times):
            frame = reader.at(t)
            if frame is None:
                break
            x0, y0, cw, ch = crop_px(rect, frame.shape[1], frame.shape[0])
            crop_size = (cw, ch)
            cv2.imwrite(os.path.join(tmp, f"{i:05d}.jpg"), frame[y0 : y0 + ch, x0 : x0 + cw])
        if crop_size is None:
            raise RuntimeError("no frames")
        cw, ch = crop_size
        with torch.inference_mode():
            state = predictor.init_state(video_path=tmp)
            # The streamer fills the middle of their own camera: prompt with that box.
            predictor.add_new_points_or_box(state, frame_idx=0, obj_id=1, box=np.array([cw * 0.12, ch * 0.08, cw * 0.88, ch * 0.99], dtype=np.float32))
            masks, scores = {}, []
            for idx, _ids, logits in predictor.propagate_in_video(state):
                prob = torch.sigmoid(logits[0, 0]).float().cpu().numpy()
                masks[idx] = (prob * 255).astype("uint8")
                scores.append(float(prob[prob > 0.5].mean()) if (prob > 0.5).any() else 0.0)
                if idx % 10 == 0:
                    progress(idx / len(times))
        writer = open_writer(*writer_args(cw, ch))
        for idx in sorted(masks):
            writer.stdin.write(cv2.resize(masks[idx], (cw, ch)).tobytes())
        return writer, sum(scores) / max(1, len(scores)), "SAM 2.1 hiera-small"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--start", type=float, required=True)
    ap.add_argument("--end", type=float, required=True)
    ap.add_argument("--rect", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--fps", type=float, default=30)
    ap.add_argument("--engine", default="auto")
    args = ap.parse_args()

    rect = parse_box(args.rect)
    reader = FrameReader(args.video)
    fps = min(args.fps, reader.fps or args.fps)
    n = max(1, int((args.end - args.start) * fps))
    times = [args.start + i / fps for i in range(n)]
    writer_args = lambda w, h: (args.out, w, h, fps)  # noqa: E731

    attempts = []
    if args.engine in ("auto", "sam2"):
        attempts.append(("sam2", run_sam2))
    if args.engine in ("auto", "mediapipe"):
        attempts.append(("mediapipe", run_mediapipe))
    for name, fn in attempts:
        try:
            writer, score, engine = fn(reader, times, rect, writer_args)
        except ImportError as err:
            log(f"{name} not installed: {err}")
            continue
        except Exception as err:
            log(f"{name} failed: {err}")
            continue
        writer.stdin.close()
        if writer.wait() != 0:
            fail("ffmpeg couldn't write the matte")
        reader.close()
        emit("mask", score=round(score, 3))
        progress(1)
        result(engine=engine, native=name == "sam2", score=round(score, 3), frames=len(times), fps=fps)
        return
    fail("No segmentation engine available (SAM 2 or MediaPipe)")


if __name__ == "__main__":
    main()
