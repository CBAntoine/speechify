package app.shuttle.recorder;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.MediaRecorder;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Display;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.IntentCompat;
import androidx.lifecycle.LifecycleService;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * Records the phone's screen (and optionally the microphone) to an MP4 file
 * with MediaProjection. Runs as a foreground service so recording continues
 * while the user is in other apps. The notification carries Pause/Resume and
 * Stop. An optional floating camera bubble is drawn over other apps and is
 * captured as part of the screen.
 */
public class ScreenRecordService extends LifecycleService {

    private static final String TAG = "ShuttleRecorder";

    static final String ACTION_START = "app.shuttle.recorder.START";
    static final String ACTION_PAUSE = "app.shuttle.recorder.PAUSE";
    static final String ACTION_RESUME = "app.shuttle.recorder.RESUME";
    static final String ACTION_STOP = "app.shuttle.recorder.STOP";

    static final String EXTRA_RESULT_CODE = "resultCode";
    static final String EXTRA_RESULT_DATA = "resultData";
    static final String EXTRA_MIC = "mic";
    static final String EXTRA_CAMERA = "camera";
    static final String EXTRA_QUALITY = "quality";

    private static final String CHANNEL_RECORDING = "recording";
    private static final String CHANNEL_SAVED = "saved";
    private static final int NOTIFICATION_RECORDING = 41;
    private static final int NOTIFICATION_SAVED = 42;

    /** Callbacks to the plugin, delivered on the main thread. */
    interface Events {
        void onStarted();

        void onStartFailed(String message);

        void onStateChanged(JSONObject status);

        void onFinished(@Nullable JSONObject recording, @Nullable String error);
    }

    private static volatile ScreenRecordService instance;
    private static volatile Events events;

    static void setEvents(@Nullable Events e) {
        events = e;
    }

