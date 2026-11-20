# Shuttle

A screen recorder that runs entirely in the browser. Record your screen and camera, get a transcript while you talk, cut mistakes by striking out sentences, take out pauses in one click, add smooth zooms, and export an MP4, captions, or a single-file player page. Nothing is uploaded.

## What it does better than Loom

- **No upload, no length limit.** Recordings live in your browser (IndexedDB). Exports are plain files you own.
- **The camera stays editable.** It is recorded as its own track, so you can move, resize, reshape or hide the bubble after recording.
- **Edit by text.** Strike a phrase in the transcript and it leaves the video. Trim, cut ranges, undo and redo on a waveform timeline.
- **Pauses out in one click**, with a choice of how long a pause has to be before it goes.
- **Smooth zooms** onto any part of the screen, eased in and out.
- **Captions from the start.** A live transcript while you record; export WebVTT/SRT or burn captions into the video.
- **Chapters** from the **M** key while recording or editing, or written by Claude from the transcript along with a title, summary and action items.
- **Crash-safe.** Every second is backed up while recording; a closed or crashed tab can be recovered.
- **Speaker notes** in the floating controls, with auto-scroll. They are never recorded.
- **A share page with no server.** One `.html` file holds the player, chapters, a searchable transcript, the summary and an optional call-to-action button.

What Loom still does that Shuttle does not: hosted share links, viewer comments and reactions, view analytics, and a desktop app with system-wide hotkeys and cursor highlighting. Shuttle is local-first by design, so anything that needs a server is left out.

## Run it

```bash
cd shuttle
npm install
npm run dev        # http://localhost:5199
```

Use a recent Chrome or Edge for every feature. Screen capture only works on `localhost` or HTTPS.

Build a static site with `npm run build` and serve `dist/` from any HTTPS host. On Vercel, create a project with **Root Directory** set to `shuttle`; the framework preset is Vite.

## How it works

- **Capture** (`src/lib/recorder.ts`). `getDisplayMedia` for the screen, `getUserMedia` for camera and microphone. Microphone and shared-tab/system audio are mixed with Web Audio into the screen file. The camera goes into a second `MediaRecorder` started in the same task, so the two files line up and the bubble can be composited later. Pause and resume act on both recorders.
- **Crash recovery** (`src/lib/db.ts`, `src/lib/takes.ts`). Recorders emit a chunk every second; each chunk is written to IndexedDB as it arrives, along with the transcript and markers. If the tab dies, the library offers to rebuild the take from those chunks.
- **Floating controls** (`src/lib/pip.ts`, `src/components/PipControls.tsx`). A Document Picture-in-Picture window with the timer, level meter, pause, chapter and finish buttons, plus speaker notes. It stays above every app.
- **Live transcript** (`src/lib/transcriber.ts`). The browser's speech recognition, stamped with the recording clock (paused time excluded). After recording, phrase boundaries are snapped to speech onsets in the audio so cutting a sentence doesn't clip a word (`refineSegments` in `src/lib/timeline.ts`).
- **Editing model** (`src/lib/timeline.ts`). The source files are never modified. Edits are data: a trim, a list of cuts (manual, pause, struck phrase), zoom regions, and the camera layout. `keptSegments` turns them into the ranges that survive; every view maps between source and output time with it.
- **Pause detection**. The audio is decoded once into a 50 Hz RMS envelope. A threshold between the noise floor and speech level (10th and 90th percentiles) finds pauses longer than the chosen length; padding keeps a natural beat around speech. Recordings without clear speech/noise contrast are never cut automatically.
- **Preview** (`src/components/Editor.tsx`). Two `<video>` elements, kept in sync, with zooms as CSS transforms and captions as an overlay. Playback skips removed parts. Geometry comes from `src/lib/layout.ts`, the same code the exporter uses, so the preview matches the file.
- **Export** (`src/lib/exporter.ts`). [Mediabunny](https://mediabunny.dev) decodes both files with WebCodecs. Each output frame is drawn on a canvas (zoom crop, camera bubble, caption) and encoded to H.264 (or VP9/AV1) at a constant frame rate; audio is cut sample-accurately with 4 ms fades at every join. It does not wait for playback, so it usually runs faster than real time.
- **Player page** (`src/lib/playerPage.ts`). One HTML file with the video embedded, chapters, a searchable transcript that follows playback, captions, speed buttons, the summary and an optional call-to-action button.
- **AI notes** (`src/lib/ai.ts`, optional). With your own Anthropic API key (Settings), Claude writes a title, summary, chapters and action items from the kept transcript using structured output. Only the transcript text is sent, from your browser straight to `api.anthropic.com`. Requests use `claude-opus-5-5` with server-side refusal fallback enabled.

## Browser support

| | Chrome / Edge | Safari 17+ | Firefox |
| --- | --- | --- | --- |
| Screen + camera recording | Yes | Yes (no system audio) | Yes |
| Tab / system audio | Tab audio; full system audio on Windows and ChromeOS | No | No |
| Live transcript | Yes (Chrome sends audio to Google's speech service) | Yes | No |
| Floating controls | Yes | No (controls stay in the tab) | No |
| Export | MP4 (H.264) | MP4 | WebM, or MP4 where H.264 encoding exists |

## Keyboard

| Key | Action |
| --- | --- |
| P | Pause or resume while recording |
| M | Add a chapter (recording and editing) |
| Space / K | Play or pause |
| J / L | Back or forward 5 s |
| ← / → | Back or forward 1 s (Shift: 5 s) |
| C or Delete | Cut the selection, or delete the selected cut or zoom |
| Z | Zoom into the selection |
| Ctrl/⌘ Z, Ctrl/⌘ Shift Z | Undo, redo |

## Tests

```bash
npm test           # unit tests: timeline math, silence detection, captions, layout
npm run build && npm run e2e
```

`npm run e2e` drives headless Chromium with a fake camera, a fake shared screen and a generated speech-like microphone signal. It records a take with a pause and a chapter, edits it (strike a phrase, remove pauses, add a zoom, move the camera), writes AI notes against a stubbed Anthropic API, exports an MP4 and checks it with `ffprobe`/`ffmpeg`, opens the player page, discards a take, then kills a tab mid-recording and recovers it. Screenshots land in `tests/e2e/out/`. It needs Playwright's Chromium and ffmpeg on the PATH.
