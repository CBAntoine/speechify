"""02 Cuts: scene detection with PySceneDetect.

    python cf_scenes.py --video analysis.mp4 --out scenes.json [--threshold 3.0]

Streams {"type":"cut","t":seconds} as cuts are found and {"type":"progress"}.
"""
import argparse
import json
import os
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cf_common import emit, fail, log, progress, result  # noqa: E402


def seconds_of(tc):
    """FrameTimecode -> seconds on PySceneDetect 0.6 and 0.7+."""
    value = getattr(type(tc), "seconds", None)
    return tc.seconds if isinstance(value, property) else tc.get_seconds()


def frames_of(tc):
    value = getattr(type(tc), "frame_num", None)
    return tc.frame_num if isinstance(value, property) else tc.get_frames()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--threshold", type=float, default=3.0)
    ap.add_argument("--min-scene", type=float, default=0.6, help="seconds")
    args = ap.parse_args()

    try:
        import scenedetect
        from scenedetect import AdaptiveDetector, SceneManager, open_video
    except ImportError as err:
        fail(f"PySceneDetect isn't installed: {err}")

    video = open_video(args.video)
    fps = float(video.frame_rate)
    total = frames_of(video.duration) if video.duration else 0
    manager = SceneManager()
    manager.auto_downscale = True
    manager.add_detector(AdaptiveDetector(adaptive_threshold=args.threshold, min_scene_len=max(2, int(args.min_scene * fps))))

    done = threading.Event()

    def report():
        while not done.wait(0.5):
            if total:
                progress(video.frame_number / total)

    threading.Thread(target=report, daemon=True).start()

    def on_cut(_frame, timecode):
        emit("cut", t=round(seconds_of(timecode), 3))

    started = time.time()
    try:
        manager.detect_scenes(video=video, callback=on_cut, show_progress=False)
    finally:
        done.set()
    cuts = [round(seconds_of(s[0]), 3) for s in manager.get_scene_list()][1:]
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump({"cuts": cuts, "fps": fps}, fh)
    log(f"{len(cuts)} cuts in {time.time() - started:.1f}s")
    progress(1)
    result(cuts=len(cuts), engine=f"PySceneDetect {scenedetect.__version__}")


if __name__ == "__main__":
    main()
