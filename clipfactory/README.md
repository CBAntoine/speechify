# Clip Factory /18

Turn a long gameplay VOD with a facecam into captioned 9:16 shorts, and post them to your YouTube channel. Paste a YouTube, Twitch or Kick link (or drop a recording), and Clip Factory pulls it, finds the moments worth posting, puts the facecam on top and the action below, cleans the audio, adds word-timed captions and a hook, exports platform-ready MP4s with titles and hashtags, and can post them as Shorts, right away or on a schedule.

Up to 18 open-source repos do the work, with Claude (Opus 5.5) as the orchestrator that picks the moments. Every step shows up live in a dashboard modelled on the "Clip Factory /18" video: program monitor, 9:16 output, inspector, render queue, timeline and the 18-repo stack.

It runs on your own computer. There's no subscription. Claude costs about $0.10–0.30 per VOD, and only if you add an API key.

```
VOD → find the moment → reframe → audio → caption → ship
```

## Run it

You need **Node.js 22+**, **FFmpeg** and **Python 3.11 or 3.12**.

```bash
cd clipfactory
npm install
npm run setup            # Python tools + models into ./.venv, ./models, ./tools (about 1.5 GB)
npm run dev              # http://127.0.0.1:3200
```

- `npm run setup -- --full` adds WhisperX, YOLO, Demucs, Real-ESRGAN and RIFE (PyTorch, several GB; best with an NVIDIA GPU or Apple Silicon). Add `--cpu` for the smaller CPU-only PyTorch.
- `npm run setup -- --dub` adds F5-TTS for dubbing. `--sam2` adds SAM 2 for the cutout layout. `--all` installs everything.
- `npm run doctor` shows, for each of the 18 steps, whether the real repo runs or a built-in equivalent does.
- Copy `.env.example` to `.env.local` and add `ANTHROPIC_API_KEY` so Claude picks the moments. Without it, a built-in scorer picks them (loudness spikes, hype words, laughter), and everything else works the same.

### From the terminal

```bash
npm run factory -- "https://www.youtube.com/watch?v=…" --count 8
npm run factory -- ~/Videos/stream.mp4 --layout split --dub es,de --upscale 4k
```

Options: `--count`, `--min`/`--max` (seconds), `--layout auto|split|crop|fit|cutout`, `--style pop|karaoke|clean`, `--no-captions`, `--no-hook`, `--keep-silence`, `--no-stems`, `--no-denoise`, `--no-slowmo`, `--dub es,de,ja`, `--upscale auto|4k|off`, `--lang en`, `--direction "only the funniest fails"`.

### No VOD handy?

`npm run demo-vod` renders a 90-second fake stream (scene cuts, HUD, explosions, dead air and a synthesised streamer voice) with a matching `.srt`. Pass `--face photo.jpg` to put a real face in the facecam so the facecam detection has something to find.

## What you get

Everything lands in `workspace/<job>/export/`:

| File | What it is |
| --- | --- |
| `SHORT_01.mp4` … | 1080×1920 H.264/AAC, −14 LUFS, faststart, numbered in posting order (best first) |
| `SHORT_01.jpg` … | Cover image: the climax frame with the hook |
| `SHORT_01.es.mp4` … | Dubbed versions (same picture, captions stay in the original language) |
| `raw/SHORT_01_raw.mp4` … | Lossless raw cut of each moment from the source, for re-editing |
| `shorts.csv` / `shorts.json` | Title, description, hashtags, score, QA notes for each short |
| `selects.edl` | Every kept range in posting order, for DaVinci Resolve or Premiere |
| `project.llc` | LosslessCut project; a copy sits next to the source so LosslessCut opens it automatically |

The dashboard's **Shipped** shelf has download buttons, a "Copy post" button and a **Post** button for each short.

## Post to YouTube

Clip Factory can post straight to your channel: one short at a time (edit the title and description first), all of them at once, spaced out on a schedule, or automatically when a job finishes.

### Connect your channel (once, about five minutes)

It uses your own Google OAuth client, so your login stays on your computer:

