package app.shuttle.recorder;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * The bridge between Shuttle's web app and Android: phone screen recording,
 * the floating camera bubble, and saving or sharing exported files.
 */
@CapacitorPlugin(
        name = "ShuttleNative",
        permissions = {
                @Permission(alias = "microphone", strings = {Manifest.permission.RECORD_AUDIO}),
                @Permission(alias = "camera", strings = {Manifest.permission.CAMERA}),
                @Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS}),
        })
public class ShuttleNativePlugin extends Plugin implements ScreenRecordService.Events {

    private final Handler main = new Handler(Looper.getMainLooper());
    @Nullable
    private PluginCall pendingStart;
    @Nullable
    private PluginCall pendingStop;

    @Override
    public void load() {
        ScreenRecordService.setEvents(this);
    }

    /** Lets the web app refresh as soon as Shuttle is back in front. */
    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        notifyListeners("appResumed", new JSObject());
    }

    @Override
    protected void handleOnDestroy() {
        ScreenRecordService.setEvents(null);
        super.handleOnDestroy();
    }

    // ------------------------------------------------------------------ status

    @PluginMethod
    public void getStatus(PluginCall call) {
        main.post(() -> {
            ScreenRecordService s = ScreenRecordService.running();
            JSObject out = new JSObject();
            if (s != null && s.isRecording()) {
                JSONObject st = s.status();
                out.put("state", st.optString("state", "recording"));
                out.put("elapsedMs", st.optLong("elapsedMs", 0));
                out.put("markers", st.optInt("markers", 0));
                out.put("camera", st.optBoolean("camera", false));
                out.put("mic", st.optBoolean("mic", false));
            } else {
                out.put("state", "idle");
                out.put("elapsedMs", 0);
            }
            out.put("canDrawOverlays", Settings.canDrawOverlays(getContext()));
            out.put("micPermission", getPermissionState("microphone").toString());
            out.put("cameraPermission", getPermissionState("camera").toString());
            call.resolve(out);
        });
    }

    // ------------------------------------------------------------------ start

    @PluginMethod
    public void startScreenRecording(PluginCall call) {
        ScreenRecordService s = ScreenRecordService.running();
        if (s != null && s.isRecording()) {
            call.reject("A recording is already running.", "BUSY");
            return;
        }
        List<String> needed = new ArrayList<>();
        if (call.getBoolean("mic", true) && getPermissionState("microphone") != PermissionState.GRANTED) needed.add("microphone");
        if (call.getBoolean("camera", false) && getPermissionState("camera") != PermissionState.GRANTED) needed.add("camera");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState("notifications") != PermissionState.GRANTED) needed.add("notifications");
        if (!needed.isEmpty()) {
            requestPermissionForAliases(needed.toArray(new String[0]), call, "afterPermissions");
            return;
        }
        askForCapture(call);
    }

    @PermissionCallback
    private void afterPermissions(PluginCall call) {
        // Missing microphone or camera access is not fatal: the take is recorded without them.
        askForCapture(call);
    }

    private void askForCapture(PluginCall call) {
        MediaProjectionManager mpm = getContext().getSystemService(MediaProjectionManager.class);
        Intent consent = mpm.createScreenCaptureIntent();
        startActivityForResult(call, consent, "afterConsent");
    }

    @ActivityCallback
    private void afterConsent(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Screen recording was not allowed.", "DENIED");
            return;
        }
        Context ctx = getContext();
        boolean mic = call.getBoolean("mic", true) && getPermissionState("microphone") == PermissionState.GRANTED;
        boolean camera = call.getBoolean("camera", false) && getPermissionState("camera") == PermissionState.GRANTED;
        int quality = "1080".equals(call.getString("quality", "720")) ? 1080 : 720;
        Intent svc = new Intent(ctx, ScreenRecordService.class)
                .setAction(ScreenRecordService.ACTION_START)
                .putExtra(ScreenRecordService.EXTRA_RESULT_CODE, result.getResultCode())
                .putExtra(ScreenRecordService.EXTRA_RESULT_DATA, result.getData())
                .putExtra(ScreenRecordService.EXTRA_MIC, mic)
                .putExtra(ScreenRecordService.EXTRA_CAMERA, camera)
                .putExtra(ScreenRecordService.EXTRA_QUALITY, quality);
        pendingStart = call;
        try {
            ContextCompat.startForegroundService(ctx, svc);
        } catch (RuntimeException e) {
            pendingStart = null;
            call.reject("Android refused to start the recorder: " + e.getMessage(), "START_FAILED");
        }
    }

    // ------------------------------------------------------------------ controls

    @PluginMethod
    public void pause(PluginCall call) {
        withService(call, ScreenRecordService::pause);
    }

    @PluginMethod
    public void resume(PluginCall call) {
        withService(call, ScreenRecordService::resume);
    }

    @PluginMethod
    public void addMarker(PluginCall call) {
        withService(call, ScreenRecordService::addMarker);
    }

    /** Sends Shuttle to the background so the user lands on what they want to record. */
    @PluginMethod
    public void minimize(PluginCall call) {
        main.post(() -> {
            ScreenRecordService s = ScreenRecordService.running();
            if (s != null) s.markMinimized();
            Activity a = getActivity();
            if (a != null) a.moveTaskToBack(true);
            call.resolve();
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> {
            ScreenRecordService s = ScreenRecordService.running();
            if (s == null || !s.isRecording()) {
                call.resolve(new JSObject());
                return;
            }
            pendingStop = call;
            s.stopRecording(null);
        });
    }

    private interface ServiceAction {
        void run(ScreenRecordService s);
    }

    private void withService(PluginCall call, ServiceAction action) {
        main.post(() -> {
            ScreenRecordService s = ScreenRecordService.running();
            if (s == null || !s.isRecording()) {
                call.reject("Nothing is being recorded.", "IDLE");
                return;
            }
            action.run(s);
            call.resolve();
        });
    }

    // ------------------------------------------------------------------ finished takes

    @PluginMethod
    public void listFinished(PluginCall call) {
        try {
            JSONArray list = RecordingStore.list(getContext());
            JSObject out = new JSObject();
            out.put("recordings", list);
            call.resolve(out);
        } catch (RuntimeException e) {
            call.reject("Could not read recordings: " + e.getMessage());
        }
    }

    @PluginMethod
    public void deleteFinished(PluginCall call) {
        String id = call.getString("id", "");
        RecordingStore.delete(getContext(), id == null ? "" : id);
        ScreenRecordService.clearSavedNotification(getContext());
        call.resolve();
    }

    // ------------------------------------------------------------------ overlay permission

    @PluginMethod
    public void requestOverlayPermission(PluginCall call) {
        if (Settings.canDrawOverlays(getContext())) {
            JSObject out = new JSObject();
            out.put("granted", true);
            call.resolve(out);
            return;
        }
        Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
        startActivityForResult(call, i, "afterOverlay");
    }

    @ActivityCallback
    private void afterOverlay(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject out = new JSObject();
        out.put("granted", Settings.canDrawOverlays(getContext()));
        call.resolve(out);
    }

    // ------------------------------------------------------------------ files

    private File exportDir() {
        File d = new File(getContext().getCacheDir(), "exports");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    private static boolean safeName(String name) {
        return name != null && name.matches("[\\p{L}\\p{N}._ -]{1,120}") && !name.startsWith(".");
    }

    /** Receives a file from the web app in base64 pieces, written to the cache. */
    @PluginMethod
    public void writeChunk(PluginCall call) {
        String name = call.getString("name");
        String data = call.getString("data", "");
        boolean append = call.getBoolean("append", false);
        if (!safeName(name)) {
            call.reject("Bad file name.");
            return;
        }
        File f = new File(exportDir(), name);
        try (OutputStream out = new FileOutputStream(f, append)) {
            out.write(Base64.decode(data, Base64.DEFAULT));
        } catch (IOException | IllegalArgumentException e) {
            call.reject("Could not write the file: " + e.getMessage());
            return;
        }
        JSObject out = new JSObject();
        out.put("path", f.getAbsolutePath());
        call.resolve(out);
    }

    @Nullable
    private File exportFile(PluginCall call) {
        String path = call.getString("path", "");
        File f = new File(path == null ? "" : path);
        try {
            if (!f.getCanonicalPath().startsWith(exportDir().getCanonicalPath()) || !f.isFile()) return null;
        } catch (IOException e) {
            return null;
        }
        return f;
    }

    /** Opens Android's share sheet for an exported file. */
    @PluginMethod
    public void shareFile(PluginCall call) {
        File f = exportFile(call);
        if (f == null) {
            call.reject("That file is gone.");
            return;
        }
        String mime = call.getString("mime", "application/octet-stream");
        Context ctx = getContext();
        Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", f);
        Intent send = new Intent(Intent.ACTION_SEND)
                .setType(mime)
                .putExtra(Intent.EXTRA_STREAM, uri)
                .putExtra(Intent.EXTRA_TITLE, call.getString("title", f.getName()))
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        Intent chooser = Intent.createChooser(send, call.getString("title", "Share"));
        chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        Activity a = getActivity();
        if (a == null) {
            call.reject("Shuttle is not in the foreground.");
            return;
        }
        a.runOnUiThread(() -> {
            a.startActivity(chooser);
            call.resolve();
        });
    }

    /** Copies an exported video to Movies/Shuttle (or other files to Download/Shuttle). */
    @PluginMethod
    public void saveToGallery(PluginCall call) {
        File f = exportFile(call);
        if (f == null) {
            call.reject("That file is gone.");
            return;
        }
        String mime = call.getString("mime", "video/mp4");
        boolean video = mime != null && mime.startsWith("video/");
        ContentResolver cr = getContext().getContentResolver();
        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, f.getName());
        v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        v.put(MediaStore.MediaColumns.RELATIVE_PATH, video ? "Movies/Shuttle" : "Download/Shuttle");
        v.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri collection = video
                ? MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                : MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        Uri item = cr.insert(collection, v);
        if (item == null) {
            call.reject("Android did not accept the file.");
            return;
        }
        try (InputStream in = new FileInputStream(f); OutputStream out = cr.openOutputStream(item)) {
            if (out == null) throw new IOException("no output stream");
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        } catch (IOException e) {
            cr.delete(item, null, null);
            call.reject("Saving failed: " + e.getMessage());
            return;
        }
        ContentValues done = new ContentValues();
        done.put(MediaStore.MediaColumns.IS_PENDING, 0);
        cr.update(item, done, null, null);
        JSObject out = new JSObject();
        out.put("uri", item.toString());
        out.put("folder", video ? "Movies/Shuttle" : "Download/Shuttle");
        call.resolve(out);
    }

    @PluginMethod
    public void clearExports(PluginCall call) {
        File[] files = exportDir().listFiles();
        if (files != null) for (File f : files) //noinspection ResultOfMethodCallIgnored
            f.delete();
        call.resolve();
    }

    // ------------------------------------------------------------------ service events

    @Override
    public void onStarted() {
        PluginCall c = pendingStart;
        pendingStart = null;
        if (c != null) {
            ScreenRecordService s = ScreenRecordService.running();
            JSObject out = new JSObject();
            if (s != null) {
                JSONObject st = s.status();
                out.put("camera", st.optBoolean("camera", false));
                out.put("mic", st.optBoolean("mic", false));
            }
            c.resolve(out);
        }
    }

    @Override
    public void onStartFailed(String message) {
        PluginCall c = pendingStart;
        pendingStart = null;
        if (c != null) {
            c.reject(message, "START_FAILED");
        }
    }

    @Override
    public void onStateChanged(JSONObject status) {
        try {
            notifyListeners("stateChange", JSObject.fromJSONObject(status));
        } catch (JSONException ignored) {
        }
    }

    @Override
    public void onFinished(@Nullable JSONObject recording, @Nullable String error) {
        JSObject payload = new JSObject();
        try {
            if (recording != null) payload.put("recording", JSObject.fromJSONObject(recording));
        } catch (JSONException ignored) {
        }
        if (error != null) payload.put("error", error);
        PluginCall c = pendingStop;
        pendingStop = null;
        if (c != null) {
            c.resolve(payload);
        } else {
            // Stopped from the notification or the system: keep the event for the web app.
            notifyListeners("recordingFinished", payload, true);
        }
    }
}
