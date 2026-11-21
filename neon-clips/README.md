# Neon Clips

An Android app that turns long videos into 9:16 shorts. Find a video that is getting views (or pick one from your phone), let the app pick the moments, fix the framing and captions, and export an MP4 ready for Reels, TikTok and Shorts.

Everything except auto captions runs on the phone: no upload, no account, no credits, no watermark.

## What it does

| Step | How |
| --- | --- |
| **Find** | Searches YouTube for a topic, most-viewed first, within a time window (today, this week, ...). Shows views, age and views per hour. Any link yt-dlp understands (Twitch, TikTok, X, Kick ...) can be pasted or shared into the app. |
| **Fetch** | Reads the video's "most replayed" graph and offers its peaks. Only the picked stretches are downloaded, so a 20-hour stream is not a problem. Short videos can be fetched whole. |
| **Pick moments** | Measures loudness across the file and looks for the places where the sound rises well above what is normal around it (shouts, laughs, explosions), combined with replay data when there is any. Picks never overlap, and each one starts and ends in a pause. |
| **Cut** | Timeline with trim handles. With Snap on, an end you drop lands in the nearest pause, or beside a word instead of inside it. |
| **Reframe** | Follows the main face with a damped virtual camera and switches on the exact frame of a cut. Small faces (a corner facecam) are ignored so gameplay stays centred. Tap anyone in Source view to follow that person instead, drag to nudge, or set keyframes by hand. Punch-in zoom up to 3x. |
| **Caption** | A hook title for the opening seconds, plus word-timed captions from ElevenLabs Scribe (needs your API key, entered in Settings). Captions are cut into short punchy groups, the spoken word lights up, every line is editable, and a timing slider shifts them if they run early or late. |
| **Export** | H.264 MP4, 1080x1920 or 720x1280, captions burned in, saved to `Movies/NeonClips` in the gallery, with a share button. Export one clip or all of them. |

The preview and the export draw through the same crop maths and the same caption painter, so what you see in the editor is what lands in the file.

## How it compares with CapCut's long-video-to-shorts

Complaints people report about CapCut's clipper, and what this app does about each:

| CapCut complaint | Here |
| --- | --- |
| Clips start without context or cut a sentence in half | The peak sits 40% into the clip so there is a build-up; both ends snap to pauses; trims snap too. |
| The same moment shows up in several clips | Picks are spaced a full clip apart and never overlap. |
| The crop follows the wrong person or misses a cut | Tap the person to follow; cuts are located to within a frame or two; every path can be nudged or keyframed. |
| The preview framing differs from the exported file | One code path for both, checked by an on-device test that inspects the rendered pixels. |
| Caption timing is off and cannot be adjusted | Word-level timestamps, editable text, and a timing slider. |
| Uploads stall, jobs queue, length and size ceilings, credits | Analysis and rendering run on the phone. Long sources are fetched by section. |
| Features move behind a subscription, watermarks | No account, no paywall, no watermark. |

## Build

```bash
cd neon-clips
./gradlew :core:test                 # logic tests, plain JVM
./gradlew :app:assembleRelease       # arm64 APK in app/build/outputs/apk/release/
./gradlew :app:assembleRelease -Pabi=x86_64   # for an emulator on a PC
```

Needs JDK 21 and the Android SDK (platform 37.2). Release builds are signed with the debug key unless `NEONCLIPS_KEYSTORE`, `NEONCLIPS_KEYSTORE_PASSWORD`, `NEONCLIPS_KEY_ALIAS` and `NEONCLIPS_KEY_PASSWORD` are set. An update only installs over an older copy signed with the same key, so set a real keystore before handing builds to other people.

The GitHub workflow `.github/workflows/neon-clips-apk.yml` runs the tests and uploads the APK as a build artifact on every push that touches this folder.

### On-device tests

`app/src/androidTest` runs the real pipeline on a device or emulator: probing (including sideways files), loudness, rendering (crop position over time, a hard cut, hook, captions, gain) and audio extraction.

```bash
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest -Pabi=x86_64
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w app.neonclips.test/androidx.test.runner.AndroidJUnitRunner
```

The face-tracking test needs a video with a real face, which is not in the repo; the test's comment says how to push one.

## Layout

```
core/   Pure Kotlin, no Android: highlight detection, camera path, caption grouping,
        search URL + yt-dlp output parsing, ElevenLabs client. Unit tested.
app/    Android app (Compose, Media3, ML Kit, yt-dlp via youtubedl-android).
  media/    AudioScan (loudness), FaceScan (ML Kit), Exporter (Media3 Transformer), CaptionPainter
  source/   YtDlp (search, info, download), ImportManager (fetch -> analyse -> project)
  ui/       Home, Discover, ImportSheet, Settings, editor/ (Viewport, Timeline, tabs, export)
```

## Limits worth knowing

- **Rights.** Downloading is done by yt-dlp on the phone. Clip videos you own or have the creator's permission to clip; sites' terms and copyright apply to what you post.
- **Sites change.** When searching or fetching stops working, Settings has an "Update now" button that fetches the newest yt-dlp. The app tries this once by itself when a fetch fails.
- **Captions need a key.** Transcription uses ElevenLabs Scribe with your own API key. Without one you still get the hook title and hand-typed captions.
- **No Play Store.** An app that downloads from YouTube is not accepted there; install the APK directly.
- **Not built yet:** stacked facecam-over-gameplay layout, on-device transcription, background rendering while the app is closed.

## Credits

yt-dlp, FFmpeg and Python are bundled by [youtubedl-android](https://github.com/yausername/youtubedl-android). Rendering: AndroidX Media3. Faces: Google ML Kit. Fonts: Anton and JetBrains Mono, SIL Open Font License (see `licenses/`).