1. In Google Cloud Console, create a project and enable the [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com).
2. In [Google Auth Platform](https://console.cloud.google.com/auth/overview), set up the OAuth consent screen: user type **External**, and add your Google account as a test user. While the app is in **Testing**, Google ends the login after 7 days. Press **Publish app** under Audience to stay connected. Google will warn that it hasn't verified the app; it's your own app, so choose Advanced → continue.
3. [Create an OAuth client ID](https://console.cloud.google.com/auth/clients) of type **Desktop app** and download its JSON. A Web application client works too; register `http://127.0.0.1:3200/` as its redirect URI.
4. In the dashboard, press **Connect YouTube**, drop the JSON in, and sign in with Google.

The login is saved in `.secrets/` (git-ignored, readable only by your user). Disconnect from the channel menu in the header.

### Posting

- **Post** on a shipped short: edit the title and description, pick Public, Unlisted or Private, and post now or schedule it.
- **Post all to YouTube** posts every short not posted yet, in posting order (best first): all now, one now and the rest spaced out, or starting at a time you pick. Scheduled videos stay private until their time and then YouTube publishes them, so your computer can be off.
- **Post to YouTube when done** on the new-VOD form does the same automatically when the job finishes.
- From the terminal: `npm run factory -- <link> --post public --every 6`. Connect once in the dashboard first.

Each post uses the title, description and hashtags Clip Factory wrote, with `#Shorts` and a link to the full stream, in the Gaming category, marked not made for kids. Vertical videos up to 3 minutes count as Shorts on YouTube. Uploads go in resumable 8 MiB chunks, so a dropped connection carries on where it stopped. The card shows progress, then the link once YouTube has the video.

Uploads count against your Google Cloud project's YouTube API quota and YouTube's own daily upload limit for the channel. If you hit either, the short shows why and you can post it again later.

## The 18 repos, and what runs when one isn't installed

Each step uses the real repo when it's installed and a built-in equivalent when it isn't. The stack panel marks which one ran for each step (hover a row for details).

| # | Repo | Job here | Built-in equivalent |
| --- | --- | --- | --- |
| 01 | [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Downloads the VOD (H.264 ≤1080p, info, platform captions) | Direct download of plain video links |
| 02 | [PySceneDetect](https://github.com/Breakthrough/PySceneDetect) | Finds every scene cut; shorts snap to them | FFmpeg scene filter |
| 03 | [WhisperX](https://github.com/m-bain/whisperX) | Word-level transcript; speaker labels with `HF_TOKEN` | faster-whisper (installed by default) → Whisper → the platform's own captions → a sidecar `.srt` |
| 04 | [AI Shorts Generator](https://github.com/SamurAIGPT/AI-Youtube-Shorts-Generator) | Its technique, an LLM reading the transcript, done by Claude: picks and scores moments, writes hooks and titles | Loudness + hype-word scorer |
| 05 | [auto-editor](https://github.com/WyattBlue/auto-editor) | Cuts dead air inside each moment | FFmpeg silencedetect |
| 06 | [MediaPipe](https://github.com/google-ai-edge/mediapipe) | Finds the facecam (faces that never move, plus the overlay's border) and frames the faces | OpenCV face cascade |
| 07 | [Ultralytics YOLO](https://github.com/ultralytics/ultralytics) | Tracks people and vehicles so the 9:16 crop follows the action | Motion tracking (frame differencing) |
| 08 | [SAM 2](https://github.com/facebookresearch/sam2) | Cuts the streamer out for the cutout layout | MediaPipe selfie segmentation |
| 09 | [Demucs](https://github.com/facebookresearch/demucs) | Splits voice from game audio, so the game ducks under speech | The original mix |
| 10 | [DeepFilterNet](https://github.com/Rikorose/DeepFilterNet) | Cleans the voice stem (standalone `deep-filter` binary, no PyTorch) | FFmpeg afftdn |
| 11 | [F5-TTS](https://github.com/SWivid/F5-TTS) | Dubs each short in the streamer's own voice (Claude translates) | Off |
| 12 | [Remotion](https://github.com/remotion-dev/remotion) | Animated word-timed captions | libass via FFmpeg: the same word-pop look without a browser (this is what runs) |
| 13 | [MoviePy](https://github.com/Zulko/moviepy) | Batch: renders every short's plate, then the covers | FFmpeg drawtext covers |
| 14 | [LosslessCut](https://github.com/mifi/lossless-cut) | Lossless raw cuts plus a `.llc` project to fine-tune them | FFmpeg stream copy, which is what LosslessCut uses |
| 15 | [OpenCut](https://github.com/OpenCut-app/OpenCut) | Arranges the shorts into posting order and a sequence | Posting order + EDL for any editor |
| 16 | [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) | AI upscale for sub-1080p sources, or a 4K export | Lanczos + sharpen |
| 17 | [RIFE](https://github.com/hzwer/ECCV2022-RIFE) | Smooth slow-motion replay of the climax | FFmpeg minterpolate |
| 18 | [FFmpeg](https://github.com/FFmpeg/FFmpeg) | Composites, encodes, normalises loudness, exports | Required |

Some of these are honest approximations, worth knowing about:

- **AI Shorts Generator** is a script, not a library. Clip Factory uses its idea (an LLM picks highlights from the transcript) with Claude as the LLM.
- **Remotion, OpenCut and LosslessCut** are apps rather than pipeline libraries. Captions are rendered with libass, the arranged sequence is exported as an EDL (OpenCut can import the finished shorts), and the LosslessCut project opens the source with every moment marked.
- **F5-TTS's base model speaks English and Chinese.** For other languages, set `CF_F5_CKPT_<LANG>`/`CF_F5_VOCAB_<LANG>` to a fine-tuned checkpoint. Dubbing also needs Demucs (to remove the original voice) and Claude (to translate).
- **Real-ESRGAN and RIFE** are the ncnn builds, which need a Vulkan GPU. Without one, the built-in equivalents run.

## How a short is made

1. **Source.** yt-dlp downloads the VOD. One FFmpeg pass makes a 10 fps 640px analysis proxy, 16 kHz audio and, if needed, a browser preview. PySceneDetect finds the cuts.
2. **Moment.** WhisperX transcribes. Claude reads the transcript and the loudness spikes and returns the best moments, each with start, end, climax, hook, title, description, hashtags and a score. Clips start and end on sentence boundaries. auto-editor removes pauses longer than 0.45 s, but never so many that a short drops under your minimum length.
3. **Reframe.** MediaPipe samples about 40 frames. Faces that stay in the same place across the VOD are the facecam, and the outermost persistent straight edge around them is the overlay's border. YOLO tracks the action at 3 fps outside the facecam, and a virtual camera (median filter, dead zone, speed limit, hard cuts at scene changes) turns that into a smooth 9:16 pan that never shows the facecam twice.
4. **Audio.** Demucs splits voice and game audio, DeepFilterNet cleans the voice, and the game ducks under the voice. For dubs, Claude translates each line and F5-TTS speaks it in the streamer's voice, fitted to the original timing.
5. **Captions.** Word-timed pages of up to 3 words, with the spoken word popping in the accent colour (coloured per speaker when WhisperX labels them). The hook sits on the seam between facecam and gameplay for the first 2.4 s. MoviePy batches the plates and covers.
6. **Ship.** Lossless raw cuts, posting order, optional AI upscale, a ×0.35 slow-motion replay of the climax, then the final encode. A QA check (size, length, audio, loudness) runs before each short counts as shipped.

## Settings

All optional. Put them in `.env.local`.

| Variable | Does |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude picks the moments, writes hooks and titles, and translates dubs. Model `claude-opus-5-5` (`CLAUDE_MODEL` to change). |
| `HF_TOKEN` | Speaker labels in WhisperX ("who's talking"; accept the pyannote model terms on Hugging Face first). |
| `CF_WHISPER_MODEL` | Whisper model (default `base` on CPU, `large-v3` on GPU). |
| `CF_MAX_JOBS` | Jobs that run at once (default 1; each job already uses every core). |
| `CF_WORKSPACE` | Where jobs are stored (default `./workspace`). |
| `CF_PYTHON` | A different Python for the helper scripts. |
| `CF_GITHUB_TOKEN` | Raises the GitHub rate limit for the star counts in the header. |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` | Your Google OAuth client, instead of dropping its JSON into the dashboard. |
| `CF_ALLOWED_HOSTS` | Other hostnames allowed to use the server (for example your computer's LAN name). |

## Notes

- The server listens on 127.0.0.1 only, and only Clip Factory's own pages can make changes: requests from other websites are refused, so a page you visit can't post to your channel. To use it from your phone on the same WiFi, run `npx next dev --port 3200 --hostname 0.0.0.0` and add your computer's address to `CF_ALLOWED_HOSTS`. Don't expose it to the internet: anyone who can reach it can post to your channel.
- On a CPU, a 90-second test VOD becomes 3 shorts in about 3 minutes. Most of the time goes to the slow-motion replay (minterpolate) and the final encodes. A GPU and `--full` make the AI steps fast.
- On headless Linux, MediaPipe needs `sudo apt install libegl1 libgles2`. Without them it falls back to OpenCV.
- Only clip streams you have the rights to post.
- Tests: `npm test` covers the captions, layout and tracking maths, moment picking, dead-air cutting, subtitle parsing, the Claude request, and YouTube login, upload and scheduling (both against mock servers).
