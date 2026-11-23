"""11 Dub: speak translated lines in the streamer's own voice with F5-TTS.

    python cf_dub.py --ref-audio voice.wav --ref-text "what they said" --lines lines.json --out-dir dir
        [--model F5TTS_v1_Base] [--ckpt path] [--vocab path]

lines.json: [{"i": 0, "text": "¡No puede ser!"}, ...] -> dir/line_000.wav ...

F5-TTS's base model speaks English and Chinese. For other languages point
--ckpt/--vocab at a fine-tuned checkpoint (CF_F5_CKPT_<LANG> / CF_F5_VOCAB_<LANG>).
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cf_common import fail, progress, result, torch_device  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref-audio", required=True)
    ap.add_argument("--ref-text", default="")
    ap.add_argument("--lines", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--model", default="F5TTS_v1_Base")
    ap.add_argument("--ckpt", default="")
    ap.add_argument("--vocab", default="")
    args = ap.parse_args()
    try:
        from f5_tts.api import F5TTS
    except ImportError as err:
        fail(f"F5-TTS isn't installed: {err}")

    kwargs = {"model": args.model, "device": torch_device()}
    if args.ckpt:
        kwargs["ckpt_file"] = args.ckpt
    if args.vocab:
        kwargs["vocab_file"] = args.vocab
    tts = F5TTS(**kwargs)
    with open(args.lines, encoding="utf-8") as fh:
        lines = json.load(fh)
    os.makedirs(args.out_dir, exist_ok=True)
    for n, line in enumerate(lines):
        out = os.path.join(args.out_dir, f"line_{int(line['i']):03d}.wav")
        tts.infer(ref_file=args.ref_audio, ref_text=args.ref_text, gen_text=line["text"], file_wave=out, remove_silence=True)
        progress((n + 1) / len(lines))
    result(engine=f"F5-TTS {args.model}", native=True, lines=len(lines))


if __name__ == "__main__":
    main()
