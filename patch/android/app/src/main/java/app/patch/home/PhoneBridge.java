package app.patch.home;

import android.app.SearchManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.media.AudioManager;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.util.Log;
import android.view.KeyEvent;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * How Patch's server (Node.js, in this same app) asks the phone to do things only Android can:
 * read and use the screen, open apps and web pages, play music, media keys and volume.
 * A tiny HTTP server on 127.0.0.1 with a secret that only Patch's server is given.
 */
final class PhoneBridge implements Runnable {
    private static final String TAG = "Patch";
    private static PhoneBridge instance;

    private final Context app;
    private final ServerSocket server;
    private final String token;
    private final ExecutorService workers = Executors.newFixedThreadPool(2);

    /** Music apps that can play a song by name, in the order Patch prefers them. */
    static final String[][] MUSIC_APPS = {
        {"spotify", "com.spotify.music", "Spotify"},
        {"youtube music", "com.google.android.apps.youtube.music", "YouTube Music"},
        {"yt music", "com.google.android.apps.youtube.music", "YouTube Music"},
        {"amazon music", "com.amazon.mp3", "Amazon Music"},
        {"apple music", "com.apple.android.music", "Apple Music"},
        {"deezer", "deezer.android.app", "Deezer"},
        {"tidal", "com.aspiro.tidal", "TIDAL"},
        {"pandora", "com.pandora.android", "Pandora"},
        {"soundcloud", "com.soundcloud.android", "SoundCloud"},
    };

    private PhoneBridge(Context app) throws IOException {
        this.app = app.getApplicationContext();
        this.server = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
        byte[] secret = new byte[24];
        new SecureRandom().nextBytes(secret);
        StringBuilder hex = new StringBuilder();
        for (byte b : secret) hex.append(String.format(Locale.ROOT, "%02x", b));
        this.token = hex.toString();
    }

    static synchronized PhoneBridge start(Context app) throws IOException {
        if (instance == null) {
            instance = new PhoneBridge(app);
            Thread t = new Thread(instance, "patch-bridge");
            t.setDaemon(true);
            t.start();
        }
        return instance;
    }

    String url() {
        return "http://127.0.0.1:" + server.getLocalPort();
    }

    String token() {
        return token;
    }

    @Override
    public void run() {
        while (!server.isClosed()) {
            try {
                Socket s = server.accept();
                workers.execute(() -> handle(s));
            } catch (IOException e) {
                Log.w(TAG, "Bridge stopped", e);
                return;
            }
        }
    }

    // ── HTTP ────────────────────────────────────────────────────────────────

