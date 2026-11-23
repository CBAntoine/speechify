"""Reports which Python tools are installed, fast (no heavy imports unless --gpu)."""
import importlib.metadata as md
import importlib.util
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cf_common import MODELS  # noqa: E402

MODULES = {
    # import name: distribution name
    "yt_dlp": "yt-dlp",
    "scenedetect": "scenedetect",
    "cv2": None,
    "whisperx": "whisperx",
    "faster_whisper": "faster-whisper",
    "whisper": "openai-whisper",
    "mediapipe": "mediapipe",
    "ultralytics": "ultralytics",
    "sam2": "sam2",
    "demucs": "demucs",
    "df": "deepfilternet",
    "f5_tts": "f5-tts",
    "moviepy": "moviepy",
    "torch": "torch",
    "numpy": "numpy",
}

CV2_DISTS = ["opencv-python", "opencv-python-headless", "opencv-contrib-python", "opencv-contrib-python-headless"]


def version_of(dist_names):
    for name in dist_names:
        try:
            return md.version(name)
        except md.PackageNotFoundError:
            continue
    return None


def main():
    found = {}
    for mod, dist in MODULES.items():
        spec = importlib.util.find_spec(mod)
        if spec is None:
            found[mod] = None
            continue
        found[mod] = version_of(CV2_DISTS if mod == "cv2" else [dist]) or "installed"
    out = {
        "python": sys.version.split()[0],
        "modules": found,
        "models": {
            "face": os.path.exists(os.path.join(MODELS, "mediapipe", "blaze_face_short_range.tflite")),
            "selfie": os.path.exists(os.path.join(MODELS, "mediapipe", "selfie_segmenter.tflite")),
            "yolo": os.path.exists(os.path.join(MODELS, "yolo", "yolo11n.pt")),
            "sam2": os.path.exists(os.path.join(MODELS, "sam2")),
        },
    }
    if "--gpu" in sys.argv and found.get("torch"):
        try:
            import torch

            out["cuda"] = bool(torch.cuda.is_available())
            out["gpu"] = torch.cuda.get_device_name(0) if out["cuda"] else None
            mps = getattr(torch.backends, "mps", None)
            out["mps"] = bool(mps and mps.is_available())
        except Exception as err:  # broken torch install
            out["torch_error"] = str(err)
    print(json.dumps(out))


if __name__ == "__main__":
    main()
