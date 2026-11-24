# Clip Factory /18

Turn a long gameplay VOD with a facecam into captioned 9:16 shorts, and post them to YouTube, TikTok and Instagram. Or let it run your clipping business: it finds who to clip, takes their new VODs as they're published, makes the shorts, posts them across your accounts, and tracks what each paid campaign owes you. Paste a YouTube, Twitch or Kick link (or drop a recording), and Clip Factory pulls it, finds the moments worth posting, puts the facecam on top and the action below, cleans the audio, cuts each short like an editor would (a cold open on the payoff, punch-in zooms, a whoosh into the cut, word-timed captions with the key words lit), exports platform-ready MP4s with titles and hashtags, and can post them as Shorts, right away or on a schedule.

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

Options: `--count`, `--min`/`--max` (seconds), `--layout auto|split|crop|fit|cutout`, `--style pop|karaoke|clean`, `--no-captions`, `--no-hook`, `--keep-silence`, `--no-stems`, `--no-denoise`, `--no-slowmo`, `--no-teaser`, `--no-punch`, `--no-sfx`, `--title-bar`, `--progress-bar`, `--censor`, `--no-audience`, `--dub es,de,ja`, `--upscale auto|4k|off`, `--lang en`, `--direction "only the funniest fails"`.

### No VOD handy?

`npm run demo-vod` renders a 90-second fake stream (scene cuts, HUD, explosions, dead air and a synthesised streamer voice) with a matching `.srt`. Pass `--face photo.jpg` to put a real face in the facecam so the facecam detection has something to find.

## What you get

Everything lands in `workspace/<job>/export/`:

| File | What it is |
| --- | --- |
| `SHORT_01.mp4` … | 1080×1920 H.264 High (x264 slow, CRF 18, BT.709) and AAC at −14 LUFS, faststart, numbered in posting order (best first) |
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

## Run it as a clipping business