    private void handle(Socket socket) {
        try (Socket s = socket) {
            s.setSoTimeout(20_000);
            InputStream in = new BufferedInputStream(s.getInputStream());
            String requestLine = readLine(in);
            if (requestLine == null) return;
            int length = 0;
            String secret = null;
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                if (colon <= 0) continue;
                String name = line.substring(0, colon).trim().toLowerCase(Locale.ROOT);
                String value = line.substring(colon + 1).trim();
                if (name.equals("content-length")) length = Math.min(Integer.parseInt(value), 64 * 1024);
                else if (name.equals("x-patch-phone")) secret = value;
            }
            byte[] body = new byte[length];
            int read = 0;
            while (read < length) {
                int n = in.read(body, read, length - read);
                if (n < 0) break;
                read += n;
            }
            JSONObject reply;
            String[] parts = requestLine.split(" ");
            if (!token.equals(secret) || parts.length < 2 || !parts[0].equals("POST")) {
                reply = fail("EAUTH", "Not allowed.");
            } else {
                String command = parts[1].replaceFirst("^/", "");
                JSONObject args = read > 0 ? new JSONObject(new String(body, 0, read, StandardCharsets.UTF_8)) : new JSONObject();
                reply = dispatch(command, args);
            }
            byte[] out = reply.toString().getBytes(StandardCharsets.UTF_8);
            OutputStream os = s.getOutputStream();
            os.write(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: " + out.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
            os.write(out);
            os.flush();
        } catch (Exception e) {
            Log.w(TAG, "Bridge request failed", e);
        }
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) >= 0) {
            if (c == '\n') break;
            if (c != '\r') b.write(c);
            if (b.size() > 8192) throw new IOException("header too long");
        }
        if (c < 0 && b.size() == 0) return null;
        return b.toString(StandardCharsets.UTF_8.name());
    }

    // ── Commands ────────────────────────────────────────────────────────────

    private JSONObject dispatch(String command, JSONObject a) throws JSONException {
        switch (command) {
            case "status":
                return ok().put("screen", PatchAccessibility.get() != null).put("listening", ListeningService.isRunning()).put("musicApps", new JSONArray(musicApps()));
            case "screen":
            case "tap":
            case "scroll":
            case "type":
            case "enter":
            case "global": {
                PatchAccessibility screen = PatchAccessibility.get();
                if (screen == null) return fail("ENOSCREEN", "Patch can't see the screen yet. Turn on Patch in your phone's Accessibility settings (Patch shows you how).");
                return screen.command(command, a);
            }
            case "open_app":
                return openApp(a.optString("name"));
            case "apps":
                return apps();
            case "open_url":
                return openUrl(a.optString("url"));
            case "play_media":
                return playMedia(a.optString("query"), a.optString("app"), a.optString("kind"));
            case "media":
                return mediaKey(a.optString("action"));
            case "volume":
                return volume(a.optString("action"), a.optInt("percent", -1));
            default:
                return fail("EUNKNOWN", "Unknown phone command: " + command);
        }
    }

    static JSONObject ok() throws JSONException {
        return new JSONObject().put("ok", true);
    }

    static JSONObject fail(String code, String message) {
        try {
            return new JSONObject().put("ok", false).put("code", code).put("message", message);
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Starts an activity. With screen access on, Android lets Patch do this even while another app is in front. */
    private void launch(Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PatchAccessibility screen = PatchAccessibility.get();
        Context from = screen != null ? screen : app;
        from.startActivity(intent);
    }

    // ── Apps ────────────────────────────────────────────────────────────────

    static String norm(String s) {
        return s == null ? "" : s.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]+", " ").trim();
    }

    private List<ResolveInfo> launchableApps() {
        Intent launcher = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        return app.getPackageManager().queryIntentActivities(launcher, 0);
    }

    private JSONObject apps() throws JSONException {
        PackageManager pm = app.getPackageManager();
        JSONArray list = new JSONArray();
        for (ResolveInfo ri : launchableApps()) list.put(String.valueOf(ri.loadLabel(pm)));
        return ok().put("apps", list);
    }

    private JSONObject openApp(String name) throws JSONException {
        String want = norm(name);
        if (want.isEmpty()) return fail("EVALUE", "Which app should I open?");
        PackageManager pm = app.getPackageManager();
        Intent intent = null;
        String label = null;
        if (want.matches("(the |my |web )?(browser|internet|web)")) {
            ResolveInfo ri = pm.resolveActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com")), PackageManager.MATCH_DEFAULT_ONLY);
            if (ri != null && ri.activityInfo != null && !"android".equals(ri.activityInfo.packageName)) {
                intent = pm.getLaunchIntentForPackage(ri.activityInfo.packageName);
                label = String.valueOf(ri.loadLabel(pm));
            }
        }
        if (intent == null) {
            ResolveInfo best = null;
            int bestScore = 0;
            for (ResolveInfo ri : launchableApps()) {
                String l = norm(String.valueOf(ri.loadLabel(pm)));
                int score = l.equals(want) ? 100 : l.startsWith(want) ? 80 : want.startsWith(l) && l.length() >= 3 ? 70 : l.contains(want) ? 60 : allWords(l, want) ? 50 : 0;
                if (score > bestScore || (score == bestScore && best != null && l.length() < norm(String.valueOf(best.loadLabel(pm))).length())) {
                    best = ri;
                    bestScore = score;
                }
            }
            if (best == null) return fail("ENOTFOUND", "I can't find an app called “" + name + "” on this phone.");
            intent = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClassName(best.activityInfo.packageName, best.activityInfo.name);
            label = String.valueOf(best.loadLabel(pm));
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        try {
            launch(intent);
        } catch (ActivityNotFoundException | SecurityException e) {
            return fail("EFAILED", "Android wouldn't open " + label + ".");
        }
        Log.i(TAG, "Opened " + label);
        return ok().put("app", label);
    }

    private static boolean allWords(String haystack, String words) {
        for (String w : words.split(" ")) if (!w.isEmpty() && !haystack.contains(w)) return false;
        return true;
    }

    private JSONObject openUrl(String url) throws JSONException {
        Uri u = Uri.parse(url);
        if (!"http".equals(u.getScheme()) && !"https".equals(u.getScheme())) return fail("EVALUE", "I only open web pages.");
        Log.i(TAG, "Opening " + u.getHost() + " outside Patch");
        try {
            launch(new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException e) {
            return fail("ENOAPP", "There's no app on this phone that can open web pages.");
        }
        return ok();
    }

    // ── Music ───────────────────────────────────────────────────────────────

    private JSONObject playMedia(String query, String appName, String kind) throws JSONException {
        if (query == null || query.trim().isEmpty()) return fail("EVALUE", "What should I play?");
        PackageManager pm = app.getPackageManager();
        Intent probe = new Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH);
        List<ResolveInfo> players = pm.queryIntentActivities(probe, 0);
        String pkg = null;
        String label = null;
        String wanted = norm(appName);
        if (!wanted.isEmpty()) {
            for (String[] m : MUSIC_APPS) if (wanted.equals(m[0]) || wanted.startsWith(m[0])) pkg = m[1];
            if (pkg == null) {
                for (ResolveInfo ri : players) {
                    if (norm(String.valueOf(ri.loadLabel(pm))).contains(wanted)) pkg = ri.activityInfo.packageName;
                }
            }
            if (pkg == null || !handles(players, pkg)) return fail("ENOAPP", appLabel(appName) + " isn't on this phone (or can't play songs by name).");
        } else {
            for (String[] m : MUSIC_APPS) {
                if (handles(players, m[1])) {
                    pkg = m[1];
                    break;
                }
            }
            if (pkg == null && !players.isEmpty()) pkg = players.get(0).activityInfo.packageName;
            if (pkg == null) return fail("ENOAPP", "There's no music app on this phone that can play a song by name. Spotify or YouTube Music can.");
        }
        for (ResolveInfo ri : players) if (ri.activityInfo.packageName.equals(pkg)) label = String.valueOf(ri.loadLabel(pm));

        Intent play = new Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH).setPackage(pkg);
        play.putExtra(SearchManager.QUERY, query);
        if ("playlist".equals(kind)) {
            play.putExtra(MediaStore.EXTRA_MEDIA_FOCUS, "android.intent.extra.playlist");
            play.putExtra("android.intent.extra.playlist", query);
        } else if ("album".equals(kind)) {
            play.putExtra(MediaStore.EXTRA_MEDIA_FOCUS, MediaStore.Audio.Albums.ENTRY_CONTENT_TYPE);
            play.putExtra(MediaStore.EXTRA_MEDIA_ALBUM, query);
        } else if ("artist".equals(kind)) {
            play.putExtra(MediaStore.EXTRA_MEDIA_FOCUS, MediaStore.Audio.Artists.ENTRY_CONTENT_TYPE);
            play.putExtra(MediaStore.EXTRA_MEDIA_ARTIST, query);
        } else {
            play.putExtra(MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/*");
        }
        try {
            launch(play);
        } catch (ActivityNotFoundException e) {
            return fail("ENOAPP", (label != null ? label : "That app") + " couldn't play it.");
        }
        Log.i(TAG, "Asked " + label + " to play");
        return ok().put("app", label);
    }

    private static boolean handles(List<ResolveInfo> players, String pkg) {
        for (ResolveInfo ri : players) if (ri.activityInfo.packageName.equals(pkg)) return true;
        return false;
    }

    private static String appLabel(String asked) {
        String n = norm(asked);
        for (String[] m : MUSIC_APPS) if (n.startsWith(m[0])) return m[2];
        return asked;
    }

    private JSONObject mediaKey(String action) throws JSONException {
        int code;
        switch (action) {
            case "play": code = KeyEvent.KEYCODE_MEDIA_PLAY; break;
            case "pause": code = KeyEvent.KEYCODE_MEDIA_PAUSE; break;
            case "next": code = KeyEvent.KEYCODE_MEDIA_NEXT; break;
            case "previous": code = KeyEvent.KEYCODE_MEDIA_PREVIOUS; break;
            case "stop": code = KeyEvent.KEYCODE_MEDIA_STOP; break;
            default: code = KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE;
        }
        AudioManager am = app.getSystemService(AudioManager.class);
        long now = SystemClock.uptimeMillis();
        am.dispatchMediaKeyEvent(new KeyEvent(now, now, KeyEvent.ACTION_DOWN, code, 0));
        am.dispatchMediaKeyEvent(new KeyEvent(now, now, KeyEvent.ACTION_UP, code, 0));
        return ok().put("playing", am.isMusicActive());
    }

    private JSONObject volume(String action, int percent) throws JSONException {
        AudioManager am = app.getSystemService(AudioManager.class);
        int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        switch (action) {
            // adjustVolume reaches whatever is playing, including Spotify on a speaker (Spotify Connect).
            case "up": am.adjustVolume(AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI); break;
            case "down": am.adjustVolume(AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI); break;
            case "mute": am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_MUTE, AudioManager.FLAG_SHOW_UI); break;
            case "unmute": am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, AudioManager.FLAG_SHOW_UI); break;
            case "set":
                if (percent < 0 || percent > 100) return fail("EVALUE", "Give me a volume from 0 to 100.");
                am.setStreamVolume(AudioManager.STREAM_MUSIC, Math.round(max * percent / 100f), AudioManager.FLAG_SHOW_UI);
                break;
            default:
                return fail("EVALUE", "Volume up, down, mute, unmute or a percentage.");
        }
        int now = am.getStreamVolume(AudioManager.STREAM_MUSIC);
        return ok().put("volume", max > 0 ? Math.round(now * 100f / max) : 0);
    }

    /** The music apps on this phone that can play a song by name (for the dashboard and the agent). */
    List<String> musicApps() {
        PackageManager pm = app.getPackageManager();
        List<String> out = new ArrayList<>();
        for (ResolveInfo ri : pm.queryIntentActivities(new Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH), 0)) out.add(String.valueOf(ri.loadLabel(pm)));
        return out;
    }
}
