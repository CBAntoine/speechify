# Builds the two Doorkeep UGC videos (1080x1920, 30 fps, H.264 + AAC) from the caption slides and voiceovers.
# Slide cuts snap to pauses in the voiceover; each slide gets a slow push-in and a short crossfade.
# Run: node render_slides.cjs && python3 build_videos.py   (from this folder, or with paths as below)
import re, subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent
FPS, XF, HOLD = 30, 0.3, 1.8   # frame rate, crossfade seconds, end-card hold after the voice ends

VIDEOS = {
    "doorkeep-ugc-a-the-receipt.mp4": ("vo-a.mp3", ["A1", "A2", "A3", "A4", "A5"], [
        "Last Friday, your fans paid about three-fifty a ticket in fees. Your venue kept zero.",
        "That's the ticket platform's cut. Every ticket, every show, all year.",
        "Doorkeep gives you your own box office, paid into your own Stripe. One honest price, still lower than fans pay now, and you keep about a dollar a ticket.",
        "Three hundred tickets a week? That's about sixteen grand a year. No monthly fee: we only earn seventy-five cents when you sell.",
        "Want your number? Tap below, and we'll run your last month of shows."],
        [6.10, 11.10, 20.52, 28.23]),
    "doorkeep-ugc-b-doors-at-7.mp4": ("vo-b.mp3", ["B1", "B2", "B3", "B4", "B5"], [
        "If you run a room that holds three hundred people, this one's for you.",
        "Right now, a ticket site sits between you and every fan. It takes a fee on each ticket, owns the checkout, and makes your fans pay more.",
        "We build you your own box office in seven days. Your logo, your domain, your Stripe account. Door staff scan tickets on their phones. Your list is yours.",
        "Fans see one all-in price, usually lower than they pay now, and the booking fee stays with the house. No monthly fee.",
        "Doorkeep. Own the door. Book a ten-minute fee check: link below."],
        [3.82, 12.92, 23.44, 31.06]),
}
# The fixed cut times above are the midpoints of the pauses that end each spoken line, read from
# `ffmpeg -af silencedetect` on these exact voiceovers. If a voiceover is regenerated, set its cuts to None
# to fall back to automatic snapping, then check the printed pause list against the sentence ends.

def duration(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)]))

def silences(path):
    log = subprocess.run(["ffmpeg", "-i", str(path), "-af", "silencedetect=n=-35dB:d=0.22", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", log)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", log)]
    return [(s + e) / 2 for s, e in zip(starts, ends)]

for name, (vo, slides, lines, fixed_cuts) in VIDEOS.items():
    audio = HERE / vo
    total = duration(audio)
    words = [len(l.split()) for l in lines]
    bounds, acc = [], 0
    if fixed_cuts:
        bounds = list(fixed_cuts)
    else:
        mids = silences(audio)
        for w in words[:-1]:                  # proportional estimate, snapped to the nearest pause within 1.8 s
            acc += w
            est = total * acc / sum(words)
            near = min(mids, key=lambda m: abs(m - est), default=est)
            bounds.append(near if abs(near - est) <= 1.8 else est)
        print(f"{name}: pauses at " + ", ".join(f"{m:.2f}" for m in mids) + " (check these against sentence ends)")
    cuts = [0.0] + bounds + [total]
    durs = [cuts[i + 1] - cuts[i] for i in range(len(slides))]
    durs[-1] += HOLD
    inputs, filters = [], []
    for i, (sid, d) in enumerate(zip(slides, durs)):
        length = d + (XF if i < len(slides) - 1 else 0)
        frames = int(round(length * FPS))
        inputs += ["-loop", "1", "-framerate", str(FPS), "-t", f"{length:.3f}", "-i", str(HERE / "slides" / f"{sid}.png")]
        filters.append(f"[{i}:v]scale=1620:2880,zoompan=z='1+0.04*on/{frames}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
                       f":s=1080x1920:fps={FPS},format=yuv420p,setpts=PTS-STARTPTS[v{i}]")
    chain, offset = "v0", 0.0
    for i in range(1, len(slides)):
        offset += durs[i - 1]
        filters.append(f"[{chain}][v{i}]xfade=transition=fade:duration={XF}:offset={offset:.3f}[x{i}]")
        chain = f"x{i}"
    a = len(slides)
    inputs += ["-i", str(audio)]
    filters.append(f"[{a}:a]apad[aout]")
    video_len = sum(durs)
    cmd = ["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(filters), "-map", f"[{chain}]", "-map", "[aout]",
           "-t", f"{video_len:.3f}", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", str(FPS),
           "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(OUT / name)]
    subprocess.run(cmd, check=True)
    print(f"{name}: {video_len:.1f}s; cuts at " + ", ".join(f"{c:.2f}" for c in bounds) + f" (voice {total:.2f}s)")