Open **Business** (top of the dashboard, or http://127.0.0.1:3200/business). [docs/clipping-playbook.md](docs/clipping-playbook.md) has the research behind it: how the top clipping tools work, how clippers get paid, the platform rules, and a top earner's workflow mapped to what this automates.

### Set up (once)

1. **Sources & keys.** Each is optional; add the ones for where your creators are.
   - **Twitch:** make an app at [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) (any OAuth redirect URL), then paste its client ID and secret. This gives live viewers, new VODs, and the clips viewers make.
   - **Kick:** make an app at kick.com/settings/developer. This gives who's live and how many are watching. Kick's API doesn't list VODs, so paste Kick VOD links into New VOD yourself.
   - **YouTube:** an API key (Google Cloud → YouTube Data API v3), or just your connected channel. This gives channels' new long videos and trending long-form.
2. **Creators.** Paste channel links. Mark each one's permission:
   - A **paid campaign** on file counts as permission.
   - **Allowed:** they've said clips are welcome. Note where.
   - **Ask first:** the default. Ranked, never clipped.
   - **No clips.**
3. **Campaigns.** For each campaign you join (Content Rewards at contentrewards.com/c/discover, Vyro, a streamer's Discord), enter:
   - its rate per 1,000 views, the views it pays after, its cap and fee;
   - its submission window: 30 minutes on Content Rewards, where only views after you submit count;
   - its rules: required caption text, hashtags, mentions, platforms, length, an on-screen "#ad", and direction for Claude.
4. **Accounts.** Your connected YouTube channel appears by itself.
   - **TikTok:** make a **Desktop** app at developers.tiktok.com with Login Kit and the Content Posting API, and register `http://127.0.0.1:3200/api/accounts/tiktok/callback` as its redirect URI. Then press Connect.
     - **Drafts mode** sends each short to your TikTok inbox and you tap Post. It works before TikTok audits your app, with at most 5 drafts waiting at a time.
     - **Direct post** needs TikTok's audit before it can post publicly. Until then, it only posts private videos to a private account.
   - **Instagram Reels:** paste a long-lived token for a Business or Creator account. Meta documents direct video uploads for **Facebook Login for Business** tokens (`EAA…`, Instagram linked to a Facebook Page). An Instagram Login token (`IG…`) may be refused for uploads.
   - Give an account one or more creators to make it a theme page. Accounts with none take anyone. Each short goes to one account per platform.
5. **Autopilot settings:** how often to scan, VODs per day, shorts per VOD, the lowest score worth posting, posting hours, the gap between posts, your watermark handle, the edit options. Optionally, "Ask me before posting".

### Then

Turn the autopilot on. The dashboard's server runs it (so does `npm run autopilot` on an always-on machine; only one runs at a time). Each scan:

1. **Ranks your creators.** Score = pay 35% + audience 25% + a fresh unclipped VOD 20% + community clipping 10% + your own results 10%, each shown with its reasons.
2. **Clips the best new VODs** from creators you may clip, up to your daily limit. Each job carries:
   - the campaign's rules and length limits;
   - the creator's word list (for names and slang in the captions);
   - what has worked for you with that creator, as direction for Claude.
3. **Fast lane (optional, Twitch):** turns the clips viewers made in the last few hours into shorts.
4. **Schedules** each finished job's shorts that clear your score bar: one account per platform, inside posting hours, spaced out, under each account's daily limit.
5. **Posts** them when their slot comes. YouTube uploads early and publishes itself at its time.
6. **Refreshes views** every 3 hours and works out what each campaign owes: its rate, threshold, cap and fee, and only views after submission where the campaign works that way.

Campaigns don't take submissions through an API (Content Rewards has none). When a post goes live, it appears under **Submit to campaigns** with the campaign's countdown. Turn on **Alert me** for a browser notification, copy the link, submit it on the campaign page, and press **Submitted**. If you can't always be there within 30 minutes, turn on **Ask me before posting** and post when you are. Record payouts as they arrive.

From the terminal: `npm run autopilot` runs it, `npm run autopilot -- --scout` ranks your creators and suggests new ones, and `npm run autopilot -- --stats` prints earnings and what's left to submit.

### Limits worth knowing

- **Permission matters more than any feature.** A campaign licenses its footage for its own clips only. Clip anyone else only with their written permission.
- **Platforms' originality rules apply regardless of permission.**
  - YouTube's reused-content policy can stop a clip channel's monetisation; campaign payouts don't depend on it.
  - TikTok and Instagram push unoriginal reposts down.
  - Posting the same file to two accounts on one platform links them, which is why each short goes to one account per platform.
- **Keep the pace human.** Defaults: 4–5 posts per account per day. Bulk automation and coordinated account networks break TikTok's rules. Never buy views: it gets you banned from every campaign.
- **Read-only where the API is.** Discovery only reads what Twitch, Kick and YouTube publish through their APIs, and keeps Twitch data for 24 hours at most (Twitch's terms). Nothing scrapes Kick or the campaign sites.

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
2. **Moment.** WhisperX transcribes. For YouTube VODs, yt-dlp also fetches what viewers did: the Most replayed graph, the live-chat replay (message rate, laughs, "clip it") and comments that cite a timestamp. Claude reads the transcript, the loudness spikes and those audience signals, proposes about twice as many moments as you asked for, then looks at a contact sheet of six frames from each and keeps the ones that hold up on screen. Each moment comes with a climax, a cold-open window, a hook, a headline, the words to stress, a title, description, hashtags and a score. Clips start and end on sentence boundaries. A second Whisper pass with the most accurate model re-transcribes just the chosen minutes for the captions. auto-editor removes pauses longer than 0.45 s, but never so many that a short drops under your minimum length.
3. **Reframe.** MediaPipe samples about 40 frames. Faces that stay in the same place across the VOD are the facecam, and the outermost persistent straight edge around them is the overlay's border. YOLO tracks the action at 3 fps outside the facecam, and a virtual camera (median filter, dead zone, speed limit, hard cuts at scene changes) turns that into a smooth 9:16 pan that never shows the facecam twice.
4. **Audio.** Demucs splits voice and game audio, DeepFilterNet cleans the voice, and the game ducks under the voice. For dubs, Claude translates each line and F5-TTS speaks it in the streamer's voice, fitted to the original timing.
5. **Captions and edit.** The short opens on 1–3 s of the payoff, flashes, and rewinds to the setup (or, without a cold open, ends on a ×0.35 slow-motion replay). Hard punch-in zooms land on the payoff (gameplay panel) and the loudest reactions (facecam panel). Word-timed pages of up to 3 words, with the spoken word popping in the accent colour (coloured per speaker when WhisperX labels them) and the words that carry the moment lit in yellow. The hook rides the cold open. Optional: a headline box across the top, a progress bar, and swearing masked and bleeped. MoviePy batches the plates and covers.
6. **Ship.** Lossless raw cuts, posting order, optional AI upscale, a whoosh into each cut and a hit under the payoff zoom, then the final encode: x264 slow at CRF 18, colour converted and tagged BT.709 (SD sources converted from BT.601, HDR tone-mapped), and loudness measured first, then set to −14 LUFS with one gain and a peak limiter. A QA check (size, length, audio, loudness within 1.5 LU) runs before each short counts as shipped.

## What makes the shorts good

The parts of a short that decide whether people keep watching, and what Clip Factory does about each:

- **Picking.** Loud isn't the same as good. Claude reads the whole transcript with the loudness spikes and, for YouTube VODs, where viewers rewatched, where chat exploded and which moments commenters cite. Then it looks at frames from each candidate and drops the ones that are menus, loading screens or don't make sense without context. Without an API key, the built-in scorer uses the same audience signals.
- **The first second.** A cold open puts the payoff first, with the hook on it, so the first frame already shows why to watch. A white flash and a whoosh mark the cut back to the setup.
- **Pacing.** Dead air is cut, every clip starts and ends on a sentence, and punch-in zooms (at least 3 s apart, never across a cut) land on the payoff and the biggest reactions.
- **Captions.** Exact word timings from a second, more accurate transcription of just the chosen minutes. Three words a page, the spoken word pops, key words stay lit, speakers get their own colour.
- **Sound.** Voice split from the game, cleaned, and the game ducked under it. Effects are synthesised, so there's nothing to license. Loudness is measured and set exactly, so every short plays at the level Shorts, TikTok and Reels normalise to, without the pumping of one-pass normalisation.
- **Picture.** Crops that track the action and keep clear of the facecam, colour that matches the source (BT.601 sources converted, HDR tone-mapped), a near-lossless intermediate, and a slow-preset x264 final with adaptive quantisation that keeps dark game scenes clean.

## Settings

All optional. Put them in `.env.local`.

| Variable | Does |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude picks the moments, writes hooks and titles, and translates dubs. Model `claude-opus-5-5` (`CLAUDE_MODEL` to change). |
| `HF_TOKEN` | Speaker labels in WhisperX ("who's talking"; accept the pyannote model terms on Hugging Face first). |
| `CF_WHISPER_MODEL` | Whisper model for the whole VOD (default `base` on CPU, `large-v3` on GPU). |
| `CF_WHISPER_CAPTION_MODEL` | Model for the second, captions-only pass over the chosen moments (default `large-v3-turbo` on CPU, `large-v3` on GPU; `off` to skip it). |
| `CF_MAX_JOBS` | Jobs that run at once (default 1; each job already uses every core). |
| `CF_WORKSPACE` | Where jobs are stored (default `./workspace`). |
| `CF_PYTHON` | A different Python for the helper scripts. |
| `CF_GITHUB_TOKEN` | Raises the GitHub rate limit for the star counts in the header. |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` | Your Google OAuth client, instead of dropping its JSON into the dashboard. |
| `CF_ALLOWED_HOSTS` | Other hostnames allowed to use the server (for example your computer's LAN name). |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | Your Twitch app, instead of entering it under Business → Sources & keys. |
| `KICK_CLIENT_ID` / `KICK_CLIENT_SECRET` | Your Kick app. |
| `YOUTUBE_API_KEY` | YouTube Data API key for the scout (otherwise it uses your connected channel). |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` / `TIKTOK_REDIRECT_URI` | Your TikTok app. |
| `CF_AUTOPILOT` | `off` keeps the dashboard's server from running the autopilot (when `npm run autopilot` runs it elsewhere). |
| `CF_CLIP_LANE_MIN_VIEWS` | Views a viewer's Twitch clip needs before the fast lane takes it (default 2000). |
| `CF_IG_API_VERSION` | Graph API version for Instagram (default `v24.0`). |

## Notes

- The server listens on 127.0.0.1 only, and only Clip Factory's own pages can make changes: requests from other websites are refused, so a page you visit can't post to your channel. To use it from your phone on the same WiFi, run `npx next dev --port 3200 --hostname 0.0.0.0` and add your computer's address to `CF_ALLOWED_HOSTS`. Don't expose it to the internet: anyone who can reach it can post to your channel.
- On a CPU, a 90-second test VOD becomes 2–3 shorts in about 4 minutes. Most of the time goes to the final slow-preset encodes and the second caption pass. A GPU and `--full` make the AI steps fast.
- On headless Linux, MediaPipe needs `sudo apt install libegl1 libgles2`. Without them it falls back to OpenCV.
- Only clip streams you have the rights to post.
- Tests: `npm test` covers the captions, layout and tracking maths, moment picking and cut points, dead-air cutting, subtitle parsing, audience signals, the edit (cold open, punch-ins, stressed words, bleeps, sound effects), the composed FFmpeg graph (run through FFmpeg), the Claude requests (picking and watching), YouTube login, upload and scheduling, and the clipping business end to end against stand-ins for Twitch, TikTok and Instagram: scouting, campaigns, scheduling, posting, view tracking and earnings.
