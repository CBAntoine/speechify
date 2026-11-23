"""13 Batch: build each short's cover image with MoviePy.

    python cf_cover.py --jobs covers.json --font Anton-Regular.ttf

covers.json: [{"image": "frame.jpg", "text": "FULL SEND.", "out": "cover.jpg"}, ...]
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cf_common import fail, progress, result  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", required=True)
    ap.add_argument("--font", required=True)
    args = ap.parse_args()
    try:
        import moviepy
        from moviepy import CompositeVideoClip, ImageClip, TextClip
    except ImportError as err:
        fail(f"MoviePy isn't installed: {err}")

    with open(args.jobs, encoding="utf-8") as fh:
        jobs = json.load(fh)
    for i, job in enumerate(jobs):
        base = ImageClip(job["image"])
        w, h = base.size
        text = TextClip(
            font=args.font,
            text=job["text"].upper(),
            font_size=int(w * 0.15),
            color="white",
            stroke_color="black",
            stroke_width=max(4, int(w * 0.008)),
            method="caption",
            size=(int(w * 0.9), None),
            text_align="center",
            margin=(12, 24, 12, 48),
        )
        y = int(h * float(job.get("y", 0.42))) - text.size[1] // 2
        CompositeVideoClip([base, text.with_position(("center", y))], size=(w, h)).save_frame(job["out"], t=0, with_mask=False)
        progress((i + 1) / len(jobs))
    result(engine=f"MoviePy {getattr(moviepy, '__version__', '')}".strip(), native=True, covers=len(jobs))


if __name__ == "__main__":
    main()
