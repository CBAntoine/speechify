# Dashcam

A native Android app that turns your phone into a dashcam. It keeps recording in the
background while you use Maps, Waze, Spotify or anything else, with the screen on or off.

## Features

- **Background recording.** Recording runs in a camera foreground service, so switching apps
  or turning the screen off doesn't stop it. Controls live in the notification: Protect, Mute
  and Stop.
- **Loop recording.** Footage is saved as 1, 2, 3 or 5 minute clips. The oldest unprotected
  clips are deleted automatically to stay under a storage limit you choose (2 to 64 GB), and
  some free space is always kept on the phone.
- **Incident protection.** A sudden impact (accelerometer, three sensitivity levels) or a tap
  on **Protect** moves the current clip to a protected folder. If the event lands near a clip
  boundary, the previous or next clip is protected too, so the moment is never cut off.
  Protected clips can be copied to your Gallery (`Movies/Dashcam`) automatically, so they
  survive an uninstall and back up with Google Photos.
- **Burned-in overlay.** Date, time, speed and optionally GPS coordinates are drawn into the
  video like a hardware dashcam, using CameraX's GPU overlay effect.
- **GPS telemetry.** Every clip gets a JSON sidecar with a 1 Hz GPS track and its events. The
  player shows the speed and position at the current moment, and has an "Open in Maps" button.
- **Modern capture.** 720p, 1080p, 1440p or 4K; H.264 or HEVC (about 40% smaller files);
  optional stabilization; ultra-wide lens chip on phones that have one; pinch to zoom and tap
  to focus.
- **Built for the car.** Starts recording when the app opens. Optional auto-stop 60 s after
  the charger is unplugged. Pauses instead of overheating in a hot car, then resumes on its
  own. Quick Settings tile, long-press app shortcuts, and an optional floating
  (picture-in-picture) preview.
- **Crash resilient.** Each clip is its own file, and CameraX 1.7's Media3 muxer protects
  against corruption, so a crash or dead battery can only cost the clip in progress.
- **Car scanner.** Tap **Scan** and the HUD tracks vehicles with corner brackets, reads their
  licence plates on the phone and names their colour. With your own Anthropic API key, Claude
  identifies the make, model, model years, body style and typical specs of the car in focus.
  The panel then shows that model's recall record (NHTSA) and links to its specifications and
  to Transport Canada's recall search. It never looks up owners or vehicle history: that needs
  the VIN and the owner's consent.

## Install the APK

1. Copy the APK (e.g. `Dashcam-1.1.1.apk`) to your phone, or download it straight onto the phone.
2. Open it. If Android asks, allow your browser or file manager to **install unknown apps**.
3. Open **Dashcam**, grant the camera (required), microphone, location and notification
   permissions, and allow background activity when asked.

Requires Android 8.0 or newer. Built and tested against Android 17 (API 37).

## Use it

1. Mount the phone in landscape with a clear view of the road, and plug it into a charger.
2. Open Dashcam. It starts recording on its own; you can turn that off in Settings.
3. Switch to your navigation app. The red camera dot in the status bar and the "Recording"
   notification show that it's still rolling.
4. Tap **Protect** in the app or the notification to keep the current clip. Impacts are
   protected automatically.
5. Browse, play, share or delete clips under **Clips**.

### Car scanner

1. In **Settings → Car scanner → Anthropic API key**, paste a key from the Claude Console
   (console.anthropic.com). It is encrypted with the Android Keystore, stays on this phone and is
   only ever sent to Anthropic. Without a key the scanner still tracks cars, reads plates and
   names colours; only make and model need it.
2. On the camera screen, tap **Scan** (top left). It reads **PLATE SCAN · LIVE** while running.
   Tap a box's label or a thumbnail in the strip to see that vehicle's profile.
3. Plates are readable when a vehicle is close: a few car lengths at the default 1080p.
4. Identification uses Claude Opus 5.5 by default. You can pick Sonnet 5.5 or Haiku 5.5 (fastest
   and cheapest) in Settings. Each identification is one request billed to your Anthropic
   account. Automatic identification only asks about the vehicle in focus, at most every
   8 seconds and 40 times per scan, and never twice for the same plate. You can turn it off and
   tap **Identify** instead.

