package app.patch.tvapp;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * A TV app made with Patch: its pages are in assets/app/ (index.html and Patch's small runtime),
 * shown full screen. The remote's arrows and OK go to the page, Back goes back (then leaves).
 * A "website" app shows that site instead, with a pointer moved by the arrows (OK clicks; Menu
 * switches the pointer off for sites that work with the arrows). A "browser" app is the same for
 * any site: it starts on its own page (a search box), or on the link it was opened with.
 *
 * The page is open to DevTools, which on Android only ADB can reach (and ADB is what the TV's
 * owner allowed Patch to use). That is how Patch reads a page for the person and clicks, types
 * and scrolls in it: see patch/src/tvweb.
 */
public final class AppActivity extends Activity {
    private static final String TAG = "PatchTV";
    /** Pages are served from here (an address Android keeps for apps' own files). */
    static final String HOST = "appassets.androidplatform.net";
    static final String BASE = "https://" + HOST + "/app/";

    private WebView web;
    private FrameLayout root;
    private Pointer pointer;
    private TextView problem;
    private View fullscreen;
    private WebChromeClient.CustomViewCallback fullscreenDone;
    private boolean website;
    private boolean browser;
    private String siteUrl;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        JSONObject app = readConfig();
        boolean hasUrl = app.optString("url", "").matches("^https?://.+");
        browser = "browser".equals(app.optString("kind"));
        website = browser || ("website".equals(app.optString("kind")) && hasUrl);
        siteUrl = website && hasUrl ? app.optString("url") : null;
        Log.i(TAG, "Showing " + app.optString("name", "app") + " (" + app.optString("kind", "?") + ")");
        // Lets Patch see into the page over ADB (see the note at the top).
        WebView.setWebContentsDebuggingEnabled(true);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW); // radio streams and pictures on plain http
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        if (website) {
            s.setUseWideViewPort(true);
            s.setLoadWithOverviewMode(true);
            pointer = new Pointer(this);
            root.addView(pointer, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            String asked = browser ? linkIn(getIntent()) : null;
            web.loadUrl(asked != null ? asked : siteUrl != null ? siteUrl : BASE + "index.html");
        } else {
            // Only the app's own pages can use the bridge (never a website it opens).
            web.addJavascriptInterface(new Bridge(), "PatchTV");
            web.loadUrl(BASE + "index.html");
        }
        web.requestFocus();
    }

    /** The web address the app was opened with (the browser can be started on a page), or null. */
    private static String linkIn(Intent intent) {
        Uri u = intent == null ? null : intent.getData();
        if (u == null || u.getHost() == null) return null;
        return "https".equals(u.getScheme()) || "http".equals(u.getScheme()) ? u.toString() : null;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String asked = browser ? linkIn(intent) : null;
        if (asked != null) web.loadUrl(asked);
    }

    private JSONObject readConfig() {
        try (InputStream in = getAssets().open("app/app.json")) {
            return new JSONObject(new String(readAll(in), StandardCharsets.UTF_8));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }

    // ── The app's own files ────────────────────────────────────────────────

    private static final Map<String, String> TYPES = new HashMap<>();

    static {
        TYPES.put("html", "text/html");
        TYPES.put("js", "text/javascript");
        TYPES.put("css", "text/css");
        TYPES.put("json", "application/json");
        TYPES.put("jpg", "image/jpeg");
        TYPES.put("jpeg", "image/jpeg");
        TYPES.put("png", "image/png");
        TYPES.put("webp", "image/webp");
        TYPES.put("gif", "image/gif");
        TYPES.put("svg", "image/svg+xml");
        TYPES.put("mp3", "audio/mpeg");
        TYPES.put("mp4", "video/mp4");
        TYPES.put("woff2", "font/woff2");
    }

    private WebResourceResponse appFile(Uri url) {
        String path = url.getPath() == null ? "" : url.getPath();
        if (!path.startsWith("/app/") || path.contains("..")) return missing();
        String name = path.substring("/app/".length());
        if (name.isEmpty()) name = "index.html";
        String ext = name.lastIndexOf('.') >= 0 ? name.substring(name.lastIndexOf('.') + 1).toLowerCase() : "";
        String type = TYPES.containsKey(ext) ? TYPES.get(ext) : "application/octet-stream";
        try {
            InputStream in = getAssets().open("app/" + name);
            WebResourceResponse r = new WebResourceResponse(type, type.startsWith("text/") || type.endsWith("json") ? "utf-8" : null, in);
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-cache");
            r.setResponseHeaders(headers);
            return r;
        } catch (IOException e) {
            return missing();
        }
    }

    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not found", new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
    }

    private final class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            return HOST.equals(u.getHost()) ? appFile(u) : null;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return leave(request.getUrl());
        }

        @SuppressWarnings("deprecation")
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return leave(Uri.parse(url));
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (problem != null && !"about:blank".equals(url)) {
                root.removeView(problem);
                problem = null;
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showProblem();
        }

        @SuppressWarnings("deprecation")
        @Override
        public void onReceivedError(WebView view, int code, String description, String url) {
            if (url != null && (url.equals(view.getUrl()) || url.equals(siteUrl))) showProblem();
        }
    }

    /** Whether a link leaves the app: other sites open in the TV's own apps, unless this is a website app. */
    private boolean leave(Uri u) {
        String scheme = u.getScheme() == null ? "" : u.getScheme();
        if (HOST.equals(u.getHost())) return false;
        if (website && ("http".equals(scheme) || "https".equals(scheme))) return false;
        openOutside(u);
        return true;
    }

    private void openOutside(Uri u) {
        try {
            Intent i = "intent".equals(u.getScheme()) ? Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME) : new Intent(Intent.ACTION_VIEW, u);
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            i.setComponent(null);
            i.setSelector(null);
            startActivity(i);
        } catch (Exception e) {
            Toast.makeText(this, "Nothing on this TV can open that.", Toast.LENGTH_LONG).show();
        }
    }

    private void showProblem() {
        if (problem != null) return;
        problem = new TextView(this);
        problem.setText(website ? "This site didn't open. Check the TV's internet connection, then press OK to try again." : "This app didn't open.");
        problem.setTextColor(Color.WHITE);
        problem.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26);
        problem.setGravity(Gravity.CENTER);
        problem.setPadding(80, 80, 80, 80);
        problem.setBackgroundColor(Color.rgb(11, 15, 29));
        root.addView(problem, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    // ── Full-screen video (a website's own players) ────────────────────────

    private final class Chrome extends WebChromeClient {
        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (fullscreen != null) {
                callback.onCustomViewHidden();
                return;
            }
            fullscreen = view;
            fullscreenDone = callback;
            root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            if (pointer != null) pointer.bringToFront();
        }

        @Override
        public void onHideCustomView() {
            hideFullscreen();
        }
    }

    private void hideFullscreen() {
        if (fullscreen == null) return;
        root.removeView(fullscreen);
        fullscreen = null;
        WebChromeClient.CustomViewCallback done = fullscreenDone;
        fullscreenDone = null;
        if (done != null) done.onCustomViewHidden();
    }

    // ── The remote ─────────────────────────────────────────────────────────

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int code = e.getKeyCode();
        boolean down = e.getAction() == KeyEvent.ACTION_DOWN;
        if (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_ESCAPE) {
            if (!down && !e.isCanceled()) goBack();
            return true;
        }
        if (problem != null && (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER)) {
            if (down) web.reload();
            return true;
        }
        if (website && pointer != null) {
            if (code == KeyEvent.KEYCODE_MENU) {
                if (down && e.getRepeatCount() == 0) {
                    pointer.setOn(!pointer.on);
                    Toast.makeText(this, pointer.on ? "Pointer on: the arrows move it, OK clicks." : "Pointer off: the arrows move between links.", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
            if (pointer.on) {
                switch (code) {
                    case KeyEvent.KEYCODE_DPAD_UP:
                    case KeyEvent.KEYCODE_DPAD_DOWN:
                    case KeyEvent.KEYCODE_DPAD_LEFT:
                    case KeyEvent.KEYCODE_DPAD_RIGHT:
                        if (down) pointer.move(code, e.getRepeatCount());
                        return true;
                    case KeyEvent.KEYCODE_DPAD_CENTER:
                    case KeyEvent.KEYCODE_ENTER:
                    case KeyEvent.KEYCODE_NUMPAD_ENTER:
                    case KeyEvent.KEYCODE_BUTTON_A:
                        if (down && e.getRepeatCount() == 0) pointer.click();
                        return true;
                    default:
                        break;
                }
            }
        }
        return super.dispatchKeyEvent(e);
    }

    private void goBack() {
        if (fullscreen != null) {
            hideFullscreen();
            return;
        }
        if (website) {
            if (web.canGoBack()) web.goBack();
            else finish();
            return;
        }
        // The app's page decides first (closing a video, say); otherwise leave.
        web.evaluateJavascript("(window.tvkit && window.tvkit.back) ? String(window.tvkit.back()) : 'false'", value -> {
            if (!"\"true\"".equals(value)) finish();
        });
    }

    /** The pointer for websites: arrows move it (faster when held), OK taps where it is. */
    private final class Pointer extends View {
        final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
        final float radius;
        float x = -1;
        float y = -1;
        boolean on = true;
        long pressedAt;

        Pointer(Activity a) {
            super(a);
            radius = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 11, getResources().getDisplayMetrics());
            fill.setColor(Color.argb(200, 255, 255, 255));
            ring.setColor(Color.argb(230, 40, 50, 120));
            ring.setStyle(Paint.Style.STROKE);
            ring.setStrokeWidth(radius / 3);
            setFocusable(false);
        }

        void setOn(boolean v) {
            on = v;
            invalidate();
        }

        void move(int code, int repeat) {
            if (x < 0) center();
            float step = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, Math.min(10 + repeat * 5, 60), getResources().getDisplayMetrics());
            float dx = code == KeyEvent.KEYCODE_DPAD_LEFT ? -step : code == KeyEvent.KEYCODE_DPAD_RIGHT ? step : 0;
            float dy = code == KeyEvent.KEYCODE_DPAD_UP ? -step : code == KeyEvent.KEYCODE_DPAD_DOWN ? step : 0;
            float nx = x + dx;
            float ny = y + dy;
            float margin = getHeight() * 0.06f;
            // At the top or bottom edge, scroll the page instead.
            if (ny < margin && dy < 0) web.evaluateJavascript("window.scrollBy(0," + (int) (dy * 3) + ")", null);
            if (ny > getHeight() - margin && dy > 0) web.evaluateJavascript("window.scrollBy(0," + (int) (dy * 3) + ")", null);
            x = Math.max(0, Math.min(getWidth() - 1, nx));
            y = Math.max(margin / 2, Math.min(getHeight() - margin / 2, ny));
            invalidate();
        }

        void center() {
            x = getWidth() / 2f;
            y = getHeight() / 2f;
        }

        void click() {
            if (x < 0) center();
            long t = SystemClock.uptimeMillis();
            MotionEvent d = MotionEvent.obtain(t, t, MotionEvent.ACTION_DOWN, x, y, 0);
            d.setSource(InputDevice.SOURCE_TOUCHSCREEN);
            web.dispatchTouchEvent(d);
            d.recycle();
            MotionEvent u = MotionEvent.obtain(t, t + 60, MotionEvent.ACTION_UP, x, y, 0);
            u.setSource(InputDevice.SOURCE_TOUCHSCREEN);
            web.dispatchTouchEvent(u);
            u.recycle();
            pressedAt = SystemClock.uptimeMillis();
            invalidate();
            postInvalidateDelayed(220);
        }

        @Override
        protected void onDraw(Canvas c) {
            if (!on) return;
            if (x < 0) center();
            boolean pressed = SystemClock.uptimeMillis() - pressedAt < 200;
            float r = pressed ? radius * 0.75f : radius;
            c.drawCircle(x, y, r, fill);
            c.drawCircle(x, y, r, ring);
        }
    }

    // ── What the app's pages can ask for (window.PatchTV) ──────────────────

    private final class Bridge {
        /** Open a link in the TV's own apps (a YouTube video opens in its YouTube app). */
        @JavascriptInterface
        public void openUrl(String url) {
            final Uri u = Uri.parse(url == null ? "" : url);
            if (!"https".equals(u.getScheme()) && !"http".equals(u.getScheme())) return;
            runOnUiThread(() -> openOutside(u));
        }

        /** Open another app on the TV by its id. */
        @JavascriptInterface
        public void launch(String pkg) {
            if (pkg == null || !pkg.matches("^[A-Za-z0-9_.]+$")) return;
            runOnUiThread(() -> {
                PackageManager pm = getPackageManager();
                Intent i = pm.getLeanbackLaunchIntentForPackage(pkg);
                if (i == null) i = pm.getLaunchIntentForPackage(pkg);
                if (i == null) {
                    Toast.makeText(AppActivity.this, "That app isn't on this TV.", Toast.LENGTH_LONG).show();
                    return;
                }
                try {
                    startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                } catch (ActivityNotFoundException e) {
                    Toast.makeText(AppActivity.this, "That app wouldn't open.", Toast.LENGTH_LONG).show();
                }
            });
        }

        /** The TV's apps, as [{ name, package }] (JSON). */
        @JavascriptInterface
        public String apps() {
            PackageManager pm = getPackageManager();
            Set<String> seen = new HashSet<>();
            List<JSONObject> list = new ArrayList<>();
            for (String cat : new String[] {Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER}) {
                Intent query = new Intent(Intent.ACTION_MAIN).addCategory(cat);
                for (ResolveInfo r : pm.queryIntentActivities(query, 0)) {
                    String pkg = r.activityInfo.packageName;
                    if (pkg.equals(getPackageName()) || !seen.add(pkg)) continue;
                    try {
                        list.add(new JSONObject().put("name", String.valueOf(r.loadLabel(pm))).put("package", pkg));
                    } catch (Exception ignored) {
                        // skip it
                    }
                }
            }
            Collections.sort(list, (a, b) -> a.optString("name").compareToIgnoreCase(b.optString("name")));
            JSONArray out = new JSONArray();
            for (JSONObject o : list) out.put(o);
            return out.toString();
        }

        /** Keep the screen on (photo frames, clocks, radio) or let it sleep again. */
        @JavascriptInterface
        public void keepAwake(boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        @JavascriptInterface
        public void exit() {
            runOnUiThread(AppActivity.this::finish);
        }
    }

    // ── Life cycle ─────────────────────────────────────────────────────────

    @Override
    protected void onPause() {
        // Leaving the app stops its sound (a radio, a video), as TV apps do.
        if (!website) web.evaluateJavascript("Array.prototype.forEach.call(document.querySelectorAll('audio,video'),function(m){m.pause()})", null);
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
