"""03 Transcribe: word-level transcript.

    python cf_transcribe.py --audio audio16k.wav --out transcript.json
        [--engine auto|whisperx|faster-whisper|whisper] [--model small] [--language en] [--no-diarize]

auto tries WhisperX, then faster-whisper, then OpenAI Whisper.
Writes {"engine","language","words":[{"w","s","e"}],"segments":[{"s","e","text"}]}.
"""
import argparse
import importlib.util
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cf_common import emit, fail, log, progress, result, torch_device  # noqa: E402

ENGINES = ["whisperx", "faster-whisper", "whisper"]
DIARIZE = True
MODULE = {"whisperx": "whisperx", "faster-whisper": "faster_whisper", "whisper": "whisper"}


def default_model(engine, device):
    env = os.environ.get("CF_WHISPER_MODEL")
    if env:
        return env
    if device == "cuda":
        return "turbo" if engine == "whisper" else "large-v3"
    return "base"


def clean_words(raw):
    """raw: (text, start, end[, speaker label])."""
    words, speakers = [], {}
    for item in raw:
        text, s, e = item[0], item[1], item[2]
        text = (text or "").strip()
        if not text or s is None or e is None:
            continue
        word = {"w": text, "s": round(float(s), 3), "e": round(float(max(e, s)), 3)}
        label = item[3] if len(item) > 3 else None
        if label:
            word["sp"] = speakers.setdefault(label, len(speakers))
        words.append(word)
    return words


def diarize(whisperx, audio, out, device):
    """Speaker labels ("who's talking"). pyannote needs a Hugging Face token with its terms accepted."""
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    if not token:
        log("Set HF_TOKEN to label speakers (WhisperX diarization)")
        return out
    try:
        try:
            from whisperx.diarize import DiarizationPipeline
        except ImportError:
            DiarizationPipeline = whisperx.DiarizationPipeline
        progress(0.85, "who's talking")
        pipe = DiarizationPipeline(use_auth_token=token, device=device)
        return whisperx.assign_word_speakers(pipe(audio), out)
    except Exception as err:  # gated model, no network, old version
        log(f"Diarization skipped: {err}")
        return out


def run_whisperx(path, model_name, language, device, duration):
    import whisperx

    compute = "float16" if device == "cuda" else "int8"
    dev = "cuda" if device == "cuda" else "cpu"
    progress(0.05, "loading WhisperX")
    model = whisperx.load_model(model_name, dev, compute_type=compute, language=language or None)
    audio = whisperx.load_audio(path)
    progress(0.15, "transcribing")
    out = model.transcribe(audio, batch_size=16 if dev == "cuda" else 4)
    lang = out.get("language") or language or "en"
    progress(0.7, "aligning words")
    try:
        align_model, meta = whisperx.load_align_model(language_code=lang, device=dev)
        out = whisperx.align(out["segments"], align_model, meta, audio, dev, return_char_alignments=False)
    except Exception as err:  # no alignment model for this language
        log(f"WhisperX alignment unavailable ({err}); using segment timings")
    if DIARIZE:
        out = diarize(whisperx, audio, out, dev)
    raw, segments = [], []
    for seg in out["segments"]:
        segments.append({"s": round(seg["start"], 3), "e": round(seg["end"], 3), "text": seg.get("text", "").strip()})
        words = seg.get("words") or []
        if words:
            for w in words:
                raw.append((w.get("word"), w.get("start"), w.get("end"), w.get("speaker") or seg.get("speaker")))
        else:
            raw.extend(spread(seg.get("text", ""), seg["start"], seg["end"]))
    return lang, clean_words(raw), segments


def run_faster(path, model_name, language, device, duration):
    from faster_whisper import WhisperModel

    dev = "cuda" if device == "cuda" else "cpu"
    progress(0.03, "loading faster-whisper")
    model = WhisperModel(model_name, device=dev, compute_type="float16" if dev == "cuda" else "int8")
    segs, info = model.transcribe(path, language=language or None, word_timestamps=True, vad_filter=True)
    total = duration or getattr(info, "duration", 0) or 0
    raw, segments = [], []
    for seg in segs:
        segments.append({"s": round(seg.start, 3), "e": round(seg.end, 3), "text": seg.text.strip()})
        emit("segment", s=round(seg.start, 2), e=round(seg.end, 2), text=seg.text.strip())
        for w in seg.words or []:
            raw.append((w.word, w.start, w.end))
        if total:
            progress(0.05 + 0.93 * min(1.0, seg.end / total))
    return info.language or language, clean_words(raw), segments


def run_whisper(path, model_name, language, device, duration):
    import whisper

    progress(0.03, "loading Whisper")
    model = whisper.load_model(model_name, device="cuda" if device == "cuda" else "cpu")
    progress(0.1, "transcribing")
    out = model.transcribe(path, language=language or None, word_timestamps=True, verbose=None, fp16=device == "cuda")
    raw, segments = [], []
    for seg in out["segments"]:
        segments.append({"s": round(seg["start"], 3), "e": round(seg["end"], 3), "text": seg["text"].strip()})
        for w in seg.get("words") or []:
            raw.append((w["word"], w["start"], w["end"]))
    return out.get("language") or language, clean_words(raw), segments


def spread(text, start, end):
    """Evenly time words across a segment when a model gives no word timings."""
    words = text.split()
    if not words:
        return []
    step = (end - start) / len(words)
    return [(w, start + i * step, start + (i + 1) * step) for i, w in enumerate(words)]


RUNNERS = {"whisperx": run_whisperx, "faster-whisper": run_faster, "whisper": run_whisper}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--engine", default="auto")
    ap.add_argument("--model", default="")
    ap.add_argument("--language", default="")
    ap.add_argument("--duration", type=float, default=0)
    ap.add_argument("--no-diarize", action="store_true", help="skip speaker labels (the caller already has them)")
    args = ap.parse_args()
    global DIARIZE
    DIARIZE = not args.no_diarize

    order = ENGINES if args.engine == "auto" else [args.engine]
    available = [e for e in order if importlib.util.find_spec(MODULE[e]) is not None]
    if not available:
        fail("No Whisper engine is installed (WhisperX, faster-whisper or openai-whisper).")
    device = torch_device() if importlib.util.find_spec("torch") else "cpu"
    errors = []
    for engine in available:
        model_name = args.model or default_model(engine, device)
        started = time.time()
        try:
            lang, words, segments = RUNNERS[engine](args.audio, model_name, args.language, device, args.duration)
        except Exception as err:  # try the next engine
            errors.append(f"{engine}: {err}")
            log(f"{engine} failed: {err}")
            continue
        label = {"whisperx": "WhisperX", "faster-whisper": "faster-whisper", "whisper": "Whisper"}[engine]
        speakers = len({w["sp"] for w in words if "sp" in w})
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump({"engine": f"{label} {model_name}", "language": lang, "speakers": speakers, "words": words, "segments": segments}, fh, ensure_ascii=False)
        log(f"{label} {model_name} on {device}: {len(words)} words in {time.time() - started:.0f}s")
        progress(1)
        result(engine=f"{label} {model_name}", native=engine == "whisperx", words=len(words), language=lang, device=device, speakers=speakers)
        return
    fail("; ".join(errors))


if __name__ == "__main__":
    main()