Privacy: plates are read on the phone and never uploaded. The photo sent to Claude is cropped to
the vehicle with its plate pixelated. Nothing the scanner sees is saved; it is forgotten when you
turn **Scan** off. The scanner only runs while the camera screen is visible, and it slows down when
the phone gets hot so recording is never affected.

### Keep Android from stopping it

Recording runs as a foreground service, which Android allows to keep using the camera. Some
phone makers add their own battery savers on top:

- Allow **background activity** when the app asks (Settings → Reliability shows the status).
- **Samsung:** Settings → Battery → Background usage limits. Add Dashcam to *Never sleeping apps*.
- **Xiaomi / Redmi / POCO:** App info → Autostart on, and Battery saver → *No restrictions*.
- **Huawei / Honor:** Battery → App launch. Set Dashcam to *Manage manually* and enable everything.
- **OnePlus / OPPO / realme:** Battery → Battery optimization → *Don't optimize*.

## Why Android only

iOS doesn't let third-party apps use the camera while they are in the background, so an
iPhone app could only record while it stays on screen. Android lets a foreground service with
the camera type keep recording, which is what this app is built on.

## Build from source

Requirements: JDK 17+, the Android SDK with platform `android-37.2`. The Gradle wrapper
downloads Gradle 9.9.2.

```bash
cd dashcam
echo "sdk.dir=$ANDROID_HOME" > local.properties   # if ANDROID_HOME isn't set already
./gradlew testDebugUnitTest lintDebug assembleRelease
# → app/build/outputs/apk/release/app-release.apk
```

Release builds are minified with R8. Without a `keystore.properties` file they are signed with
your local debug key so they can be sideloaded. For your own signing key, create
`dashcam/keystore.properties` (it is gitignored):

```properties
storeFile=/path/to/your.jks
storePassword=…
keyAlias=…
keyPassword=…
```

## How it works

| Piece | Role |
| --- | --- |
| `recording/RecordingService` | LifecycleService that owns the camera. Bound while the app is visible (live preview). A camera, microphone and location foreground service while recording. |
| `recording/DashcamEngine` | CameraX `SessionConfig` with Preview + VideoCapture + `OverlayEffect`. Because the effect targets both, CameraX shares one stream between them, so the viewfinder can disappear (app in background, screen off) without touching the recording. Also handles clip rotation, protection, retries, thermal pause, auto-stop and the wake lock. |
| `recording/OverlayRenderer` | Draws the date/speed text on the GPU overlay, pre-rotated for the output orientation. It redraws only when the text changes. |
| `storage/ClipRepository` | `Dashcam/loop` and `Dashcam/protected` on each storage volume, the storage budget, sidecars and Gallery export. All file operations run on one thread. |
| `telemetry/*` | GPS (platform `LocationManager`, no Play Services needed) and accelerometer impact detection. |
| `scanner/*` | The car scanner. Frames come from an `ImageAnalysis` stream that the engine binds only when the camera can carry it without lowering the video quality. EfficientDet-Lite0 (LiteRT, on the CPU) runs on two square tiles of each frame. An IoU tracker follows vehicles; ML Kit reads plates, with format-aware voting across frames. Colours are named in HSV. Claude identification goes through the Anthropic Java SDK with structured JSON output, low effort and server-side fallbacks. Recalls come from NHTSA's public API. |
| `ui/*` | Jetpack Compose + Material 3: the camera HUD, scanner overlay, clip library, Media3 player, settings and onboarding. Navigation 3 handles screens. |

Clips are stored in the app's folder (`Android/data/com.cbantoine.dashcam/files/Dashcam`),
which is removed if you uninstall the app. Protected clips copied to the Gallery are kept.

The bundled vehicle detector (`app/src/main/assets/vehicle_detector.tflite`) is TensorFlow's
EfficientDet-Lite0 detection model, used under the Apache License 2.0.

## Good to know

- Recording audio inside a car can be subject to consent laws where you live. Audio can be
  turned off in Settings or muted from the notification.
- Set it up before you drive. Don't handle your phone while driving.