    @Nullable
    static ScreenRecordService running() {
        return instance;
    }

    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaProjection projection;
    private VirtualDisplay display;
    private MediaRecorder recorder;
    private CameraBubble bubble;
    private File outFile;
    private String id;
    private long startedAtWall;
    private long startedAtClock;
    private long pausedTotal;
    private long pausedSince;
    private boolean paused;
    private boolean recording;
    private boolean hasAudio;
    private boolean cameraShown;
    private long trimStartMs;
    private int width;
    private int height;
    private final List<Long> markers = new ArrayList<>();

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createChannels();
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        super.onStartCommand(intent, flags, startId);
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_START.equals(action)) {
            if (!recording) start(intent);
        } else if (ACTION_PAUSE.equals(action)) {
            pause();
        } else if (ACTION_RESUME.equals(action)) {
            resume();
        } else if (ACTION_STOP.equals(action)) {
            stopRecording(null);
        } else if (!recording) {
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        super.onBind(intent);
        return null;
    }

    @Override
    public void onDestroy() {
        if (recording) stopRecording("Recording was interrupted.");
        instance = null;
        super.onDestroy();
    }

    // ------------------------------------------------------------------ start

    private void start(Intent intent) {
        boolean wantMic = intent.getBooleanExtra(EXTRA_MIC, true) && granted(Manifest.permission.RECORD_AUDIO);
        boolean wantCamera = intent.getBooleanExtra(EXTRA_CAMERA, false)
                && granted(Manifest.permission.CAMERA)
                && Settings.canDrawOverlays(this);
        int quality = intent.getIntExtra(EXTRA_QUALITY, 720);
        int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
        Intent data = IntentCompat.getParcelableExtra(intent, EXTRA_RESULT_DATA, Intent.class);
        if (data == null) {
            failStart("Screen capture permission is missing.");
            return;
        }

        int types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION;
        // Microphone and camera service types exist from Android 11.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (wantMic) types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
            if (wantCamera) types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA;
        }
        try {
            startForeground(NOTIFICATION_RECORDING, buildRecordingNotification(), types);
        } catch (RuntimeException e) {
            Log.e(TAG, "startForeground failed", e);
            failStart("Android did not allow the recording service to start: " + e.getMessage());
            return;
        }

        try {
            MediaProjectionManager mpm = getSystemService(MediaProjectionManager.class);
            projection = mpm.getMediaProjection(resultCode, data);
            if (projection == null) throw new IllegalStateException("No screen capture session.");
            // Android 14 requires a callback before the virtual display exists.
            projection.registerCallback(new MediaProjection.Callback() {
                @Override
                public void onStop() {
                    main.post(() -> stopRecording(null));
                }
            }, main);

            computeSize(quality);
            File dir = RecordingStore.dir(this);
            id = "rec" + System.currentTimeMillis();
            outFile = new File(dir, id + ".mp4");

            recorder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? new MediaRecorder(this) : legacyRecorder();
            hasAudio = wantMic;
            if (wantMic) recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            recorder.setOutputFile(outFile.getAbsolutePath());
            recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264);
            recorder.setVideoSize(width, height);
            recorder.setVideoFrameRate(30);
            recorder.setVideoEncodingBitRate(quality >= 1080 ? 10_000_000 : 6_000_000);
            if (wantMic) {
                recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
                recorder.setAudioSamplingRate(48_000);
                recorder.setAudioEncodingBitRate(128_000);
                recorder.setAudioChannels(1);
            }
            recorder.prepare();

            DisplayMetrics dm = realMetrics();
            display = projection.createVirtualDisplay(
                    "Shuttle", width, height, dm.densityDpi,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                    recorder.getSurface(), null, main);
            recorder.start();
        } catch (Exception e) {
            Log.e(TAG, "could not start recording", e);
            releaseAll();
            if (outFile != null) //noinspection ResultOfMethodCallIgnored
                outFile.delete();
            stopForeground(STOP_FOREGROUND_REMOVE);
            failStart("The screen recorder could not start: " + e.getMessage());
            stopSelf();
            return;
        }

        recording = true;
        paused = false;
        pausedTotal = 0;
        markers.clear();
        trimStartMs = 0;
        startedAtWall = System.currentTimeMillis();
        startedAtClock = SystemClock.elapsedRealtime();
        updateNotification();

        if (wantCamera) {
            try {
                bubble = new CameraBubble(this, this);
                bubble.show();
                cameraShown = true;
            } catch (Exception e) {
                // The recording matters more than the bubble.
                Log.w(TAG, "camera bubble failed", e);
                bubble = null;
                cameraShown = false;
            }
        }
        Events ev = events;
        if (ev != null) ev.onStarted();
        notifyState();
    }

    @SuppressWarnings("deprecation")
    private MediaRecorder legacyRecorder() {
        return new MediaRecorder();
    }

    private void failStart(String message) {
        Events ev = events;
        if (ev != null) ev.onStartFailed(message);
    }

    @SuppressWarnings("deprecation")
    private DisplayMetrics realMetrics() {
        DisplayManager dm = getSystemService(DisplayManager.class);
        Display d = dm.getDisplay(Display.DEFAULT_DISPLAY);
        DisplayMetrics m = new DisplayMetrics();
        d.getRealMetrics(m);
        return m;
    }

    /** Recording size: the screen's shape, short side at most `quality`, multiples of 16. */
    private void computeSize(int quality) {
        DisplayMetrics m = realMetrics();
        int w = m.widthPixels;
        int h = m.heightPixels;
        int shortSide = Math.min(w, h);
        double scale = shortSide > quality ? (double) quality / shortSide : 1.0;
        width = align16(w * scale);
        height = align16(h * scale);
    }

    private static int align16(double v) {
        return Math.max(16, (int) Math.round(v / 16.0) * 16);
    }

    // ------------------------------------------------------------------ controls

    long elapsedMs() {
        if (!recording) return 0;
        long now = SystemClock.elapsedRealtime();
        long pausedNow = paused ? now - pausedSince : 0;
        return now - startedAtClock - pausedTotal - pausedNow;
    }

    boolean isRecording() {
        return recording;
    }

    boolean isPaused() {
        return paused;
    }

    void pause() {
        if (!recording || paused) return;
        try {
            recorder.pause();
            paused = true;
            pausedSince = SystemClock.elapsedRealtime();
            updateNotification();
            notifyState();
        } catch (RuntimeException e) {
            Log.w(TAG, "pause failed", e);
        }
    }

    void resume() {
        if (!recording || !paused) return;
        try {
            recorder.resume();
            pausedTotal += SystemClock.elapsedRealtime() - pausedSince;
            paused = false;
            updateNotification();
            notifyState();
        } catch (RuntimeException e) {
            Log.w(TAG, "resume failed", e);
        }
    }

    void addMarker() {
        if (recording) markers.add(elapsedMs());
        notifyState();
    }

    /** Shuttle moved itself out of the way; the frames before this are its own screen. */
    void markMinimized() {
        if (recording && elapsedMs() < 15_000) trimStartMs = elapsedMs() + 450;
    }

    JSONObject status() {
        JSONObject o = new JSONObject();
        try {
            o.put("state", !recording ? "idle" : paused ? "paused" : "recording");
            o.put("elapsedMs", elapsedMs());
            o.put("markers", markers.size());
            o.put("camera", cameraShown);
            o.put("mic", hasAudio);
        } catch (JSONException ignored) {
        }
        return o;
    }

    void stopRecording(@Nullable String reason) {
        if (!recording) {
            stopSelf();
            return;
        }
        long duration = elapsedMs();
        recording = false;
        String error = reason;
        boolean ok = true;
        try {
            if (paused) recorder.resume();
            recorder.stop();
        } catch (RuntimeException e) {
            // stop() throws when no frame reached the file.
            Log.w(TAG, "stop failed", e);
            ok = false;
            if (error == null) error = "The recording was too short to save.";
        }
        releaseAll();
        stopForeground(STOP_FOREGROUND_REMOVE);

        JSONObject result = null;
        if (ok && outFile != null && outFile.length() > 0) {
            try {
                result = new JSONObject();
                result.put("id", id);
                result.put("path", outFile.getAbsolutePath());
                result.put("startedAt", startedAtWall);
                result.put("durationMs", duration);
                result.put("width", width);
                result.put("height", height);
                result.put("hasAudio", hasAudio);
                result.put("camera", cameraShown);
                result.put("trimStartMs", trimStartMs);
                JSONArray ms = new JSONArray();
                for (Long m : markers) ms.put(m);
                result.put("markersMs", ms);
                RecordingStore.writeMeta(this, id, result);
                showSavedNotification();
            } catch (Exception e) {
                Log.e(TAG, "could not write metadata", e);
                error = "The recording was saved but its details were not: " + e.getMessage();
            }
        } else if (outFile != null) {
            //noinspection ResultOfMethodCallIgnored
            outFile.delete();
        }
        Events ev = events;
        if (ev != null) ev.onFinished(result, result == null ? error : null);
        notifyState();
        stopSelf();
    }

    private void releaseAll() {
        if (bubble != null) {
            try {
                bubble.hide();
            } catch (Exception ignored) {
            }
            bubble = null;
        }
        if (display != null) {
            display.release();
            display = null;
        }
        if (recorder != null) {
            try {
                recorder.reset();
            } catch (RuntimeException ignored) {
            }
            recorder.release();
            recorder = null;
        }
        if (projection != null) {
            try {
                projection.stop();
            } catch (RuntimeException ignored) {
            }
            projection = null;
        }
    }

    private void notifyState() {
        Events ev = events;
        if (ev != null) ev.onStateChanged(status());
    }

    private boolean granted(String permission) {
        return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED;
    }

    // ------------------------------------------------------------------ notifications

    private void createChannels() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel rec = new NotificationChannel(CHANNEL_RECORDING, getString(R.string.channel_recording), NotificationManager.IMPORTANCE_LOW);
        rec.setShowBadge(false);
        nm.createNotificationChannel(rec);
        NotificationChannel saved = new NotificationChannel(CHANNEL_SAVED, getString(R.string.channel_saved), NotificationManager.IMPORTANCE_DEFAULT);
        nm.createNotificationChannel(saved);
    }

    private PendingIntent serviceAction(String action, int requestCode) {
        Intent i = new Intent(this, ScreenRecordService.class).setAction(action);
        return PendingIntent.getService(this, requestCode, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private PendingIntent openApp() {
        Intent i = new Intent(this, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification buildRecordingNotification() {
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_RECORDING)
                .setSmallIcon(R.drawable.ic_stat_record)
                .setContentTitle(paused ? getString(R.string.notif_paused) : getString(R.string.notif_recording))
                .setContentText(getString(R.string.notif_recording_text))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .setContentIntent(openApp());
        if (recording && !paused) {
            b.setUsesChronometer(true).setWhen(System.currentTimeMillis() - elapsedMs()).setShowWhen(true);
        } else {
            b.setShowWhen(false);
        }
        if (recording) {
            if (paused) b.addAction(R.drawable.ic_stat_record, getString(R.string.action_resume), serviceAction(ACTION_RESUME, 2));
            else b.addAction(R.drawable.ic_stat_pause, getString(R.string.action_pause), serviceAction(ACTION_PAUSE, 1));
            b.addAction(R.drawable.ic_stat_stop, getString(R.string.action_stop), serviceAction(ACTION_STOP, 3));
        }
        return b.build();
    }

    private void updateNotification() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.notify(NOTIFICATION_RECORDING, buildRecordingNotification());
    }

    private void showSavedNotification() {
        Notification n = new NotificationCompat.Builder(this, CHANNEL_SAVED)
                .setSmallIcon(R.drawable.ic_stat_record)
                .setContentTitle(getString(R.string.notif_saved))
                .setContentText(getString(R.string.notif_saved_text))
                .setAutoCancel(true)
                .setContentIntent(openApp())
                .build();
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.notify(NOTIFICATION_SAVED, n);
    }

    static void clearSavedNotification(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        nm.cancel(NOTIFICATION_SAVED);
    }
}
