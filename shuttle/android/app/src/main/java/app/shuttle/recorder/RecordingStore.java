package app.shuttle.recorder;

import android.content.Context;
import android.os.Environment;

import androidx.annotation.Nullable;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Finished screen recordings waiting to be imported by the web app. Each take
 * is an MP4 plus a small JSON file with its details. The web app copies the
 * video into its own library and then deletes both.
 */
final class RecordingStore {
    private RecordingStore() {
    }

    static File dir(Context ctx) {
        File base = ctx.getExternalFilesDir(Environment.DIRECTORY_MOVIES);
        if (base == null) base = ctx.getFilesDir();
        File d = new File(base, "recordings");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    static void writeMeta(Context ctx, String id, JSONObject meta) throws IOException {
        File f = new File(dir(ctx), id + ".json");
        try (OutputStream out = new FileOutputStream(f)) {
            out.write(meta.toString().getBytes(StandardCharsets.UTF_8));
        }
    }

    static JSONArray list(Context ctx) {
        JSONArray out = new JSONArray();
        File[] files = dir(ctx).listFiles((d, name) -> name.endsWith(".json"));
        if (files == null) return out;
        for (File f : files) {
            JSONObject meta = read(f);
            if (meta == null) continue;
            File video = new File(meta.optString("path", ""));
            if (video.isFile() && video.length() > 0) out.put(meta);
        }
        return out;
    }

    static void delete(Context ctx, String id) {
        if (!id.matches("[A-Za-z0-9_-]+")) return;
        File d = dir(ctx);
        //noinspection ResultOfMethodCallIgnored
        new File(d, id + ".mp4").delete();
        //noinspection ResultOfMethodCallIgnored
        new File(d, id + ".json").delete();
    }

    @Nullable
    private static JSONObject read(File f) {
        try (InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[(int) f.length()];
            int off = 0;
            while (off < buf.length) {
                int n = in.read(buf, off, buf.length - off);
                if (n < 0) break;
                off += n;
            }
            return new JSONObject(new String(buf, 0, off, StandardCharsets.UTF_8));
        } catch (Exception e) {
            return null;
        }
    }
}
