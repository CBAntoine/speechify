package app.patch.home;

import android.content.Context;
import android.content.res.AssetManager;
import android.os.Build;
import android.provider.Settings;
import android.system.Os;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Runs Patch's own server (the same one that runs on computers) inside the app, on Node.js.
 * The dashboard then talks to it at http://127.0.0.1:4545, exactly as a browser on a computer does.
 * Node.js can only be started once per app process, so this starts it at most once.
 */
final class PatchServer {
    static final int PORT = 4545;
    private static final String TAG = "Patch";

    private static boolean started;
    private static volatile String failure;

    static {
        System.loadLibrary("node");
        System.loadLibrary("patchbridge");
    }

    private static native int startNode(String[] args);

    private PatchServer() {}

    /** Why Patch's server isn't running, or null while it is (or is still starting). */
    static String failure() {
        return failure;
    }

    static synchronized void start(Context context) {
        if (started) return;
        started = true;
        final Context app = context.getApplicationContext();
        Thread thread = new Thread(null, () -> run(app), "patch-server", 32L * 1024 * 1024);
        thread.setDaemon(true);
        thread.start();
    }

    private static void run(Context app) {
        try {
            File code = unpack(app);
            File data = new File(app.getFilesDir(), "data");
            if (!data.isDirectory() && !data.mkdirs()) throw new IOException("can't create " + data);
            File network = new File(data, "network.json");
            PhoneNetwork.Info wifi = PhoneNetwork.write(app, network);
            PhoneNetwork.watch(app, network);
            // What only Android can do (the screen, apps, music) Patch's server asks for through the bridge.
            PhoneBridge bridge = PhoneBridge.start(app);

            setenv("PATCH_PLATFORM", "android");
            setenv("PATCH_DATA_DIR", data.getAbsolutePath());
            setenv("PATCH_NETWORK_FILE", network.getAbsolutePath());
            setenv("PATCH_PHONE_BRIDGE", bridge.url());
            setenv("PATCH_PHONE_TOKEN", bridge.token());
            setenv("PATCH_WIFI", wifi.wifi);
            setenv("PATCH_GATEWAY", wifi.gateway);
            setenv("PATCH_DNS", wifi.dns);
            setenv("PATCH_DEVICE_NAME", deviceName(app));
            setenv("PATCH_DEVICE_BRAND", Build.MANUFACTURER);
            setenv("PATCH_DEVICE_MODEL", Build.MODEL);
            setenv("PATCH_ANDROID_VERSION", Build.VERSION.RELEASE);
            setenv("PATCH_APP_VERSION", appVersion(app));
            setenv("HOME", app.getFilesDir().getAbsolutePath());
            setenv("TMPDIR", app.getCacheDir().getAbsolutePath());

            Log.i(TAG, "Starting Patch from " + code);
            int exit = startNode(new String[] {
                "node", new File(code, "server.mjs").getAbsolutePath(), "--no-open", "--port", String.valueOf(PORT),
            });
            failure = "Patch's engine stopped (exit code " + exit + ").";
            Log.e(TAG, failure);
        } catch (Throwable e) {
            failure = "Patch couldn't start: " + e;
            Log.e(TAG, "Patch couldn't start", e);
        }
    }

    private static void setenv(String name, String value) throws Exception {
        Os.setenv(name, value == null ? "" : value, true);
    }

    /** This app's version ("1.0." and the build number), which Patch shows in its Settings. */
    private static String appVersion(Context app) {
        try {
            return app.getPackageManager().getPackageInfo(app.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return null;
        }
    }

    /** The phone's name as its owner set it (Settings → About phone), if Android shares it. */
    private static String deviceName(Context app) {
        try {
            if (Build.VERSION.SDK_INT >= 25) {
                String name = Settings.Global.getString(app.getContentResolver(), Settings.Global.DEVICE_NAME);
                if (name != null && !name.trim().isEmpty()) return name.trim();
            }
        } catch (RuntimeException ignored) {
            // not shared on this phone
        }
        return "";
    }

    // ── Unpacking Patch's server from the APK ───────────────────────────────

    /** Copies Patch's server out of the APK the first time, and again after each app update. */
    private static File unpack(Context app) throws IOException {
        AssetManager assets = app.getAssets();
        String version = readAll(assets.open("patch/version.txt")).trim();
        File dir = new File(app.getFilesDir(), "patch");
        File stamp = new File(dir, "version.txt");
        if (stamp.isFile() && version.equals(readAll(new FileInputStream(stamp)).trim())) return dir;

        File fresh = new File(app.getFilesDir(), "patch.new");
        deleteTree(fresh);
        copyAssets(assets, "patch", fresh);
        deleteTree(dir);
        if (!fresh.renameTo(dir)) throw new IOException("can't move Patch into place");
        Log.i(TAG, "Unpacked Patch " + version);
        return dir;
    }

    private static void copyAssets(AssetManager assets, String path, File to) throws IOException {
        String[] children = assets.list(path);
        if (children == null || children.length == 0) {
            File parent = to.getParentFile();
            if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("can't create " + parent);
            try (InputStream in = assets.open(path); OutputStream out = new FileOutputStream(to)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            return;
        }
        if (!to.isDirectory() && !to.mkdirs()) throw new IOException("can't create " + to);
        for (String child : children) copyAssets(assets, path + "/" + child, new File(to, child));
    }

    private static String readAll(InputStream in) throws IOException {
        try (InputStream s = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = s.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static void deleteTree(File f) {
        if (!f.exists()) return;
        File[] children = f.listFiles();
        if (children != null) for (File c : children) deleteTree(c);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}
